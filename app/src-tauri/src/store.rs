use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub const LEGACY_FILES: &[&str] = &[
    "catalog.json",
    "ship-details.json",
    "hangar.json",
    "buyback.json",
    "plans.json",
    "price-overrides.json",
    "ship-images.json",
    "offer-history.jsonl",
    "sale-history.json",
    "sale-events.json",
    "warbond-prices.json",
    "plan-snapshots.json",
];

fn read_optional_json(path: &Path) -> Result<Option<Value>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| format!("invalid JSON: {e}")),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// Node's readdirSync returns names in filename order. Only immediate JSON files
// belong to the upgrades input/import contract.
fn upgrade_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.path().extension().is_some_and(|ext| ext == "json")
        {
            paths.push(entry.path());
        }
    }
    paths.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(paths)
}

// CLI thumbnails use <id>-s|l.webp; desktop originals use <id>-original.<format>.
fn is_image_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let id = if ext == "webp" {
        stem.strip_suffix("-s")
            .or_else(|| stem.strip_suffix("-l"))
            .or_else(|| stem.strip_suffix("-original"))
    } else if ["png", "jpg", "jpeg", "avif", "gif"].contains(&ext) {
        stem.strip_suffix("-original")
    } else {
        None
    };
    id.is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

// Store catalog pictures are images/catalog/<id>.<format>, kept in the format RSI sent.
fn is_catalog_image_name(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(stem, ext)| {
        ["webp", "png", "jpg", "jpeg", "avif", "gif"].contains(&ext)
            && !stem.is_empty()
            && stem.bytes().all(|b| b.is_ascii_digit())
    })
}

