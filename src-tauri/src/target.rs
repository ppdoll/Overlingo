//! Following one window instead of a fixed spot on screen: where it is now, and whether
//! another app's window is on top of it (then capture would read that app instead).

use serde::Serialize;

use crate::ScreenRect;

/// What a followed window is doing right now.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum WindowState {
    /// On screen at `rect`, physical pixels, without the invisible resize borders.
    Shown { rect: ScreenRect },
    /// Minimized, or on another virtual desktop.
    Hidden,
    /// Closed.
    Gone,
}

#[cfg(windows)]
mod imp {
    use std::{ffi::c_void, mem};

    use windows::{
        Win32::{
            Foundation::{HWND, LPARAM, RECT},
            Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute},
            UI::WindowsAndMessaging::{
                EnumWindows, GW_OWNER, GWL_EXSTYLE, GetWindow, GetWindowLongW, GetWindowThreadProcessId, IsIconic,
                IsWindow, IsWindowVisible, WS_EX_TRANSPARENT,
            },
        },
        core::BOOL,
    };

    use super::WindowState;
    use crate::ScreenRect;

    /// Window ids are HWNDs. Handles only use their low 32 bits, so they survive the trip
    /// through JavaScript numbers; going back they are sign-extended, as Windows documents.
    fn hwnd_of(id: u32) -> HWND {
        HWND(id as i32 as isize as *mut c_void)
    }

    pub fn id_of(hwnd: *mut c_void) -> u32 {
        hwnd as usize as u32
    }

    fn bounds(hwnd: HWND) -> Option<ScreenRect> {
        let mut rect = RECT::default();
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut c_void,
                mem::size_of::<RECT>() as u32,
            )
        }
        .ok()?;
        let width = u32::try_from(rect.right - rect.left).ok()?;
        let height = u32::try_from(rect.bottom - rect.top).ok()?;
        Some(ScreenRect { x: rect.left, y: rect.top, width, height })
    }

    fn cloaked(hwnd: HWND) -> bool {
        let mut value = 0u32;
        let read = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut value as *mut u32 as *mut c_void,
                mem::size_of::<u32>() as u32,
            )
        };
        read.is_ok() && value != 0
    }

    pub fn window_state(id: u32) -> WindowState {
        let hwnd = hwnd_of(id);
        unsafe {
            if !IsWindow(Some(hwnd)).as_bool() {
                return WindowState::Gone;
            }
            if IsIconic(hwnd).as_bool() || cloaked(hwnd) {
                return WindowState::Hidden;
            }
        }
        match bounds(hwnd) {
            Some(rect) if rect.width > 0 && rect.height > 0 => WindowState::Shown { rect },
            _ => WindowState::Hidden,
        }
    }

    /// Whether `window` is a popup that `owner` opened (a menu, an emoji picker), which
    /// belongs to the followed window rather than covering it.
    fn owned_by(mut window: HWND, owner: HWND) -> bool {
        for _ in 0..8 {
            match unsafe { GetWindow(window, GW_OWNER) } {
                Ok(next) if !next.is_invalid() => {
                    if next == owner {
                        return true;
                    }
                    window = next;
                }
                _ => return false,
            }
        }
        false
    }

    /// Walks the windows above the followed one, collecting those a capture would show.
    struct Above {
        target: HWND,
        main: Option<u32>,
        ours: u32,
        rects: Vec<ScreenRect>,
        /// Whether the walk got to the followed window.
        reached: bool,
    }

    /// Whether `hwnd`, lying above the followed window, would show up in a capture over it.
    /// Click-through windows (our overlay among them) are left out, and so are our own windows
    /// other than the main one, which capture would read.
    fn shows_above(hwnd: HWND, above: &Above) -> bool {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || cloaked(hwnd) {
                return false;
            }
            if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TRANSPARENT.0 != 0 {
                return false;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == above.ours && Some(id_of(hwnd.0)) != above.main {
                return false;
            }
        }
        !owned_by(hwnd, above.target)
    }

    unsafe extern "system" fn collect_above(hwnd: HWND, state: LPARAM) -> BOOL {
        let above = unsafe { &mut *(state.0 as *mut Above) };
        // Top-level windows come in z-order, topmost first, so the walk stops at the target.
        if hwnd == above.target {
            above.reached = true;
            return BOOL(0);
        }
        if shows_above(hwnd, above) {
            if let Some(rect) = bounds(hwnd) {
                above.rects.push(rect);
            }
        }
        BOOL(1)
    }

    /// Share (0..1) of `region`, sampled on a 3x3 grid, that windows above window `id` cover.
    pub fn covered_share(id: u32, region: ScreenRect, main: Option<u32>) -> f32 {
        let mut above =
            Above { target: hwnd_of(id), main, ours: std::process::id(), rects: Vec::new(), reached: false };
        // Stopping early makes EnumWindows report failure; the collected windows are still good.
        let _ = unsafe { EnumWindows(Some(collect_above), LPARAM(&mut above as *mut Above as isize)) };
        if !above.reached {
            return 0.0;
        }
        let mut covered = 0;
        for fy in [1, 3, 5] {
            for fx in [1, 3, 5] {
                let x = region.x + (region.width as i32 * fx) / 6;
                let y = region.y + (region.height as i32 * fy) / 6;
                let hit = |r: &ScreenRect| x >= r.x && y >= r.y && x < r.x + r.width as i32 && y < r.y + r.height as i32;
                if above.rects.iter().any(hit) {
                    covered += 1;
                }
            }
        }
        covered as f32 / 9.0
    }
}

#[cfg(not(windows))]
mod imp {
    //! Following windows is Windows-only for now; elsewhere a picked window reads as closed.
    use super::WindowState;
    use crate::ScreenRect;

    pub fn window_state(_id: u32) -> WindowState {
        WindowState::Gone
    }

    pub fn covered_share(_id: u32, _region: ScreenRect, _main: Option<u32>) -> f32 {
        0.0
    }
}

#[cfg(windows)]
pub use imp::id_of;
pub use imp::{covered_share, window_state};
