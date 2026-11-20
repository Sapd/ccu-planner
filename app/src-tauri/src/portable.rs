use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

pub fn exe_dir(exe: &Path) -> io::Result<Option<&Path>> {
    let dir = exe
        .parent()
        .ok_or_else(|| io::Error::other("Could not find the CCU Planner executable folder"))?;
    match fs::metadata(dir.join("portable.txt")) {
        Ok(marker) => Ok(marker.is_file().then_some(dir)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn data_dir(
    portable_dir: Option<&Path>,
    explicit: Option<OsString>,
    installed: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    if let Some(dir) = explicit {
        return Ok(dir.into());
    }
    let Some(dir) = portable_dir else {
        return installed();
    };
    let data = dir.join("data");
    // An actual write checks permissions on Windows too, even when data already exists.
    let check = |folder| tempfile::NamedTempFile::new_in(folder)?.close();
    check(dir)
        .and_then(|()| fs::create_dir_all(&data))
        .and_then(|()| check(data.as_path()))
        .map_err(|error| {
            format!(
                "CCU Planner could not write to its portable folder ({}) or its data folder. \
                 Move CCU Planner.exe and portable.txt to a folder you can write to and try again. ({error})",
                dir.display()
            )
        })?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_marker_uses_data_beside_the_executable() {
        let folder = tempfile::tempdir().unwrap();
        let exe = folder.path().join("CCU Planner.exe");
        fs::write(folder.path().join("portable.txt"), "Portable mode").unwrap();
        let dir = exe_dir(&exe).unwrap();
        assert_eq!(dir, Some(folder.path()));
        assert_eq!(
            data_dir(dir, None, || panic!("installed path used in portable mode")).unwrap(),
            folder.path().join("data")
        );
        assert!(folder.path().join("data").is_dir());
    }

    #[test]
    fn missing_marker_uses_the_installed_data_folder() {
        let folder = tempfile::tempdir().unwrap();
        let exe = folder.path().join("ccu-planner-desktop.exe");
        let installed = folder.path().join("installed/data");
        let dir = exe_dir(&exe).unwrap();
        assert_eq!(dir, None);
        assert_eq!(
            data_dir(dir, None, || Ok(installed.clone())).unwrap(),
            installed
        );
        assert!(!folder.path().join("data").exists());
    }

    #[test]
    fn ccu_data_overrides_both_modes() {
        let folder = tempfile::tempdir().unwrap();
        let explicit = folder.path().join("override");
        for dir in [None, Some(folder.path())] {
            assert_eq!(
                data_dir(dir, Some(explicit.clone().into_os_string()), || {
                    panic!("installed path used with CCU_DATA")
                })
                .unwrap(),
                explicit
            );
        }
        assert!(!folder.path().join("data").exists());
    }

    #[test]
    fn unusable_portable_data_folder_reports_an_error() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("data"), "").unwrap();
        let error = data_dir(Some(folder.path()), None, || {
            panic!("fell back to the installed folder")
        })
        .unwrap_err();
        assert!(error.contains("could not write to its portable folder"));
    }
}
