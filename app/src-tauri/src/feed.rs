//! The signed data feed (desktop side). Mirrors src/feed.mjs and src/logic/feed.mjs, which the Node tools use.
//!
//! The app asks exactly one place, `https://sapd.github.io/ccu-planner/feed/` (a debug build may be pointed elsewhere with CCU_FEED_URL, a
//! release build never), with plain GET requests that carry nothing but the path. A refresh fetches manifest.json and manifest.json.sig,
//! verifies the ed25519 signature over the exact manifest bytes with the key embedded from src/feed-public-key.json, and only then fetches
//! the files the manifest lists, each checked against its sha256 before it is saved. Any failure leaves the last good copy in `<data>/feed/`.
//! Files are written atomically, the manifest and its signature last; a reader re-verifies both, so a half-finished refresh is never used.
//! The webview gets the verified data through feed_read; it never fetches the feed itself (the CSP stays closed to every network address).

use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{
    digest::{digest, SHA256},
    signature::{UnparsedPublicKey, ED25519},
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const FEED_BASE: &str = "https://sapd.github.io/ccu-planner/feed/";
const KEY_FILE: &str = include_str!("../../../src/feed-public-key.json");
/// `{ "minGeneratedAt": ... }`: the oldest feed this build accepts. `npm run version` moves it with every release (src/feed-floor.json).
const FLOOR_FILE: &str = include_str!("../../../src/feed-floor.json");
const REFRESH_SECS: u64 = 6 * 60 * 60;
const MAX_MANIFEST: usize = 4 * 1024 * 1024;
const MAX_JSON: usize = 16 * 1024 * 1024;
const MAX_IMAGE: usize = 4 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
/// The most a manifest may announce in total (the cache on a user's disk can never grow past this).
const MAX_TOTAL: u64 = 512 * 1024 * 1024;
/// A feed older than this is stale: the saved copy is still used, and the app says so.
const STALE_SECS: u64 = 30 * 24 * 60 * 60;

/// Serializes refreshes and picture batches so two overlapping calls never write the same files.
#[derive(Default)]
pub struct FeedState(tokio::sync::Mutex<()>);

#[derive(Debug, Clone, PartialEq)]
pub struct Manifest {
    pub generated_at: String,
    pub files: BTreeMap<String, (String, u64)>,
}

/// The 32 raw bytes of the embedded public key.
pub fn public_key() -> Result<Vec<u8>, String> {
    let doc: Value = serde_json::from_str(KEY_FILE).map_err(|e| e.to_string())?;
    if doc["algorithm"] != "ed25519" {
        return Err("the embedded feed key is not ed25519".into());
    }
    let raw = STANDARD
        .decode(doc["publicKey"].as_str().unwrap_or(""))
        .map_err(|e| e.to_string())?;
    if raw.len() != 32 {
        return Err("the embedded feed key is not 32 bytes".into());
    }
    Ok(raw)
}

/// The picture folders of the feed: store catalog items and ships (images/<folder>/<digits>.webp).
const PICTURE_FOLDERS: [&str; 2] = ["catalog", "ships"];

/// The only names a manifest may list: events.json, store-catalog.json, images/catalog/<digits>.webp and images/ships/<digits>.webp.
pub fn allowed_name(name: &str) -> bool {
    if name == "events.json" || name == "store-catalog.json" {
        return true;
    }
    PICTURE_FOLDERS.iter().any(|folder| {
        name.strip_prefix("images/")
            .and_then(|n| n.strip_prefix(folder))
            .and_then(|n| n.strip_prefix('/'))
            .and_then(|n| n.strip_suffix(".webp"))
            .is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
    })
}

fn is_ship_image(name: &str) -> bool {
    name.starts_with("images/ships/")
}

fn is_image(name: &str) -> bool {
    name.starts_with("images/")
}

fn sha_hex(bytes: &[u8]) -> String {
    digest(&SHA256, bytes).as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// `YYYY-MM-DDTHH:MM:SS[.fff]Z`, split so two stamps compare as time (a missing fraction is zero).
fn stamp_key(s: &str) -> Option<(String, String)> {
    let b = s.as_bytes();
    let digits = |r: std::ops::Range<usize>| b.get(r).is_some_and(|d| d.iter().all(u8::is_ascii_digit));
    let shape = b.len() >= 20
        && digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10)
        && b[10] == b'T' && digits(11..13) && b[13] == b':' && digits(14..16) && b[16] == b':' && digits(17..19)
        && b[b.len() - 1] == b'Z';
    if !shape {
        return None;
    }
    let rest = &s[19..s.len() - 1];
    let frac = match rest {
        "" => String::new(),
        r if r.starts_with('.') && r.len() > 1 && r[1..].bytes().all(|c| c.is_ascii_digit()) => r[1..].to_owned(),
        _ => return None,
    };
    Some((s[..19].to_owned(), format!("{frac:0<9}")))
}

/// The verified manifest. The signature is over the exact bytes, so nothing is parsed before it checks out.
pub fn verify_manifest(bytes: &[u8], sig_text: &str, key: &[u8]) -> Result<Manifest, String> {
    if bytes.len() > MAX_MANIFEST {
        return Err("manifest is too large".into());
    }
    let sig = STANDARD
        .decode(sig_text.trim())
        .map_err(|_| "signature is not base64")?;
    if sig.len() != 64 {
        return Err("signature has the wrong length".into());
    }
    UnparsedPublicKey::new(&ED25519, key)
        .verify(bytes, &sig)
        .map_err(|_| "signature does not match")?;
    let doc: Value = serde_json::from_slice(bytes).map_err(|_| "manifest is not JSON")?;
    if doc["schema"] != 1 {
        return Err("unsupported feed schema".into());
    }
    let generated_at = doc["generatedAt"].as_str().unwrap_or("").to_owned();
    if stamp_key(&generated_at).is_none() {
        return Err("manifest has no valid generatedAt".into());
    }
    let list = doc["files"].as_object().ok_or("manifest has no file list")?;
    if list.len() > MAX_FILES {
        return Err("manifest lists too many files".into());
    }
    let mut files = BTreeMap::new();
    let mut total = 0u64;
    for (name, f) in list {
        if !allowed_name(name) {
            return Err(format!("manifest lists a file that is not allowed: {name}"));
        }
        let sha = f["sha256"].as_str().unwrap_or("");
        if sha.len() != 64 || !sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(format!("bad sha256 for {name}"));
        }
        let cap = if is_image(name) { MAX_IMAGE } else { MAX_JSON } as u64;
        let size = f["size"].as_u64().filter(|s| *s <= cap).ok_or_else(|| format!("bad size for {name}"))?;
        total += size;
        files.insert(name.clone(), (sha.to_owned(), size));
    }
    if total > MAX_TOTAL {
        return Err("manifest announces more data than allowed".into());
    }
    Ok(Manifest { generated_at, files })
}

