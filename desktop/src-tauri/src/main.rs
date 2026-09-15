#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
use bridge::{Bridge, WorkerConfig};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager};

#[tauri::command]
fn native_start(
    app: tauri::AppHandle,
    state: tauri::State<Bridge>,
    request: Value,
) -> Result<(), String> {
    // Development host configuration only. A release must replace this with
    // verified bundled paths; renderer input never chooses a program or arguments.
    let executable =
        std::env::var_os("CHECKFACE_NATIVE_PYTHON").ok_or("Native runtime is not configured")?;
    let worker =
        std::env::var("CHECKFACE_NATIVE_WORKER").map_err(|_| "Native worker is not configured")?;
    let bundle =
        std::env::var("CHECKFACE_NATIVE_BUNDLE").map_err(|_| "Native bundle is not configured")?;
    let output = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "App data directory unavailable")?
        .join("outputs");
    std::fs::create_dir_all(&output).map_err(|_| "Cannot prepare output directory")?;
    let config = WorkerConfig {
        executable: executable.into(),
        args: vec![
            worker,
            "--bundle".into(),
            bundle,
            "--output".into(),
            output.to_string_lossy().into(),
        ],
        timeout: Duration::from_secs(180),
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
fn native_cancel(state: tauri::State<Bridge>, job_id: String) -> Result<(), String> {
    state.cancel(&job_id)
}
#[tauri::command]
fn native_release(state: tauri::State<Bridge>) {
    state.release();
}

#[tauri::command]
fn desktop_smoke_result(rendered: bool, missing_runtime_rejected: bool) {
    if std::env::var_os("CHECKFACE_DESKTOP_SMOKE").is_some() {
        eprintln!("CHECKFACE_ELMISH_RENDERED={rendered}");
        if let Some(path) = std::env::var_os("CHECKFACE_DESKTOP_SMOKE_REPORT") {
            let _ = std::fs::write(path, serde_json::json!({"rendered": rendered, "missingRuntimeRejected": missing_runtime_rejected}).to_string());
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Bridge::default())
        .invoke_handler(tauri::generate_handler![
            native_start,
            native_cancel,
            native_release,
            desktop_smoke_result
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_page_load(|webview, payload| {
            if std::env::var_os("CHECKFACE_DESKTOP_SMOKE").is_some() {
                eprintln!("CHECKFACE_PAGE_LOAD={:?}", payload.event());
            }
            if std::env::var_os("CHECKFACE_DESKTOP_SMOKE").is_some()
                && payload.event() == tauri::webview::PageLoadEvent::Finished
            {
                let _ = webview.eval("setTimeout(async () => { let missingRuntimeRejected = false; try { await window.__TAURI__.core.invoke('native_start', {request: {schemaVersion: 1, jobId: 'ci-smoke', type: 'generate'}}); } catch (error) { missingRuntimeRejected = String(error).includes('Native runtime is not configured'); } await window.__TAURI__.core.invoke('desktop_smoke_result', { rendered: Boolean(document.querySelector('#elmish-app')?.children.length), missingRuntimeRejected }); }, 1000)");
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
