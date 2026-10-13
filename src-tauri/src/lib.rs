//! Native side of the Overlingo desktop app: screen capture, picking a region or a window
//! straight on the desktop and following that window, and a click-through overlay that draws
//! translations next to what they translate. OCR, change tracking and translation run in the
//! web frontend, shared with the web version.

mod target;

use std::{
    collections::HashMap,
    io::Cursor,
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

use image::{DynamicImage, RgbaImage, codecs::jpeg::JpegEncoder};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, ipc::Response,
};
use xcap::{Monitor as CaptureMonitor, Window as CaptureWindow};

use target::WindowState;

const MAIN: &str = "main";
const OVERLAY: &str = "overlay";
const DEMO: &str = "demo";
const DEMO_TITLE: &str = "Overlingo 샘플 채팅";
const SELECTOR_PREFIX: &str = "selector-";
/// Smaller windows (physical pixels) are toolbars and the like, not worth picking.
const MIN_PICKABLE: u32 = 80;

/// A rectangle on the virtual desktop, in physical pixels.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A window the user can pick in the selector, as it was when the selector opened.
#[derive(Clone, Debug, Serialize)]
struct PickableWindow {
    /// The window handle, which the frontend hands back to follow the window.
    id: u32,
    title: String,
    app: String,
    rect: ScreenRect,
}

/// What the user picked: a region, and the window it belongs to when they picked one.
#[derive(Clone, Debug, Serialize)]
struct RegionChoice {
    region: ScreenRect,
    window: Option<PickableWindow>,
}

/// The screenshot each region selector window shows, keyed by window label.
#[derive(Default)]
struct SelectorShots(Mutex<HashMap<String, Vec<u8>>>);

/// The windows under the selectors, topmost first.
#[derive(Default)]
struct SelectorWindows(Mutex<Vec<PickableWindow>>);

/// The main window's id, looked up once. It counts as covering a followed window, since
/// capture would read it instead.
#[derive(Default)]
struct MainWindowId(OnceLock<Option<u32>>);

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// The id (window handle) of one of our own windows.
#[cfg(windows)]
fn window_id(window: &WebviewWindow) -> Option<u32> {
    window.hwnd().ok().map(|hwnd| target::id_of(hwnd.0))
}

#[cfg(not(windows))]
fn window_id(_window: &WebviewWindow) -> Option<u32> {
    None
}

/// Captures `region` with GDI, cut to the monitor that holds its center, and returns what was
/// captured with where it is. Windows excluded from capture (the overlay) don't show up in it.
fn capture(region: ScreenRect) -> Result<(RgbaImage, ScreenRect), String> {
    const OFF_SCREEN: &str = "선택한 영역이 화면 밖에 있어요";
    let cx = region.x + (region.width / 2) as i32;
    let cy = region.y + (region.height / 2) as i32;
    let monitor = CaptureMonitor::from_point(cx, cy).map_err(|_| OFF_SCREEN.to_string())?;
    let left = monitor.x().map_err(err)?;
    let top = monitor.y().map_err(err)?;
    let right = left + monitor.width().map_err(err)? as i32;
    let bottom = top + monitor.height().map_err(err)? as i32;
    let x0 = region.x.max(left);
    let y0 = region.y.max(top);
    let x1 = (region.x + region.width as i32).min(right);
    let y1 = (region.y + region.height as i32).min(bottom);
    if x1 <= x0 || y1 <= y0 {
        return Err(OFF_SCREEN.into());
    }
    let captured = ScreenRect { x: x0, y: y0, width: (x1 - x0) as u32, height: (y1 - y0) as u32 };
    let image = monitor
        .capture_region((x0 - left) as u32, (y0 - top) as u32, captured.width, captured.height)
        .map_err(err)?;
    Ok((image, captured))
}

