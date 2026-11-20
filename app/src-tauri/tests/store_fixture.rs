// The Rust store and the JS dev store (app/vite-dev-data.js, test/store-fixture.test.mjs) must behave
// the same. Both load the same folder, test/fixtures/store, and check the same expectations in
// test/fixtures/store-expected.json. Keep the two tests in step; a difference between the two stores
// is written down as a "known difference" test on each side, not silently fixed.

use ccu_planner_desktop_lib::store::{import_legacy, load_data, save_doc};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tempfile::tempdir;

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures")
}

fn expected() -> Value {
    let text = fs::read_to_string(fixture_root().join("store-expected.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn copy_fixture() -> tempfile::TempDir {
    let dir = tempdir().unwrap();
    copy_tree(&fixture_root().join("store"), dir.path());
    dir
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn fixture_documents_load() {
    let dir = copy_fixture();
    assert_eq!(load_data(dir.path()).unwrap(), Some(expected()["load"].clone()));
}

#[test]
fn fixture_revisioned_save_succeeds_and_stale_rev_is_refused() {
    for save in expected()["saves"].as_array().unwrap() {
        let name = save["name"].as_str().unwrap();
        let file = save["file"].as_str().unwrap();
        let rev = save["rev"].as_u64().unwrap();
        let dir = copy_fixture();
        let before = fs::read_to_string(dir.path().join(file)).unwrap();
        assert_eq!(
            save_doc(dir.path(), name, json!({"marker": "stale"}), rev - 1),
            Err("conflict".into()),
            "{name}: stale rev"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join(file)).unwrap(),
            before,
            "{name}: a refused save writes nothing"
        );
        assert_eq!(
            save_doc(dir.path(), name, json!({"marker": "fresh"}), rev),
            Ok(rev + 1),
            "{name}: right rev"
        );
        let saved: Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join(file)).unwrap()).unwrap();
        assert_eq!(saved, json!({"marker": "fresh", "rev": rev + 1}));
        assert_eq!(
            save_doc(dir.path(), name, json!({}), rev),
            Err("conflict".into()),
            "{name}: the old rev is stale now"
        );
    }
    let dir = copy_fixture();
    assert_eq!(
        save_doc(dir.path(), "catalog", json!({}), 0),
        Err("unknown document name".into())
    );
}

#[test]
fn fixture_import_accepts_and_rejects_the_same_file_names() {
    let expected = expected();
    let source = fixture_root().join("store");
    let dest = tempdir().unwrap();
    let result = import_legacy(&source, dest.path()).unwrap();
    assert_eq!(result.copied, strings(&expected["importCopied"]));
    assert!(result.skipped.is_empty());
    for rel in strings(&expected["importRejected"]) {
        assert!(!dest.path().join(&rel).exists(), "{rel} must not be imported");
    }
    // A second import keeps the documents the user edits and the pictures.
    let again = import_legacy(&source, dest.path()).unwrap();
    assert_eq!(
        again.skipped,
        vec![
            "plans.json",
            "price-overrides.json",
            "sale-events.json",
            "images/1-l.webp",
            "images/1-s.webp"
        ]
    );
}

// KNOWN DIFFERENCE (see the matching JS test): Rust requires a file extension, so an upgrade file
// named exactly ".json" has none and is ignored. The JS store reads it. Behaviour left as is.
#[test]
fn known_difference_upgrade_file_named_dot_json_is_ignored_by_rust() {
    let dir = copy_fixture();
    fs::write(dir.path().join("upgrades/.json"), r#"{"id":"dot"}"#).unwrap();
    let loaded = load_data(dir.path()).unwrap().unwrap();
    assert_eq!(loaded["upgrades"], json!([{"id": "a"}, {"id": "b"}]));
}

// KNOWN DIFFERENCE: Rust follows a symlinked catalog.json when loading; the JS store treats it as
// "no data". (Import refuses a symlinked catalog in both.) Behaviour left as is.
#[cfg(unix)]
#[test]
fn known_difference_symlinked_catalog_loads_in_rust() {
    let dir = copy_fixture();
    fs::rename(
        dir.path().join("catalog.json"),
        dir.path().join("real-catalog.json"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        dir.path().join("real-catalog.json"),
        dir.path().join("catalog.json"),
    )
    .unwrap();
    assert_eq!(
        load_data(dir.path()).unwrap().unwrap()["catalog"],
        expected()["load"]["catalog"]
    );
}