/// The oldest feed this build accepts (src/feed-floor.json).
fn min_generated_at() -> Result<String, String> {
    let doc: Value = serde_json::from_str(FLOOR_FILE).map_err(|e| e.to_string())?;
    let at = doc["minGeneratedAt"].as_str().unwrap_or("").to_owned();
    stamp_key(&at).ok_or("the embedded feed floor is not a valid date")?;
    Ok(at)
}

/// The newer of two stamps (both valid; an invalid one loses).
fn newer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if stamp_key(b) > stamp_key(a) { b } else { a }
}

/// `<data>/feed-seen.json`: the newest generatedAt ever accepted on this machine. It lives next to the feed folder, not in it, so wiping or
/// damaging the cache cannot let an older signed manifest in. Not signed (a local file): it can only make this machine stricter.
fn seen_path(data: &Path) -> PathBuf {
    data.join("feed-seen.json")
}

fn read_seen(data: &Path) -> Option<String> {
    let doc: Value = serde_json::from_slice(&read_regular(&seen_path(data))?).ok()?;
    let at = doc["highestGeneratedAt"].as_str()?;
    stamp_key(at).map(|_| at.to_owned())
}

fn record_seen(data: &Path, generated_at: &str) -> Result<(), String> {
    if read_seen(data).is_some_and(|seen| stamp_key(&seen) >= stamp_key(generated_at)) {
        return Ok(());
    }
    write_atomic(&seen_path(data), json!({ "highestGeneratedAt": generated_at }).to_string().as_bytes())
}

/// A feed older than the oldest one accepted before is refused: whoever serves the files must not be able to roll a client back with an old
/// signed manifest. "Before" is this build's floor, the highest one ever accepted here (survives a wiped cache) and the saved copy. The same
/// date with other content is no update either.
fn check_fresh(new: &Manifest, new_bytes: &[u8], saved: Option<&(Manifest, Vec<u8>)>, seen: Option<&str>, floor: &str) -> Result<(), String> {
    let mut oldest = floor;
    if let Some(seen) = seen {
        oldest = newer(oldest, seen);
    }
    if let Some((m, _)) = saved {
        oldest = newer(oldest, &m.generated_at);
    }
    if stamp_key(&new.generated_at) < stamp_key(oldest) {
        return Err("the feed is older than the newest one accepted before".into());
    }
    if let Some((m, bytes)) = saved {
        if stamp_key(&m.generated_at) == stamp_key(&new.generated_at) && bytes != new_bytes {
            return Err("the feed has the same date as the saved copy but different content".into());
        }
    }
    Ok(())
}

/// Seconds since 1970 of a stamp that passed `stamp_key` (UTC; the fraction is dropped).
fn epoch_secs(stamp: &str) -> Option<i64> {
    stamp_key(stamp)?;
    let n = |r: std::ops::Range<usize>| stamp[r].parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (h, mi, s) = (n(11..13)?, n(14..16)?, n(17..19)?);
    // days from civil (Howard Hinnant)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + s)
}

/// True when the stamp is more than 30 days before `now` (an unreadable stamp is not called stale).
fn is_stale(generated_at: Option<&str>, now: u64) -> bool {
    generated_at.and_then(epoch_secs).is_some_and(|t| now as i64 - t > STALE_SECS as i64)
}

/// The address of a feed file below `base`: an allowlisted name only.
pub fn file_url(base: &reqwest::Url, name: &str) -> Result<reqwest::Url, String> {
    if name != "manifest.json" && name != "manifest.json.sig" && !allowed_name(name) {
        return Err("feed file not allowlisted".into());
    }
    base.join(name).map_err(|e| e.to_string())
}

/// The feed address. Release builds: the constant. Debug builds: CCU_FEED_URL when set (for testing a folder served over http).
pub fn base_url() -> Result<reqwest::Url, String> {
    let text = if cfg!(debug_assertions) {
        std::env::var("CCU_FEED_URL").unwrap_or_else(|_| FEED_BASE.to_owned())
    } else {
        FEED_BASE.to_owned()
    };
    let text = if text.ends_with('/') { text } else { format!("{text}/") };
    let url = reqwest::Url::parse(&text).map_err(|_| "invalid feed address")?;
    let official = url.scheme() == "https" && url.host_str() == Some("sapd.github.io") && url.path() == "/ccu-planner/feed/";
    let local_test = cfg!(debug_assertions) && url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || !(official || local_test) {
        return Err("feed address not allowlisted".into());
    }
    Ok(url)
}

// ----- the cache folder -----

