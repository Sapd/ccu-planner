//! Read-only RSI transport. Cookies and CSRF state never cross IPC.
use crate::session_store::{delete_session, load_session, needed_cookie, save_session, Session};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

const ORIGIN: &str = "https://robertsspaceindustries.com";
const GQL: &str = "/pledge-store/api/upgrade/v2/graphql";
/// The store catalog's browse query (src/sync/catalog-query.mjs) is POSTed here, with the session, on the website's own /graphql.
const CATALOG_GQL: &str = "/graphql";
const CATALOG_OPERATION: &str = "GetBrowseSkusByFilter";
const CONTEXT: &str = "/api/ship-upgrades/setContextToken";
const PROBE: &str = "/en/account/pledges?page=1&pagesize=1";
const EXPIRED: &str = "Sign-in expired";
const SESSION_NOT_SAVED: &str =
    "Signed in, but the session couldn't be saved; you'll need to sign in again next time";

/// The client, the cancel flag, and the held `<data>/sync.lock` while a sync runs (dropped on end, error or panic).
pub struct RsiState(
    Mutex<Client>,
    Arc<AtomicBool>,
    std::sync::Mutex<Option<crate::lock::SyncGuard>>,
);
impl Default for RsiState {
    fn default() -> Self {
        let client = Client::default();
        let cancel = client.cancelled.clone();
        Self(Mutex::new(client), cancel, std::sync::Mutex::new(None))
    }
}
struct Client {
    http: reqwest::Client,
    cancelled: Arc<AtomicBool>,
    #[cfg(test)]
    test_origin: String,
    session: Option<Session>,
    persisted: Option<Session>,
    context: bool,
    last: Option<tokio::time::Instant>,
}
impl Default for Client {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .user_agent(concat!("CCUPlanner/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("HTTP client"),
            #[cfg(test)]
            test_origin: ORIGIN.into(),
            session: None,
            persisted: None,
            context: false,
            last: None,
            cancelled: Arc::default(),
        }
    }
}
fn context_body() -> Value {
    json!({"fromShipId":null,"toShipId":null,"toSkuId":null,"pledgeId":null})
}

fn keys_are(o: &serde_json::Map<String, Value>, keys: &[&str]) -> bool {
    o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k))
}

/// True only for the exact body shape of src/sync/catalog-query.mjs catalogBody(): the pinned query, a page of 100 (page 1..=100),
/// RSI's own product ids and at most one of its tag facets, the fixed sort, and no "mutation" anywhere. Mirrors isCatalogBody.
fn is_catalog_body(body: &Value) -> bool {
    let Ok(spec) = serde_json::from_str::<Value>(include_str!("../../../src/sync/catalog-query.json")) else {
        return false;
    };
    let Some(b) = body.as_object() else { return false };
    if !keys_are(b, &["operationName", "query", "variables"])
        || b["operationName"] != CATALOG_OPERATION
        || Some(&b["query"]) != spec.get("query")
        || body.to_string().to_lowercase().contains("mutation")
    {
        return false;
    }
    let Some(v) = b["variables"].as_object().filter(|v| keys_are(v, &["query"])) else { return false };
    let Some(q) = v["query"].as_object().filter(|q| keys_are(q, &["limit", "page", "skus", "sort"])) else { return false };
    if q["limit"].as_u64() != Some(100) || !q["page"].as_u64().is_some_and(|p| (1..=100).contains(&p)) {
        return false;
    }
    if !q["sort"].as_object().is_some_and(|s| keys_are(s, &["direction", "field"]) && s["direction"] == "desc" && s["field"] == "weight") {
        return false;
    }
    let Some(skus) = q["skus"].as_object() else { return false };
    if !skus.keys().all(|k| k == "products" || k == "filtersFromTags") {
        return false;
    }
    let allowed = spec["products"].as_array().cloned().unwrap_or_default();
    let Some(products) = skus.get("products").and_then(Value::as_array) else { return false };
    if products.is_empty() || products.len() > 8 || !products.iter().all(|p| p.as_u64().is_some() && allowed.contains(p)) {
        return false;
    }
    if let Some(f) = skus.get("filtersFromTags") {
        let Some(f) = f.as_object().filter(|f| keys_are(f, &["facetIdentifiers", "tagIdentifiers"])) else { return false };
        let one = |k: &str| f[k].as_array().filter(|a| a.len() == 1).and_then(|a| a[0].as_str().map(str::to_owned));
        let (Some(facet), Some(tag)) = (one("facetIdentifiers"), one("tagIdentifiers")) else { return false };
        if !spec["facets"][&facet].as_array().is_some_and(|tags| tags.iter().any(|t| t == tag.as_str())) {
            return false;
        }
    }
    true
}

