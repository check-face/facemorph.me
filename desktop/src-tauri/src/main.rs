#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
use bridge::{Bridge, WorkerConfig};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

fn data_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if std::env::var_os("CHECKFACE_DESKTOP_WORKFLOW_REPORT").is_some() {
        if let Some(path) = std::env::var_os("CHECKFACE_DESKTOP_TEST_DATA_DIR") {
            return Ok(path.into());
        }
    }
    app.path()
        .app_local_data_dir()
        .map_err(|_| "App data directory unavailable".into())
}

fn write_export(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Selected destination is unavailable")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Cannot prepare the selected destination")?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "Could not finish saving; your prepared result is still available")?;
    file.persist(path).map_err(|_| {
        "Could not replace the selected file; your prepared result is still available"
    })?;
    Ok(())
}

#[tauri::command]
fn native_start(
    app: tauri::AppHandle,
    state: tauri::State<Bridge>,
    request: Value,
) -> Result<(), String> {
    let output = data_directory(&app)?.join("outputs");
    std::fs::create_dir_all(&output).map_err(|_| "Cannot prepare output directory")?;
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| "App resources unavailable")?;
    let executable = resources.join("native").join(if cfg!(windows) {
        "checkface-worker.exe"
    } else {
        "checkface-worker"
    });
    let manifest = resources.join("native/manifest.json");
    let config = if executable.is_file() && manifest.is_file() {
        let cache = data_directory(&app)?.join("cache");
        WorkerConfig {
            executable,
            args: vec![
                "--manifest".into(),
                manifest.to_string_lossy().into(),
                "--cache".into(),
                cache.to_string_lossy().into(),
                "--output".into(),
                output.to_string_lossy().into(),
            ],
            timeout: Duration::from_secs(1800),
        }
    } else {
        // Local development override is never accepted from renderer input.
        if !cfg!(debug_assertions) {
            return Err("Native runtime is not configured".into());
        }
        let executable = std::env::var_os("CHECKFACE_NATIVE_PYTHON")
            .ok_or("Native runtime is not configured")?;
        let worker = std::env::var("CHECKFACE_NATIVE_WORKER")
            .map_err(|_| "Native worker is not configured")?;
        let bundle = std::env::var("CHECKFACE_NATIVE_BUNDLE")
            .map_err(|_| "Native bundle is not configured")?;
        WorkerConfig {
            executable: executable.into(),
            args: vec![
                worker,
                "--bundle".into(),
                bundle,
                "--output".into(),
                output.to_string_lossy().into(),
            ],
            timeout: Duration::from_secs(180),
        }
    };
    state.start(
        config,
        request,
        Arc::new(move |event| {
            let _ = app.emit("native-event", event);
        }),
    )
}
#[tauri::command]
fn native_read_artifact(
    app: tauri::AppHandle,
    artifact_id: String,
    file: String,
) -> Result<tauri::ipc::Response, String> {
    if artifact_id.len() != 36
        || !artifact_id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() || c == b'-')
        || !matches!(file.as_str(), "image.png" | "result.json")
    {
        return Err("Invalid artifact reference".into());
    }
    let root = data_directory(&app)?.join("outputs");
    let folder = root.join(artifact_id);
    if !folder.join("COMPLETE").is_file() {
        return Err("Artifact is incomplete".into());
    }
    let path = folder.join(file);
    let canonical = path.canonicalize().map_err(|_| "Artifact unavailable")?;
    if !canonical.starts_with(root.canonicalize().map_err(|_| "Artifact unavailable")?) {
        return Err("Invalid artifact path".into());
    }
    if canonical
        .metadata()
        .map_err(|_| "Artifact unavailable")?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("Artifact exceeds size limit".into());
    }
    std::fs::read(canonical)
        .map(tauri::ipc::Response::new)
        .map_err(|_| "Cannot read artifact".into())
}
#[tauri::command]
fn native_release_artifact(app: tauri::AppHandle, artifact_id: String) -> Result<(), String> {
    if artifact_id.len() != 36
        || !artifact_id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() || c == b'-')
    {
        return Err("Invalid artifact reference".into());
    }
    let root = data_directory(&app)?
        .join("outputs")
        .canonicalize()
        .map_err(|_| "Artifact unavailable")?;
    let folder = root
        .join(artifact_id)
        .canonicalize()
        .map_err(|_| "Artifact unavailable")?;
    if folder.parent() != Some(root.as_path()) || !folder.join("COMPLETE").is_file() {
        return Err("Invalid artifact path".into());
    }
    for name in ["image.png", "result.json", "COMPLETE"] {
        std::fs::remove_file(folder.join(name)).map_err(|_| "Cannot release transfer artifact")?;
    }
    std::fs::remove_dir(folder).map_err(|_| "Cannot release transfer artifact".into())
}
#[tauri::command]
fn native_status(app: tauri::AppHandle) -> Result<Value, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| "App resources unavailable")?
        .join("native");
    let worker = root.join(if cfg!(windows) {
        "checkface-worker.exe"
    } else {
        "checkface-worker"
    });
    Ok(
        serde_json::json!({"available": worker.is_file() && root.join("manifest.json").is_file(), "provider": "native-cpu"}),
    )
}