// Regular files with a picture name in a real (not symlinked) images folder, in filename order.
fn image_files(dir: &Path) -> Result<Vec<String>, String> {
    match fs::symlink_metadata(dir) {
        Ok(meta) if meta.file_type().is_dir() => {}
        Ok(_) => return Ok(Vec::new()),
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file() {
            if let Some(name) = entry.file_name().to_str().filter(|n| is_image_name(n)) {
                names.push(name.to_owned());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// The same raw JSON shape as src/data.mjs readRaw, with no catalog meaning no data.
pub fn load_data(dir: &Path) -> Result<Option<Value>, String> {
    let Some(catalog) = read_optional_json(&dir.join("catalog.json"))? else {
        return Ok(None);
    };
    let upgrades = upgrade_files(&dir.join("upgrades"))?
        .into_iter()
        .map(|path| {
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let history = match fs::read_to_string(dir.join("offer-history.jsonl")) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    Ok(Some(json!({
        "catalog": catalog,
        "details": read_optional_json(&dir.join("ship-details.json"))?,
        "upgrades": upgrades,
        "hangar": read_optional_json(&dir.join("hangar.json"))?,
        "buyback": read_optional_json(&dir.join("buyback.json"))?,
        "history": history,
        "plans": read_optional_json(&dir.join("plans.json"))?,
        "overrides": read_optional_json(&dir.join("price-overrides.json"))?,
        "images": read_optional_json(&dir.join("ship-images.json"))?,
        "saleHistory": read_optional_json(&dir.join("sale-history.json"))?,
        "saleEvents": read_optional_json(&dir.join("sale-events.json"))?,
        "warbondPrices": read_optional_json(&dir.join("warbond-prices.json"))?
            .unwrap_or_else(|| json!({"pairs": {}})),
        // History only: a damaged file means no history, never a failed load.
        "planSnapshots": read_optional_json(&dir.join("plan-snapshots.json")).unwrap_or_else(|e| {
            eprintln!("warning: ignoring unreadable plan-snapshots.json: {e}");
            None
        }),
    })))
}

/// Serializes in-process callers through the caller's mutex and other processes through `<data>/.write.lock`.
pub fn save_doc(dir: &Path, name: &str, mut doc: Value, base_rev: u64) -> Result<u64, String> {
    let filename = match name {
        "plans" => "plans.json",
        "overrides" => "price-overrides.json",
        "sale-events" => "sale-events.json",
        _ => return Err("unknown document name".into()),
    };
    let target = dir.join(filename);
    // The check, the write and the rename are one step across processes: <data>/.write.lock, like the Node writers.
    crate::lock::with_write_lock(dir, move || {
        let current = read_optional_json(&target)?;
        let current_rev = match current.as_ref().and_then(|value| value.get("rev")) {
            None => 0,
            Some(rev) => rev.as_u64().ok_or("invalid revision")?,
        };
        if current_rev != base_rev {
            return Err("conflict".into());
        }
        let rev = base_rev.checked_add(1).ok_or("revision overflow")?;
        let object = doc.as_object_mut().ok_or("document must be an object")?;
        object.insert("rev".into(), rev.into());
        let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        // A unique, exclusively created sibling avoids clobbering another temp file.
        // Rename within the directory atomically replaces the previous document.
        static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
        let (temp_path, mut temp) = loop {
            let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = dir.join(format!(".{filename}.{}.{sequence}.tmp", std::process::id()));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => break (path, file),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        };
        let result = (|| {
            temp.write_all(&bytes).map_err(|e| e.to_string())?;
            temp.sync_all().map_err(|e| e.to_string())?;
            drop(temp);
            fs::rename(&temp_path, target).map_err(|e| e.to_string())?;
            Ok(rev)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp_path);
        }
        result
    })
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct ImportResult {
    pub copied: Vec<String>,
    pub skipped: Vec<String>,
}

fn copy_atomic(source: &Path, target: &Path) -> Result<(), String> {
    let dir = target.parent().ok_or("invalid destination")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let (temp_path, mut temp) = loop {
        let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!(".import.{}.{sequence}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => break (path, file),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    };
    let result = (|| {
        let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut temp).map_err(|e| e.to_string())?;
        temp.sync_all().map_err(|e| e.to_string())?;
        drop(temp);
        fs::rename(&temp_path, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

/// Copies only allowlisted regular files, preserving existing editable documents.
pub fn import_legacy(source: &Path, destination: &Path) -> Result<ImportResult, String> {
    if !fs::symlink_metadata(source.join("catalog.json"))
        .map(|meta| meta.file_type().is_file())
        .unwrap_or(false)
    {
        return Err("legacy catalog.json is missing".into());
    }
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let destination = fs::canonicalize(destination).map_err(|e| e.to_string())?;
    if source == destination {
        return Err("source is the app data dir".into());
    }
    let mut paths = Vec::new();
    for filename in LEGACY_FILES {
        match fs::symlink_metadata(source.join(filename)) {
            Ok(meta) if meta.file_type().is_file() => paths.push(PathBuf::from(filename)),
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    for path in upgrade_files(&source.join("upgrades"))? {
        paths.push(Path::new("upgrades").join(path.file_name().ok_or("invalid upgrade filename")?));
    }
    for name in image_files(&source.join("images"))? {
        paths.push(Path::new("images").join(name));
    }
    // catalog.json is the "import complete" marker: copy it last, so a failed
    // import never leaves a catalog next to a partial data set.
    paths.sort_by_key(|p| p == Path::new("catalog.json"));
    let mut result = ImportResult {
        copied: Vec::new(),
        skipped: Vec::new(),
    };
    for relative in paths {
        let target = destination.join(&relative);
        let name = relative.to_string_lossy().replace('\\', "/");
        if relative == Path::new("plans.json")
            || relative == Path::new("price-overrides.json")
            || relative == Path::new("sale-events.json")
            || relative.starts_with("images")
        {
            match fs::symlink_metadata(&target) {
                Ok(_) => {
                    result.skipped.push(name);
                    continue;
                }
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        copy_atomic(&source.join(&relative), &target)?;
        result.copied.push(name);
    }
    Ok(result)
}

// Sync has no access to editable documents or arbitrary filesystem paths.
pub fn sync_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let fixed = [
        "catalog.json",
        "hangar.json",
        "buyback.json",
        "offer-history.jsonl",
        "sale-history.json",
        "warbond-prices.json",
        "ship-details.json",
        "plan-snapshots.json",
        "sync-state.json",
        "ship-images.json",
        "store-catalog.json",
        "pending-import.json",
    ];
    let upgrade = name
        .strip_prefix("upgrades/")
        .and_then(|s| s.strip_suffix(".json"))
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    let image = name.strip_prefix("images/").is_some_and(|n| {
        is_image_name(n) || n.strip_prefix("catalog/").is_some_and(is_catalog_image_name)
    });
    if !(fixed.contains(&name) || upgrade || image) {
        return Err("sync path not allowlisted".into());
    }
    // The selected data root may itself be a symlink; refuse symlinks below it.
    let target = dir.join(name);
    for ancestor in target
        .ancestors()
        .take_while(|p| *p != dir && p.starts_with(dir))
    {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_type().is_symlink() => return Err("symlink in sync path".into()),
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(target)
}

pub fn sync_read(dir: &Path, name: &str) -> Result<Option<Value>, String> {
    if name == "images" {
        sync_path(dir, "images/0-original.webp")?;
        return image_files(&dir.join("images")).map(|v| Some(json!(v)));
    }
    if name == "images/catalog" {
        // The store catalog pictures on disk, as the names the catalog file records ("catalog/<id>.<format>").
        sync_path(dir, "images/catalog/0.webp")?;
        let folder = dir.join("images").join("catalog");
        let mut names = Vec::new();
        match fs::symlink_metadata(&folder) {
            Ok(meta) if meta.file_type().is_dir() => {
                for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                        if let Some(n) = entry.file_name().to_str().filter(|n| is_catalog_image_name(n)) {
                            names.push(format!("catalog/{n}"));
                        }
                    }
                }
            }
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        names.sort();
        return Ok(Some(json!(names)));
    }
    if name == "upgrades" {
        sync_path(dir, "upgrades/0.json")?;
        return upgrade_files(&dir.join("upgrades"))?
            .iter()
            .map(|p| {
                let name = format!("upgrades/{}", p.file_name().unwrap().to_string_lossy());
                read_optional_json(&sync_path(dir, &name)?)?.ok_or("missing upgrade".into())
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|v| Some(Value::Array(v)));
    }
    read_optional_json(&sync_path(dir, name)?)
}

pub fn sync_write(dir: &Path, name: &str, bytes: &[u8], append: bool) -> Result<(), String> {
    let target = sync_path(dir, name)?;
    if append && name != "offer-history.jsonl" {
        return Err("append not allowlisted".into());
    }
    fs::create_dir_all(target.parent().ok_or("invalid parent")?).map_err(|e| e.to_string())?;
    if append {
        if bytes.last() != Some(&b'\n') {
            return Err("append requires whole lines".into());
        }
        let mut log = OpenOptions::new()
            .read(true)
            .append(true)
            .create(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
        // O_APPEND preserves every prior line across crashes and concurrent writers.
        // Separate any torn final line before appending; parseHistory skips that line.
        if log.metadata().map_err(|e| e.to_string())?.len() > 0 {
            log.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
            let mut last = [0];
            log.read_exact(&mut last).map_err(|e| e.to_string())?;
            if last[0] != b'\n' {
                log.write_all(b"\n").map_err(|e| e.to_string())?;
            }
        }
        for line in bytes.split_inclusive(|b| *b == b'\n') {
            if log.write(line).map_err(|e| e.to_string())? != line.len() {
                return Err("Incomplete history line append".into());
            }
        }
        return log.sync_all().map_err(|e| e.to_string());
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let temp_path = target.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| e.to_string())?;
        temp.write_all(bytes).map_err(|e| e.to_string())?;
        temp.sync_all().map_err(|e| e.to_string())?;
        drop(temp);
        fs::rename(&temp_path, &target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    #[cfg(unix)]
    #[test]
    fn failed_import_leaves_no_catalog() {
        use std::os::unix::fs::PermissionsExt;
        let src = tempdir().unwrap();
        let dest = tempdir().unwrap();
        fs::write(src.path().join("catalog.json"), "{}").unwrap();
        let hangar = src.path().join("hangar.json");
        fs::write(&hangar, "{}").unwrap();
        fs::set_permissions(&hangar, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read(&hangar).is_ok() {
            return; // running as root: cannot make a copy fail this way
        }
        assert!(import_legacy(src.path(), dest.path()).is_err());
        assert!(!dest.path().join("catalog.json").exists());
        fs::set_permissions(&hangar, fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn sync_accepts_symlink_root_but_not_descendant_links() {
        let temp = tempdir().unwrap();
        let real = tempdir().unwrap();
        let root = temp.path().join("data");
        std::os::unix::fs::symlink(real.path(), &root).unwrap();
        sync_write(&root, "hangar.json", b"{}", false).unwrap();
        assert_eq!(sync_read(&root, "hangar.json").unwrap(), Some(json!({})));
        std::os::unix::fs::symlink(temp.path(), real.path().join("upgrades")).unwrap();
        assert!(sync_write(&root, "upgrades/1.json", b"{}", false).is_err());
    }
    #[test]
    fn append_preserves_old_lines_and_separates_torn_tail() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("offer-history.jsonl");
        fs::write(&file, b"{\"old\":1}\n{torn").unwrap();
        sync_write(dir.path(), "offer-history.jsonl", b"{\"new\":2}\n", true).unwrap();
        assert_eq!(
            fs::read_to_string(file).unwrap(),
            "{\"old\":1}\n{torn\n{\"new\":2}\n"
        );
        assert!(sync_write(dir.path(), "offer-history.jsonl", b"no newline", true).is_err());
    }

    #[test]
    fn sync_paths_and_atomic_append() {
        let dir = tempdir().unwrap();
        assert!(is_image_name("1-original.png"));
        assert!(is_image_name("1-original.webp"));
        for name in [
            "../catalog.json",
            "images/../plans.json",
            "upgrades/../1.json",
            "/catalog.json",
            "plans.json",
            "session.json",
            "images/x.webp",
            "upgrades/1.json/extra",
            "upgrades/1%2f.json",
            "upgrades/1\\2.json",
        ] {
            assert!(
                sync_write(dir.path(), name, b"{}", false).is_err(),
                "{name}"
            );
        }
        sync_write(dir.path(), "upgrades/1.json", b"{\"fromId\":1}", false).unwrap();
        assert_eq!(
            sync_read(dir.path(), "upgrades")
                .unwrap()
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        sync_write(dir.path(), "offer-history.jsonl", b"one\n", true).unwrap();
        sync_write(dir.path(), "offer-history.jsonl", b"two\n", true).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("offer-history.jsonl")).unwrap(),
            "one\ntwo\n"
        );
        assert!(sync_write(dir.path(), "hangar.json", b"{}", true).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn sync_refuses_symlink_parents_and_targets() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("upgrades")).unwrap();
        assert!(sync_write(dir.path(), "upgrades/1.json", b"{}", false).is_err());
        std::os::unix::fs::symlink(
            outside.path().join("secret"),
            dir.path().join("catalog.json"),
        )
        .unwrap();
        assert!(sync_read(dir.path(), "catalog.json").is_err());
    }

    #[test]
    fn load_returns_none_on_empty_dir() {
        let dir = tempdir().unwrap();
        assert_eq!(load_data(dir.path()).unwrap(), None);
    }

    #[test]
    fn save_rejects_stale_rev() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("plans.json");
        let original = "{ \"rev\": 3, \"chains\": [] }";
        fs::write(&path, original).unwrap();
        assert_eq!(
            save_doc(dir.path(), "plans", json!({}), 2),
            Err("conflict".into())
        );
        assert_eq!(fs::read_to_string(path).unwrap(), original);
    }

    #[test]
    fn two_writers_with_the_same_base_rev_exactly_one_wins() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("plans.json"), r#"{"rev":3}"#).unwrap();
        let results: Vec<_> = (0..6)
            .map(|n| {
                let path = dir.path().to_path_buf();
                std::thread::spawn(move || save_doc(&path, "plans", json!({"chains": [n]}), 3))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect();
        assert_eq!(
            results.iter().filter(|r| **r == Ok(4)).count(),
            1,
            "{results:?}"
        );
        assert!(results
            .iter()
            .filter(|r| r.is_err())
            .all(|r| *r == Err("conflict".into())));
        assert!(!dir.path().join(crate::lock::WRITE_LOCK).exists());
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
    }

    #[test]
    fn save_refuses_clearly_while_another_process_holds_the_write_lock() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("plans.json"), r#"{"rev":0}"#).unwrap();
        let held = crate::lock::lock_text_for_tests(std::process::id());
        fs::write(dir.path().join(crate::lock::WRITE_LOCK), held).unwrap();
        assert_eq!(
            save_doc(dir.path(), "plans", json!({}), 0).unwrap_err(),
            crate::lock::DATA_BUSY
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("plans.json")).unwrap(),
            r#"{"rev":0}"#
        );
    }

    #[test]
    fn save_bumps_rev_atomically() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("plans.json"), r#"{"rev":3}"#).unwrap();
        assert_eq!(
            save_doc(dir.path(), "plans", json!({"chains": [1]}), 3).unwrap(),
            4
        );
        let saved: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("plans.json")).unwrap())
                .unwrap();
        assert_eq!(saved, json!({"rev": 4, "chains": [1]}));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn save_writes_sale_events_with_rev_check() {
        let dir = tempdir().unwrap();
        assert_eq!(
            save_doc(
                dir.path(),
                "sale-events",
                json!({"events": [{"id": "e1"}]}),
                0
            ),
            Ok(1)
        );
        let saved: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("sale-events.json")).unwrap())
                .unwrap();
        assert_eq!(saved, json!({"rev": 1, "events": [{"id": "e1"}]}));
        assert_eq!(
            save_doc(dir.path(), "sale-events", json!({"events": []}), 0),
            Err("conflict".into())
        );
    }

    #[test]
    fn save_rejects_unknown_name() {
        let dir = tempdir().unwrap();
        assert!(save_doc(dir.path(), "../catalog", json!({}), 0).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn import_copies_only_known_files() {
        let source = tempdir().unwrap();
        let destination = tempdir().unwrap();
        for name in [
            "catalog.json",
            "ship-details.json",
            "hangar.json",
            "buyback.json",
            "plans.json",
            "price-overrides.json",
            "ship-images.json",
            "offer-history.jsonl",
            "sale-history.json",
            "sale-events.json",
            "warbond-prices.json",
            "plan-snapshots.json",
            "session.json",
        ] {
            fs::write(source.path().join(name), "{}").unwrap();
        }
        fs::create_dir(source.path().join("profile")).unwrap();
        fs::write(source.path().join("profile/private.json"), "{}").unwrap();
        fs::create_dir(source.path().join("upgrades")).unwrap();
        fs::write(source.path().join("upgrades/b.json"), "{}").unwrap();
        fs::write(source.path().join("upgrades/session.txt"), "private").unwrap();
        let result = import_legacy(source.path(), destination.path()).unwrap();
        assert!(result.skipped.is_empty());
        let copied = result.copied;
        assert_eq!(
            copied,
            vec![
                "ship-details.json",
                "hangar.json",
                "buyback.json",
                "plans.json",
                "price-overrides.json",
                "ship-images.json",
                "offer-history.jsonl",
                "sale-history.json",
                "sale-events.json",
                "warbond-prices.json",
                "plan-snapshots.json",
                "upgrades/b.json",
                "catalog.json"
            ]
        );
        for name in &copied {
            assert_eq!(
                fs::read(source.path().join(name)).unwrap(),
                fs::read(destination.path().join(name)).unwrap()
            );
        }
        assert!(!destination.path().join("session.json").exists());
        assert!(!destination.path().join("profile").exists());
        assert!(!destination.path().join("upgrades/session.txt").exists());
    }

    #[test]
    fn import_copies_ship_pictures_and_keeps_existing_ones() {
        let source = tempdir().unwrap();
        let destination = tempdir().unwrap();
        fs::write(source.path().join("catalog.json"), "{}").unwrap();
        fs::write(source.path().join("secret.txt"), "secret").unwrap();
        let images = source.path().join("images");
        fs::create_dir(&images).unwrap();
        for name in [
            "1-s.webp", "1-l.webp", "2-s.png", "x-s.webp", "1-m.webp", "-s.webp",
        ] {
            fs::write(images.join(name), format!("new {name}")).unwrap();
        }
        fs::create_dir(images.join("5-s.webp")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(source.path().join("secret.txt"), images.join("3-s.webp"))
            .unwrap();
        fs::create_dir(destination.path().join("images")).unwrap();
        fs::write(destination.path().join("images/1-s.webp"), "old").unwrap();

        let result = import_legacy(source.path(), destination.path()).unwrap();
        assert_eq!(result.copied, vec!["images/1-l.webp", "catalog.json"]);
        assert_eq!(result.skipped, vec!["images/1-s.webp"]);
        assert_eq!(
            fs::read(destination.path().join("images/1-s.webp")).unwrap(),
            b"old"
        );
        assert_eq!(
            fs::read(destination.path().join("images/1-l.webp")).unwrap(),
            b"new 1-l.webp"
        );
        assert_eq!(
            fs::read_dir(destination.path().join("images"))
                .unwrap()
                .count(),
            2
        );
        assert!(!destination.path().join("secret.txt").exists());
    }

    #[test]
    fn store_catalog_files_and_pictures_have_their_own_allowlisted_names() {
        let dir = tempdir().unwrap();
        for ok in ["images/catalog/1.webp", "images/catalog/12345.png", "images/catalog/7.jpg", "images/catalog/7.avif"] {
            assert!(sync_path(dir.path(), ok).is_ok(), "{ok}");
        }
        for bad in [
            "images/catalog/x.webp",
            "images/catalog/.webp",
            "images/catalog/1.svg",
            "images/catalog/../1.webp",
            "images/catalog/1/2.webp",
            "images/catalog/1.webp.x",
            "images/catalog2/1.webp",
            "catalog/1.webp",
            "store-catalog.json.bak",
            "images/catalog",
        ] {
            assert!(sync_path(dir.path(), bad).is_err(), "{bad}");
        }
        sync_write(dir.path(), "store-catalog.json", b"{\"items\":[]}", false).unwrap();
        assert_eq!(sync_read(dir.path(), "store-catalog.json").unwrap(), Some(json!({"items": []})));
        assert_eq!(sync_read(dir.path(), "images/catalog").unwrap(), Some(json!([])));
        sync_write(dir.path(), "images/catalog/12.png", b"x", false).unwrap();
        sync_write(dir.path(), "images/catalog/3.webp", b"x", false).unwrap();
        fs::write(dir.path().join("images/catalog/notes.txt"), b"x").unwrap();
        assert_eq!(sync_read(dir.path(), "images/catalog").unwrap(), Some(json!(["catalog/12.png", "catalog/3.webp"])));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_catalog_picture_folder_is_refused() {
        let dir = tempdir().unwrap();
        let other = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("images")).unwrap();
        std::os::unix::fs::symlink(other.path(), dir.path().join("images/catalog")).unwrap();
        assert!(sync_write(dir.path(), "images/catalog/1.webp", b"x", false).is_err());
        assert!(sync_read(dir.path(), "images/catalog").is_err());
    }

    #[test]
    fn picture_names_follow_the_pattern() {
        for ok in ["1-s.webp", "12-l.webp", "007-s.webp"] {
            assert!(is_image_name(ok), "{ok}");
        }
        for bad in [
            "-s.webp",
            "1-m.webp",
            "1-s.png",
            "a-s.webp",
            "../1-s.webp",
            "1-s.webp.x",
            "1-s-l.webp",
            "1_s.webp",
        ] {
            assert!(!is_image_name(bad), "{bad}");
        }
    }

    #[test]
    fn import_keeps_existing_plans_and_overrides() {
        let source = tempdir().unwrap();
        let destination = tempdir().unwrap();
        for name in LEGACY_FILES {
            fs::write(source.path().join(name), "legacy data").unwrap();
        }
        fs::create_dir(source.path().join("upgrades")).unwrap();
        fs::write(source.path().join("upgrades/a.json"), "legacy upgrade").unwrap();
        fs::write(destination.path().join("catalog.json"), "old catalog").unwrap();
        let existing = [
            ("plans.json", "{ \"rev\": 7, \"chains\": [1] }\n"),
            ("price-overrides.json", "{ \"rev\": 9, \"ships\": {} }\n"),
            ("sale-events.json", "{ \"rev\": 2, \"events\": [] }\n"),
        ];
        for (name, contents) in existing {
            fs::write(destination.path().join(name), contents).unwrap();
        }

        let result = import_legacy(source.path(), destination.path()).unwrap();
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            json!({
                "copied": ["ship-details.json", "hangar.json",
                    "buyback.json", "ship-images.json", "offer-history.jsonl", "sale-history.json", "warbond-prices.json", "plan-snapshots.json", "upgrades/a.json", "catalog.json"],
                "skipped": ["plans.json", "price-overrides.json", "sale-events.json"]
            })
        );
        for (name, contents) in existing {
            assert_eq!(
                fs::read(destination.path().join(name)).unwrap(),
                contents.as_bytes()
            );
        }
        for name in result.copied {
            assert_eq!(
                fs::read(destination.path().join(&name)).unwrap(),
                fs::read(source.path().join(name)).unwrap()
            );
        }
        assert_eq!(fs::read_dir(destination.path()).unwrap().count(), 13);
        assert_eq!(
            fs::read_dir(destination.path().join("upgrades"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn import_refuses_own_data_dir() {
        let dir = tempdir().unwrap();
        for name in LEGACY_FILES {
            fs::write(dir.path().join(name), format!("original {name}\n")).unwrap();
        }
        fs::create_dir(dir.path().join("upgrades")).unwrap();
        fs::write(dir.path().join("upgrades/a.json"), "original upgrade").unwrap();
        // The second destination only resolves to the source after creating new/.
        for destination in [dir.path().to_path_buf(), dir.path().join("new/..")] {
            assert_eq!(
                import_legacy(dir.path(), &destination),
                Err("source is the app data dir".into())
            );
            for name in LEGACY_FILES {
                assert_eq!(
                    fs::read_to_string(dir.path().join(name)).unwrap(),
                    format!("original {name}\n")
                );
            }
            assert_eq!(
                fs::read_to_string(dir.path().join("upgrades/a.json")).unwrap(),
                "original upgrade"
            );
        }
    }

    #[test]
    fn load_reads_all_upgrades_and_history() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("catalog.json"), r#"{"ships":[]}"#).unwrap();
        fs::create_dir(dir.path().join("upgrades")).unwrap();
        fs::write(dir.path().join("upgrades/z.json"), r#"{"id":"z"}"#).unwrap();
        fs::write(dir.path().join("upgrades/a.json"), r#"{"id":"a"}"#).unwrap();
        let history = "{\"offer\":1}\r\n\n{\"offer\":2}";
        fs::write(dir.path().join("offer-history.jsonl"), history).unwrap();
        assert_eq!(
            load_data(dir.path()).unwrap(),
            Some(json!({
                "catalog": {"ships": []}, "details": null,
                "upgrades": [{"id":"a"}, {"id":"z"}], "hangar": null,
                "buyback": null, "history": history, "plans": null, "overrides": null,
                "images": null, "saleHistory": null, "saleEvents": null,
                "warbondPrices": {"pairs": {}}, "planSnapshots": null
            }))
        );
    }

    #[test]
    fn load_reads_optional_documents_and_defaults_missing_history() {
        let dir = tempdir().unwrap();
        for (name, value) in [
            ("catalog.json", json!({"ships": []})),
            ("ship-details.json", json!({"details": []})),
            ("hangar.json", json!([1])),
            ("buyback.json", json!([2])),
            ("plans.json", json!({"rev": 3})),
            ("price-overrides.json", json!({"rev": 4})),
            ("ship-images.json", json!({"images": {}})),
            (
                "sale-history.json",
                json!({"ships": {"7": {"onSaleDays": ["2026-11-18"]}}}),
            ),
            ("sale-events.json", json!({"rev": 5, "events": []})),
            (
                "warbond-prices.json",
                json!({"pairs": {"1-2": {"cash": 3500, "at": "2026-11-18", "skuId": 20}}}),
            ),
            (
                "plan-snapshots.json",
                json!({"version": 1, "snapshots": [{"at": "t", "storeAt": "S", "hangarAt": "H"}]}),
            ),
        ] {
            fs::write(dir.path().join(name), value.to_string()).unwrap();
        }
        assert_eq!(
            load_data(dir.path()).unwrap(),
            Some(json!({
                "catalog": {"ships": []}, "details": {"details": []},
                "upgrades": [], "hangar": [1], "buyback": [2],
                "history": "", "plans": {"rev": 3}, "overrides": {"rev": 4},
                "images": {"images": {}},
                "saleHistory": {"ships": {"7": {"onSaleDays": ["2026-11-18"]}}},
                "saleEvents": {"rev": 5, "events": []},
                "warbondPrices": {"pairs": {"1-2": {"cash": 3500, "at": "2026-11-18", "skuId": 20}}},
                "planSnapshots": {"version": 1, "snapshots": [{"at": "t", "storeAt": "S", "hangarAt": "H"}]}
            }))
        );
    }

    #[test]
    fn save_defaults_missing_file_and_revision_to_zero() {
        let parent = tempdir().unwrap();
        let dir = parent.path().join("data");
        assert_eq!(
            save_doc(&dir, "overrides", json!({"rev": 99, "ships": {}}), 0).unwrap(),
            1
        );
        let saved = read_optional_json(&dir.join("price-overrides.json"))
            .unwrap()
            .unwrap();
        assert_eq!(saved, json!({"rev": 1, "ships": {}}));
        fs::write(dir.join("plans.json"), r#"{"chains":[]}"#).unwrap();
        assert_eq!(
            save_doc(&dir, "plans", json!({"chains": []}), 0).unwrap(),
            1
        );
    }

    #[test]
    fn a_damaged_plan_snapshots_file_does_not_break_load() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("catalog.json"), r#"{"ships":[]}"#).unwrap();
        fs::write(dir.path().join("plan-snapshots.json"), "{ not json").unwrap();
        let loaded = load_data(dir.path()).unwrap().unwrap();
        assert_eq!(loaded["planSnapshots"], serde_json::Value::Null);
        assert_eq!(loaded["catalog"], json!({"ships": []}));
    }

    #[test]
    fn sync_can_read_and_write_plan_snapshots_and_load_sees_them() {
        // The desktop sync records the plan snapshot through the sync commands (app/src/lib/plan-snapshot.js).
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("catalog.json"), r#"{"ships":[]}"#).unwrap();
        assert_eq!(sync_read(dir.path(), "plan-snapshots.json").unwrap(), None);
        let doc =
            json!({"version": 1, "snapshots": [{"at": "t", "storeAt": "S", "hangarAt": "H"}]});
        sync_write(
            dir.path(),
            "plan-snapshots.json",
            &serde_json::to_vec_pretty(&doc).unwrap(),
            false,
        )
        .unwrap();
        assert_eq!(
            sync_read(dir.path(), "plan-snapshots.json").unwrap(),
            Some(doc.clone())
        );
        assert_eq!(
            load_data(dir.path()).unwrap().unwrap()["planSnapshots"],
            doc
        );
    }

    #[test]
    fn a_damaged_file_read_by_sync_says_invalid_json() {
        // The desktop snapshot treats exactly this error as "no history"; other read errors must not.
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("plan-snapshots.json"), "{ not json").unwrap();
        let error = sync_read(dir.path(), "plan-snapshots.json").unwrap_err();
        assert!(error.starts_with("invalid JSON: "), "{error}");
    }

    #[test]
    fn plan_snapshots_are_read_only_for_the_app() {
        let dir = tempdir().unwrap();
        assert_eq!(
            save_doc(dir.path(), "plan-snapshots", json!({"snapshots": []}), 0),
            Err("unknown document name".into())
        );
        assert!(!dir.path().join("plan-snapshots.json").exists());
    }

    #[test]
    fn import_refuses_missing_catalog_without_writes() {
        let source = tempdir().unwrap();
        let parent = tempdir().unwrap();
        let destination = parent.path().join("data");
        fs::write(source.path().join("plans.json"), "{}").unwrap();
        assert!(import_legacy(source.path(), &destination).is_err());
        assert!(!destination.exists());
    }

    #[test]
    fn malformed_input_is_reported_without_overwriting_it() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("catalog.json"), "invalid JSON").unwrap();
        assert!(load_data(dir.path()).is_err());
        fs::write(dir.path().join("plans.json"), "invalid JSON").unwrap();
        assert!(save_doc(dir.path(), "plans", json!({}), 0).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("plans.json")).unwrap(),
            "invalid JSON"
        );
    }
}