pub fn validate_request(method: &str, path: &str, body: &Option<Value>) -> Result<(), String> {
    if path.contains(['\\', '#', '%'])
        || path.contains("..")
        || path.chars().any(char::is_whitespace)
    {
        return Err("path not allowlisted".into());
    }
    if method == "GET"
        && body.is_none()
        && (path.starts_with("/en/account/pledges?")
            || path.starts_with("/en/account/buy-back-pledges?"))
    {
        return Ok(());
    }
    if method == "POST" && path == CONTEXT && body.as_ref() == Some(&context_body()) {
        return Ok(());
    }
    if method == "POST" && path == CATALOG_GQL && body.as_ref().is_some_and(is_catalog_body) {
        return Ok(());
    }
    let queries: Value = serde_json::from_str(include_str!("../../../src/sync/queries.json"))
        .map_err(|e| e.to_string())?;
    if method == "POST" && path == GQL {
        if let Some(ops) = body.as_ref().and_then(Value::as_array) {
            if !ops.is_empty()
                && ops.iter().all(|op| {
                    let name = op
                        .get("operationName")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    queries
                        .get(name)
                        .is_some_and(|q| Some(q) == op.get("query"))
                        && !op.to_string().to_lowercase().contains("mutation")
                })
            {
                return Ok(());
            }
        }
    }
    Err("RSI request not allowlisted".into())
}
fn has_signin_form(html: &str) -> bool {
    static RULE: OnceLock<regex::bytes::Regex> = OnceLock::new();
    RULE.get_or_init(|| {
        let pattern: String =
            serde_json::from_str(include_str!("../../../src/sync/signin-rule.json"))
                .expect("valid shared sign-in rule");
        regex::bytes::RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .unicode(false)
            .build()
            .expect("portable sign-in regex")
    })
    .is_match(html.as_bytes())
}
fn csrf_from(html: &str) -> Option<String> {
    html.split("<meta name=\"csrf-token\" content=\"")
        .nth(1)?
        .split('"')
        .next()
        .map(str::to_owned)
}
fn is_login_redirect(status: u16, location: &str) -> bool {
    let loc = location.to_lowercase();
    (300..400).contains(&status)
        && (loc.contains("signin") || loc.contains("sign-in") || loc.contains("login"))
}
/// The store listing is the one response RSI sends in large pieces: at most this many bytes are read.
const MAX_CATALOG_RESPONSE: usize = 20 * 1024 * 1024;
fn is_catalog_refusal(method: &str, path: &str, status: u16) -> bool {
    method == "POST" && path == CATALOG_GQL && status == 401
}
async fn read_capped(mut res: reqwest::Response, max: usize) -> Result<String, String> {
    if res.content_length().is_some_and(|n| n > max as u64) {
        return Err("RSI store listing too large".into());
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|_| "Could not read RSI response".to_string())?
    {
        if bytes.len() + chunk.len() > max {
            return Err("RSI store listing too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Could not read RSI response".to_string())
}
fn is_expired(status: u16, location: &str) -> bool {
    status == 401 || is_login_redirect(status, location)
}
fn login_navigation(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            host == "robertsspaceindustries.com" || host.ends_with(".robertsspaceindustries.com")
        })
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}
fn retry_delay(status: u16, attempt: u32) -> Option<Duration> {
    ((status == 429 || (500..600).contains(&status)) && attempt < 4)
        .then(|| Duration::from_secs(1 << attempt))
}
impl Client {
    async fn exchange(
        &mut self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<reqwest::Response, String> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err("Sync cancelled; progress saved".into());
        }
        if let Some(last) = self.last {
            tokio::time::sleep_until(last + Duration::from_secs(1)).await;
        }
        if self.cancelled.load(Ordering::Relaxed) {
            return Err("Sync cancelled; progress saved".into());
        }
        self.last = Some(tokio::time::Instant::now());
        let session = self.session.as_ref().ok_or(EXPIRED)?;
        let origin = ORIGIN;
        #[cfg(test)]
        let origin = if self.test_origin.is_empty() {
            origin
        } else {
            &self.test_origin
        };
        let mut req = self
            .http
            .request(
                if method == "GET" {
                    reqwest::Method::GET
                } else {
                    reqwest::Method::POST
                },
                format!("{origin}{path}"),
            )
            .header(
                "accept",
                if body.is_some() {
                    "application/json"
                } else {
                    "text/html,application/xhtml+xml"
                },
            )
            .header("accept-language", "en-US,en;q=0.9")
            .header("origin", ORIGIN)
            .header(
                "referer",
                format!("{ORIGIN}/en/account/pledges?page=1&pagesize=10"),
            )
            .header(
                "cookie",
                session
                    .cookies
                    .iter()
                    .filter(|(name, _)| needed_cookie(name))
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            );
        if path == CONTEXT {
            req = req.header(
                "x-rsi-token",
                session
                    .cookies
                    .get("Rsi-Token")
                    .map(String::as_str)
                    .unwrap_or(""),
            );
        }
        if path == GQL || path == CATALOG_GQL {
            req = req.header("x-csrf-token", &session.csrf);
        }
        if let Some(body) = body {
            req = req.json(body);
        }
        let res = req
            .send()
            .await
            .map_err(|_| "RSI network request failed".to_string())?;
        let session = self.session.as_mut().ok_or(EXPIRED)?;
        for line in res.headers().get_all("set-cookie") {
            if let Ok(line) = line.to_str() {
                if let Ok(cookie) = tauri::webview::Cookie::parse(line.to_owned()) {
                    if !needed_cookie(cookie.name()) {
                        continue;
                    }
                    if cookie.name() == "Rsi-Token" {
                        session.expires_at = cookie.expires_datetime().map(|d| d.unix_timestamp());
                    }
                    session
                        .cookies
                        .insert(cookie.name().into(), cookie.value().into());
                }
            }
        }
        Ok(res)
    }
    fn persist_with(
        &mut self,
        save: impl FnOnce(&Session) -> Result<(), String>,
        log: impl FnOnce(&str),
    ) -> bool {
        if let Some(session) = &self.session {
            if self
                .persisted
                .as_ref()
                .is_some_and(|old| old.same_credentials(session))
            {
                return true;
            }
            match save(session) {
                Ok(()) => self.persisted = Some(session.clone()),
                Err(error) => {
                    log(&error);
                    return false;
                }
            }
        }
        true
    }
    fn persist(&mut self) -> bool {
        self.persist_with(save_session, |error| {
            eprintln!("Could not save RSI session: {error}")
        })
    }
    async fn send(
        &mut self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<String, String> {
        let mut attempt = 0;
        let mut csrf_retried = false;
        loop {
            let res = self.exchange(method, path, body).await?;
            let status = res.status().as_u16();
            if status == 403 {
                let mut refreshed = false;
                let confirmed = match self.exchange("GET", PROBE, None).await {
                    Ok(probe) => {
                        let confirmed = is_login_redirect(
                            probe.status().as_u16(),
                            probe
                                .headers()
                                .get("location")
                                .and_then(|h| h.to_str().ok())
                                .unwrap_or(""),
                        );
                        if probe.status().is_success() {
                            if let Ok(html) = probe.text().await {
                                if !has_signin_form(&html) {
                                    if let Some(csrf) = csrf_from(&html) {
                                        let session = self.session.as_mut().ok_or(EXPIRED)?;
                                        refreshed = session.csrf != csrf;
                                        session.csrf = csrf;
                                    }
                                }
                            }
                        }
                        confirmed
                    }
                    Err(_) => false,
                };
                if confirmed {
                    self.session.as_mut().ok_or(EXPIRED)?.expired = true;
                    self.context = false;
                    return Err(EXPIRED.into());
                }
                if refreshed && !csrf_retried {
                    csrf_retried = true;
                    continue;
                }
                return Err("RSI refused the request (403)".into());
            }
            if is_catalog_refusal(method, path, status) {
                // A 401 on the browse query alone is a catalog failure; the hangar session is not proven expired by it.
                return Err("RSI refused the store catalog request (401)".into());
            }
            let session = self.session.as_mut().ok_or(EXPIRED)?;
            if is_expired(
                status,
                res.headers()
                    .get("location")
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or(""),
            ) {
                session.expired = true;
                self.context = false;
                return Err(EXPIRED.into());
            }
            if let Some(delay) = retry_delay(status, attempt) {
                attempt += 1;
                tokio::time::sleep(delay).await;
                continue;
            }
            if !(200..300).contains(&status) {
                return Err(format!("RSI HTTP {status}"));
            }
            let text = if path == CATALOG_GQL {
                read_capped(res, MAX_CATALOG_RESPONSE).await?
            } else {
                res.text()
                    .await
                    .map_err(|_| "Could not read RSI response".to_string())?
            };
            if let Some(csrf) = csrf_from(&text) {
                session.csrf = csrf;
            }
            return Ok(text);
        }
    }
}

