/*!
 * YouTube sign-in through a real browser window, with zero app popups.
 *
 * The app launches an installed Chromium with an APP-MANAGED profile directory
 * (under the app data dir — never the user's own browser profile, so their tabs,
 * sessions and settings are never touched, restarted, or even read) plus a
 * debugging port, and opens the YouTube login there. The user signs in once, in
 * a real browser window; the app polls the session over DevTools, and the moment
 * login cookies appear it kills its own window and stores the session as an
 * ordinary slot. Afterwards the profile persists, so later sign-ins are an
 * account chooser instead of typing.
 *
 * Why this shape and not the alternatives:
 * - Cookie *files* are app-bound encrypted (v20) and unreadable to anyone but
 *   the browser itself — asking the RUNNING browser over DevTools has it decrypt
 *   for us, HttpOnly cookies included.
 * - The user's own profile is never launched, killed, restarted, or read. The
 *   only window that ever closes is one this module opened.
 * - No extensions, no registry keys, no admin, no secrets, no verification:
 *   the loopback port is picked fresh per run and nothing listens when idle.
 */

use std::path::{Path, PathBuf};

/// One session cookie. Values never touch a log line.
pub(crate) struct SessionCookie {
    pub name: String,
    pub value: String,
}

/// Hosts whose cookies make up a YouTube Music session.
pub(crate) fn is_session_host(host: &str) -> bool {
    let host = host.trim_start_matches('.').to_ascii_lowercase();
    host == "youtube.com"
        || host == "music.youtube.com"
        || host == "accounts.youtube.com"
        || host == "google.com"
        || host.ends_with(".youtube.com")
        || host.ends_with(".google.com")
}

/// Cookie names proving a human completed a Google login (vs consent/measurement).
fn is_login_cookie_name(name: &str) -> bool {
    matches!(
        name,
        "SID" | "HSID" | "SSID" | "APISID" | "SAPISID" | "SIDCC"
            | "__Secure-1PSID" | "__Secure-3PSID" | "__Secure-1PAPISID" | "__Secure-3PAPISID"
            | "__Secure-1PSIDTS" | "__Secure-3PSIDTS" | "__Secure-1PSIDCC" | "__Secure-3PSIDCC"
    )
}

/// Browsers this flow can drive, preferred first.
const SUPPORTED_BROWSERS: &[&str] = &["Brave", "Edge", "Chrome", "Opera", "Vivaldi"];

/// First installed Chromium, preferred order. `None` means no supported browser —
/// the caller falls back to the classic window instead of failing silently.
pub(crate) fn pick_signin_browser() -> Option<&'static str> {
    SUPPORTED_BROWSERS
        .iter()
        .find(|browser| find_browser_exe(browser).is_some())
        .copied()
}

pub(crate) fn find_browser_exe(browser: &str) -> Option<PathBuf> {
    let program_files = std::env::var_os("PROGRAMFILES").map(PathBuf::from);
    let program_files_x86 = std::env::var_os("PROGRAMFILES(X86)").map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut push = |base: &Option<PathBuf>, relative: &str| {
        if let Some(base) = base {
            candidates.push(base.join(relative));
        }
    };
    match browser {
        "Brave" => {
            push(&program_files, "BraveSoftware/Brave-Browser/Application/brave.exe");
            push(&local_app_data, "BraveSoftware/Brave-Browser/Application/brave.exe");
        }
        "Chrome" => {
            push(&program_files, "Google/Chrome/Application/chrome.exe");
            push(&local_app_data, "Google/Chrome/Application/chrome.exe");
        }
        "Edge" => {
            push(&program_files, "Microsoft/Edge/Application/msedge.exe");
            push(&program_files_x86, "Microsoft/Edge/Application/msedge.exe");
        }
        "Opera" => {
            push(&program_files, "Opera/opera.exe");
            push(&local_app_data, "Programs/Opera/opera.exe");
        }
        "Vivaldi" => {
            push(&program_files, "Vivaldi/Application/vivaldi.exe");
            push(&local_app_data, "Vivaldi/Application/vivaldi.exe");
        }
        _ => {}
    }
    if let Some(found) = candidates.into_iter().find(|path| path.is_file()) {
        return Some(found);
    }
    // PATH fallback. Output is trusted no further than "a file exists here" —
    // it is launched with explicit flags below, never bare.
    let binary = match browser {
        "Brave" => "brave",
        "Chrome" => "chrome",
        "Edge" => "msedge",
        "Opera" => "opera",
        "Vivaldi" => "vivaldi",
        _ => return None,
    };
    let output = std::process::Command::new("where.exe").arg(binary).output().ok()?;
    let first = String::from_utf8_lossy(&output.stdout).lines().next()?.trim().to_string();
    let path = PathBuf::from(first);
    path.is_file().then_some(path)
}

