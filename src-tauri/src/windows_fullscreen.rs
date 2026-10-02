#[cfg(target_os = "windows")]
pub mod implementation {
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, GetWindowPlacement, SetWindowLongW, SetWindowPlacement, SetWindowPos,
        GWL_STYLE, HWND_NOTOPMOST, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOMOVE,
        SWP_NOOWNERZORDER, SWP_NOSIZE, WINDOWPLACEMENT, WS_CAPTION, WS_MAXIMIZE, WS_POPUP,
        WS_THICKFRAME,
    };

    static PREV_PLACEMENT: Mutex<Option<WINDOWPLACEMENT>> = Mutex::new(None);
    static PREV_STYLE: Mutex<Option<u32>> = Mutex::new(None);
    static IS_CUSTOM_FULLSCREEN: Mutex<bool> = Mutex::new(false);

    pub fn set_fullscreen(app: &AppHandle, fullscreen: bool) -> Result<(), String> {
        let window = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().values().next().cloned())
            .ok_or_else(|| "No window found".to_string())?;

        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd_raw.0);

        unsafe {
            if fullscreen {
                let mut placement = WINDOWPLACEMENT::default();
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;

                let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;

                let mut mi = MONITORINFO::default();
                mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let _ = GetWindowPlacement(hwnd, &mut placement);
                let _ = GetMonitorInfoW(monitor, &mut mi);

                // Save state to restore seamlessly
                *PREV_PLACEMENT.lock().unwrap() = Some(placement);
                *PREV_STYLE.lock().unwrap() = Some(style);
                *IS_CUSTOM_FULLSCREEN.lock().unwrap() = true;

                // Strip overlapped/maximized borders & titlebar
                let new_style =
                    (style & !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_MAXIMIZE.0)) | WS_POPUP.0;
                SetWindowLongW(hwnd, GWL_STYLE, new_style as i32);

                let monitor_rect = mi.rcMonitor;
                let width = monitor_rect.right - monitor_rect.left;
                let height = monitor_rect.bottom - monitor_rect.top;

                // Move directly to cover entire monitor (including taskbar) in ONE atomic call without shrink!
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    monitor_rect.left,
                    monitor_rect.top,
                    width,
                    height,
                    SWP_FRAMECHANGED | SWP_NOOWNERZORDER,
                );
            } else {
                let prev_style = PREV_STYLE.lock().unwrap().take();
                let prev_placement = PREV_PLACEMENT.lock().unwrap().take();
                *IS_CUSTOM_FULLSCREEN.lock().unwrap() = false;

                if let Some(style) = prev_style {
                    SetWindowLongW(hwnd, GWL_STYLE, style as i32);
                }

                if let Some(placement) = prev_placement {
                    let _ = SetWindowPlacement(hwnd, &placement);
                }

                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_NOTOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOOWNERZORDER,
                );
            }
        }

        Ok(())
    }

    pub fn is_fullscreen() -> bool {
        *IS_CUSTOM_FULLSCREEN.lock().unwrap()
    }
}