#[tauri::command]
pub async fn rsi_request(
    requester: tauri::WebviewWindow,
    state: tauri::State<'_, RsiState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    crate::main_only(&requester)?;
    validate_request(&method, &path, &body)?;
    let mut client = state.0.lock().await;
    if client.session.is_none() {
        client.session = load_session()?;
        client.persisted = client.session.clone();
    }
    if client.session.as_ref().is_none_or(|s| s.is_expired()) {
        return Err(EXPIRED.into());
    }
    let result = async {
        if path == GQL && !client.context {
            client.send("GET", PROBE, None).await?;
            client.send("POST", CONTEXT, Some(&context_body())).await?;
            client.context = true;
        }
        let text = client.send(&method, &path, body.as_ref()).await?;
        if method == "GET" {
            Ok(Value::String(text))
        } else {
            serde_json::from_str(&text).map_err(|_| "Invalid RSI JSON".into())
        }
    }
    .await;
    client.persist();
    result
}

#[tauri::command]
pub async fn rsi_session_status(
    requester: tauri::WebviewWindow,
    state: tauri::State<'_, RsiState>,
) -> Result<String, String> {
    crate::main_only(&requester)?;
    let mut client = state.0.lock().await;
    if client.session.is_none() {
        client.session = load_session()?;
        client.persisted = client.session.clone();
    }
    Ok(match &client.session {
        None => "none",
        Some(s) if s.is_expired() => "expired",
        Some(_) => "signed in",
    }
    .into())
}

#[tauri::command]
pub async fn rsi_login(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RsiState>,
) -> Result<Option<String>, String> {
    crate::main_only(&requester)?;
    if app.get_webview_window("rsi-login").is_some() {
        return Err("RSI sign-in is already open".into());
    }
    state.1.store(false, Ordering::Relaxed);
    // No remote IPC capability is granted to this window. The page owns password/2FA entry.
    let window = WebviewWindowBuilder::new(
        &app,
        "rsi-login",
        WebviewUrl::External(
            format!("{ORIGIN}/en/")
                .parse()
                .map_err(|_| "Invalid RSI URL")?,
        ),
    )
    .incognito(true)
    .on_navigation(login_navigation)
    // No popups from the remote page: a window.open or target=_blank would escape the navigation allowlist above.
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .title("Sign in to RSI")
    .build()
    .map_err(|e| e.to_string())?;
    let result = async {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
        let mut last_cookies = None;
        while tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if app.get_webview_window("rsi-login").is_none() {
                return Err("Sign-in cancelled".into());
            }
            let cookies = window
                .cookies_for_url(ORIGIN.parse().map_err(|_| "Invalid RSI URL")?)
                .map_err(|e| e.to_string())?;
            if !cookies.iter().any(|c| c.name() == "Rsi-Token") {
                continue;
            }
            let jar: BTreeMap<String, String> = cookies
                .iter()
                .filter(|c| needed_cookie(c.name()))
                .map(|c| (c.name().into(), c.value().into()))
                .collect();
            // Anonymous pages can carry Rsi-Token too. Probe only when cookies change,
            // instead of repeatedly requesting the hangar while the user enters 2FA.
            if last_cookies.as_ref() == Some(&jar) {
                continue;
            }
            last_cookies = Some(jar.clone());
            let mut client = state.0.lock().await;
            let previous = client.session.take();
            let expires_at = cookies
                .iter()
                .find(|c| c.name() == "Rsi-Token")
                .and_then(|c| c.expires_datetime())
                .map(|d| d.unix_timestamp());
            client.session = Some(Session {
                expires_at,
                cookies: jar,
                ..Session::default()
            });
            // A token alone can be anonymous: require the authenticated hangar page and CSRF.
            let probe = client.send("GET", PROBE, None).await;
            if let Ok(html) = probe {
                if csrf_from(&html).is_some() && !has_signin_form(&html) {
                    client.context = false;
                    let notice = login_notice(client.persist());
                    app.emit("rsi-session", "signed in")
                        .map_err(|e| e.to_string())?;
                    return Ok(notice);
                }
            }
            client.session = previous;
        }
        Err("Sign-in timed out".into())
    }
    .await;
    let _ = window.clear_all_browsing_data();
    let _ = window.close();
    result
}