#[tauri::command]
async fn native_save_media(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    let kind = request
        .headers()
        .get("x-facemorph-kind")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing media kind")?;
    let (name, extension, limit) = match kind {
        "image" => ("facemorph.png", "png", 16 * 1024 * 1024),
        "video" => ("facemorph.mp4", "mp4", 48 * 1024 * 1024),
        "project" => ("facemorph-project.json", "json", 16 * 1024 * 1024),
        _ => return Err("Unknown media kind".into()),
    };
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if !bytes.is_empty() && bytes.len() <= limit => {
            bytes.clone()
        }
        _ => return Err("Media bytes are missing or exceed the export bound".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        // Headless installed-artifact tests still exercise the same raw-byte validation
        // and filesystem write; interactive dialog cancellation is a separate UI check.
        if std::env::var_os("CHECKFACE_DESKTOP_WORKFLOW_REPORT").is_some() {
            if let Some(folder) = std::env::var_os("CHECKFACE_DESKTOP_TEST_SAVE_DIR") {
                let folder = std::path::PathBuf::from(folder);
                std::fs::create_dir_all(&folder)
                    .map_err(|_| "Test save directory unavailable".to_string())?;
                write_export(&folder.join(name), &bytes)?;
                return Ok(serde_json::json!({"saved":true,"cancelled":false}));
            }
        }
        let selection = app
            .dialog()
            .file()
            .set_file_name(name)
            .add_filter("FaceMorph export", &[extension])
            .blocking_save_file();
        match selection {
            None => Ok(serde_json::json!({"saved":false,"cancelled":true})),
            Some(file) => {
                let path = file
                    .into_path()
                    .map_err(|_| "Selected destination is unavailable".to_string())?;
                write_export(&path, &bytes)?;
                Ok(serde_json::json!({"saved":true,"cancelled":false}))
            }
        }
    })
    .await
    .map_err(|_| "Save dialog failed".to_string())?
}

#[tauri::command]
fn native_cancel(state: tauri::State<Bridge>, job_id: String) -> Result<(), String> {
    state.cancel(&job_id)
}
#[tauri::command]
fn native_release(state: tauri::State<Bridge>) {
    state.release();
}

#[tauri::command]
fn desktop_test_photo() -> Result<tauri::ipc::Response, String> {
    if std::env::var_os("CHECKFACE_DESKTOP_WORKFLOW_REPORT").is_none() {
        return Err("Test mode unavailable".into());
    }
    let path = std::env::var_os("CHECKFACE_DESKTOP_TEST_PHOTO")
        .ok_or("Synthetic test fixture unavailable")?;
    let bytes = std::fs::read(path).map_err(|_| "Synthetic test fixture unavailable")?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Synthetic fixture exceeds bound".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
fn desktop_test_saved_media(kind: String) -> Result<tauri::ipc::Response, String> {
    if std::env::var_os("CHECKFACE_DESKTOP_WORKFLOW_REPORT").is_none() {
        return Err("Test mode unavailable".into());
    }
    let folder = std::env::var_os("CHECKFACE_DESKTOP_TEST_SAVE_DIR")
        .ok_or("Test save directory unavailable")?;
    let name = match kind.as_str() {
        "project" => "facemorph-project.json",
        "video" => "facemorph.mp4",
        "image" => "facemorph.png",
        _ => return Err("Invalid test export".into()),
    };
    let bytes = std::fs::read(std::path::PathBuf::from(folder).join(name))
        .map_err(|_| "Test export not yet saved")?;
    if bytes.len() > 48 * 1024 * 1024 {
        return Err("Test export exceeds bound".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
fn desktop_workflow_result(result: Value) {
    if let Some(path) = std::env::var_os("CHECKFACE_DESKTOP_WORKFLOW_REPORT") {
        let _ = std::fs::write(path, result.to_string());
    }
}

#[tauri::command]
fn desktop_smoke_result(rendered: bool, missing_runtime_rejected: bool, runtime_available: bool) {
    if std::env::var_os("CHECKFACE_DESKTOP_SMOKE").is_some() {
        eprintln!("CHECKFACE_ELMISH_RENDERED={rendered}");
        if let Some(path) = std::env::var_os("CHECKFACE_DESKTOP_SMOKE_REPORT") {
            let _ = std::fs::write(path, serde_json::json!({"rendered": rendered, "missingRuntimeRejected": missing_runtime_rejected, "runtimeAvailable": runtime_available}).to_string());
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Bridge::default())
        .invoke_handler(tauri::generate_handler![
            native_start,
            native_read_artifact,
            native_release_artifact,
            native_status,
            native_save_media,
            native_cancel,
            native_release,
            desktop_smoke_result,
            desktop_test_photo,
            desktop_test_saved_media,
            desktop_workflow_result
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if std::env::var_os("CHECKFACE_DESKTOP_WORKFLOW_REPORT").is_some()
                && payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = webview.eval(include_str!("../../tests/product-smoke.js"));
            }
            if std::env::var_os("CHECKFACE_DESKTOP_SMOKE").is_some() {
                eprintln!("CHECKFACE_PAGE_LOAD={:?}", payload.event());
            }
            if std::env::var_os("CHECKFACE_DESKTOP_SMOKE").is_some()
                && payload.event() == tauri::webview::PageLoadEvent::Finished
            {
                let _ = webview.eval("setTimeout(async () => { const status = await window.__TAURI__.core.invoke('native_status'); let missingRuntimeRejected = false; if (!status.available) { try { await window.__TAURI__.core.invoke('native_start', {request: {schemaVersion: 1, jobId: 'ci-smoke', type: 'generate'}}); } catch (error) { missingRuntimeRejected = String(error).includes('Native runtime is not configured'); } } await window.__TAURI__.core.invoke('desktop_smoke_result', { rendered: Boolean(document.querySelector('#elmish-app')?.children.length), missingRuntimeRejected, runtimeAvailable: status.available }); }, 1000)");
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<Bridge>().release();
            }
        })
        .run(tauri::generate_context!())
        .expect("could not start CheckFace desktop shell");
}
