/*!
 * YouTube sign-in through the user's own browser, with zero app popups.
 *
 * The app restarts the user's Chromium on their own profile with a debugging
 * port, opens the YouTube login there, polls the session over DevTools (the
 * browser decrypts for us, HttpOnly cookies included), and the moment login
 * cookies appear kills its debug instance and relaunches the browser normally.
 * Tabs survive when the browser restores its session — checked up front, warned
 * about out loud when it doesn't. The debug port is never left open behind us:
 * every exit path relaunches normally first.
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

/// Launches the browser on a user profile with a debugging port, for the app to
/// read back what the user does there. Same executable the user already has —
/// no downloads, no bundled browser. The returned child is ours to kill; a
/// running user instance is closed first by the caller, never here.
pub(crate) fn launch_debug_browser(
    browser_exe: &Path,
    user_data_dir: &Path,
    profile_dir_name: &str,
    port: u16,
    login_url: &str,
) -> Result<std::process::Child, String> {
    std::process::Command::new(browser_exe)
        .arg(format!("--user-data-dir={}", user_data_dir.display()))
        .arg(format!("--profile-directory={profile_dir_name}"))
        .arg(format!("--remote-debugging-port={port}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate")
        .arg(login_url)
        .spawn()
        .map_err(|error| format!("could not open the browser: {error}"))
}

/// A live user profile that could hold a session. Paths only — reading happens
/// exclusively through the browser itself over DevTools, never from files.
pub(crate) struct UserBrowserProfile {
    pub browser: &'static str,
    pub user_data_dir: PathBuf,
    pub profile_dir_name: String,
    /// The browser reopens its tabs after a restart. False means the UI must
    /// warn about tab loss out loud before proceeding.
    pub restores_tabs: bool,
}

/// User-data roots per browser. The first existing profile (Default preferred)
/// wins; multi-profile machines get Default-or-first, documented in the UI.
pub(crate) fn detect_user_profile() -> Option<UserBrowserProfile> {
    for browser in SUPPORTED_BROWSERS {
        let Some(user_data_dir) = user_data_dir(browser) else { continue };
        if find_browser_exe(browser).is_none() {
            continue;
        }
        let mut names: Vec<String> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&user_data_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "Default" || name.starts_with("Profile ") {
                    names.push(name);
                }
            }
        }
        names.sort_by_key(|name| if name == "Default" { 0 } else { 1 });
        if let Some(profile_dir_name) = names.into_iter().next() {
            return Some(UserBrowserProfile {
                browser,
                restores_tabs: browser_restores_tabs(&user_data_dir),
                user_data_dir,
                profile_dir_name,
            });
        }
    }
    None
}

fn user_data_dir(browser: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
        let relative = match browser {
            "Brave" => "BraveSoftware\\Brave-Browser\\User Data",
            "Chrome" => "Google\\Chrome\\User Data",
            "Edge" => "Microsoft\\Edge\\User Data",
            "Opera" => "Opera Software\\Opera Stable",
            "Vivaldi" => "Vivaldi\\User Data",
            _ => return None,
        };
        Some(local.join(relative))
    }
    #[cfg(target_os = "macos")]
    {
        let library = std::env::var_os("HOME").map(PathBuf::from)?.join("Library/Application Support");
        let relative = match browser {
            "Brave" => "BraveSoftware/Brave-Browser",
            "Chrome" => "Google/Chrome",
            "Edge" => "Microsoft Edge",
            "Opera" => "com.operasoftware.Opera",
            "Vivaldi" => "Vivaldi",
            _ => return None,
        };
        Some(library.join(relative))
    }
    #[cfg(target_os = "linux")]
    {
        let config = std::env::var_os("HOME").map(PathBuf::from)?.join(".config");
        let relative = match browser {
            "Brave" => "BraveSoftware/Brave-Browser",
            "Chrome" => "google-chrome",
            "Edge" => "microsoft-edge",
            "Opera" => "opera",
            "Vivaldi" => "vivaldi",
            _ => return None,
        };
        Some(config.join(relative))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = browser;
        None
    }
}

/// Whether the browser reopens its tabs after a restart.
///
/// Read from `<User Data>/Preferences` (`session.restore_on_startup == 1`).
/// Missing file or key means "does not restore" — the safe direction to err in,
/// because the import restarts the browser and tabs are the thing at stake.
fn browser_restores_tabs(user_data_dir: &Path) -> bool {
    let text = match std::fs::read_to_string(user_data_dir.join("Preferences")) {
        Ok(text) => text,
        Err(_) => return false,
    };
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    parsed
        .pointer("/session/restore_on_startup")
        .and_then(|value| value.as_u64())
        == Some(1)
}

pub(crate) fn process_is_running(image: &str) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image}"), "/NH"])
        .output()
        .map(|output| {
            let text = String::from_utf8_lossy(&output.stdout);
            text.lines().any(|line| line.to_ascii_lowercase().starts_with(&image.to_ascii_lowercase()))
        })
        .unwrap_or(false)
}

pub(crate) fn wait_for_exit(image: &str, timeout_ms: u64) -> bool {
    let rounds = timeout_ms / 250;
    for _ in 0..rounds {
        if !process_is_running(image) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    !process_is_running(image)
}

/// Puts the browser back exactly as a normal launch after import work.
///
/// The debug port is never left open behind us: every exit path — success,
/// failure, timeout — relaunches normally first.
pub(crate) fn relaunch_normally(browser_exe: &Path, user_data_dir: &Path, profile_dir_name: &str) {
    let _ = std::process::Command::new(browser_exe)
        .arg(format!("--user-data-dir={}", user_data_dir.display()))
        .arg(format!("--profile-directory={profile_dir_name}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .spawn();
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

    use super::{detect_user_profile, find_browser_exe};

    #[test]
    fn signin_browser_resolution_is_sane() {
        // Unknown names resolve to nothing, never panic.
        assert!(find_browser_exe("Netscape").is_none());
        match detect_user_profile() {
            Some(profile) => {
                eprintln!(
                    "[probe] sign-in profile: {} / {} restores_tabs={}",
                    profile.browser, profile.profile_dir_name, profile.restores_tabs
                );
                assert!(find_browser_exe(profile.browser).is_some());
            }
            None => eprintln!("[probe] no supported browser profile on disk"),
        }
    }
}