#[tauri::command]
pub async fn rsi_logout(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RsiState>,
) -> Result<(), String> {
    crate::main_only(&requester)?;
    let mut client = state.0.lock().await;
    let deletion = delete_session();
    client.session = None;
    client.persisted = None;
    client.context = false;
    let result = finish_logout(deletion, || {
        // A private window keeps login browsing data separate from the planner.
        let window = if let Some(w) = app.get_webview_window("rsi-login") {
            w
        } else {
            WebviewWindowBuilder::new(
                &app,
                "rsi-login",
                WebviewUrl::External("about:blank".parse().map_err(|_| "Invalid blank URL")?),
            )
            .incognito(true)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?
        };
        let cleared = window.clear_all_browsing_data().map_err(|e| e.to_string());
        let closed = window.close().map_err(|e| e.to_string());
        cleared.and(closed)
    });
    let notified = app.emit("rsi-session", "none").map_err(|e| e.to_string());
    result.and(notified)
}
fn login_notice(saved: bool) -> Option<String> {
    (!saved).then(|| SESSION_NOT_SAVED.to_owned())
}
fn finish_logout(
    deletion: Result<(), String>,
    clear: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let cleared = clear(); // Run even when keychain deletion failed.
    deletion.and(cleared)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_blocks_every_write_route_and_query_substitution() {
        for path in [
            "/api/purchase",
            "/api/melt",
            "/api/gift",
            "/api/apply",
            "/pledge/buyback/1",
            "/api/cart",
            "/en/account/pledges/../cart?x",
            "https://evil.test/",
            "/en/account/pledges?%2f",
        ] {
            for method in ["GET", "POST", "DELETE", "PUT"] {
                assert!(
                    validate_request(method, path, &Some(json!({}))).is_err(),
                    "{path}"
                );
            }
        }
        for op in [
            "purchase",
            "melt",
            "gift",
            "applyUpgrade",
            "redeemBuyback",
            "addToCart",
            "getPrice",
        ] {
            assert!(validate_request(
                "POST",
                GQL,
                &Some(json!([{ "operationName":op, "query":"mutation { buy }" }]))
            )
            .is_err());
        }
        let queries: Value =
            serde_json::from_str(include_str!("../../../src/sync/queries.json")).unwrap();
        for (name, query) in queries.as_object().unwrap() {
            assert!(validate_request(
                "POST",
                GQL,
                &Some(json!([{"operationName":name,"query":query,"variables":{}}]))
            )
            .is_ok());
        }
        assert!(validate_request("GET", PROBE, &None).is_ok());
        assert!(validate_request("POST", CONTEXT, &Some(context_body())).is_ok());
        assert!(validate_request("POST", CONTEXT, &Some(json!({"pledgeId":123}))).is_err());
    }
    fn catalog_spec() -> Value {
        serde_json::from_str(include_str!("../../../src/sync/catalog-query.json")).unwrap()
    }
    fn catalog_body(skus: Value, page: u64) -> Value {
        json!({
            "operationName": CATALOG_OPERATION,
            "query": catalog_spec()["query"],
            "variables": { "query": { "limit": 100, "page": page, "skus": skus, "sort": { "direction": "desc", "field": "weight" } } }
        })
    }
    fn catalog_ok(body: Value) -> bool {
        validate_request("POST", CATALOG_GQL, &Some(body)).is_ok()
    }
    #[test]
    fn the_store_catalog_query_is_allowed_only_in_its_pinned_shape() {
        assert!(catalog_ok(catalog_body(json!({"products": [72]}), 1)));
        assert!(catalog_ok(catalog_body(json!({"products": [9, 45, 46]}), 100)));
        assert!(catalog_ok(catalog_body(
            json!({"products": [289], "filtersFromTags": {"facetIdentifiers": ["extras-gear"], "tagIdentifiers": ["filters-gear-armor"]}}),
            2
        )));
        // every pinned product id and facet tag the JS side may send is accepted
        let spec = catalog_spec();
        for p in spec["products"].as_array().unwrap() {
            assert!(catalog_ok(catalog_body(json!({"products": [p]}), 1)));
        }
        for (facet, tags) in spec["facets"].as_object().unwrap() {
            for t in tags.as_array().unwrap() {
                assert!(catalog_ok(catalog_body(
                    json!({"products": [268], "filtersFromTags": {"facetIdentifiers": [facet], "tagIdentifiers": [t]}}),
                    1
                )));
            }
        }
        let ok = catalog_body(json!({"products": [72]}), 1);
        // a mutation, another query or operation, extra keys
        let mut b = ok.clone();
        b["query"] = json!("mutation { addToCart(id: 1) { id } }");
        assert!(!catalog_ok(b));
        let mut b = ok.clone();
        b["query"] = json!(format!("{}\nmutation {{ x }}", catalog_spec()["query"].as_str().unwrap()));
        assert!(!catalog_ok(b));
        let mut b = ok.clone();
        b["query"] = json!(catalog_spec()["query"].as_str().unwrap().replace("amount", "amount price"));
        assert!(!catalog_ok(b));
        let mut b = ok.clone();
        b["operationName"] = json!("addToCart");
        assert!(!catalog_ok(b));
        let mut b = ok.clone();
        b["extensions"] = json!({});
        assert!(!catalog_ok(b));
        assert!(!catalog_ok(json!([ok.clone()])));
        // changed variables
        for (patch, why) in [
            (json!({"limit": 1000}), "limit"),
            (json!({"page": 0}), "page 0"),
            (json!({"page": 101}), "page 101"),
            (json!({"page": "1"}), "page text"),
            (json!({"sort": {"direction": "asc", "field": "weight"}}), "sort"),
            (json!({"skus": {"products": []}}), "no products"),
            (json!({"skus": {"products": ["72"]}}), "text product"),
            (json!({"skus": {"products": [73]}}), "unknown product"),
            (json!({"skus": {"products": [72, 99999]}}), "unknown product 2"),
            (json!({"skus": {"products": [72], "extra": 1}}), "extra sku key"),
            (json!({"skus": {"products": [289], "filtersFromTags": {"facetIdentifiers": ["extras-gear"], "tagIdentifiers": ["filters-paint-premium"]}}}), "tag of another facet"),
            (json!({"skus": {"products": [289], "filtersFromTags": {"facetIdentifiers": ["unknown"], "tagIdentifiers": ["filters-gear-armor"]}}}), "unknown facet"),
            (json!({"skus": {"products": [289], "filtersFromTags": {"facetIdentifiers": ["extras-gear", "paints"], "tagIdentifiers": ["filters-gear-armor"]}}}), "two facets"),
        ] {
            let mut b = ok.clone();
            for (k, v) in patch.as_object().unwrap() {
                b["variables"]["query"][k] = v.clone();
            }
            assert!(!catalog_ok(b), "{why}");
        }
        // another path, method or no body
        for (method, path) in [("GET", "/graphql"), ("PUT", "/graphql"), ("POST", "/graphql/"), ("POST", "/api/graphql"), ("POST", "/pledge-store/api/graphql"), ("POST", "/graphql?x=1"), ("POST", "/graphql#x")] {
            assert!(validate_request(method, path, &Some(ok.clone())).is_err(), "{method} {path}");
        }
        assert!(validate_request("POST", CATALOG_GQL, &None).is_err());
        // the catalog body is not accepted on the upgrade endpoint
        assert!(validate_request("POST", GQL, &Some(ok)).is_err());
    }
    #[test]
    fn catalog_pictures_come_from_rsi_hosts_only() {
        for ok in [
            "https://media.robertsspaceindustries.com/abc/store_small.jpg",
            "https://robertsspaceindustries.com/i/abc/store_small.jpg",
            "https://robertsspaceindustries.com/media/abc.png",
        ] {
            assert!(catalog_image_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "https://evil.test/a.jpg",
            "http://media.robertsspaceindustries.com/a.jpg",
            "https://robertsspaceindustries.com.evil.test/a.jpg",
            "https://user@media.robertsspaceindustries.com/a.jpg",
            "https://media.robertsspaceindustries.com:444/a.jpg",
            "https://robertsspaceindustries.com/en/account/logout",
            "https://robertsspaceindustries.com/graphql",
            "https://robertsspaceindustries.com/pledge/Gear/x",
            "https://media.robertsspaceindustries.com/a.jpg#x",
            "javascript:alert(1)",
        ] {
            assert!(catalog_image_url(bad).is_err(), "{bad}");
        }
        // the ship picture rules did not widen
        assert!(public_target("https://media.robertsspaceindustries.com/a.jpg", Public::Image).is_err());
        assert!(public_target("https://media.robertsspaceindustries.com/a.jpg", Public::CatalogImage).is_ok());
        assert_eq!(image_ext("image/jpeg"), "jpg");
        assert_eq!(image_ext("image/png"), "png");
    }
    fn mock_server(responses: Vec<String>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{BufRead, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = std::io::BufReader::new(&mut socket);
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    headers.push_str(&line);
                    if line == "\r\n" {
                        break;
                    }
                }
                let length = headers
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                requests.push(format!("{headers}{}", String::from_utf8_lossy(&body)));
                socket.write_all(response.as_bytes()).unwrap();
            }
            requests
        });
        (origin, handle)
    }
    fn response(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
            body.len()
        )
    }
    fn test_client(origin: String) -> Client {
        Client {
            test_origin: origin,
            session: Some(Session {
                cookies: BTreeMap::from([("Rsi-Token".into(), "initial".into())]),
                csrf: "initial-csrf".into(),
                ..Session::default()
            }),
            ..Client::default()
        }
    }
    #[tokio::test]
    async fn mocked_transport_retries_rotates_tokens_and_never_follows_login() {
        let (origin, server) = mock_server(vec![
            response(
                "429 Too Many Requests",
                "Set-Cookie: Rsi-Token=rotated; Path=/\r\n",
                "",
            ),
            response("200 OK", "", "<meta name=\"csrf-token\" content=\"fresh\">"),
            response("200 OK", "", "{}"),
            response("302 Found", "Location: /en/signin\r\n", ""),
        ]);
        let mut client = test_client(origin);
        let html = client.send("GET", PROBE, None).await.unwrap();
        assert!(html.contains("fresh"));
        assert_eq!(client.session.as_ref().unwrap().csrf, "fresh");
        client
            .send("POST", CONTEXT, Some(&context_body()))
            .await
            .unwrap();
        assert_eq!(client.send("GET", PROBE, None).await.unwrap_err(), EXPIRED);
        assert!(client.session.as_ref().unwrap().is_expired());
        let requests = server.join().unwrap();
        assert!(requests[1].contains("Rsi-Token=rotated"));
        assert!(requests[2].contains("x-rsi-token: rotated"));
        assert!(requests[0].contains("CCUPlanner/"));
        assert!(!requests[0].contains("Mozilla"));
    }
    #[tokio::test]
    async fn forbidden_only_expires_after_probe_redirects_to_login() {
        for (probe, expected, expired) in [
            (
                response(
                    "200 OK",
                    "",
                    "<meta name=\"csrf-token\" content=\"initial-csrf\">",
                ),
                "RSI refused the request (403)",
                false,
            ),
            (
                response("403 Forbidden", "", ""),
                "RSI refused the request (403)",
                false,
            ),
            (
                response("401 Unauthorized", "", ""),
                "RSI refused the request (403)",
                false,
            ),
            (
                response("302 Found", "Location: /en/signin\r\n", ""),
                EXPIRED,
                true,
            ),
        ] {
            let (origin, server) = mock_server(vec![response("403 Forbidden", "", ""), probe]);
            let mut client = test_client(origin);
            assert_eq!(
                client
                    .send("POST", CONTEXT, Some(&context_body()))
                    .await
                    .unwrap_err(),
                expected
            );
            assert_eq!(client.session.as_ref().unwrap().expired, expired);
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), 2);
            assert!(requests[1].starts_with(&format!("GET {PROBE} ")));
        }
    }

    #[tokio::test]
    async fn forbidden_retries_original_post_once_with_refreshed_csrf() {
        for fails_again in [false, true] {
            let mut responses = vec![
                response("403 Forbidden", "", ""),
                response("200 OK", "", "<meta name=\"csrf-token\" content=\"fresh\">"),
                response(
                    if fails_again {
                        "403 Forbidden"
                    } else {
                        "200 OK"
                    },
                    "",
                    "success",
                ),
            ];
            if fails_again {
                responses.push(response(
                    "200 OK",
                    "",
                    "<meta name=\"csrf-token\" content=\"even-newer\">",
                ));
            }
            let (origin, server) = mock_server(responses);
            let mut client = test_client(origin);
            let queries: Value =
                serde_json::from_str(include_str!("../../../src/sync/queries.json")).unwrap();
            let body = serde_json::json!([{"operationName":"initShipUpgrade", "variables":{}, "query":queries["initShipUpgrade"]}]);
            let result = client.send("POST", GQL, Some(&body)).await;
            if fails_again {
                assert_eq!(result.unwrap_err(), "RSI refused the request (403)");
            } else {
                assert_eq!(result.unwrap(), "success");
            }
            assert!(!client.session.as_ref().unwrap().expired);
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), if fails_again { 4 } else { 3 });
            assert!(requests[0].contains("x-csrf-token: initial-csrf"));
            assert!(requests[2].contains("x-csrf-token: fresh"));
            assert_eq!(
                requests[0].split("\r\n\r\n").nth(1),
                requests[2].split("\r\n\r\n").nth(1)
            );
        }
    }
    #[tokio::test]
    async fn the_catalog_query_goes_to_graphql_with_the_session_cookie_and_csrf_header() {
        let (origin, server) = mock_server(vec![response("200 OK", "", "{\"data\":{}}")]);
        let mut client = test_client(origin);
        let body = catalog_body(json!({"products": [65]}), 1);
        validate_request("POST", CATALOG_GQL, &Some(body.clone())).unwrap();
        assert_eq!(client.send("POST", CATALOG_GQL, Some(&body)).await.unwrap(), "{\"data\":{}}");
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("POST /graphql "));
        assert!(requests[0].contains("x-csrf-token: initial-csrf"));
        assert!(requests[0].to_lowercase().contains("cookie: rsi-token=initial"));
    }
    #[test]
    fn shared_signin_form_fixtures() {
        let cases: Vec<(String, bool)> =
            serde_json::from_str(include_str!("../../../test/fixtures/signin-forms.json")).unwrap();
        for (html, expected) in cases {
            assert_eq!(has_signin_form(&html), expected, "{html}");
        }
    }
    #[test]
    fn release_sync_drops_a_leaked_lock_and_cancels() {
        let dir = tempfile::tempdir().unwrap();
        let state = RsiState::default();
        begin_sync(dir.path(), &state).unwrap();
        assert!(dir.path().join(crate::lock::SYNC_LOCK).exists());
        release_sync(&state);
        assert!(!dir.path().join(crate::lock::SYNC_LOCK).exists());
        assert!(state.1.load(Ordering::Relaxed));
        release_sync(&state); // nothing held: harmless
        begin_sync(dir.path(), &state).unwrap();
        assert!(
            !state.1.load(Ordering::Relaxed),
            "a new sync starts uncancelled"
        );
    }

    #[test]
    fn begin_sync_takes_the_shared_lock_and_end_or_drop_releases_it() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (RsiState::default(), RsiState::default());
        begin_sync(dir.path(), &a).unwrap();
        // our own pid holds it, so the second state (another "process" here) is refused with the shared message
        let err = begin_sync(dir.path(), &b).unwrap_err();
        assert!(
            err.starts_with("Another sync is running (started "),
            "{err}"
        );
        // a webview reload that never ended its sync can begin again
        begin_sync(dir.path(), &a).unwrap();
        a.2.lock().unwrap().take();
        assert!(!dir.path().join(crate::lock::SYNC_LOCK).exists());
        begin_sync(dir.path(), &b).unwrap();
        drop(b);
        assert!(!dir.path().join(crate::lock::SYNC_LOCK).exists());
    }

    #[test]
    fn login_reports_unsaved_session_and_logout_always_clears_browser() {
        assert_eq!(login_notice(false).as_deref(), Some(SESSION_NOT_SAVED));
        assert_eq!(login_notice(true), None);
        let mut cleared = false;
        let error = finish_logout(Err("keychain deletion failed".into()), || {
            cleared = true;
            Err("browser failure".into())
        });
        assert!(cleared);
        assert_eq!(error.unwrap_err(), "keychain deletion failed");
    }
    #[test]
    fn saves_only_changed_credentials_and_logs_failure_without_replacing_result() {
        let mut client = test_client(String::new());
        client.persisted = client.session.clone();
        client.persist_with(
            |_| panic!("unchanged session must not save"),
            |_| panic!("no error"),
        );
        client.session.as_mut().unwrap().expired = true;
        client.persist_with(
            |_| panic!("expiry alone must not save"),
            |_| panic!("no error"),
        );
        client.session.as_mut().unwrap().csrf = "rotated".into();
        let mut logged = Vec::new();
        let result = Ok::<_, String>("request succeeded");
        let saved = client.persist_with(
            |_| Err("mock keychain failure".into()),
            |s| logged.push(s.to_owned()),
        );
        assert_eq!(login_notice(saved).as_deref(), Some(SESSION_NOT_SAVED));
        assert_eq!(result, Ok("request succeeded"));
        assert_eq!(logged, ["mock keychain failure"]);
        assert_ne!(client.persisted.as_ref().unwrap().csrf, "rotated");
        client.persist_with(|_| Ok(()), |_| panic!("no error"));
        client.persist_with(|_| panic!("already saved"), |_| panic!("no error"));
        client
            .session
            .as_mut()
            .unwrap()
            .cookies
            .insert("Rsi-Token".into(), "new-token".into());
        let mut saves = 0;
        client.persist_with(
            |_| {
                saves += 1;
                Ok(())
            },
            |_| panic!("no error"),
        );
        assert_eq!(saves, 1);
    }
    #[test]
    fn login_navigation_is_https_and_rsi_hosts_only() {
        for good in [
            "https://robertsspaceindustries.com/en/",
            "https://auth.robertsspaceindustries.com/login",
        ] {
            assert!(login_navigation(&good.parse().unwrap()));
        }
        for bad in [
            "http://robertsspaceindustries.com/en/",
            "https://robertsspaceindustries.com.evil.test",
            "https://evilrobertsspaceindustries.com",
            "https://evil.test/",
            "https://user:pass@robertsspaceindustries.com/",
        ] {
            assert!(!login_navigation(&bad.parse().unwrap()));
        }
    }
    #[tokio::test]
    async fn cancelled_transport_stops_before_network() {
        let mut client = test_client("http://127.0.0.1:1".into());
        client.cancelled.store(true, Ordering::Relaxed);
        assert!(client
            .send("GET", PROBE, None)
            .await
            .unwrap_err()
            .contains("cancelled"));
    }
    #[test]
    fn public_images_refuse_other_hosts_schemes_and_credentials() {
        for url in [
            "https://evil.test/image.png",
            "http://robertsspaceindustries.com/i",
            "https://user:pass@robertsspaceindustries.com/i",
            "https://robertsspaceindustries.com:444/i",
        ] {
            assert!(public_url(url, true).is_err());
        }
        for path in [
            "/api/cart",
            "/api/purchase",
            "/api/melt",
            "/api/gift",
            "/api/apply",
            "/pledge/buyback/1",
        ] {
            assert!(public_url(&format!("{ORIGIN}{path}"), false).is_err());
            assert!(public_url(&format!("{ORIGIN}{path}"), true).is_err());
        }
        assert!(public_url(
            "https://robertsspaceindustries.com/en/pledge/ships/test",
            false
        )
        .is_ok());
        assert!(public_url("https://robertsspaceindustries.com/media/test.png", true).is_ok());
        assert!(Session {
            expires_at: Some(1),
            ..Session::default()
        }
        .is_expired());
    }

    #[test]
    fn expiry_csrf_and_backoff() {
        assert!(is_expired(401, ""));
        assert!(!is_expired(403, ""));
        assert!(is_expired(302, "/en/sign-in"));
        assert!(!is_expired(200, ""));
        assert!(is_catalog_refusal("POST", CATALOG_GQL, 401));
        assert!(!is_catalog_refusal("POST", GQL, 401));
        assert!(!is_catalog_refusal("POST", CATALOG_GQL, 403));
        for status in [429, 500, 503] {
            for attempt in 0..4 {
                assert_eq!(
                    retry_delay(status, attempt).unwrap().as_secs(),
                    1 << attempt
                );
            }
            assert_eq!(retry_delay(status, 4), None);
        }
        assert_eq!(retry_delay(400, 0), None);
        assert_eq!(
            csrf_from("<meta name=\"csrf-token\" content=\"rotated\">"),
            Some("rotated".into())
        );
    }
}

