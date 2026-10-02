#[cfg(target_os = "windows")]
pub mod implementation {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SendMessageW, SetWindowPlacement, SetWindowPos, SWP_FRAMECHANGED,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINDOWPLACEMENT, WM_SETREDRAW,
    };

    static WAS_MAXIMIZED: AtomicBool = AtomicBool::new(false);
    static SAVED_PLACEMENT: Mutex<Option<WINDOWPLACEMENT>> = Mutex::new(None);

    pub fn set_fullscreen(app: &AppHandle, fullscreen: bool) -> Result<(), String> {
        let window = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().values().next().cloned())
            .ok_or_else(|| "No window found".to_string())?;

        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd_raw.0);

        if fullscreen {
            let is_max = window.is_maximized().unwrap_or(false);
            WAS_MAXIMIZED.store(is_max, Ordering::SeqCst);

            unsafe {
                // Freeze rendering so the fullscreen transition is completely invisible and atomic
                let _ = SendMessageW(hwnd, WM_SETREDRAW, Some(WPARAM(0)), Some(LPARAM(0)));
            }

            if is_max {
                unsafe {
                    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    let mut mi = MONITORINFO::default();
                    mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                    let _ = GetMonitorInfoW(monitor, &mut mi);

                    let mut placement = WINDOWPLACEMENT::default();
                    placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                    let _ = GetWindowPlacement(hwnd, &mut placement);

                    // Save the original placement to restore exact bounds and state on exit
                    *SAVED_PLACEMENT.lock().unwrap() = Some(placement);

                    // Temporarily set the normal restored rectangle to the full monitor rect.
                    // When unmaximize() is called below, Windows DWM restores to rcNormalPosition.
                    // Because rcNormalPosition is already the full monitor rect, DWM performs
                    // ZERO shrinking/minimizing animation!
                    placement.rcNormalPosition = mi.rcMonitor;
                    let _ = SetWindowPlacement(hwnd, &placement);
                }

                let _ = window.unmaximize();
            }

            let _ = window.set_fullscreen(true);
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();

            unsafe {
                // Unfreeze and trigger frame update
                let _ = SendMessageW(hwnd, WM_SETREDRAW, Some(WPARAM(1)), Some(LPARAM(0)));
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
                );
            }
        } else {
            let was_max = WAS_MAXIMIZED.swap(false, Ordering::SeqCst);

            let _ = window.set_always_on_top(false);
            let _ = window.set_fullscreen(false);

            if was_max {
                let _ = window.maximize();
                unsafe {
                    if let Some(orig) = SAVED_PLACEMENT.lock().unwrap().take() {
                        let mut current = WINDOWPLACEMENT::default();
                        current.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                        let _ = GetWindowPlacement(hwnd, &mut current);
                        current.rcNormalPosition = orig.rcNormalPosition;
                        let _ = SetWindowPlacement(hwnd, &current);
                    }
                }
            }
            let _ = window.set_focus();
        }

        Ok(())
    }

    pub fn is_fullscreen(app: &AppHandle) -> bool {
        if let Some(window) = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().values().next().cloned())
        {
            window.is_fullscreen().unwrap_or(false)
        } else {
            false
        }
    }
}