/// Launches OUR OWN browser window: app-managed profile, debugging port, login page.
///
/// Same profile directory every call, so the Google session persists between
/// sign-ins. Same executable the user already has — no downloads, no bundled
/// browser. The returned child is ours to kill; nothing else is ever touched.
pub(crate) fn launch_managed_browser(
    browser_exe: &Path,
    profile_dir: &Path,
    port: u16,
    login_url: &str,
) -> Result<std::process::Child, String> {
    std::fs::create_dir_all(profile_dir)
        .map_err(|error| format!("browser profile directory unavailable: {error}"))?;
    std::process::Command::new(browser_exe)
        .arg(format!("--user-data-dir={}", profile_dir.display()))
        .arg(format!("--remote-debugging-port={port}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate")
        .arg(login_url)
        .spawn()
        .map_err(|error| format!("could not open the browser: {error}"))
}

/// Reads the session cookies the managed window currently holds.
///
/// `Storage.getCookies` is browser-wide for that window's profile; the caller
/// filters to session hosts. Values cross loopback only, straight into the
/// account store — never a log line.
pub(crate) async fn read_cookies_via_cdp(port: u16) -> Result<Vec<SessionCookie>, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio::time::{sleep, timeout};

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| format!("http client failed: {error}"))?;
    let mut targets_url = String::new();
    for _ in 0..80 {
        match client.get(format!("http://127.0.0.1:{port}/json/version")).send().await {
            Ok(response) if response.status().is_success() => {
                targets_url = format!("http://127.0.0.1:{port}/json/list");
                break;
            }
            _ => sleep(std::time::Duration::from_millis(250)).await,
        }
    }
    if targets_url.is_empty() {
        return Err("browser debugging port never came up".to_string());
    }

    let targets_text: String = client
        .get(&targets_url)
        .send()
        .await
        .map_err(|error| format!("DevTools target list failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("DevTools target list read failed: {error}"))?;
    let targets: serde_json::Value = serde_json::from_str(&targets_text)
        .map_err(|error| format!("DevTools target list parse failed: {error}"))?;
    let ws_url = targets
        .as_array()
        .and_then(|list| list.iter().find_map(|target| target.get("webSocketDebuggerUrl")?.as_str()))
        .ok_or_else(|| "browser exposed no debuggable target".to_string())?
        .to_string();

    let (mut socket, _) = timeout(
        std::time::Duration::from_secs(15),
        tokio_tungstenite::connect_async(&ws_url),
    )
    .await
    .map_err(|_| "DevTools socket timed out".to_string())
    .map_err(|error| format!("DevTools socket failed: {error}"))?
    .map_err(|error| format!("DevTools socket failed: {error}"))?;

    let request = serde_json::json!({ "id": 1, "method": "Storage.getCookies" });
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(request.to_string().into()))
        .await
        .map_err(|error| format!("DevTools request failed: {error}"))?;

    let deadline = std::time::Duration::from_secs(20);
    let cookies_value: serde_json::Value = timeout(deadline, async {
        while let Some(message) = socket.next().await {
            let message = message.map_err(|error| format!("DevTools read failed: {error}"))?;
            let text = match message {
                tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
                tokio_tungstenite::tungstenite::Message::Close(_) => {
                    return Err("DevTools socket closed".to_string())
                }
                _ => continue,
            };
            let parsed: serde_json::Value =
                serde_json::from_str(&text).map_err(|error| format!("DevTools parse failed: {error}"))?;
            if parsed.get("id") == Some(&serde_json::Value::from(1)) {
                if let Some(error) = parsed.get("error") {
                    return Err(format!("DevTools error: {error}"));
                }
                return parsed
                    .pointer("/result/cookies")
                    .cloned()
                    .ok_or_else(|| "DevTools returned no cookies".to_string());
            }
        }
        Err("DevTools gave no answer".to_string())
    })
    .await
    .map_err(|_| "DevTools answer timed out".to_string())??;

    let mut session = Vec::new();
    for entry in cookies_value.as_array().cloned().unwrap_or_default() {
        let name = entry.get("name").and_then(|value| value.as_str()).unwrap_or("").to_string();
        let value = entry.get("value").and_then(|value| value.as_str()).unwrap_or("").to_string();
        let domain = entry.get("domain").and_then(|value| value.as_str()).unwrap_or("").to_string();
        if name.trim().is_empty() || value.is_empty() || !is_session_host(&domain) {
            continue;
        }
        session.push(SessionCookie { name, value });
    }
    Ok(session)
}

/// Whether cookies amount to a completed Google login (vs consent/measurement).
pub(crate) fn cookies_hold_login(cookies: &[SessionCookie]) -> bool {
    cookies.iter().any(|cookie| is_login_cookie_name(&cookie.name))
}

#[cfg(test)]
mod cdp_probe {
    //! Safe probes: no browser is ever launched or touched.
    //! Run: `cargo test cdp_probe -- --nocapture`.

    use super::{find_browser_exe, pick_signin_browser};

    #[test]
    fn signin_browser_resolution_is_sane() {
        // Unknown names resolve to nothing, never panic.
        assert!(find_browser_exe("Netscape").is_none());
        match pick_signin_browser() {
            Some(browser) => {
                eprintln!("[probe] sign-in browser: {browser}");
                assert!(find_browser_exe(browser).is_some());
            }
            None => eprintln!("[probe] no supported browser installed"),
        }
    }
}
