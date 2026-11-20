//! Small, versioned keychain records. Publish the manifest last so failed saves
//! cannot replace the previous session with an incomplete set of chunks. Two
//! bounded generation slots make interrupted writes discoverable without keyring
//! enumeration; pending and legacy markers survive until cleanup succeeds.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
const ACCOUNT: &str = "rsi-session";
const PENDING: &str = "rsi-session-pending";
const LEGACY_CLEANUP: &str = "rsi-session-legacy-cleanup";
// Written after a successful full sweep with no session, so signed-out loads
// do not repeat 256 deletes. Any other value counts as absent.
const CLEAN: &str = "rsi-session-clean";
const CLEAN_VALUE: &str = "clean";
const CHUNK_UNITS: usize = 1200; // < 2560 bytes including UTF-16 storage overhead.
const MAX_CHUNKS: usize = 128;

#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq)]
pub struct Session {
    pub cookies: BTreeMap<String, String>,
    pub csrf: String,
    pub expired: bool,
    #[serde(default)]
    pub expires_at: Option<i64>,
}
impl Session {
    pub fn is_expired(&self) -> bool {
        self.expired
            || self.expires_at.is_some_and(|expiry| {
                expiry
                    <= std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64
            })
    }
    pub fn same_credentials(&self, other: &Self) -> bool {
        self.cookies == other.cookies
            && self.csrf == other.csrf
            && self.expires_at == other.expires_at
    }
    fn reduced(&self) -> Self {
        let mut session = self.clone();
        session.cookies.retain(|name, _| needed_cookie(name));
        session
    }
}
// The CLI explicitly checks Rsi-Token and sends the RSI session cookies. Keep
// the RSI authentication namespace plus Cloudflare access cookies; no analytics,
// marketing, preference or unrelated webview cookies enter the native client.
// The list is shared with the Node side (src/sync/session-cookies.json).
pub fn needed_cookie(name: &str) -> bool {
    static RULE: std::sync::OnceLock<(Vec<String>, Vec<String>)> = std::sync::OnceLock::new();
    let (prefixes, names) = RULE.get_or_init(|| {
        let rule: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/sync/session-cookies.json"))
                .expect("valid shared cookie rule");
        let list = |key: &str| -> Vec<String> {
            rule[key]
                .as_array()
                .expect("cookie rule list")
                .iter()
                .map(|v| v.as_str().expect("cookie rule text").to_string())
                .collect()
        };
        (list("prefixes"), list("names"))
    });
    prefixes.iter().any(|p| name.starts_with(p.as_str())) || names.iter().any(|n| n == name)
}
trait Secrets {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}
// Keychain service names follow the bundle identifier. The old one is only read
// once, by `migrate_legacy_session`.
const SERVICE: &str = "eu.sapd.ccuplanner";
const LEGACY_SERVICE: &str = "com.ccuplanner.desktop";
struct Keychain(&'static str);
fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| e.to_string())
}
impl Secrets for Keychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match entry(self.0, account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        entry(self.0, account)?
            .set_password(value)
            .map_err(|e| e.to_string())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match entry(self.0, account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Manifest {
    version: u8,
    generation: String,
    chunks: usize,
    // Upper bounds include unfinished writes and tails from a failed sweep.
    // None denotes an older manifest: discover its bounded slots once.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    slot_chunks: Option<[usize; 2]>,
}
impl Manifest {
    fn validate(&self) -> Result<(), String> {
        if ![1, 2].contains(&self.version)
            || (self.version == 2 && !["0", "1"].contains(&self.generation.as_str()))
            || self.slot_chunks.is_some_and(|counts| {
                counts.iter().any(|n| *n > MAX_CHUNKS)
                    || (["0", "1"]
                        .iter()
                        .position(|g| *g == self.generation)
                        .is_some_and(|i| counts[i] < self.chunks))
            })
            || self.chunks == 0
            || self.chunks > MAX_CHUNKS
            || self.generation.is_empty()
            || !self
                .generation
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'-')
        {
            return Err("Invalid session manifest".into());
        }
        Ok(())
    }
    fn occupied(&self) -> [usize; 2] {
        self.slot_chunks.unwrap_or_else(|| {
            if self.version == 2 {
                [MAX_CHUNKS; 2]
            } else {
                let mut counts = [0; 2];
                if let Some(i) = ["0", "1"].iter().position(|g| *g == self.generation) {
                    counts[i] = self.chunks;
                }
                counts
            }
        })
    }
    fn account(&self, index: usize) -> String {
        format!("{ACCOUNT}-{}-{index}", self.generation)
    }
}
fn chunks(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut chunk = String::new();
    let mut units = 0;
    for ch in value.chars() {
        if units + ch.len_utf16() > CHUNK_UNITS {
            chunks.push(std::mem::take(&mut chunk));
            units = 0;
        }
        chunk.push(ch);
        units += ch.len_utf16();
    }
    if !chunk.is_empty() {
        chunks.push(chunk);
    }
    chunks
}
fn manifest(value: Option<&str>) -> Result<Option<Manifest>, String> {
    let parsed = value.and_then(|s| serde_json::from_str::<Manifest>(s).ok());
    if let Some(m) = &parsed {
        m.validate()?;
    }
    Ok(parsed)
}
/// A cleanup marker as found in the keychain. A non-empty value that does not
/// parse or fails validation is `Unknown`: its bounds cannot be trusted, so
/// every possible slot is treated as occupied and the marker is replaced.
enum Marker {
    Absent,
    Known(Manifest),
    Unknown,
}
impl Marker {
    fn read(secrets: &impl Secrets, key: &str) -> Result<Self, String> {
        Ok(match secrets.get(key)? {
            None => Self::Absent,
            Some(value) if value.trim().is_empty() => Self::Absent,
            Some(value) => match serde_json::from_str::<Manifest>(&value) {
                Ok(m) if m.validate().is_ok() => Self::Known(m),
                _ => Self::Unknown,
            },
        })
    }
    fn is_present(&self) -> bool {
        !matches!(self, Self::Absent)
    }
    fn widen(&self, counts: &mut [usize; 2]) {
        match self {
            Self::Absent => {}
            Self::Known(m) => {
                for (count, n) in counts.iter_mut().zip(m.occupied()) {
                    *count = (*count).max(n);
                }
            }
            Self::Unknown => *counts = [MAX_CHUNKS; 2],
        }
    }
}
fn sweep(secrets: &impl Secrets, generation: &str, count: usize) -> Result<(), String> {
    sweep_range(secrets, generation, 0, count)
}
fn sweep_range(
    secrets: &impl Secrets,
    generation: &str,
    start: usize,
    count: usize,
) -> Result<(), String> {
    let mut result = Ok(());
    for i in start..count {
        if let Err(e) = secrets.delete(&format!("{ACCOUNT}-{generation}-{i}")) {
            result = Err(e);
        }
    }
    result
}
fn cleanup_inactive(secrets: &impl Secrets, current: Option<&Manifest>) -> Result<(), String> {
    let pending = Marker::read(secrets, PENDING)?;
    let legacy = Marker::read(secrets, LEGACY_CLEANUP)?;
    let mut counts = current.map_or([0; 2], Manifest::occupied);
    pending.widen(&mut counts);
    // Unreadable legacy bounds: sweep every bounded slot, then drop the marker.
    if matches!(legacy, Marker::Unknown) {
        legacy.widen(&mut counts);
    }
    // Without a readable manifest or pending bounds (ACCOUNT missing or
    // corrupt) orphans can only be found by sweeping the whole bounded range.
    let full_sweep = current.is_none()
        && !pending.is_present()
        && secrets.get(CLEAN)?.as_deref() != Some(CLEAN_VALUE);
    if full_sweep {
        counts = [MAX_CHUNKS; 2];
    }
    let mut result = Ok(());
    for (i, generation) in ["0", "1"].iter().enumerate() {
        let keep = current
            .filter(|m| m.generation == *generation)
            .map_or(0, |m| m.chunks);
        // Preserve live chunks, but clean any tail left when a failed initial
        // sweep was followed by publishing a smaller replacement in that slot.
        match sweep_range(secrets, generation, keep, counts[i]) {
            Ok(()) => counts[i] = keep,
            Err(e) => result = Err(e),
        }
    }
    match &legacy {
        Marker::Known(old) if current.is_none_or(|m| m.generation != old.generation) => {
            match sweep(secrets, &old.generation, old.chunks) {
                Ok(()) => {
                    if let Err(e) = secrets.delete(LEGACY_CLEANUP) {
                        result = Err(e);
                    }
                }
                Err(e) => result = Err(e), // Keep the name for startup/logout to retry.
            }
        }
        Marker::Unknown if result.is_ok() => {
            if let Err(e) = secrets.delete(LEGACY_CLEANUP) {
                result = Err(e);
            }
        }
        _ => {}
    }
    if let Some(current) = current {
        if current.slot_chunks != Some(counts) {
            let mut cleaned = current.clone();
            cleaned.slot_chunks = Some(counts);
            if let Err(e) = secrets.set(
                ACCOUNT,
                &serde_json::to_string(&cleaned).map_err(|e| e.to_string())?,
            ) {
                result = Err(e);
            }
        }
    }
    if full_sweep && result.is_ok() {
        if let Err(e) = secrets.set(CLEAN, CLEAN_VALUE) {
            result = Err(e);
        }
    }
    // Do not forget pending bounds until every sweep and metadata update has
    // succeeded. Normal loads only read these two markers and the live chunks.
    if result.is_ok() && pending.is_present() {
        if let Err(e) = secrets.delete(PENDING) {
            result = Err(e);
        }
    }
    result
}
fn load(secrets: &impl Secrets) -> Result<Option<Session>, String> {
    let value = secrets.get(ACCOUNT)?;
    let current = manifest(value.as_deref())?;
    if let Err(e) = cleanup_inactive(secrets, current.as_ref()) {
        eprintln!("Could not clean inactive RSI session chunks: {e}");
    }
    let Some(value) = value else {
        return Ok(None);
    };
    let session = if let Some(current) = &current {
        let mut joined = String::new();
        for i in 0..current.chunks {
            joined.push_str(
                &secrets
                    .get(&current.account(i))?
                    .ok_or("Missing session chunk")?,
            );
        }
        serde_json::from_str::<Session>(&joined).map_err(|e| e.to_string())?
    } else {
        serde_json::from_str::<Session>(&value).map_err(|e| e.to_string())?
    };
    let reduced = session.reduced();
    // Migrate legacy full jars and v1 manifests on the first read. A failed
    // rewrite is logged; valid in-memory credentials still remain usable.
    if current.as_ref().is_none_or(|m| m.version == 1) || reduced != session {
        if let Err(e) = save(secrets, &reduced) {
            eprintln!("Could not rewrite legacy RSI session: {e}");
        }
    }
    Ok(Some(reduced))
}
fn save(secrets: &impl Secrets, session: &Session) -> Result<(), String> {
    save_with_log(secrets, session, |message| eprintln!("{message}"))
}
fn save_with_log(
    secrets: &impl Secrets,
    session: &Session,
    mut log: impl FnMut(&str),
) -> Result<(), String> {
    let value = secrets.get(ACCOUNT)?;
    let mut old = manifest(value.as_deref())?;
    let pre_cleanup_failed = if let Err(e) = cleanup_inactive(secrets, old.as_ref()) {
        log(&format!(
            "Could not clean inactive RSI session chunks before save: {e}"
        ));
        true
    } else {
        false
    };
    // Cleanup may have reduced the recorded bounds. Failed cleanup must not
    // prevent publishing new credentials, nor lose any still-pending bounds.
    old = manifest(secrets.get(ACCOUNT)?.as_deref())?;
    let pending = match Marker::read(secrets, PENDING) {
        Ok(pending) => pending,
        Err(e) => {
            log(&format!("Could not read pending RSI session cleanup: {e}"));
            // Reading cleanup metadata must not block credentials either.
            // Bounded slots let us conservatively retain every possible chunk.
            Marker::Unknown
        }
    };
    let mut counts = old.as_ref().map_or([0; 2], Manifest::occupied);
    pending.widen(&mut counts);
    if old.is_none() && !pending.is_present() && pre_cleanup_failed {
        counts = [MAX_CHUNKS; 2]; // Orphans could not be swept; keep the bound.
    }
    // A published v1 generation has an unbounded name. Remember it before
    // replacing its manifest, and retain that pointer until deletion succeeds.
    // Already-orphaned v1 names cannot be discovered through keyring; never
    // discard another legacy pointer while migrating to bounded slots.
    if let Some(old) = old.as_ref().filter(|m| m.version == 1) {
        secrets.set(
            LEGACY_CLEANUP,
            &serde_json::to_string(old).map_err(|e| e.to_string())?,
        )?;
    }
    let pieces = chunks(&serde_json::to_string(&session.reduced()).map_err(|e| e.to_string())?);
    let slot = usize::from(old.as_ref().is_some_and(|m| m.generation == "0"));
    counts[slot] = counts[slot].max(pieces.len());
    let next = Manifest {
        version: 2,
        generation: slot.to_string(),
        chunks: pieces.len(),
        slot_chunks: Some(counts),
    };
    next.validate()?;
    let encoded = serde_json::to_string(&next).map_err(|e| e.to_string())?;
    // The marker is durable before any cookie-bearing chunk is written.
    secrets.delete(CLEAN)?; // A session may exist from here on.
    secrets.set(PENDING, &encoded)?;
    let result = (|| {
        for (i, piece) in pieces.iter().enumerate() {
            secrets.set(&next.account(i), piece)?;
        }
        secrets.set(ACCOUNT, &encoded) // Publish last; the previous session stays intact until here.
    })();
    if let Err(error) = result {
        if let Err(e) = cleanup_inactive(secrets, old.as_ref()) {
            log(&format!("Could not clean pending RSI session chunks: {e}"));
        }
        return Err(error);
    }
    if let Err(e) = cleanup_inactive(secrets, Some(&next)) {
        log(&format!(
            "Could not clean RSI session chunks after publication: {e}"
        ));
    }
    Ok(()) // The manifest is published, even if deferred cleanup failed.
}
fn delete(secrets: &impl Secrets) -> Result<(), String> {
    let mut result = Ok(());
    let current = match secrets.get(ACCOUNT).and_then(|s| manifest(s.as_deref())) {
        Ok(m) => m,
        Err(e) => {
            result = Err(e);
            None
        }
    };
    let logout = Manifest {
        version: 2,
        generation: "0".into(),
        chunks: 1,
        slot_chunks: Some([MAX_CHUNKS; 2]),
    };
    let mut can_remove_manifest = true;
    secrets.delete(CLEAN)?;
    if let Err(e) = secrets.set(
        PENDING,
        &serde_json::to_string(&logout).map_err(|e| e.to_string())?,
    ) {
        result = Err(e);
        // Still attempt every deletion when metadata storage itself fails.
        for generation in ["0", "1"] {
            if let Err(e) = sweep(secrets, generation, MAX_CHUNKS) {
                result = Err(e);
                can_remove_manifest = false;
            }
        }
    }
    if let Some(old) = current.as_ref().filter(|m| m.version == 1) {
        // Do not discard the sole reference to legacy chunks if this write
        // fails. Bounded slots can always be swept independently of metadata.
        if let Err(e) = secrets.set(
            LEGACY_CLEANUP,
            &serde_json::to_string(old).map_err(|e| e.to_string())?,
        ) {
            result = Err(e);
            match sweep(secrets, &old.generation, old.chunks) {
                Ok(()) => {}
                Err(e) => {
                    result = Err(e);
                    can_remove_manifest = false;
                }
            }
        }
    }
    if can_remove_manifest {
        if let Err(e) = secrets.delete(ACCOUNT) {
            result = Err(e);
        }
    }
    // Always try both slots and recorded legacy cleanup, even if removing the
    // manifest failed. Failed cleanup retains its marker for the next attempt.
    if let Err(e) = cleanup_inactive(secrets, None) {
        result = Err(e);
    }
    if result.is_ok() {
        if let Err(e) = secrets.set(CLEAN, CLEAN_VALUE) {
            result = Err(e);
        }
    }
    result
}
pub fn load_session() -> Result<Option<Session>, String> {
    load(&Keychain(SERVICE))
}
pub fn save_session(session: &Session) -> Result<(), String> {
    save(&Keychain(SERVICE), session)
}
pub fn delete_session() -> Result<(), String> {
    delete(&Keychain(SERVICE))
}

#[derive(Debug, PartialEq)]
pub enum SessionMove {
    /// Nothing under the old service name.
    NoOld,
    /// The new service already holds a session; the old entries are left alone.
    NewPresent,
    Moved,
}
/// Moves a stored RSI session from the old keychain service to the new one.
/// The old entries are deleted only after the copy reads back identically, so a
/// failure at any point leaves the session recoverable (worst case under both names).
fn migrate_session(old: &impl Secrets, new: &impl Secrets) -> Result<SessionMove, String> {
    if new.get(ACCOUNT)?.is_some_and(|v| !v.trim().is_empty()) {
        return Ok(SessionMove::NewPresent);
    }
    // Do not call `load` on the old service when it is empty: it would write a marker there.
    if old.get(ACCOUNT)?.is_none_or(|v| v.trim().is_empty()) {
        return Ok(SessionMove::NoOld);
    }
    let Some(session) = load(old)? else {
        return Ok(SessionMove::NoOld);
    };
    save(new, &session)?;
    if load(new)?.as_ref() != Some(&session) {
        return Err("Moved session did not read back; the old one was kept".into());
    }
    delete(old)?;
    // `delete` leaves its "swept" marker behind; nothing should stay under the old name.
    old.delete(CLEAN)?;
    old.delete(LEGACY_CLEANUP)?;
    Ok(SessionMove::Moved)
}
pub fn migrate_legacy_session() -> Result<SessionMove, String> {
    migrate_session(&Keychain(LEGACY_SERVICE), &Keychain(SERVICE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    #[derive(Default)]
    struct Memory {
        values: RefCell<BTreeMap<String, String>>,
        fail: Cell<bool>,
        crash_publish: Cell<bool>,
        fail_delete: RefCell<Option<String>>,
        reads: Cell<usize>,
        deletes: RefCell<Vec<String>>,
    }
    impl Secrets for Memory {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            self.reads.set(self.reads.get() + 1);
            Ok(self.values.borrow().get(key).cloned())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            assert!(value.encode_utf16().count() <= CHUNK_UNITS);
            if self.crash_publish.get() && key == ACCOUNT {
                panic!("simulated crash before publication");
            }
            if self.fail.get() && key == ACCOUNT {
                return Err("mock keychain failure".into());
            }
            self.values.borrow_mut().insert(key.into(), value.into());
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.deletes.borrow_mut().push(key.into());
            if self.fail_delete.borrow().as_deref() == Some(key) {
                return Err("mock deletion failure".into());
            }
            self.values.borrow_mut().remove(key);
            Ok(())
        }
    }
    #[test]
    fn large_jar_reduces_chunks_and_roundtrips_in_windows_limit() {
        let secrets = Memory::default();
        let session = Session {
            cookies: BTreeMap::from([
                ("Rsi-Token".into(), "a😀".repeat(2500)),
                ("Rsi-Account-ID".into(), "42".into()),
                ("cf_clearance".into(), "cloudflare".into()),
                ("_ga".into(), "tracking".repeat(5000)),
            ]),
            csrf: "csrf".repeat(500),
            ..Session::default()
        };
        save(&secrets, &session).unwrap();
        assert!(secrets.values.borrow().len() > 2);
        assert!(!secrets
            .values
            .borrow()
            .values()
            .any(|v| v.contains("tracking")));
        assert_eq!(load(&secrets).unwrap(), Some(session.reduced()));
        // Failed replacement leaves the previous published generation usable.
        secrets.fail.set(true);
        assert!(save(&secrets, &Session::default()).is_err());
        assert_eq!(load(&secrets).unwrap(), Some(session.reduced()));
        secrets.fail.set(false);
        save(&secrets, &Session::default()).unwrap();
        assert_eq!(secrets.values.borrow().len(), 2);
        delete(&secrets).unwrap();
        assert!(secrets.values.borrow().keys().all(|k| k == CLEAN));
    }
    #[test]
    fn shared_cookie_rule_matches_the_node_side() {
        for name in [
            "Rsi-Token",
            "Rsi-Account-Auth",
            "cf_clearance",
            "__cf_bm",
            "__cflb",
        ] {
            assert!(needed_cookie(name), "{name}");
        }
        for name in ["_ga", "analytics", "rsi-lower", "cf_other", ""] {
            assert!(!needed_cookie(name), "{name}");
        }
    }

    #[test]
    fn reads_legacy_session_and_discards_unneeded_cookies() {
        let secrets = Memory::default();
        let session = Session {
            cookies: BTreeMap::from([
                ("Rsi-Token".into(), "token".into()),
                ("analytics".into(), "drop".into()),
            ]),
            ..Session::default()
        };
        secrets
            .values
            .borrow_mut()
            .insert(ACCOUNT.into(), serde_json::to_string(&session).unwrap());
        assert_eq!(load(&secrets).unwrap(), Some(session.reduced()));
        assert_eq!(
            manifest(secrets.get(ACCOUNT).unwrap().as_deref())
                .unwrap()
                .unwrap()
                .version,
            2
        );
        assert!(!secrets
            .values
            .borrow()
            .values()
            .any(|s| s.contains("analytics") || s.contains("drop")));
        delete(&secrets).unwrap();
        assert!(secrets.values.borrow().keys().all(|k| k == CLEAN));
    }
    #[test]
    fn startup_cleans_chunks_after_crash_before_manifest_publication() {
        for existing in [false, true] {
            let secrets = Memory::default();
            if existing {
                save(&secrets, &Session::default()).unwrap();
            }
            secrets.crash_publish.set(true);
            let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                save(
                    &secrets,
                    &Session {
                        csrf: "secret".repeat(800),
                        ..Session::default()
                    },
                )
                .unwrap();
            }));
            assert!(crashed.is_err());
            assert!(secrets.get(PENDING).unwrap().is_some());
            secrets.crash_publish.set(false);
            assert_eq!(load(&secrets).unwrap(), existing.then(Session::default));
            assert!(secrets.get(PENDING).unwrap().is_none());
            assert!(!secrets
                .values
                .borrow()
                .values()
                .any(|s| s.contains("secret")));
        }
    }
    #[test]
    fn failed_old_chunk_deletion_is_retried_at_startup() {
        let secrets = Memory::default();
        save(
            &secrets,
            &Session {
                csrf: "old-secret".into(),
                ..Session::default()
            },
        )
        .unwrap();
        *secrets.fail_delete.borrow_mut() = Some(format!("{ACCOUNT}-0-0"));
        let replacement = Session {
            csrf: "new-secret".into(),
            ..Session::default()
        };
        assert!(save(&secrets, &replacement).is_ok());
        assert!(secrets.get(PENDING).unwrap().is_some());
        assert_eq!(load(&secrets).unwrap(), Some(replacement.clone()));
        *secrets.fail_delete.borrow_mut() = None;
        assert_eq!(load(&secrets).unwrap(), Some(replacement));
        assert!(secrets.get(PENDING).unwrap().is_none());
        assert!(secrets.get(&format!("{ACCOUNT}-0-0")).unwrap().is_none());
    }
    #[test]
    fn logout_clears_both_slots_including_unpublished_chunks() {
        let secrets = Memory::default();
        save(&secrets, &Session::default()).unwrap();
        secrets.crash_publish.set(true);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            save(
                &secrets,
                &Session {
                    csrf: "pending-secret".repeat(400),
                    ..Session::default()
                },
            )
            .unwrap();
        }));
        // Failure must not stop attempts to clear the other generation.
        *secrets.fail_delete.borrow_mut() = Some(format!("{ACCOUNT}-0-0"));
        assert!(delete(&secrets).is_err());
        assert!(secrets.get(&format!("{ACCOUNT}-1-0")).unwrap().is_none());
        *secrets.fail_delete.borrow_mut() = None;
        delete(&secrets).unwrap();
        assert!(secrets.values.borrow().keys().all(|k| k == CLEAN));
    }
    #[test]
    fn legacy_manifest_cleanup_survives_failed_deletion() {
        let secrets = Memory::default();
        let old = Manifest {
            version: 1,
            generation: "123-456".into(),
            chunks: 1,
            slot_chunks: None,
        };
        secrets
            .set(
                &old.account(0),
                &serde_json::to_string(&Session::default()).unwrap(),
            )
            .unwrap();
        secrets
            .set(ACCOUNT, &serde_json::to_string(&old).unwrap())
            .unwrap();
        *secrets.fail_delete.borrow_mut() = Some(old.account(0));
        assert_eq!(load(&secrets).unwrap(), Some(Session::default()));
        assert!(secrets.get(LEGACY_CLEANUP).unwrap().is_some());
        *secrets.fail_delete.borrow_mut() = None;
        delete(&secrets).unwrap();
        assert!(secrets.values.borrow().keys().all(|k| k == CLEAN));
    }
    #[test]
    fn normal_loads_do_no_deletes_and_saves_only_sweep_recorded_chunks() {
        let secrets = Memory::default();
        save(&secrets, &Session::default()).unwrap();
        secrets.reads.set(0);
        secrets.deletes.borrow_mut().clear();
        assert_eq!(load(&secrets).unwrap(), Some(Session::default()));
        assert_eq!(secrets.reads.get(), 4); // manifest, two markers, one chunk
        assert!(secrets.deletes.borrow().is_empty());
        save(&secrets, &Session::default()).unwrap();
        assert_eq!(
            *secrets.deletes.borrow(),
            [CLEAN.into(), format!("{ACCOUNT}-0-0"), PENDING.into()]
        );
        let current = manifest(secrets.get(ACCOUNT).unwrap().as_deref())
            .unwrap()
            .unwrap();
        assert_eq!(current.slot_chunks, Some([0, 1]));
        secrets.deletes.borrow_mut().clear();
        load(&secrets).unwrap();
        assert!(secrets.deletes.borrow().is_empty());
    }
    #[test]
    fn older_bounded_manifest_is_swept_once_then_loads_are_cheap() {
        let secrets = Memory::default();
        let old = Manifest {
            version: 2,
            generation: "0".into(),
            chunks: 1,
            slot_chunks: None,
        };
        secrets
            .set(ACCOUNT, &serde_json::to_string(&old).unwrap())
            .unwrap();
        secrets
            .set(
                &old.account(0),
                &serde_json::to_string(&Session::default()).unwrap(),
            )
            .unwrap();
        secrets
            .set(&format!("{ACCOUNT}-1-127"), "old orphan")
            .unwrap();
        assert_eq!(load(&secrets).unwrap(), Some(Session::default()));
        assert_eq!(secrets.deletes.borrow().len(), 2 * MAX_CHUNKS - 1);
        secrets.deletes.borrow_mut().clear();
        load(&secrets).unwrap();
        assert!(secrets.deletes.borrow().is_empty());
        assert!(secrets.get(&format!("{ACCOUNT}-1-127")).unwrap().is_none());
    }
    #[test]
    fn publication_succeeds_despite_cleanup_failures_before_and_after_it() {
        let secrets = Memory::default();
        let large = Session {
            csrf: "stale-tail".repeat(600),
            ..Session::default()
        };
        save(&secrets, &large).unwrap();
        // Leave slot zero occupied after slot one is published.
        *secrets.fail_delete.borrow_mut() = Some(format!("{ACCOUNT}-0-1"));
        let mut logs = Vec::new();
        save_with_log(&secrets, &Session::default(), |s| logs.push(s.to_owned())).unwrap();
        assert!(logs.iter().any(|s| s.contains("after publication")));
        let replacement = Session {
            csrf: "new".into(),
            ..Session::default()
        };
        logs.clear();
        // The pre-save sweep still fails. Publishing into slot zero must
        // succeed, retain the failed tail's bound, and retry it on startup.
        save_with_log(&secrets, &replacement, |s| logs.push(s.to_owned())).unwrap();
        assert!(logs.iter().any(|s| s.contains("before save")));
        assert!(logs.iter().any(|s| s.contains("after publication")));
        assert_eq!(load(&secrets).unwrap(), Some(replacement.clone()));
        assert!(secrets.get(&format!("{ACCOUNT}-0-1")).unwrap().is_some());
        *secrets.fail_delete.borrow_mut() = None;
        assert_eq!(load(&secrets).unwrap(), Some(replacement));
        assert!(secrets.get(&format!("{ACCOUNT}-0-1")).unwrap().is_none());
        assert!(secrets.get(PENDING).unwrap().is_none());
        secrets.deletes.borrow_mut().clear();
        load(&secrets).unwrap();
        assert!(secrets.deletes.borrow().is_empty());
    }
    #[test]
    fn recorded_inactive_count_is_sufficient_without_a_pending_marker() {
        let secrets = Memory::default();
        save(&secrets, &Session::default()).unwrap();
        *secrets.fail_delete.borrow_mut() = Some(format!("{ACCOUNT}-0-0"));
        save(&secrets, &Session::default()).unwrap();
        secrets.values.borrow_mut().remove(PENDING);
        *secrets.fail_delete.borrow_mut() = None;
        secrets.deletes.borrow_mut().clear();
        load(&secrets).unwrap();
        assert_eq!(*secrets.deletes.borrow(), [format!("{ACCOUNT}-0-0")]);
        let current = manifest(secrets.get(ACCOUNT).unwrap().as_deref())
            .unwrap()
            .unwrap();
        assert_eq!(current.slot_chunks, Some([0, 1]));
    }
    #[test]
    fn invalid_markers_mean_unknown_bounds_and_self_heal_on_load() {
        let secrets = Memory::default();
        save(&secrets, &Session::default()).unwrap();
        // Parses as a manifest but fails validate() (zero chunks).
        let invalid = r#"{"version":2,"generation":"0","chunks":0}"#;
        secrets.set(PENDING, invalid).unwrap();
        secrets.set(LEGACY_CLEANUP, invalid).unwrap();
        secrets.set(&format!("{ACCOUNT}-1-100"), "orphan").unwrap();
        assert_eq!(load(&secrets).unwrap(), Some(Session::default()));
        assert!(secrets.get(&format!("{ACCOUNT}-1-100")).unwrap().is_none());
        assert!(secrets.get(PENDING).unwrap().is_none());
        assert!(secrets.get(LEGACY_CLEANUP).unwrap().is_none());
        // The live chunk survives the full sweep.
        assert!(secrets.get(&format!("{ACCOUNT}-0-0")).unwrap().is_some());
        secrets.deletes.borrow_mut().clear();
        load(&secrets).unwrap();
        assert!(secrets.deletes.borrow().is_empty());
    }
    #[test]
    fn unparseable_pending_marker_is_not_overwritten_by_fresh_counts() {
        let secrets = Memory::default();
        save(&secrets, &Session::default()).unwrap();
        secrets.set(PENDING, "not json").unwrap();
        secrets.set(&format!("{ACCOUNT}-1-100"), "orphan").unwrap();
        *secrets.fail_delete.borrow_mut() = Some(format!("{ACCOUNT}-1-100"));
        let replacement = Session {
            csrf: "new".into(),
            ..Session::default()
        };
        save(&secrets, &replacement).unwrap();
        // The sweep of the orphan failed: the bound for every slot is kept.
        let current = manifest(secrets.get(ACCOUNT).unwrap().as_deref())
            .unwrap()
            .unwrap();
        assert_eq!(current.slot_chunks.unwrap()[1], MAX_CHUNKS);
        assert!(secrets.get(PENDING).unwrap().is_some());
        *secrets.fail_delete.borrow_mut() = None;
        assert_eq!(load(&secrets).unwrap(), Some(replacement));
        assert!(secrets.get(&format!("{ACCOUNT}-1-100")).unwrap().is_none());
        assert!(secrets.get(PENDING).unwrap().is_none());
    }
    #[test]
    fn missing_or_corrupt_manifest_without_pending_gets_one_full_sweep() {
        for corrupt in [false, true] {
            let secrets = Memory::default();
            secrets.set(&format!("{ACCOUNT}-1-77"), "orphan").unwrap();
            if corrupt {
                secrets.set(ACCOUNT, "{broken").unwrap();
            }
            let _ = load(&secrets);
            assert!(secrets.get(&format!("{ACCOUNT}-1-77")).unwrap().is_none());
        }
    }
    #[test]
    fn signed_out_loads_sweep_once_and_logout_makes_it_clean_again() {
        let secrets = Memory::default();
        assert_eq!(load(&secrets).unwrap(), None);
        assert_eq!(secrets.deletes.borrow().len(), 2 * MAX_CHUNKS);
        assert_eq!(secrets.get(CLEAN).unwrap().as_deref(), Some(CLEAN_VALUE));
        secrets.deletes.borrow_mut().clear();
        assert_eq!(load(&secrets).unwrap(), None);
        assert!(secrets.deletes.borrow().is_empty());
        save(&secrets, &Session::default()).unwrap();
        assert!(secrets.get(CLEAN).unwrap().is_none());
        delete(&secrets).unwrap();
        assert_eq!(secrets.get(CLEAN).unwrap().as_deref(), Some(CLEAN_VALUE));
        secrets.deletes.borrow_mut().clear();
        assert_eq!(load(&secrets).unwrap(), None);
        assert!(secrets.deletes.borrow().is_empty());
        // A corrupt CLEAN marker counts as absent.
        secrets.set(CLEAN, "garbage").unwrap();
        secrets.set(&format!("{ACCOUNT}-1-77"), "orphan").unwrap();
        load(&secrets).unwrap();
        assert!(secrets.get(&format!("{ACCOUNT}-1-77")).unwrap().is_none());
        assert_eq!(secrets.get(CLEAN).unwrap().as_deref(), Some(CLEAN_VALUE));
    }
    #[test]
    fn session_moves_between_services_and_old_entries_go() {
        let old = Memory::default();
        let new = Memory::default();
        let session = Session {
            cookies: BTreeMap::from([("Rsi-Token".into(), "t".repeat(3000))]),
            csrf: "c".into(),
            ..Session::default()
        };
        save(&old, &session).unwrap();
        assert_eq!(migrate_session(&old, &new).unwrap(), SessionMove::Moved);
        assert_eq!(load(&new).unwrap(), Some(session));
        assert!(old.values.borrow().is_empty(), "old entries left: {:?}", old.values.borrow().keys());
        // Second run: the new service has it, nothing to do.
        assert_eq!(migrate_session(&old, &new).unwrap(), SessionMove::NewPresent);
    }
    #[test]
    fn empty_old_service_is_left_untouched_and_new_session_wins() {
        let (old, new) = (Memory::default(), Memory::default());
        assert_eq!(migrate_session(&old, &new).unwrap(), SessionMove::NoOld);
        assert!(old.values.borrow().is_empty() && new.values.borrow().is_empty());
        let a = Session { csrf: "a".into(), ..Session::default() };
        let b = Session { csrf: "b".into(), ..Session::default() };
        save(&old, &a).unwrap();
        save(&new, &b).unwrap();
        assert_eq!(migrate_session(&old, &new).unwrap(), SessionMove::NewPresent);
        assert_eq!(load(&new).unwrap(), Some(b));
        assert_eq!(load(&old).unwrap(), Some(a));
    }
    #[test]
    fn failed_copy_keeps_the_old_session() {
        let (old, new) = (Memory::default(), Memory::default());
        let a = Session { csrf: "a".into(), ..Session::default() };
        save(&old, &a).unwrap();
        new.fail.set(true);
        assert!(migrate_session(&old, &new).is_err());
        assert_eq!(load(&old).unwrap(), Some(a));
    }
}
