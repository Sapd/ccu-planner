//! One-time move of the app data folder when the bundle identifier changed
//! (`com.ccuplanner.desktop` -> `eu.sapd.ccuplanner`).
//!
//! The rule is shared with the Node side (`src/data-migrate.mjs`) and must stay identical:
//! a folder "has planner data" when its `data/` folder holds one of the app's own files
//! (`store::LEGACY_FILES`); WebKit, cache or OS files do not count.
//! - old has data, new has none: the old entries are moved over (merged into whatever the new folder holds).
//! - both have data: nothing moves, the new folder is used, and a one-time note names both paths.
//! - otherwise: nothing to do.
use std::{fs, io, path::{Path, PathBuf}};

pub const LEGACY_IDENTIFIER: &str = "com.ccuplanner.desktop";
/// Present while a move is running; a crash leaves it so the next start finishes the move.
pub const MIGRATING: &str = ".migrating";
/// Written once when both folders held data; its presence keeps the warning to one time.
pub const WARNED: &str = ".legacy-warned";
/// Written when every migration step ran without error; later starts skip the keychain reads.
pub const DONE: &str = ".migration-done";

#[derive(Debug, PartialEq)]
pub enum DirMove {
    /// The old folder has no planner data.
    NoOld,
    /// Both folders hold planner data; nothing was moved.
    Both,
    Moved,
}

/// True when `<app_dir>/data` holds at least one of the app's own data files.
pub fn has_planner_data(app_dir: &Path) -> bool {
    let data = app_dir.join("data");
    crate::store::LEGACY_FILES.iter().any(|f| data.join(f).is_file())
}

pub fn both_note(old: &Path, new: &Path) -> String {
    format!(
        "CCU Planner found planner data in two places and moved nothing.\n  Using:    {}\n  Not used: {}\nIf the old folder holds the data you want, close the app, move its `data` folder over the new one, and start again.\n",
        new.display(),
        old.display()
    )
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Rename first; across volumes copy to `<dst>.moving`, rename that into place, then drop the source.
fn move_entry(src: &Path, dst: &Path) -> io::Result<()> {
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    let staging = with_suffix(dst, ".moving");
    if staging.is_dir() {
        fs::remove_dir_all(&staging)?;
    } else if staging.exists() {
        fs::remove_file(&staging)?;
    }
    let copied = if src.is_dir() { copy_tree(src, &staging) } else { fs::copy(src, &staging).map(|_| ()) };
    if let Err(e) = copied {
        let _ = if staging.is_dir() { fs::remove_dir_all(&staging) } else { fs::remove_file(&staging) };
        return Err(e);
    }
    fs::rename(&staging, dst)?;
    // The data is safe in the new place; a failure here only leaves a harmless copy behind.
    let removed = if src.is_dir() { fs::remove_dir_all(src) } else { fs::remove_file(src) };
    if let Err(e) = removed {
        eprintln!("Could not remove {}: {e}", src.display());
    }
    Ok(())
}

/// Moves what `dst` does not have yet; never overwrites. Emptied source folders are removed.
fn merge_move(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let (from, to) = (entry.path(), dst.join(entry.file_name()));
        if fs::symlink_metadata(&to).is_err() {
            move_entry(&from, &to)?;
        } else if entry.file_type()?.is_dir() && to.is_dir() {
            merge_move(&from, &to)?;
        }
    }
    let _ = fs::remove_dir(src); // only succeeds when empty
    Ok(())
}

