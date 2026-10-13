//! Native side of the Overlingo desktop app: screen capture, picking a region straight on the
//! desktop, and a click-through overlay that draws translations next to what they translate.
//! OCR, change tracking and translation run in the web frontend, shared with the web version.

use std::{collections::HashMap, io::Cursor, sync::Mutex, thread, time::Duration};

use image::{DynamicImage, RgbaImage, codecs::jpeg::JpegEncoder};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, ipc::Response,
};
use xcap::Monitor as CaptureMonitor;

const MAIN: &str = "main";
const OVERLAY: &str = "overlay";
const DEMO: &str = "demo";
const SELECTOR_PREFIX: &str = "selector-";

/// A rectangle on the virtual desktop, in physical pixels.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The screenshot each region selector window shows, keyed by window label.
#[derive(Default)]
struct SelectorShots(Mutex<HashMap<String, Vec<u8>>>);

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Captures `region` with GDI. Windows excluded from capture (the overlay) don't show up in it.
fn capture(region: ScreenRect) -> Result<RgbaImage, String> {
    let monitor = CaptureMonitor::from_point(region.x, region.y).map_err(err)?;
    let left = monitor.x().map_err(err)?;
    let top = monitor.y().map_err(err)?;
    let x = u32::try_from(region.x - left).map_err(err)?;
    let y = u32::try_from(region.y - top).map_err(err)?;
    let width = region.width.min(monitor.width().map_err(err)?.saturating_sub(x));
    let height = region.height.min(monitor.height().map_err(err)?.saturating_sub(y));
    if width == 0 || height == 0 {
        return Err("선택한 영역이 화면 밖에 있어요".into());
    }
    monitor.capture_region(x, y, width, height).map_err(err)
}

fn encode_jpeg(image: RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    let rgb = DynamicImage::ImageRgba8(image).into_rgb8();
    rgb.write_with_encoder(JpegEncoder::new_with_quality(&mut bytes, 85)).map_err(err)?;
    Ok(bytes.into_inner())
}

fn monitor_rect(monitor: &Monitor) -> ScreenRect {
    let position = monitor.position();
    let size = monitor.size();
    ScreenRect { x: position.x, y: position.y, width: size.width, height: size.height }
}

/// The monitor holding the center of `region`.
fn monitor_containing(app: &AppHandle, region: ScreenRect) -> Result<Monitor, String> {
    let cx = region.x + (region.width / 2) as i32;
    let cy = region.y + (region.height / 2) as i32;
    app.available_monitors()
        .map_err(err)?
        .into_iter()
        .find(|monitor| {
            let r = monitor_rect(monitor);
            cx >= r.x && cy >= r.y && cx < r.x + r.width as i32 && cy < r.y + r.height as i32
        })
        .ok_or_else(|| "영역이 있는 모니터를 찾지 못했어요".into())
}

/// Moves a window over `rect` exactly. Positions are physical, so it works across monitors
/// with different scaling.
fn cover(window: &WebviewWindow, rect: ScreenRect) -> Result<(), String> {
    window.set_position(tauri::PhysicalPosition::new(rect.x, rect.y)).map_err(err)?;
    window.set_size(tauri::PhysicalSize::new(rect.width, rect.height)).map_err(err)?;
    Ok(())
}

fn close_selectors(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(SELECTOR_PREFIX) {
            let _ = window.close();
        }
    }
}

/// Freezes every monitor into a screenshot and opens a selector window over each one, where
/// the user drags out the region to translate. The result arrives as a `region-selected` event.
#[tauri::command]
async fn start_region_select(app: AppHandle, shots: State<'_, SelectorShots>) -> Result<(), String> {
    close_selectors(&app);
    let monitors = app.available_monitors().map_err(err)?;
    // Screenshots first, so the selector windows themselves aren't in them.
    let mut taken = HashMap::new();
    for (index, monitor) in monitors.iter().enumerate() {
        let shot = capture(monitor_rect(monitor))?;
        taken.insert(format!("{SELECTOR_PREFIX}{index}"), encode_jpeg(shot)?);
    }
    *shots.0.lock().map_err(err)? = taken;

    for (index, monitor) in monitors.iter().enumerate() {
        let window = WebviewWindowBuilder::new(&app, format!("{SELECTOR_PREFIX}{index}"), WebviewUrl::App("selector.html".into()))
            .title("Overlingo 영역 선택")
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(err)?;
        cover(&window, monitor_rect(monitor))?;
        window.show().map_err(err)?;
    }
    if let Some(first) = app.get_webview_window(&format!("{SELECTOR_PREFIX}0")) {
        let _ = first.set_focus();
    }
    Ok(())
}

