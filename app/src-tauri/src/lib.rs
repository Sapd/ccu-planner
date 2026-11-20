pub mod feed;
pub mod lock;
pub mod rsi;
pub mod migrate;
mod portable;
mod session_store;
pub mod store;

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

// Keep revision checks and replacements together, including overlapping IPC calls.
#[derive(Default)]
struct StoreAccess(Mutex<()>);

struct DataLocation {
    portable: bool,
    dir: Result<PathBuf, String>,
}

// Remote RSI pages receive no planner commands, even if they try to invoke custom IPC.
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Planner commands require the main window".into());
    }
    let url = window.url().map_err(|e| e.to_string())?;
    if local_app_url(&url, cfg!(debug_assertions)) {
        Ok(())
    } else {
        Err("Planner commands require the local app".into())
    }
}

fn local_app_url(url: &reqwest::Url, debug: bool) -> bool {
    url.scheme() == "tauri"
        || (url.scheme() == "http"
            && (url.host_str() == Some("tauri.localhost")
                || (debug && url.host_str() == Some("localhost") && url.port() == Some(1420))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn localhost_ipc_is_debug_only() {
        let dev = "http://localhost:1420".parse().unwrap();
        assert!(local_app_url(&dev, true));
        assert!(!local_app_url(&dev, false));
        assert!(!local_app_url(
            &"http://localhost:1421".parse().unwrap(),
            true
        ));
        assert!(!local_app_url(
            &"https://foreign.test".parse().unwrap(),
            true
        ));
        assert!(local_app_url(&"tauri://localhost".parse().unwrap(), false));
        assert!(local_app_url(
            &"http://tauri.localhost".parse().unwrap(),
            false
        ));
    }
}

// The bundle identifier changed from com.ccuplanner.desktop to eu.sapd.ccuplanner; it names the
// data folder and the keychain service. Failures are logged, never fatal: the old data stays in place.
// Once every step ran cleanly a marker in the new folder skips the whole thing (and the two keychain reads).
fn migrate_legacy_install(app_dir: Option<&Path>) {
    if app_dir.is_some_and(|d| d.join(migrate::DONE).exists()) {
        return;
    }
    let mut clean = true;
    if let Some((new, parent)) = app_dir.and_then(|new| Some((new, new.parent()?))) {
        let old = parent.join(migrate::LEGACY_IDENTIFIER);
        match migrate::move_data_dir(&old, new) {
            Ok(migrate::DirMove::Both) => {
                let note = migrate::both_note(&old, new);
                if !new.join(migrate::WARNED).exists() {
                    eprintln!("{note}");
                    let _ = std::fs::write(new.join(migrate::WARNED), note);
                }
            }
            Ok(moved) => eprintln!("Data folder migration: {moved:?}"),
            Err(e) => {
                clean = false;
                eprintln!("Data folder migration failed, old data kept: {e}");
            }
        }
    }
    match session_store::migrate_legacy_session() {
        Ok(moved) => eprintln!("Keychain migration: {moved:?}"),
        Err(e) => {
            clean = false;
            eprintln!("Keychain migration failed, old entry kept: {e}");
        }
    }
    if let Some(dir) = app_dir.filter(|_| clean) {
        let _ =
            std::fs::create_dir_all(dir).and_then(|_| std::fs::write(dir.join(migrate::DONE), b""));
    }
}

fn resolve_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.state::<DataLocation>().dir.clone()
}

#[tauri::command]
async fn portable_mode(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<bool, String> {
    main_only(&window)?;
    Ok(app.state::<DataLocation>().portable)
}

#[tauri::command]
async fn data_dir(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<String, String> {
    main_only(&window)?;
    Ok(resolve_data_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
async fn load_data(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    access: tauri::State<'_, StoreAccess>,
) -> Result<Option<serde_json::Value>, String> {
    main_only(&window)?;
    let _guard = access.0.lock().map_err(|error| error.to_string())?;
    store::load_data(&resolve_data_dir(&app)?)
}

#[tauri::command]
async fn save_doc(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    access: tauri::State<'_, StoreAccess>,
    name: String,
    doc: serde_json::Value,
    base_rev: u64,
) -> Result<u64, String> {
    main_only(&window)?;
    let _guard = access.0.lock().map_err(|error| error.to_string())?;
    store::save_doc(&resolve_data_dir(&app)?, &name, doc, base_rev)
}

#[tauri::command]
async fn import_legacy(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    access: tauri::State<'_, StoreAccess>,
    dir: String,
) -> Result<store::ImportResult, String> {
    main_only(&window)?;
    let _guard = access.0.lock().map_err(|error| error.to_string())?;
    store::import_legacy(Path::new(&dir), &resolve_data_dir(&app)?)
}

#[tauri::command]
async fn sync_read(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    access: tauri::State<'_, StoreAccess>,
    name: String,
) -> Result<Option<serde_json::Value>, String> {
    main_only(&window)?;
    let _guard = access.0.lock().map_err(|e| e.to_string())?;
    store::sync_read(&resolve_data_dir(&app)?, &name)
}

#[tauri::command]
async fn sync_write(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    access: tauri::State<'_, StoreAccess>,
    name: String,
    value: serde_json::Value,
    append: bool,
) -> Result<(), String> {
    main_only(&window)?;
    let _guard = access.0.lock().map_err(|e| e.to_string())?;
    let bytes = if append {
        format!("{}\n", value.as_str().ok_or("append requires text")?).into_bytes()
    } else {
        serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?
    };
    store::sync_write(&resolve_data_dir(&app)?, &name, &bytes, append)
}

#[tauri::command]
async fn sync_progress(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    main_only(&window)?;
    use tauri::Emitter;
    app.emit("sync-progress", event).map_err(|e| e.to_string())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());
    // Signed updates from GitHub Releases; the check itself runs from the UI (desktop only).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .setup(|app| {
            let exe = std::env::current_exe()?;
            let portable_dir = portable::exe_dir(&exe)?;
            let explicit = std::env::var_os("CCU_DATA");
            if portable_dir.is_some() || explicit.is_some() {
                migrate_legacy_install(None);
            }
            let dir = portable::data_dir(portable_dir, explicit, || {
                let installed_dir = app.path().app_data_dir().map_err(|e| e.to_string());
                migrate_legacy_install(installed_dir.as_deref().ok());
                installed_dir.map(|dir| dir.join("data"))
            });
            app.manage(DataLocation {
                portable: portable_dir.is_some(),
                dir,
            });
            // If the data folder could not be opened, the load command reports it on the startup screen.
            if let Ok(dir) = resolve_data_dir(app.handle()) {
                app.asset_protocol_scope()
                    .allow_directory(dir.join("images"), true)?;
                app.asset_protocol_scope()
                    .allow_directory(feed::images_dir(app.handle())?, true)?;
            }
            Ok(())
        })
        // A reloaded, crashed or closed main webview never reaches its sync's end: release the sync lock and cancel then.
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                rsi::release_sync(&webview.state::<rsi::RsiState>());
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                rsi::release_sync(&window.state::<rsi::RsiState>());
            }
        })
        .manage(StoreAccess::default())
        .manage(rsi::RsiState::default())
        .manage(feed::FeedState::default())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_doc,
            import_legacy,
            data_dir,
            portable_mode,
            sync_read,
            sync_write,
            sync_progress,
            rsi::rsi_request,
            rsi::rsi_login,
            rsi::rsi_session_status,
            rsi::rsi_logout,
            rsi::rsi_public_page,
            rsi::rsi_cache_image,
            rsi::rsi_cache_catalog_image,
            rsi::rsi_cancel,
            rsi::rsi_begin_sync,
            rsi::rsi_end_sync,
            feed::feed_refresh,
            feed::feed_images,
            feed::feed_read
        ])
        .run(tauri::generate_context!())
        .expect("error while running CCU Planner");
}
