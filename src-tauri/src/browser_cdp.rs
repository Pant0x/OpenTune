/*!
 * Session import through the browser's own DevTools door.
 *
 * Chromium's app-bound encryption (v20 blobs) makes cookie *files* unreadable to
 * anyone but the browser, so instead of reading files the app asks the RUNNING
 * browser for its cookies over the DevTools protocol — where the browser decrypts
 * for us, HttpOnly cookies included. Same trust as reading the file (explicit user
 * click, loopback only, nothing leaves the machine), none of the SYSTEM-level
 * tricks malware uses to fight app-bound encryption.
 *
 * The price is a restart: a normally launched browser has no debugging port, and a
 * second instance cannot share the locked profile. Import therefore restarts the
 * browser once with `--remote-debugging-port` on the SAME profile, grabs the
 * cookies, then restarts it normally again. Tabs survive the round trip only when
 * the browser is set to restore them — checked up front from Preferences, so the
 * UI can warn before anything closes. The debug port is never left open behind us:
 * every exit path relaunches the browser normally first.
 */

use std::path::{Path, PathBuf};

use crate::browser_cookies::{is_session_host, BrowserKind, BrowserProfile, SessionCookie};

/// Everything the destructive import needs, verified without touching the browser.
pub(crate) struct CdpImportPlan {
    pub browser: &'static str,
    pub browser_exe: PathBuf,
    pub user_data_dir: PathBuf,
    pub profile_dir_name: String,
    /// `Preferences` says sessions restore (`session.restore_on_startup == 1`).
    /// False means a restart loses open tabs — the UI must say so out loud.
    pub restores_tabs: bool,
}

/// Resolves how an import would run. Reads files only: no kills, no launches.
pub(crate) fn plan_chromium_import(profile: &BrowserProfile) -> Result<CdpImportPlan, String> {
    if profile.kind != BrowserKind::Chromium {
        return Err("DevTools import is Chromium-only".to_string());
    }
    let user_data_dir = profile
        .profile_dir
        .parent()
        .ok_or_else(|| "browser profile has no parent directory".to_string())?
        .to_path_buf();
    let browser_exe =
        find_browser_exe(profile.browser).ok_or_else(|| format!("{} is not installed", profile.browser))?;
    let restores_tabs = browser_restores_tabs(&user_data_dir);
    Ok(CdpImportPlan {
        browser: profile.browser,
        browser_exe,
        user_data_dir,
        profile_dir_name: profile.profile_name.clone(),
        restores_tabs,
    })
}

/// Whether the browser reopens the previous session on launch.
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

fn find_browser_exe(browser: &str) -> Option<PathBuf> {
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
    // PATH fallback (`where.exe brave`, …). Output is trusted no further than
    // "a file exists here" — it is launched with explicit flags below, never bare.
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

/// Process image name for a browser, for the restart dance.
fn browser_image_name(browser: &str) -> Option<&'static str> {
    match browser {
        "Brave" => Some("brave.exe"),
        "Chrome" => Some("chrome.exe"),
        "Edge" => Some("msedge.exe"),
        "Opera" => Some("opera.exe"),
        "Vivaldi" => Some("vivaldi.exe"),
        _ => None,
    }
}

fn process_is_running(image: &str) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image}"), "/NH"])
        .output()
        .map(|output| {
            let text = String::from_utf8_lossy(&output.stdout);
            text.lines().any(|line| line.to_ascii_lowercase().starts_with(&image.to_ascii_lowercase()))
        })
        .unwrap_or(false)
}

fn wait_for_exit(image: &str, timeout_ms: u64) -> bool {
    let rounds = timeout_ms / 250;
    for _ in 0..rounds {
        if !process_is_running(image) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    !process_is_running(image)
}

/// Runs the full import cycle. DESTRUCTIVE: restarts the browser twice.
///
/// Contract: the caller confirmed with the user (including the tab warning when
/// `!plan.restores_tabs`). On success the browser is back to a normal launch and
/// the cookies are returned. On ANY failure the browser is still relaunched
/// normally first — the function never leaves a debugging port open or a browser
/// closed that it found open.
pub(crate) async fn import_session_via_cdp(plan: &CdpImportPlan, port: u16) -> Result<Vec<SessionCookie>, String> {
    let image = browser_image_name(plan.browser).ok_or_else(|| "unknown browser".to_string())?;
    let was_running = process_is_running(image);

    // The profile is locked by a running instance; a second one would either join
    // it (no debugging port) or fail. So the running one goes first.
    if was_running {
        std::process::Command::new("taskkill")
            .args(["/F", "/IM", image])
            .output()
            .map_err(|error| format!("could not close {image}: {error}"))?;
        if !wait_for_exit(image, 15_000) {
            return Err(format!("{image} would not close; import cancelled"));
        }
    }

    // Whatever happens below, the browser ends up launched normally again.
    let result = import_via_cdp_inner(plan, port).await;
    relaunch_normally(plan);
    result
}

fn relaunch_normally(plan: &CdpImportPlan) {
    let _ = std::process::Command::new(&plan.browser_exe)
        .arg(format!("--user-data-dir={}", plan.user_data_dir.display()))
        .arg(format!("--profile-directory={}", plan.profile_dir_name))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .spawn();
}

async fn import_via_cdp_inner(plan: &CdpImportPlan, port: u16) -> Result<Vec<SessionCookie>, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio::time::{sleep, timeout};

    let mut debug_child = std::process::Command::new(&plan.browser_exe)
        .arg(format!("--user-data-dir={}", plan.user_data_dir.display()))
        .arg(format!("--profile-directory={}", plan.profile_dir_name))
        .arg(format!("--remote-debugging-port={port}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("about:blank")
        .spawn()
        .map_err(|error| format!("could not launch browser for import: {error}"))?;

    let cleanup_child = |child: &mut std::process::Child| {
        let _ = child.kill();
        let _ = child.wait();
    };

    let outcome: Result<Vec<SessionCookie>, String> = async {
        // Wait for the DevTools HTTP endpoint.
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
    .await;

    cleanup_child(&mut debug_child);
    outcome
}

#[cfg(test)]
mod cdp_probe {
    //! Safe probe: resolves import plans without touching any browser process.
    //! No kills, no launches, no ports — pure file reads.
    //! Run: `cargo test cdp_probe -- --nocapture`.

    use super::{browser_image_name, find_browser_exe, plan_chromium_import};
    use crate::browser_cookies::{detect_browser_profiles, BrowserKind};

    #[test]
    fn import_plans_resolve_without_touching_processes() {
        let profiles = detect_browser_profiles();
        let mut chromium = 0;
        for profile in profiles.iter().filter(|profile| profile.kind == BrowserKind::Chromium) {
            chromium += 1;
            match plan_chromium_import(profile) {
                Ok(plan) => {
                    eprintln!(
                        "[probe] {} / {} : exe_found=true restores_tabs={}",
                        plan.browser, plan.profile_dir_name, plan.restores_tabs
                    );
                    assert!(browser_image_name(plan.browser).is_some());
                }
                Err(error) => {
                    eprintln!("[probe] {} / {} : plan failed: {}", profile.browser, profile.profile_name, error);
                }
            }
        }
        eprintln!("[probe] {} chromium profile(s) examined", chromium);
        // find_browser_exe is also exercised for unknown names (must be None, never panic).
        assert!(find_browser_exe("Netscape").is_none());
    }
}
