#[cfg(target_os = "windows")]
pub mod implementation {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageW, SetWindowPos, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        WM_SETREDRAW,
    };

    static WAS_MAXIMIZED: AtomicBool = AtomicBool::new(false);

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
                // Freeze rendering so the unmaximize/fullscreen transition is completely invisible and atomic
                let _ = SendMessageW(hwnd, WM_SETREDRAW, Some(WPARAM(0)), Some(LPARAM(0)));
            }

            if is_max {
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

            unsafe {
                let _ = SendMessageW(hwnd, WM_SETREDRAW, Some(WPARAM(0)), Some(LPARAM(0)));
            }

            let _ = window.set_always_on_top(false);
            let _ = window.set_fullscreen(false);
            if was_max {
                let _ = window.maximize();
            }
            let _ = window.set_focus();

            unsafe {
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