/// The frozen screenshot for the selector window that asks.
#[tauri::command]
fn selector_shot(window: Window, shots: State<'_, SelectorShots>) -> Result<Response, String> {
    let shots = shots.0.lock().map_err(err)?;
    let bytes = shots.get(window.label()).cloned().ok_or("이 창의 스크린샷이 없어요")?;
    Ok(Response::new(bytes))
}

// Commands that create or close windows are async: on Windows, doing that from a synchronous
// command blocks the main thread the window needs, and everything deadlocks.

/// Closes the selector windows and tells the main window what was picked (`null` when cancelled).
#[tauri::command]
async fn finish_region_select(
    app: AppHandle,
    region: Option<ScreenRect>,
    shots: State<'_, SelectorShots>,
) -> Result<(), String> {
    shots.0.lock().map_err(err)?.clear();
    close_selectors(&app);
    app.emit_to(MAIN, "region-selected", region).map_err(err)?;
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    Ok(())
}

/// Captures `region` after waiting `wait_ms`, so the frontend paces capture without timers
/// (which are throttled while its window is minimized). Returns the width and height as
/// little-endian u32s, followed by RGBA pixels.
#[tauri::command]
async fn capture_region(region: ScreenRect, wait_ms: u64) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if wait_ms > 0 {
            thread::sleep(Duration::from_millis(wait_ms));
        }
        let image = capture(region)?;
        let mut bytes = Vec::with_capacity(8 + image.as_raw().len());
        bytes.extend_from_slice(&image.width().to_le_bytes());
        bytes.extend_from_slice(&image.height().to_le_bytes());
        bytes.extend_from_slice(image.as_raw());
        Ok(Response::new(bytes))
    })
    .await
    .map_err(err)?
}

/// Shows the overlay over the monitor that holds `region`: transparent, always on top,
/// click-through, and excluded from screen capture so translations never feed back into OCR.
#[tauri::command]
async fn show_overlay(app: AppHandle, region: ScreenRect) -> Result<(), String> {
    let monitor = monitor_containing(&app, region)?;
    let window = match app.get_webview_window(OVERLAY) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(&app, OVERLAY, WebviewUrl::App("overlay.html".into()))
            .title("Overlingo 오버레이")
            .transparent(true)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .focusable(false)
            .focused(false)
            .visible(false)
            // OVERLINGO_CAPTURABLE_OVERLAY=1 lets screenshots of the app include it. The app then
            // reads its own labels too, so pause reading before taking one.
            .content_protected(std::env::var_os("OVERLINGO_CAPTURABLE_OVERLAY").is_none())
            .build()
            .map_err(err)?,
    };
    cover(&window, monitor_rect(&monitor))?;
    window.set_ignore_cursor_events(true).map_err(err)?;
    window.show().map_err(err)?;
    // Raise it above other always-on-top windows, such as the sample chat. Setting the same
    // value again would be a no-op, so it's toggled.
    window.set_always_on_top(false).map_err(err)?;
    window.set_always_on_top(true).map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn hide_overlay(app: AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let _ = window.close();
    }
}

/// Opens the sample chat in its own window, so the overlay can be tried without a messenger.
#[tauri::command]
async fn open_demo(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DEMO) {
        window.set_focus().map_err(err)?;
        return Ok(());
    }
    // Always on top: the capture reads whatever is on screen there, and the sample has to be it.
    WebviewWindowBuilder::new(&app, DEMO, WebviewUrl::App("demo.html".into()))
        .title("Overlingo 샘플 채팅")
        .inner_size(1280.0, 720.0)
        .center()
        .resizable(false)
        .always_on_top(true)
        .build()
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
async fn close_demo(app: AppHandle) {
    if let Some(window) = app.get_webview_window(DEMO) {
        let _ = window.close();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SelectorShots::default())
        .invoke_handler(tauri::generate_handler![
            start_region_select,
            selector_shot,
            finish_region_select,
            capture_region,
            show_overlay,
            hide_overlay,
            open_demo,
            close_demo,
        ])
        .on_window_event(|window, event| {
            // Closing the main window ends the app, overlay and helper windows included.
            if window.label() == MAIN && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Overlingo");
}