/// Windows the user can pick, topmost first. xcap leaves out our own windows; the sample chat
/// is the one of ours worth picking, and it's always on top, so it goes first.
fn pickable_windows(app: &AppHandle) -> Vec<PickableWindow> {
    // Following a window needs Windows APIs (see target.rs).
    if cfg!(not(windows)) {
        return Vec::new();
    }
    let mut windows = Vec::new();
    if let Some(id) = app.get_webview_window(DEMO).as_ref().and_then(window_id) {
        if let WindowState::Shown { rect } = target::window_state(id) {
            windows.push(PickableWindow { id, title: DEMO_TITLE.into(), app: "Overlingo".into(), rect });
        }
    }
    for window in CaptureWindow::all().unwrap_or_default() {
        if window.is_minimized().unwrap_or(true) {
            continue;
        }
        let (Ok(id), Ok(title), Ok(x), Ok(y), Ok(width), Ok(height)) =
            (window.id(), window.title(), window.x(), window.y(), window.width(), window.height())
        else {
            continue;
        };
        if title.trim().is_empty() || width < MIN_PICKABLE || height < MIN_PICKABLE {
            continue;
        }
        let app = window.app_name().unwrap_or_default();
        windows.push(PickableWindow { id, title, app, rect: ScreenRect { x, y, width, height } });
    }
    windows
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
/// the user picks a window or drags out a region. The result arrives as a `region-selected`
/// event.
#[tauri::command]
async fn start_region_select(
    app: AppHandle,
    shots: State<'_, SelectorShots>,
    windows: State<'_, SelectorWindows>,
) -> Result<(), String> {
    close_selectors(&app);
    let monitors = app.available_monitors().map_err(err)?;
    // Screenshots and the window list first, so the selector windows themselves aren't in them.
    let mut taken = HashMap::new();
    for (index, monitor) in monitors.iter().enumerate() {
        let (shot, _) = capture(monitor_rect(monitor))?;
        taken.insert(format!("{SELECTOR_PREFIX}{index}"), encode_jpeg(shot)?);
    }
    *shots.0.lock().map_err(err)? = taken;
    *windows.0.lock().map_err(err)? = pickable_windows(&app);

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

/// The windows the selectors can highlight and pick, topmost first.
#[tauri::command]
fn selector_windows(windows: State<'_, SelectorWindows>) -> Result<Vec<PickableWindow>, String> {
    Ok(windows.0.lock().map_err(err)?.clone())
}

// Commands that create or close windows are async: on Windows, doing that from a synchronous
// command blocks the main thread the window needs, and everything deadlocks.

/// Closes the selector windows and tells the main window what was picked (`null` when
/// cancelled). `window` is the id of the window the region belongs to, when there is one.
#[tauri::command]
async fn finish_region_select(
    app: AppHandle,
    region: Option<ScreenRect>,
    window: Option<u32>,
    shots: State<'_, SelectorShots>,
    windows: State<'_, SelectorWindows>,
) -> Result<(), String> {
    shots.0.lock().map_err(err)?.clear();
    let picked = {
        let mut windows = windows.0.lock().map_err(err)?;
        let picked = window.and_then(|id| windows.iter().find(|w| w.id == id).cloned());
        windows.clear();
        picked
    };
    close_selectors(&app);
    let choice = region.map(|region| RegionChoice { region, window: picked });
    app.emit_to(MAIN, "region-selected", choice).map_err(err)?;
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    Ok(())
}

/// Captures `region` after waiting `wait_ms`, so the frontend paces capture without timers
/// (which are throttled while its window is minimized). With `window`, the id of the window
/// being followed, it also measures how much of the region other apps cover. Returns the
/// width, height and covered percentage as little-endian u32s, followed by RGBA pixels.
#[tauri::command]
async fn capture_region(
    app: AppHandle,
    region: ScreenRect,
    wait_ms: u64,
    window: Option<u32>,
    main_id: State<'_, MainWindowId>,
) -> Result<Response, String> {
    let main = *main_id.0.get_or_init(|| app.get_webview_window(MAIN).as_ref().and_then(window_id));
    tauri::async_runtime::spawn_blocking(move || {
        if wait_ms > 0 {
            thread::sleep(Duration::from_millis(wait_ms));
        }
        let (image, captured) = capture(region)?;
        let covered = window.map_or(0, |id| (target::covered_share(id, captured, main) * 100.0).round() as u32);
        let mut bytes = Vec::with_capacity(12 + image.as_raw().len());
        bytes.extend_from_slice(&image.width().to_le_bytes());
        bytes.extend_from_slice(&image.height().to_le_bytes());
        bytes.extend_from_slice(&covered.to_le_bytes());
        bytes.extend_from_slice(image.as_raw());
        Ok(Response::new(bytes))
    })
    .await
    .map_err(err)?
}

/// Where window `id` is after waiting `wait_ms`, paced natively like `capture_region`.
#[tauri::command]
async fn window_state(id: u32, wait_ms: u64) -> Result<WindowState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if wait_ms > 0 {
            thread::sleep(Duration::from_millis(wait_ms));
        }
        target::window_state(id)
    })
    .await
    .map_err(err)
}

/// Shows the overlay over the monitor that holds `region`: transparent, always on top,
/// click-through, and excluded from screen capture so translations never feed back into OCR.
/// Returns the monitor's rect, which the overlay now covers.
#[tauri::command]
async fn show_overlay(app: AppHandle, region: ScreenRect) -> Result<ScreenRect, String> {
    let monitor = monitor_containing(&app, region)?;
    let area = monitor_rect(&monitor);
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
    cover(&window, area)?;
    window.set_ignore_cursor_events(true).map_err(err)?;
    window.show().map_err(err)?;
    // Raise it above other always-on-top windows, such as the sample chat. Setting the same
    // value again would be a no-op, so it's toggled.
    window.set_always_on_top(false).map_err(err)?;
    window.set_always_on_top(true).map_err(err)?;
    Ok(area)
}

#[tauri::command]
async fn hide_overlay(app: AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY) {
        let _ = window.close();
    }
}

/// Opens the sample chat in its own window, so the overlay can be tried without a messenger.
/// Returns its id, so it's followed like any window the user picks.
#[tauri::command]
async fn open_demo(app: AppHandle) -> Result<Option<u32>, String> {
    if let Some(window) = app.get_webview_window(DEMO) {
        window.set_focus().map_err(err)?;
        return Ok(window_id(&window));
    }
    // Always on top, so nothing the user has open covers it.
    let window = WebviewWindowBuilder::new(&app, DEMO, WebviewUrl::App("demo.html".into()))
        .title(DEMO_TITLE)
        .inner_size(1280.0, 720.0)
        .center()
        .resizable(false)
        .always_on_top(true)
        .build()
        .map_err(err)?;
    Ok(window_id(&window))
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
        .manage(SelectorWindows::default())
        .manage(MainWindowId::default())
        .invoke_handler(tauri::generate_handler![
            start_region_select,
            selector_shot,
            selector_windows,
            finish_region_select,
            capture_region,
            window_state,
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