/// Applies the shared rule. A crash mid-move leaves `.migrating` in `new`, and the next call finishes the move.
pub fn move_data_dir(old: &Path, new: &Path) -> io::Result<DirMove> {
    let resuming = new.join(MIGRATING).exists();
    if !has_planner_data(old) {
        if resuming {
            let _ = fs::remove_file(new.join(MIGRATING));
        }
        return Ok(DirMove::NoOld);
    }
    if !resuming && has_planner_data(new) {
        return Ok(DirMove::Both);
    }
    fs::create_dir_all(new)?;
    fs::write(new.join(MIGRATING), b"")?;
    merge_move(old, new)?;
    fs::remove_file(new.join(MIGRATING))?;
    Ok(DirMove::Moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(old: &Path) {
        fs::create_dir_all(old.join("data/images")).unwrap();
        fs::write(old.join("data/hangar.json"), "{\"rev\":3}").unwrap();
        fs::write(old.join("data/images/1.png"), [1, 2, 3]).unwrap();
    }

    #[test]
    fn moves_when_new_is_missing_or_has_only_foreign_files() {
        for pre in [0, 1, 2] {
            let tmp = tempfile::tempdir().unwrap();
            let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
            seed(&old);
            match pre {
                1 => fs::create_dir(&new).unwrap(),
                2 => {
                    fs::create_dir_all(new.join("data")).unwrap();
                    fs::write(new.join("EBWebView"), "webkit").unwrap();
                    fs::write(new.join("data/.DS_Store"), "x").unwrap();
                }
                _ => {}
            }
            assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::Moved);
            assert!(!old.exists());
            assert!(!new.join(MIGRATING).exists());
            assert_eq!(fs::read_to_string(new.join("data/hangar.json")).unwrap(), "{\"rev\":3}");
            assert_eq!(fs::read(new.join("data/images/1.png")).unwrap(), vec![1, 2, 3]);
            if pre == 2 {
                assert!(new.join("data/.DS_Store").exists() && new.join("EBWebView").exists());
            }
        }
    }

    #[test]
    fn both_with_data_moves_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        seed(&old);
        fs::create_dir_all(new.join("data")).unwrap();
        fs::write(new.join("data/plans.json"), "mine").unwrap();
        assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::Both);
        assert_eq!(fs::read_to_string(new.join("data/plans.json")).unwrap(), "mine");
        assert!(old.join("data/hangar.json").exists());
        assert!(!new.join("data/hangar.json").exists());
        let note = both_note(&old, &new);
        assert!(note.contains("old") && note.contains("new"));
    }

    #[test]
    fn old_without_planner_data_is_ignored_and_a_second_run_does_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::NoOld);
        assert!(!new.exists());
        fs::create_dir_all(old.join("data")).unwrap();
        fs::write(old.join("data/.DS_Store"), "x").unwrap();
        assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::NoOld);
        assert!(!new.exists());
        seed(&old);
        assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::Moved);
        assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::NoOld);
    }

    #[test]
    fn interrupted_move_is_finished_next_time() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        seed(&old);
        fs::write(old.join("data/plans.json"), "p").unwrap();
        // Crash after plans.json moved: new has planner data, the marker is still there.
        fs::create_dir_all(new.join("data")).unwrap();
        fs::write(new.join(MIGRATING), "").unwrap();
        fs::rename(old.join("data/plans.json"), new.join("data/plans.json")).unwrap();
        assert_eq!(move_data_dir(&old, &new).unwrap(), DirMove::Moved);
        assert!(new.join("data/hangar.json").exists() && new.join("data/plans.json").exists());
        assert!(!new.join(MIGRATING).exists() && !old.exists());
    }

    #[test]
    fn staging_name_keeps_the_dotted_identifier() {
        let p = with_suffix(Path::new("/x/eu.sapd.ccuplanner"), ".moving");
        assert_eq!(p, Path::new("/x/eu.sapd.ccuplanner.moving"));
    }

    #[test]
    fn copy_fallback_copies_folders_and_replaces_a_stale_staging_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        seed(&old);
        fs::create_dir(&new).unwrap();
        let staging = with_suffix(&new.join("data"), ".moving");
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("junk"), "x").unwrap();
        // Same steps move_entry takes after a failed rename.
        fs::remove_dir_all(&staging).unwrap();
        copy_tree(&old.join("data"), &staging).unwrap();
        fs::rename(&staging, new.join("data")).unwrap();
        assert_eq!(fs::read(new.join("data/images/1.png")).unwrap(), vec![1, 2, 3]);
        assert!(!new.join("data/junk").exists());
    }
}