pub fn feed_dir(data: &Path) -> PathBuf {
    data.join("feed")
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fs::create_dir_all(path.parent().ok_or("invalid parent")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{}.{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// A regular file's contents (a symlink or a missing file is None).
fn read_regular(path: &Path) -> Option<Vec<u8>> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.file_type().is_file() {
        return None;
    }
    fs::read(path).ok()
}

fn cached_manifest(data: &Path, key: &[u8]) -> Option<(Manifest, Vec<u8>)> {
    let dir = feed_dir(data);
    let bytes = read_regular(&dir.join("manifest.json"))?;
    let sig = read_regular(&dir.join("manifest.json.sig"))?;
    let manifest = verify_manifest(&bytes, std::str::from_utf8(&sig).ok()?, key).ok()?;
    Some((manifest, bytes))
}

fn cached_file(data: &Path, manifest: &Manifest, name: &str) -> Option<Vec<u8>> {
    let (sha, size) = manifest.files.get(name)?;
    let bytes = read_regular(&feed_dir(data).join(name))?;
    (bytes.len() as u64 == *size && &sha_hex(&bytes) == sha).then_some(bytes)
}

fn image_present(data: &Path, manifest: &Manifest, name: &str) -> bool {
    let Some((_, size)) = manifest.files.get(name) else { return false };
    fs::symlink_metadata(feed_dir(data).join(name)).is_ok_and(|m| m.file_type().is_file() && m.len() == *size)
}

/// What the cache holds, for the webview: `{ generatedAt, eventsDoc, catalog, images: ["catalog/12.webp", "ships/7.webp", ...] }`, or null without a verified manifest.
/// The signature and the two JSON files' hashes are checked again here.
pub fn read_feed(data: &Path, key: &[u8]) -> Option<Value> {
    let (manifest, _) = cached_manifest(data, key)?;
    let parse = |name: &str| cached_file(data, &manifest, name).and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let images: Vec<&str> = manifest
        .files
        .keys()
        .filter(|n| is_image(n) && image_present(data, &manifest, n))
        .map(|n| &n["images/".len()..])
        .collect();
    Some(json!({
        "generatedAt": manifest.generated_at,
        "eventsDoc": parse("events.json"),
        "catalog": parse("store-catalog.json"),
        "images": images,
    }))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// This app's version (Cargo.toml, kept equal to tauri.conf.json by scripts/version.mjs).
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The last successful check: when, and by which app version.
fn read_state(data: &Path) -> Option<(u64, Option<String>)> {
    let doc: Value = serde_json::from_slice(&read_regular(&feed_dir(data).join("state.json"))?).ok()?;
    Some((doc["checkedAt"].as_u64()?, doc["app"].as_str().map(str::to_owned)))
}

/// True when this app version checked successfully less than 6 hours ago (a stamp in the future counts as none). After an update the
/// first start checks at once: a new version may read feed content the old one ignored.
fn recently_checked(data: &Path, key: &[u8], now: u64) -> bool {
    recently_checked_by(data, key, now, APP_VERSION)
}
fn recently_checked_by(data: &Path, key: &[u8], now: u64, version: &str) -> bool {
    cached_manifest(data, key).is_some()
        && read_state(data).is_some_and(|(t, app)| app.as_deref() == Some(version) && t <= now && now - t < REFRESH_SECS)
}

/// The JSON files of the manifest that are missing or damaged locally.
fn json_to_fetch(data: &Path, manifest: &Manifest) -> Vec<String> {
    ["events.json", "store-catalog.json"]
        .into_iter()
        .filter(|n| manifest.files.contains_key(*n) && cached_file(data, manifest, n).is_none())
        .map(str::to_owned)
        .collect()
}

/// Errs unless the bytes are the size and sha256 the (verified) manifest names for the file.
fn check_file(manifest: &Manifest, name: &str, bytes: &[u8]) -> Result<(), String> {
    let (sha, size) = manifest.files.get(name).ok_or("file is not in the manifest")?;
    if bytes.len() as u64 != *size || &sha_hex(bytes) != sha {
        return Err(format!("{name} does not match the signed manifest"));
    }
    Ok(())
}

/// Saves a downloaded file when it is the size and sha256 the (verified) manifest names.
fn store_file(data: &Path, manifest: &Manifest, name: &str, bytes: &[u8]) -> Result<(), String> {
    check_file(manifest, name, bytes)?;
    write_atomic(&feed_dir(data).join(name), bytes)
}

fn commit(data: &Path, manifest_bytes: &[u8], sig_text: &str, now: u64) -> Result<(), String> {
    write_atomic(&feed_dir(data).join("manifest.json"), manifest_bytes)?;
    write_atomic(&feed_dir(data).join("manifest.json.sig"), sig_text.as_bytes())?;
    write_atomic(&feed_dir(data).join("state.json"), json!({ "checkedAt": now, "app": APP_VERSION }).to_string().as_bytes())
}

/// The pictures the manifest lists and the cache lacks, ship pictures first (`ships_only`: no catalog pictures at all).
fn missing_images(data: &Path, manifest: &Manifest, ships_only: bool) -> Vec<String> {
    let mut missing: Vec<String> = manifest
        .files
        .keys()
        .filter(|n| is_image(n) && (!ships_only || is_ship_image(n)) && !image_present(data, manifest, n))
        .cloned()
        .collect();
    missing.sort_by_key(|n| !is_ship_image(n)); // stable: the order inside each group stays by name
    missing
}

/// Removes saved pictures the manifest no longer lists (ships only: just the ship pictures).
fn prune_images(data: &Path, manifest: &Manifest, ships_only: bool) {
    for kind in PICTURE_FOLDERS.iter().filter(|k| !ships_only || **k == "ships") {
        let Ok(entries) = fs::read_dir(feed_dir(data).join("images").join(kind)) else { continue };
        for entry in entries.flatten() {
            if let Some(n) = entry.file_name().to_str() {
                let name = format!("images/{kind}/{n}");
                if allowed_name(&name) && !manifest.files.contains_key(&name) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
}

// ----- the network -----

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("CCUPlanner/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// `Offline` is silent; `Rejected` is something the feed said that we refuse.
enum Fail {
    Offline(String),
    Rejected(String),
}
impl Fail {
    fn status(&self) -> &'static str {
        match self {
            Fail::Offline(_) => "offline",
            Fail::Rejected(_) => "rejected",
        }
    }
    fn message(&self) -> &str {
        match self {
            Fail::Offline(m) | Fail::Rejected(m) => m,
        }
    }
}
impl From<String> for Fail {
    fn from(m: String) -> Self {
        Fail::Rejected(m)
    }
}

async fn get(http: &reqwest::Client, url: reqwest::Url, cap: usize) -> Result<Vec<u8>, Fail> {
    let mut res = http.get(url).send().await.map_err(|_| Fail::Offline("could not reach the feed".into()))?;
    let status = res.status();
    if !status.is_success() {
        let m = format!("feed answered HTTP {}", status.as_u16());
        return Err(if status.as_u16() == 404 { Fail::Rejected(m) } else { Fail::Offline(m) });
    }
    if res.content_length().is_some_and(|n| n > cap as u64) {
        return Err(Fail::Rejected("a feed file is larger than allowed".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| Fail::Offline("the feed connection broke".into()))? {
        if bytes.len() + chunk.len() > cap {
            return Err(Fail::Rejected("a feed file is larger than allowed".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn refresh_inner(data: &Path, base: &reqwest::Url, key: &[u8], now: u64) -> Result<Value, Fail> {
    let http = client()?;
    let saved = cached_manifest(data, key);
    let bytes = get(&http, file_url(base, "manifest.json")?, MAX_MANIFEST).await?;
    let sig = get(&http, file_url(base, "manifest.json.sig")?, 1024).await?;
    let sig_text = String::from_utf8(sig).map_err(|_| Fail::Rejected("signature is not text".into()))?;
    let manifest = verify_manifest(&bytes, &sig_text, key)?;
    check_fresh(&manifest, &bytes, saved.as_ref(), read_seen(data).as_deref(), &min_generated_at()?)?;
    let mut changed = saved.as_ref().is_none_or(|(m, b)| m != &manifest || b != &bytes);
    // All downloaded and checked before any replaces the saved one, so a refused file leaves the old copy whole.
    let mut fresh = Vec::new();
    for name in json_to_fetch(data, &manifest) {
        let body = get(&http, file_url(base, &name)?, MAX_JSON).await?;
        check_file(&manifest, &name, &body)?;
        fresh.push((name, body));
    }
    for (name, body) in fresh {
        store_file(data, &manifest, &name, &body)?;
        changed = true;
    }
    record_seen(data, &manifest.generated_at)?; // before the manifest, so a crash in between can only make this machine stricter
    commit(data, &bytes, &sig_text, now)?;
    Ok(json!({ "status": if changed { "updated" } else { "unchanged" }, "generatedAt": manifest.generated_at, "stale": is_stale(Some(&manifest.generated_at), now) }))
}

/// Refreshes `<data>/feed/`. Never an Err: the outcome is the status (`updated`, `unchanged`, `skipped`, `offline`, `rejected`) and `stale`
/// (the feed we hold is older than 30 days: the publisher seems to have stopped; its data is still used).
pub async fn refresh(data: &Path, force: bool) -> Value {
    let key = match public_key() {
        Ok(k) => k,
        Err(e) => return json!({ "status": "rejected", "generatedAt": null, "stale": false, "error": e }),
    };
    let saved_at = cached_manifest(data, &key).map(|(m, _)| m.generated_at);
    let now = now_secs();
    let stale = is_stale(saved_at.as_deref(), now);
    if !force && recently_checked(data, &key, now) {
        return json!({ "status": "skipped", "generatedAt": saved_at, "stale": stale });
    }
    let base = match base_url() {
        Ok(b) => b,
        Err(e) => return json!({ "status": "rejected", "generatedAt": saved_at, "stale": stale, "error": e }),
    };
    match refresh_inner(data, &base, &key, now).await {
        Ok(v) => v,
        Err(f) => json!({ "status": f.status(), "generatedAt": saved_at, "stale": stale, "error": f.message() }),
    }
}

/// How many pictures are fetched at the same time.
const PICTURE_CONCURRENCY: usize = 4;

/// Downloads up to `limit` pictures the manifest lists and the cache lacks (ship pictures first, four at a time, each checked against its sha256),
/// then prunes unlisted ones once none are left. `ships_only` leaves the catalog pictures alone.
/// Resolves to `{ downloaded, remaining, failed }`.
pub async fn fetch_images(data: &Path, limit: usize, ships_only: bool) -> Value {
    match (public_key(), base_url()) {
        (Ok(key), Ok(base)) => fetch_images_from(data, &key, &base, limit, ships_only).await,
        _ => json!({ "downloaded": 0, "remaining": 0, "failed": 0 }),
    }
}

/// `fetch_images` with the key and the address given (the tests point it at a local server).
async fn fetch_images_from(data: &Path, key: &[u8], base: &reqwest::Url, limit: usize, ships_only: bool) -> Value {
    let done = |downloaded: usize, remaining: usize, failed: usize| json!({ "downloaded": downloaded, "remaining": remaining, "failed": failed });
    let Some((manifest, _)) = cached_manifest(data, key) else { return done(0, 0, 0) };
    let Ok(http) = client() else { return done(0, 0, 0) };
    let missing = missing_images(data, &manifest, ships_only);
    let (mut downloaded, mut failed, mut offline) = (0, 0, false);
    let mut queue = missing.iter().take(limit).cloned();
    let mut running = tokio::task::JoinSet::new();
    loop {
        while !offline && running.len() < PICTURE_CONCURRENCY {
            let Some(name) = queue.next() else { break };
            let (http, base, manifest, data) = (http.clone(), base.clone(), manifest.clone(), data.to_path_buf());
            running.spawn(async move {
                let body = get(&http, file_url(&base, &name)?, MAX_IMAGE).await?;
                store_file(&data, &manifest, &name, &body)?;
                Ok::<(), Fail>(())
            });
        }
        match running.join_next().await {
            None => break,
            Some(Ok(Ok(()))) => downloaded += 1,
            Some(Ok(Err(Fail::Offline(_)))) => {
                failed += 1;
                offline = true;
            }
            Some(_) => failed += 1,
        }
    }
    let remaining = missing.len() - downloaded;
    if remaining == 0 {
        prune_images(data, &manifest, ships_only);
    }
    done(downloaded, remaining, failed)
}

// ----- commands -----

#[tauri::command]
pub async fn feed_refresh(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, FeedState>,
    force: bool,
) -> Result<Value, String> {
    crate::main_only(&requester)?;
    let data = crate::resolve_data_dir(&app)?;
    let _one = state.0.lock().await;
    Ok(refresh(&data, force).await)
}

#[tauri::command]
pub async fn feed_images(
    requester: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, FeedState>,
    limit: u32,
    scope: Option<String>,
) -> Result<Value, String> {
    crate::main_only(&requester)?;
    let data = crate::resolve_data_dir(&app)?;
    let _one = state.0.lock().await;
    Ok(fetch_images(&data, limit.clamp(1, 500) as usize, scope.as_deref() == Some("ships")).await)
}

#[tauri::command]
pub async fn feed_read(requester: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Option<Value>, String> {
    crate::main_only(&requester)?;
    let data = crate::resolve_data_dir(&app)?;
    Ok(public_key().ok().and_then(|key| read_feed(&data, &key)))
}

/// The directory the asset protocol may serve the feed's pictures from.
pub fn images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(feed_dir(&crate::resolve_data_dir(app)?).join("images"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn pair(seed: u8) -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap()
    }
    fn manifest_json(generated_at: &str, files: &[(&str, &[u8])]) -> Vec<u8> {
        let list: serde_json::Map<String, Value> = files
            .iter()
            .map(|(n, b)| (n.to_string(), json!({ "sha256": sha_hex(b), "size": b.len() })))
            .collect();
        serde_json::to_vec_pretty(&json!({ "schema": 1, "generatedAt": generated_at, "files": list })).unwrap()
    }
    fn sign(k: &Ed25519KeyPair, bytes: &[u8]) -> String {
        STANDARD.encode(k.sign(bytes).as_ref())
    }

    #[test]
    fn the_embedded_key_is_a_32_byte_ed25519_key() {
        assert_eq!(public_key().unwrap().len(), 32);
    }

    #[test]
    fn a_good_signature_verifies_and_gives_the_manifest() {
        let k = pair(1);
        let bytes = manifest_json("2026-11-20T10:00:00.000Z", &[("events.json", b"{}"), ("images/catalog/12.webp", b"x")]);
        let m = verify_manifest(&bytes, &sign(&k, &bytes), k.public_key().as_ref()).unwrap();
        assert_eq!(m.generated_at, "2026-11-20T10:00:00.000Z");
        assert_eq!(m.files["events.json"], (sha_hex(b"{}"), 2));
        assert_eq!(m.files.len(), 2);
    }

    #[test]
    fn a_tampered_manifest_a_wrong_key_and_a_bad_signature_are_refused() {
        let (k, other) = (pair(1), pair(2));
        let bytes = manifest_json("2026-11-20T10:00:00Z", &[("events.json", b"{}")]);
        let sig = sign(&k, &bytes);
        let mut tampered = bytes.clone();
        tampered[bytes.len() / 2] ^= 1;
        assert!(verify_manifest(&tampered, &sig, k.public_key().as_ref()).is_err());
        assert!(verify_manifest(&bytes, &sig, other.public_key().as_ref()).is_err());
        assert!(verify_manifest(&bytes, "AAAA", k.public_key().as_ref()).is_err());
        assert!(verify_manifest(&bytes, "not base64!", k.public_key().as_ref()).is_err());
        assert!(verify_manifest(&bytes, &sig, &[0u8; 5]).is_err());
    }

    #[test]
    fn a_signed_manifest_still_has_to_be_well_formed() {
        let k = pair(1);
        let check = |bytes: Vec<u8>| verify_manifest(&bytes, &sign(&k, &bytes), k.public_key().as_ref());
        assert!(check(manifest_json("2026-11-20T10:00:00Z", &[("../evil.json", b"x")])).is_err());
        assert!(check(manifest_json("2026-11-20T10:00:00Z", &[("images/catalog/a.webp", b"x")])).is_err());
        assert!(check(manifest_json("yesterday", &[("events.json", b"{}")])).is_err());
        assert!(check(br#"{"schema":2,"generatedAt":"2026-11-20T10:00:00Z","files":{}}"#.to_vec()).is_err());
        assert!(check(br#"{"schema":1,"generatedAt":"2026-11-20T10:00:00Z","files":{"events.json":{"sha256":"zz","size":1}}}"#.to_vec()).is_err());
    }

    #[test]
    fn a_manifest_signed_by_node_verifies() {
        // tests/fixtures/feed/: written by test/feed.test.mjs's generator with a throwaway key (see that test); proves both sides agree on the bytes.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/feed");
        let bytes = fs::read(dir.join("manifest.json")).unwrap();
        let sig = fs::read_to_string(dir.join("manifest.json.sig")).unwrap();
        let key = STANDARD.decode(fs::read_to_string(dir.join("public-key.txt")).unwrap().trim()).unwrap();
        let m = verify_manifest(&bytes, &sig, &key).unwrap();
        assert!(m.files.contains_key("events.json"));
        assert!(verify_manifest(&bytes, &sig, &public_key().unwrap()).is_err(), "the real key does not sign the fixture");
    }

    #[test]
    fn only_allowlisted_names_get_an_address() {
        let base = reqwest::Url::parse(FEED_BASE).unwrap();
        assert_eq!(file_url(&base, "manifest.json").unwrap().as_str(), "https://sapd.github.io/ccu-planner/feed/manifest.json");
        assert_eq!(file_url(&base, "images/catalog/7.webp").unwrap().as_str(), "https://sapd.github.io/ccu-planner/feed/images/catalog/7.webp");
        assert_eq!(file_url(&base, "images/ships/12.webp").unwrap().as_str(), "https://sapd.github.io/ccu-planner/feed/images/ships/12.webp");
        for bad in [
            "../x", "/etc/passwd", "//evil.test/x", "images/catalog/../../x.webp", "images/catalog/%2e%2e/7.webp", "%2e%2e/events.json", "images/catalog/7.png",
            "https://evil.test/x", "events.json?x=1", "images/catalog/.webp", "state.json", "feed-seen.json", "images\\catalog\\7.webp",
            "images/ships/../../x.webp", "images/ships/%2e%2e/7.webp", "images/ships/7.png", "images/ships/.webp", "images/ships/a.webp", "images/ships/7/8.webp",
            "images/shipsx/7.webp", "images/ships7.webp", "images//ships/7.webp", "images/other/7.webp", "images/ships/7.webp?x=1", "images\\ships\\7.webp",
        ] {
            assert!(file_url(&base, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_feed_address_is_the_official_one() {
        // Debug builds (the tests) may use CCU_FEED_URL, which this test does not set; the constant itself passes the allowlist.
        std::env::remove_var("CCU_FEED_URL");
        assert_eq!(base_url().unwrap().as_str(), FEED_BASE);
    }

    #[test]
    fn stamps_compare_as_time() {
        let k = |s| stamp_key(s).unwrap();
        assert!(k("2026-11-20T10:00:00.5Z") > k("2026-11-20T10:00:00Z"));
        assert!(k("2026-11-20T10:00:00.050Z") < k("2026-11-20T10:00:00.5Z"));
        assert!(k("2026-11-21T00:00:00Z") > k("2026-11-20T23:59:59.999Z"));
        assert!(stamp_key("2026-11-20 10:00:00Z").is_none() && stamp_key("2026-11-20T10:00:00+01:00").is_none());
    }

    fn feed_on_disk(data: &Path, k: &Ed25519KeyPair, at: &str, events: &[u8]) -> Manifest {
        let bytes = manifest_json(at, &[("events.json", events), ("images/catalog/5.webp", b"pic")]);
        let sig = sign(k, &bytes);
        let m = verify_manifest(&bytes, &sig, k.public_key().as_ref()).unwrap();
        store_file(data, &m, "events.json", events).unwrap();
        commit(data, &bytes, &sig, 1000).unwrap();
        m
    }

    #[test]
    fn a_downloaded_file_must_match_the_manifest_and_a_tampered_one_is_never_saved() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(3);
        let m = feed_on_disk(dir.path(), &k, "2026-11-20T10:00:00Z", br#"{"events":[]}"#);
        assert!(store_file(dir.path(), &m, "events.json", br#"{"events":[1]}"#).is_err());
        assert!(store_file(dir.path(), &m, "store-catalog.json", b"{}").is_err(), "not in the manifest");
        assert!(store_file(dir.path(), &m, "images/catalog/5.webp", b"pix").is_err());
        assert_eq!(fs::read(dir.path().join("feed/events.json")).unwrap(), br#"{"events":[]}"#);
        store_file(dir.path(), &m, "images/catalog/5.webp", b"pic").unwrap();
        assert!(missing_images(dir.path(), &m, false).is_empty());
    }

    #[test]
    fn read_uses_only_what_still_verifies() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(4);
        let key = k.public_key().as_ref().to_vec();
        assert!(read_feed(dir.path(), &key).is_none());
        feed_on_disk(dir.path(), &k, "2026-11-20T10:00:00Z", br#"{"events":[{"name":"A"}]}"#);
        let got = read_feed(dir.path(), &key).unwrap();
        assert_eq!(got["generatedAt"], "2026-11-20T10:00:00Z");
        assert_eq!(got["eventsDoc"]["events"][0]["name"], "A");
        assert_eq!(got["catalog"], Value::Null);
        assert_eq!(got["images"], json!([]), "picture 5 was not downloaded");
        // A changed file reads as missing, a changed manifest or a signature of another key as no feed at all.
        fs::write(dir.path().join("feed/events.json"), b"{\"events\":[]}").unwrap();
        assert_eq!(read_feed(dir.path(), &key).unwrap()["eventsDoc"], Value::Null);
        assert!(read_feed(dir.path(), pair(5).public_key().as_ref()).is_none());
        let mut tampered = fs::read(dir.path().join("feed/manifest.json")).unwrap();
        tampered.push(b' ');
        fs::write(dir.path().join("feed/manifest.json"), tampered).unwrap();
        assert!(read_feed(dir.path(), &key).is_none());
    }

    fn manifest_at(at: &str) -> Manifest {
        Manifest { generated_at: at.into(), files: BTreeMap::new() }
    }

    #[test]
    fn an_older_signed_feed_does_not_roll_the_copy_back() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(6);
        let saved = feed_on_disk(dir.path(), &k, "2026-11-20T10:00:00Z", b"{}");
        let saved_bytes = fs::read(dir.path().join("feed/manifest.json")).unwrap();
        let saved = (saved, saved_bytes.clone());
        let floor = "2026-11-19T00:00:00Z";
        assert!(check_fresh(&manifest_at("2026-11-19T10:00:00Z"), b"x", Some(&saved), None, floor).is_err());
        assert!(check_fresh(&manifest_at("2026-11-20T10:00:00.000Z"), &saved_bytes, Some(&saved), None, floor).is_ok());
        assert!(check_fresh(&manifest_at("2026-11-21T10:00:00Z"), b"x", Some(&saved), None, floor).is_ok());
        assert!(check_fresh(&manifest_at("2026-11-19T10:00:00Z"), b"x", None, None, floor).is_ok());
    }

    #[test]
    fn the_same_date_with_other_content_is_no_update() {
        let saved = (manifest_at("2026-11-20T10:00:00Z"), b"one".to_vec());
        let err = check_fresh(&manifest_at("2026-11-20T10:00:00.0Z"), b"two", Some(&saved), None, "2026-11-19T00:00:00Z").unwrap_err();
        assert!(err.contains("same date"), "{err}");
    }

    #[test]
    fn the_floor_and_the_highest_accepted_date_hold_without_a_saved_copy() {
        // A fresh install: only the floor stands. Later the cache is wiped: the seen file stands.
        let floor = "2026-11-19T00:00:00Z";
        assert!(check_fresh(&manifest_at("2026-11-18T23:59:59Z"), b"x", None, None, floor).is_err());
        assert!(check_fresh(&manifest_at("2026-11-19T00:00:00Z"), b"x", None, None, floor).is_ok());
        assert!(check_fresh(&manifest_at("2026-11-20T09:59:59Z"), b"x", None, Some("2026-11-20T10:00:00Z"), floor).is_err());
        assert!(check_fresh(&manifest_at("2026-11-20T10:00:00Z"), b"x", None, Some("2026-11-20T10:00:00Z"), floor).is_ok());
    }

    #[test]
    fn the_embedded_floor_is_a_valid_date() {
        let floor = min_generated_at().unwrap();
        assert!(epoch_secs(&floor).is_some());
    }

    #[test]
    fn the_highest_accepted_date_is_kept_next_to_the_cache_and_only_goes_up() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_seen(dir.path()), None);
        record_seen(dir.path(), "2026-11-20T10:00:00Z").unwrap();
        record_seen(dir.path(), "2026-11-19T10:00:00Z").unwrap();
        assert_eq!(read_seen(dir.path()).as_deref(), Some("2026-11-20T10:00:00Z"));
        record_seen(dir.path(), "2026-11-21T10:00:00.5Z").unwrap();
        // A wiped feed folder does not touch it.
        let k = pair(9);
        feed_on_disk(dir.path(), &k, "2026-11-21T10:00:00.5Z", b"{}");
        fs::remove_dir_all(feed_dir(dir.path())).unwrap();
        assert_eq!(read_seen(dir.path()).as_deref(), Some("2026-11-21T10:00:00.5Z"));
        // A damaged file is no mark (the floor still stands).
        fs::write(seen_path(dir.path()), b"not json").unwrap();
        assert_eq!(read_seen(dir.path()), None);
        fs::write(seen_path(dir.path()), br#"{"highestGeneratedAt":"yesterday"}"#).unwrap();
        assert_eq!(read_seen(dir.path()), None);
    }

    #[test]
    fn stale_means_more_than_thirty_days() {
        assert_eq!(epoch_secs("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(epoch_secs("2000-03-01T00:00:00Z"), Some(951_868_800));
        assert_eq!(epoch_secs("2026-11-20T10:00:00.123Z"), Some(1_795_168_800));
        let at = "2026-11-20T10:00:00Z";
        let t = epoch_secs(at).unwrap() as u64;
        assert!(!is_stale(Some(at), t + STALE_SECS));
        assert!(is_stale(Some(at), t + STALE_SECS + 1));
        assert!(!is_stale(Some("garbage"), t + 10 * STALE_SECS));
        assert!(!is_stale(None, t));
    }

    #[test]
    fn a_manifest_may_not_announce_more_than_the_total_cap() {
        let k = pair(1);
        let list = |n: usize| -> Vec<u8> {
            let files: serde_json::Map<String, Value> =
                (0..n).map(|i| (format!("images/catalog/{i}.webp"), json!({ "sha256": "a".repeat(64), "size": 4 * 1024 * 1024 }))).collect();
            serde_json::to_vec(&json!({ "schema": 1, "generatedAt": "2026-11-20T10:00:00Z", "files": files })).unwrap()
        };
        let check = |bytes: Vec<u8>| verify_manifest(&bytes, &sign(&k, &bytes), k.public_key().as_ref());
        assert!(check(list(100)).is_ok()); // 400 MiB
        assert!(check(list(130)).unwrap_err().contains("more data than allowed")); // 520 MiB
    }

    #[test]
    fn the_interval_is_six_hours_and_a_failed_check_does_not_count() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(7);
        let key = k.public_key().as_ref().to_vec();
        assert!(!recently_checked(dir.path(), &key, 1000), "no feed yet");
        feed_on_disk(dir.path(), &k, "2026-11-20T10:00:00Z", b"{}"); // checkedAt 1000
        assert!(recently_checked(dir.path(), &key, 1000 + REFRESH_SECS - 1));
        assert!(!recently_checked(dir.path(), &key, 1000 + REFRESH_SECS));
        assert!(!recently_checked(dir.path(), &key, 999), "a stamp from the future is no stamp");
    }

    #[test]
    fn an_updated_app_checks_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(17);
        let key = k.public_key().as_ref().to_vec();
        feed_on_disk(dir.path(), &k, "2026-11-20T10:00:00Z", b"{}"); // checked at 1000 by this version
        assert!(recently_checked_by(dir.path(), &key, 1001, APP_VERSION));
        assert!(!recently_checked_by(dir.path(), &key, 1001, "99.0.0"), "another version checks again");
        // A state written before versions were recorded counts as another version.
        fs::write(dir.path().join("feed/state.json"), br#"{"checkedAt":1000}"#).unwrap();
        assert!(!recently_checked_by(dir.path(), &key, 1001, APP_VERSION));
    }

    #[test]
    fn pictures_the_manifest_dropped_are_pruned() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(8);
        let m = feed_on_disk(dir.path(), &k, "2026-11-20T10:00:00Z", b"{}");
        store_file(dir.path(), &m, "images/catalog/5.webp", b"pic").unwrap();
        let folder = dir.path().join("feed/images/catalog");
        fs::write(folder.join("9.webp"), b"old").unwrap();
        fs::write(folder.join("notes.txt"), b"keep").unwrap();
        prune_images(dir.path(), &m, false);
        assert!(folder.join("5.webp").exists() && !folder.join("9.webp").exists() && folder.join("notes.txt").exists());
    }

    #[test]
    fn ship_pictures_come_first_and_ships_only_leaves_the_catalog_alone() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(9);
        let bytes = manifest_json(
            "2026-11-20T10:00:00Z",
            &[("events.json", b"{}"), ("images/catalog/1.webp", b"c1"), ("images/ships/2.webp", b"s2"), ("images/ships/10.webp", b"s10")],
        );
        let sig = sign(&k, &bytes);
        let m = verify_manifest(&bytes, &sig, k.public_key().as_ref()).unwrap();
        assert_eq!(missing_images(dir.path(), &m, false), ["images/ships/10.webp", "images/ships/2.webp", "images/catalog/1.webp"]);
        assert_eq!(missing_images(dir.path(), &m, true), ["images/ships/10.webp", "images/ships/2.webp"]);
        store_file(dir.path(), &m, "images/ships/2.webp", b"s2").unwrap();
        assert_eq!(missing_images(dir.path(), &m, true), ["images/ships/10.webp"]);
        assert!(store_file(dir.path(), &m, "images/ships/10.webp", b"s2").is_err(), "a ship picture must match its own hash");
    }

    #[test]
    fn ship_pictures_the_manifest_dropped_are_pruned_and_ships_only_keeps_the_catalog_ones() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(10);
        let bytes = manifest_json("2026-11-20T10:00:00Z", &[("images/ships/2.webp", b"s2")]);
        let m = verify_manifest(&bytes, &sign(&k, &bytes), k.public_key().as_ref()).unwrap();
        store_file(dir.path(), &m, "images/ships/2.webp", b"s2").unwrap();
        let ships = dir.path().join("feed/images/ships");
        let catalog = dir.path().join("feed/images/catalog");
        fs::create_dir_all(&catalog).unwrap();
        fs::write(ships.join("9.webp"), b"old").unwrap();
        fs::write(ships.join("notes.txt"), b"keep").unwrap();
        fs::write(catalog.join("9.webp"), b"old").unwrap();
        prune_images(dir.path(), &m, true);
        assert!(ships.join("2.webp").exists() && !ships.join("9.webp").exists() && ships.join("notes.txt").exists());
        assert!(catalog.join("9.webp").exists(), "ships only does not touch the catalog pictures");
        prune_images(dir.path(), &m, false);
        assert!(!catalog.join("9.webp").exists());
    }

    /// A tiny HTTP server over a map of path -> body; resolves to its base address and the paths asked for, in order.
    fn serve(files: BTreeMap<String, Vec<u8>>) -> (reqwest::Url, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{BufRead, BufReader};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = reqwest::Url::parse(&format!("http://127.0.0.1:{}/feed/", listener.local_addr().unwrap().port())).unwrap();
        let log = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (files, seen) = (files.clone(), seen.clone());
                std::thread::spawn(move || {
                    let mut line = String::new();
                    let mut reader = BufReader::new(&stream);
                    reader.read_line(&mut line).unwrap();
                    let path = line.split_whitespace().nth(1).unwrap_or("").trim_start_matches("/feed/").to_owned();
                    seen.lock().unwrap().push(path.clone());
                    let mut out = &stream;
                    match files.get(&path) {
                        Some(body) => {
                            let _ = write!(out, "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
                            let _ = out.write_all(body);
                        }
                        None => {
                            let _ = write!(out, "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                        }
                    }
                });
            }
        });
        (base, log)
    }

    #[tokio::test]
    async fn ship_pictures_are_fetched_concurrently_and_first_and_a_wrong_body_is_never_saved() {
        let dir = tempfile::tempdir().unwrap();
        let k = pair(11);
        let ships: Vec<(String, Vec<u8>)> = (1..=9).map(|i| (format!("images/ships/{i}.webp"), format!("ship-{i}").into_bytes())).collect();
        let mut listed: Vec<(&str, &[u8])> = ships.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
        listed.push(("images/catalog/1.webp", b"cat-1"));
        let bytes = manifest_json("2026-11-20T10:00:00Z", &listed);
        let (sig_ok, key) = (sign(&k, &bytes), k.public_key().as_ref().to_vec());
        let manifest = verify_manifest(&bytes, &sig_ok, &key).unwrap();
        fs::create_dir_all(feed_dir(dir.path())).unwrap();
        fs::write(feed_dir(dir.path()).join("manifest.json"), &bytes).unwrap();
        fs::write(feed_dir(dir.path()).join("manifest.json.sig"), sig_ok.as_bytes()).unwrap();
        let mut served: BTreeMap<String, Vec<u8>> = listed.iter().map(|(n, b)| (n.to_string(), b.to_vec())).collect();
        served.insert("images/ships/9.webp".into(), b"tampered".to_vec()); // does not match the signed hash
        let (base, log) = serve(served);

        // Ships only, in rounds of four: the catalog picture is not asked for, and the tampered one is refused and left out.
        let first = fetch_images_from(dir.path(), &key, &base, 4, true).await;
        assert_eq!(first, json!({ "downloaded": 4, "remaining": 5, "failed": 0 }));
        let second = fetch_images_from(dir.path(), &key, &base, 100, true).await;
        assert_eq!(second, json!({ "downloaded": 4, "remaining": 1, "failed": 1 }));
        assert!(!image_present(dir.path(), &manifest, "images/ships/9.webp"));
        assert!(!log.lock().unwrap().iter().any(|p| p.contains("catalog")), "ships only never asks for a catalog picture");
        for i in 1..=8 {
            assert_eq!(fs::read(feed_dir(dir.path()).join(format!("images/ships/{i}.webp"))).unwrap(), format!("ship-{i}").into_bytes());
        }
        // Everything: the catalog picture comes after the ship pictures still missing.
        log.lock().unwrap().clear();
        let rest = fetch_images_from(dir.path(), &key, &base, 100, false).await;
        assert_eq!(rest, json!({ "downloaded": 1, "remaining": 1, "failed": 1 }));
        assert_eq!(log.lock().unwrap().first().map(String::as_str), Some("images/ships/9.webp"));
        assert!(image_present(dir.path(), &manifest, "images/catalog/1.webp"));
    }
}