fn public_url(url: &str, image: bool) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url).map_err(|_| "Invalid public RSI URL")?;
    if u.scheme() != "https"
        || u.host_str() != Some("robertsspaceindustries.com")
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
        || (image && !(u.path().starts_with("/i/") || u.path().starts_with("/media/")))
        || (!image && !u.path().starts_with("/en/pledge/ships/"))
    {
        return Err("Public RSI URL not allowlisted".into());
    }
    Ok(u)
}
/// A store catalog picture: https, no port or credentials, any path on media.robertsspaceindustries.com, or /i/ and /media/ on the main host.
fn catalog_image_url(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url).map_err(|_| "Invalid public RSI URL")?;
    let host = u.host_str().unwrap_or("");
    let allowed = host == "media.robertsspaceindustries.com"
        || (host == "robertsspaceindustries.com" && (u.path().starts_with("/i/") || u.path().starts_with("/media/")));
    if u.scheme() != "https" || !allowed || u.port().is_some() || !u.username().is_empty() || u.password().is_some() || u.fragment().is_some() {
        return Err("Public RSI URL not allowlisted".into());
    }
    Ok(u)
}
#[derive(Clone, Copy, PartialEq)]
enum Public {
    Page,
    Image,
    CatalogImage,
}
fn public_target(url: &str, kind: Public) -> Result<reqwest::Url, String> {
    match kind {
        Public::Page => public_url(url, false),
        Public::Image => public_url(url, true),
        Public::CatalogImage => catalog_image_url(url),
    }
}
impl Client {
    // Public image/page requests deliberately use no cookies or session headers.
    async fn public_get(&mut self, url: &str, kind: Public, gap: Duration) -> Result<(Vec<u8>, String), String> {
        let image = kind != Public::Page;
        let mut url = public_target(url, kind)?;
        let mut redirects = 0;
        for attempt in 0..=4 {
            if self.cancelled.load(Ordering::Relaxed) {
                return Err("Sync cancelled; progress saved".into());
            }
            if let Some(last) = self.last {
                tokio::time::sleep_until(last + gap).await;
            }
            if self.cancelled.load(Ordering::Relaxed) {
                return Err("Sync cancelled; progress saved".into());
            }
            self.last = Some(tokio::time::Instant::now());
            let mut res = self
                .http
                .get(url.clone())
                .send()
                .await
                .map_err(|_| "Public RSI request failed")?;
            let status = res.status().as_u16();
            if let Some(delay) = retry_delay(status, attempt) {
                tokio::time::sleep(delay).await;
                continue;
            }
            if res.status().is_redirection() {
                redirects += 1;
                if redirects > 4 {
                    return Err("Too many image redirects".into());
                }
                let location = res
                    .headers()
                    .get("location")
                    .and_then(|s| s.to_str().ok())
                    .ok_or("Missing redirect location")?;
                url = public_target(url.join(location).map_err(|_| "Bad redirect")?.as_str(), kind)?;
                continue;
            }
            if !res.status().is_success() {
                return Err(format!("Public RSI HTTP {status}"));
            }
            let mime = res
                .headers()
                .get("content-type")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("")
                .split(';')
                .next()
                .unwrap_or("")
                .to_owned();
            if image
                && !matches!(
                    mime.as_str(),
                    "image/webp" | "image/png" | "image/jpeg" | "image/avif" | "image/gif"
                )
            {
                return Err("Unsupported image type".into());
            }
            let max = if image {
                20 * 1024 * 1024
            } else {
                4 * 1024 * 1024
            };
            if res.content_length().is_some_and(|n| n > max as u64) {
                return Err("Public RSI response too large".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = res
                .chunk()
                .await
                .map_err(|_| "Could not read public RSI response")?
            {
                if bytes.len() + chunk.len() > max {
                    return Err("Public RSI response too large".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok((bytes, mime));
        }
        Err("Public RSI retry limit reached".into())
    }
}
#[tauri::command]
pub async fn rsi_public_page(
    requester: tauri::WebviewWindow,
    state: tauri::State<'_, RsiState>,
    url: String,
) -> Result<String, String> {
    crate::main_only(&requester)?;
    let (bytes, _) = state.0.lock().await.public_get(&url, Public::Page, Duration::from_secs(1)).await?;
    String::from_utf8(bytes).map_err(|_| "Invalid RSI page".into())
}
#[tauri::command]
pub async fn rsi_cache_image(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RsiState>,
    id: u64,
    url: String,
) -> Result<Value, String> {
    crate::main_only(&requester)?;
    let (bytes, mime) = state.0.lock().await.public_get(&url, Public::Image, Duration::from_secs(1)).await?;
    let s = format!("{id}-original.{}", image_ext(&mime));
    let l = s.clone();
    let dir = crate::resolve_data_dir(&app)?;
    // Serialize with other store writes; originals are cached without conversion.
    let access = app.state::<crate::StoreAccess>();
    let _guard = access.0.lock().map_err(|e| e.to_string())?;
    crate::store::sync_write(&dir, &format!("images/{s}"), &bytes, false)?;
    Ok(json!({"s":s,"l":l,"sourceUrl":url,"bytes":bytes.len()}))
}

/// One store catalog picture, public and without cookies: saved as images/catalog/<id>.<format> (kept as RSI sends it, no conversion).
/// Resolves to the name the catalog file records, "catalog/<id>.<format>". 0.3 s between pictures.
#[tauri::command]
pub async fn rsi_cache_catalog_image(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RsiState>,
    id: u64,
    url: String,
) -> Result<String, String> {
    crate::main_only(&requester)?;
    let (bytes, mime) = state
        .0
        .lock()
        .await
        .public_get(&url, Public::CatalogImage, Duration::from_millis(300))
        .await?;
    let name = format!("catalog/{id}.{}", image_ext(&mime));
    let dir = crate::resolve_data_dir(&app)?;
    let access = app.state::<crate::StoreAccess>();
    let _guard = access.0.lock().map_err(|e| e.to_string())?;
    crate::store::sync_write(&dir, &format!("images/{name}"), &bytes, false)?;
    Ok(name)
}
fn image_ext(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/avif" => "avif",
        "image/gif" => "gif",
        _ => "webp",
    }
}

#[tauri::command]
pub fn rsi_cancel(
    requester: tauri::WebviewWindow,
    state: tauri::State<'_, RsiState>,
) -> Result<(), String> {
    crate::main_only(&requester)?;
    state.1.store(true, Ordering::Relaxed);
    Ok(())
}
/// Drops a held sync lock and flags the in-flight sync as cancelled: the webview that ran it is gone (reload, crash, close).
pub fn release_sync(state: &RsiState) {
    state.1.store(true, Ordering::Relaxed);
    if let Ok(mut held) = state.2.lock() {
        held.take();
    }
}

/// Takes the data folder's sync lock (the same file the CLI, the dev server and the MCP server take). Fails with
/// "Another sync is running (started ...)" while another process holds it.
#[tauri::command]
pub fn rsi_begin_sync(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, RsiState>,
) -> Result<(), String> {
    crate::main_only(&requester)?;
    begin_sync(&crate::resolve_data_dir(&app)?, &state)
}

fn begin_sync(dir: &std::path::Path, state: &RsiState) -> Result<(), String> {
    let mut held = state.2.lock().map_err(|e| e.to_string())?;
    // A lock of ours left by a reloaded webview (its sync never reached the end): release it before taking a fresh one.
    held.take();
    state.1.store(false, Ordering::Relaxed);
    *held = Some(crate::lock::acquire_sync_lock(dir)?);
    Ok(())
}

/// Releases the sync lock; called when a sync ends, is cancelled or fails.
#[tauri::command]
pub fn rsi_end_sync(
    requester: tauri::WebviewWindow,
    state: tauri::State<'_, RsiState>,
) -> Result<(), String> {
    crate::main_only(&requester)?;
    state.2.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}
