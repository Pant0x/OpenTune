/*!
 * Imports a signed-in browser session without retyping credentials.
 *
 * Browsers keep cookies on disk: Chromium (Brave/Chrome/Edge/Opera/Vivaldi) in an SQLite
 * `Cookies` file whose values are AES-256-GCM blobs keyed by a DPAPI-protected key in
 * `Local State`; Firefox in a plaintext SQLite `cookies.sqlite`. Reading them is what
 * `yt-dlp --cookies-from-browser` does.
 *
 * Three rules, all load-bearing:
 *
 * - Nothing here runs on its own. Every entry point is behind an explicit user click
 *   ("Import session from …"), and the probe below only *counts* — it never returns a
 *   value.
 * - No cookie value is ever logged. The probe prints names and counts; `bytes_preview`
 *   exists for decoder diagnostics, not for secrets.
 * - A running browser holds its cookie file open, so the file is always copied to a
 *   temp path first and the copy is what gets read. The copy is deleted afterwards.
 */

use std::path::{Path, PathBuf};

/// Which on-disk layout a profile uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BrowserKind {
    Chromium,
    Firefox,
}

/// One browser profile that may hold a session.
#[derive(Clone, Debug)]
pub(crate) struct BrowserProfile {
    /// Display name, e.g. "Brave". Never a path.
    pub browser: &'static str,
    pub kind: BrowserKind,
    /// Profile directory (Chromium) or profile directory (Firefox).
    pub profile_dir: PathBuf,
    /// Profile display name, e.g. "Default" / "Profile 1".
    pub profile_name: String,
}

impl BrowserProfile {
    /// The cookie database as the browser left it. Always copied before reading.
    fn cookies_db(&self) -> PathBuf {
        match self.kind {
            // Modern Chromium keeps cookies under `Network/`; the top-level `Cookies`
            // file is a legacy path that no longer exists on current installs.
            BrowserKind::Chromium => self.profile_dir.join("Network").join("Cookies"),
            BrowserKind::Firefox => self.profile_dir.join("cookies.sqlite"),
        }
    }

    /// Chromium's `Local State`, home of the DPAPI-protected cookie key.
    fn local_state(&self) -> Option<PathBuf> {
        match self.kind {
            BrowserKind::Chromium => {
                // `Local State` lives next to the profiles, one level above them.
                self.profile_dir.parent().map(|base| base.join("Local State"))
            }
            BrowserKind::Firefox => None,
        }
    }
}

/// Every browser profile on this machine that could hold a session.
///
/// Chromium profiles are directories directly under `<data>/User Data` whose cookie
/// database exists; Firefox profiles come from `<data>/Profiles`. A browser with no
/// profiles on disk is simply absent — nothing to import from it.
pub(crate) fn detect_browser_profiles() -> Vec<BrowserProfile> {
    let mut profiles = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let roaming_app_data = std::env::var_os("APPDATA").map(PathBuf::from);
        if let Some(local) = local_app_data {
            let chromium = [
                ("Brave", "BraveSoftware\\Brave-Browser\\User Data"),
                ("Chrome", "Google\\Chrome\\User Data"),
                ("Edge", "Microsoft\\Edge\\User Data"),
                ("Opera", "Opera Software\\Opera Stable"),
                ("Vivaldi", "Vivaldi\\User Data"),
            ];
            for (browser, relative) in chromium {
                collect_chromium_profiles(browser, &local.join(relative), &mut profiles);
            }
        }
        if let Some(roaming) = roaming_app_data {
            collect_firefox_profiles(&roaming.join("Mozilla\\Firefox\\Profiles"), &mut profiles);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let library = home.join("Library/Application Support");
            let chromium = [
                ("Brave", "BraveSoftware/Brave-Browser"),
                ("Chrome", "Google/Chrome"),
                ("Edge", "Microsoft Edge"),
                ("Opera", "com.operasoftware.Opera"),
                ("Vivaldi", "Vivaldi"),
            ];
            for (browser, relative) in chromium {
                collect_chromium_profiles(browser, &library.join(relative), &mut profiles);
            }
            collect_firefox_profiles(&library.join("Firefox/Profiles"), &mut profiles);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let config = home.join(".config");
            let chromium = [
                ("Brave", "BraveSoftware/Brave-Browser"),
                ("Chrome", "google-chrome"),
                ("Edge", "microsoft-edge"),
                ("Opera", "opera"),
                ("Vivaldi", "vivaldi"),
            ];
            for (browser, relative) in chromium {
                collect_chromium_profiles(browser, &config.join(relative), &mut profiles);
            }
            collect_firefox_profiles(&home.join(".mozilla/firefox"), &mut profiles);
        }
    }

    profiles
}

fn collect_chromium_profiles(
    browser: &'static str,
    user_data: &Path,
    profiles: &mut Vec<BrowserProfile>,
) {
    // Opera keeps its profile at the top level rather than under `User Data`.
    let candidates = if browser == "Opera" {
        vec![(user_data.to_path_buf(), "Default".to_string())]
    } else {
        match std::fs::read_dir(user_data) {
            Ok(entries) => entries
                .flatten()
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .map(|entry| {
                    (
                        entry.path(),
                        entry.file_name().to_string_lossy().to_string(),
                    )
                })
                .filter(|(_, name)| {
                    name == "Default" || name.starts_with("Profile ")
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    };

    for (dir, name) in candidates {
        let profile = BrowserProfile {
            browser,
            kind: BrowserKind::Chromium,
            profile_name: name,
            profile_dir: dir,
        };
        if profile.cookies_db().is_file() {
            profiles.push(profile);
        }
    }
}

fn collect_firefox_profiles(profiles_dir: &Path, profiles: &mut Vec<BrowserProfile>) {
    let entries = match std::fs::read_dir(profiles_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let profile = BrowserProfile {
            browser: "Firefox",
            kind: BrowserKind::Firefox,
            profile_name: entry.file_name().to_string_lossy().to_string(),
            profile_dir: entry.path(),
        };
        if profile.cookies_db().is_file() {
            profiles.push(profile);
        }
    }
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

/// Copies a possibly-locked database to a temp path for reading.
///
/// Returns the temp path; the caller deletes it. A running browser is the ordinary
/// case rather than an edge — Chrome and Firefox both hold their cookie file open —
/// and a plain copy succeeds through their share flags where opening in place fails.
fn stage_database_copy(source: &Path, tag: &str) -> Result<PathBuf, String> {
    let staged = std::env::temp_dir().join(format!(
        "opentune-cookies-{}-{}-{}.db",
        tag,
        std::process::id(),
        rand_suffix(),
    ));
    std::fs::copy(source, &staged)
        .map_err(|error| format!("cookie database copy failed: {error}"))?;
    Ok(staged)
}

fn rand_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    format!("{nanos:09}")
}

/// One decrypted session cookie. Values never touch a log line.
pub(crate) struct SessionCookie {
    pub name: String,
    pub value: String,
}

/// All YouTube-session cookies in a profile, decrypted.
///
/// Chromium values go through the DPAPI key; Firefox values are plaintext. Cookies
/// that refuse to decrypt (a rotated format, Chrome's app-bound encryption) are
/// skipped rather than failing the whole import — a partial session that still
/// authenticates beats no session, and the caller reports what landed by name.
pub(crate) fn read_session_cookies(
    profile: &BrowserProfile,
) -> Result<Vec<SessionCookie>, String> {
    let source = profile.cookies_db();
    if !source.is_file() {
        return Err("cookie database is missing".to_string());
    }
    let staged = stage_database_copy(&source, profile.browser)?;
    let result = match profile.kind {
        BrowserKind::Chromium => read_chromium_session_cookies(&staged, profile),
        BrowserKind::Firefox => read_firefox_session_cookies(&staged),
    };
    let _ = std::fs::remove_file(&staged);
    result
}

fn query_cookie_rows(staged: &Path, kind: BrowserKind) -> Result<Vec<(String, String, Vec<u8>, String)>, String> {
    // Firefox has no encrypted column and names its host column `host`;
    // Chromium has both `encrypted_value` and `host_key`.
    let sql = match kind {
        BrowserKind::Chromium => "SELECT name, value, encrypted_value, host_key FROM cookies",
        BrowserKind::Firefox => "SELECT name, value, zeroblob(0), host FROM moz_cookies",
    };
    let connection = rusqlite::Connection::open(staged)
        .map_err(|error| format!("cookie database open failed: {error}"))?;
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("cookie query prepare failed: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let value: String = row.get(1)?;
            let encrypted: Vec<u8> = row.get(2)?;
            let host: String = row.get(3)?;
            Ok((name, value, encrypted, host))
        })
        .map_err(|error| format!("cookie query failed: {error}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|error| format!("cookie row read failed: {error}"))?);
    }
    Ok(out)
}

fn read_chromium_session_cookies(
    staged: &Path,
    profile: &BrowserProfile,
) -> Result<Vec<SessionCookie>, String> {
    let local_state = profile
        .local_state()
        .filter(|path| path.is_file())
        .ok_or_else(|| "browser Local State is missing".to_string())?;
    let key = chromium_cookie_key(&local_state)?;
    let mut session = Vec::new();
    for (name, value, encrypted, host) in query_cookie_rows(&staged, profile.kind)? {
        if !is_session_host(&host) || name.trim().is_empty() {
            continue;
        }
        // Plaintext value with no encrypted payload is already usable.
        if !value.is_empty() && encrypted.len() <= 3 {
            session.push(SessionCookie { name, value });
            continue;
        }
        if let Some(decrypted) = decrypt_chromium_value(&key, &encrypted) {
            if let Ok(text) = String::from_utf8(decrypted) {
                if !text.is_empty() {
                    session.push(SessionCookie { name, value: text });
                }
            }
        }
    }
    Ok(session)
}

fn read_firefox_session_cookies(staged: &Path) -> Result<Vec<SessionCookie>, String> {
    let mut session = Vec::new();
    for (name, value, _encrypted, host) in query_cookie_rows(&staged, BrowserKind::Firefox)? {
        if !is_session_host(&host) || name.trim().is_empty() || value.is_empty() {
            continue;
        }
        session.push(SessionCookie { name, value });
    }
    Ok(session)
}

/// Diagnostic classes for the probe: how far each session cookie got.
/// Names and values never leave this function — only class counts.
#[cfg(test)]
pub(crate) fn probe_decrypt_breakdown(
    profile: &BrowserProfile,
) -> Result<(usize, std::collections::HashMap<String, usize>, std::collections::HashMap<String, usize>), String> {
    use std::collections::HashMap;
    let source = profile.cookies_db();
    if !source.is_file() {
        return Err("cookie database is missing".to_string());
    }
    let staged = stage_database_copy(&source, profile.browser)?;
    let result = (|| {
        let mut key_len = 0usize;
        let mut key = Vec::new();
        if profile.kind == BrowserKind::Chromium {
            if let Some(local_state) = profile.local_state().filter(|path| path.is_file()) {
                if let Ok(unwrapped) = chromium_cookie_key(&local_state) {
                    key_len = unwrapped.len();
                    key = unwrapped;
                }
            }
        }
        let mut prefixes: HashMap<String, usize> = HashMap::new();
        let mut outcomes: HashMap<String, usize> = HashMap::new();
        for (name, value, encrypted, host) in query_cookie_rows(&staged, profile.kind)? {
            if !is_session_host(&host) || name.trim().is_empty() {
                continue;
            }
            if !value.is_empty() && encrypted.len() <= 3 {
                *outcomes.entry("plaintext".to_string()).or_insert(0) += 1;
                continue;
            }
            let prefix = String::from_utf8_lossy(&encrypted[..encrypted.len().min(3)]).into_owned();
            *prefixes.entry(prefix).or_insert(0) += 1;
            if profile.kind != BrowserKind::Chromium {
                *outcomes.entry("non_chromium_blob".to_string()).or_insert(0) += 1;
                continue;
            }
            match decrypt_chromium_value(&key, &encrypted) {
                Some(bytes) => {
                    *outcomes.entry(if String::from_utf8(bytes).map(|t| !t.is_empty()).unwrap_or(false) {
                        "decrypt_ok"
                    } else {
                        "decrypt_empty_or_binary"
                    }.to_string()).or_insert(0) += 1;
                }
                None => {
                    *outcomes.entry("decrypt_rejected".to_string()).or_insert(0) += 1;
                }
            }
        }
        Ok((key_len, prefixes, outcomes))
    })();
    let _ = std::fs::remove_file(&staged);
    result
}
#[cfg(test)]
pub(crate) fn probe_cookie_counts(
    profile: &BrowserProfile,
) -> Result<(usize, usize, Vec<(&'static str, usize)>), String> {
    let source = profile.cookies_db();
    if !source.is_file() {
        return Err("cookie database is missing".to_string());
    }
    let staged = stage_database_copy(&source, profile.browser)?;
    let result = (|| {
        let sql_total = match profile.kind {
            BrowserKind::Chromium => "SELECT COUNT(*) FROM cookies",
            BrowserKind::Firefox => "SELECT COUNT(*) FROM moz_cookies",
        };
        let connection = rusqlite::Connection::open(&staged)
            .map_err(|error| format!("cookie database open failed: {error}"))?;
        let total: usize = connection
            .query_row(sql_total, [], |row| row.get(0))
            .map_err(|error| format!("cookie count failed: {error}"))?;
        let mut session_total = 0usize;
        let mut per_host = Vec::new();
        for host in [
            ".youtube.com",
            "youtube.com",
            ".music.youtube.com",
            "music.youtube.com",
            ".google.com",
            "google.com",
            ".accounts.google.com",
        ] {
            let sql = match profile.kind {
                BrowserKind::Chromium => "SELECT COUNT(*) FROM cookies WHERE host_key = ?1",
                BrowserKind::Firefox => "SELECT COUNT(*) FROM moz_cookies WHERE host = ?1",
            };
            let count: usize = connection
                .query_row(sql, [host], |row| row.get(0))
                .unwrap_or(0);
            session_total += count;
            per_host.push((host, count));
        }
        Ok((total, session_total, per_host))
    })();
    let _ = std::fs::remove_file(&staged);
    result
}

/// The AES key behind Chromium's cookie encryption, DPAPI-unwrapped.
///
/// `Local State` holds it base64-encoded with a 5-byte `DPAPI` prefix; unwrapping
/// needs no privileges beyond being the same user. Windows-only for now: macOS keeps
/// it in the login keychain and Linux in a keyring backend, both reachable later
/// through the `keyring` crate this app already ships.
#[cfg(target_os = "windows")]
fn chromium_cookie_key(local_state: &Path) -> Result<Vec<u8>, String> {
    let text =
        std::fs::read_to_string(local_state).map_err(|error| format!("Local State read failed: {error}"))?;
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Local State parse failed: {error}"))?;
    let encoded = parsed
        .pointer("/os_crypt/encrypted_key")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Local State carries no cookie key".to_string())?;
    use base64::Engine;
    let mut protected = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("cookie key decode failed: {error}"))?;
    // The `DPAPI` prefix marks a classic user-DPAPI blob. Chrome's newer app-bound
    // encryption keeps the same prefix but unwraps to a key that decrypts nothing —
    // that failure surfaces per-cookie below, where it belongs, rather than here.
    const DPAPI_PREFIX: &[u8] = b"DPAPI";
    if protected.starts_with(DPAPI_PREFIX) {
        protected.drain(..DPAPI_PREFIX.len());
    }
    dpapi_unprotect(&protected)
}

#[cfg(not(target_os = "windows"))]
fn chromium_cookie_key(_local_state: &Path) -> Result<Vec<u8>, String> {
    Err("browser key unwrap is Windows-only for now".to_string())
}

/// Reverses Windows DPAPI user-scope protection. Same user, no elevation.
#[cfg(target_os = "windows")]
fn dpapi_unprotect(protected: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|error| format!("DPAPI unwrap failed: {error}"))?;
        if output.pbData.is_null() || output.cbData == 0 {
            return Err("DPAPI unwrap returned no bytes".to_string());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut std::ffi::c_void)));
        Ok(bytes)
    }
}

/// Decrypts one Chromium cookie value. `None` means "cannot", never "empty".
///
/// Format is a 3-byte version tag + 12-byte nonce + ciphertext with a 16-byte GCM
/// tag. `v10`/`v11` are the classic DPAPI-keyed blobs; `v20` is accepted on the same
/// layout and proven by the cipher itself — AES-GCM authentication cannot false
/// positive, so a success is definitive and a failure just falls through to `None`.
/// Anything else is passed through untouched by the caller when it already carries
/// a plaintext value.
fn decrypt_chromium_value(key: &[u8], blob: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};

    if blob.len() < 3 + 12 + 16 || key.len() != 32 {
        return None;
    }
    if &blob[..3] != b"v10" && &blob[..3] != b"v11" && &blob[..3] != b"v20" {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let (nonce_bytes, ciphertext) = blob[3..].split_at(12);
    cipher.decrypt(Nonce::from_slice(nonce_bytes), ciphertext).ok()
}

#[cfg(test)]
mod browser_cookie_probe {
    //! Live probe: walks this machine's real browser profiles and reports, per
    //! profile, which session cookies exist and decrypt — by NAME and COUNT only.
    //! Values never reach a log line, a snapshot, or an assertion message.
    //!
    //! Run explicitly: `cargo test browser_cookie_probe -- --nocapture`.
    //! Informational by design: a machine with no browsers reports that instead
    //! of failing, because there is nothing to import there.

    use super::{decrypt_chromium_value, detect_browser_profiles, is_session_host, probe_cookie_counts, probe_decrypt_breakdown, read_session_cookies};

    #[test]
    fn live_browser_stores_report_names_and_counts_only() {
        let profiles = detect_browser_profiles();
        eprintln!("[probe] detected {} browser profile(s)", profiles.len());
        if profiles.is_empty() {
            eprintln!("[probe] no browser profiles on disk; nothing to import");
            return;
        }

        // Sanity on the pure helpers, independent of whatever browsers exist.
        assert!(is_session_host("music.youtube.com"));
        assert!(is_session_host(".youtube.com"));
        assert!(!is_session_host("notyoutube.com"));
        assert!(is_session_host("accounts.google.com"));
        assert!(decrypt_chromium_value(&[0u8; 32], b"short").is_none());
        assert!(decrypt_chromium_value(&[0u8; 16], &[b'v', b'1', b'0']).is_none());
        let mut undersized = vec![b'v', b'1', b'0'];
        undersized.extend([0u8; 28]);
        assert!(decrypt_chromium_value(&[0u8; 32], &undersized).is_none());

        for profile in &profiles {
            match probe_cookie_counts(profile) {
                Ok((total, session_total, per_host)) => {
                    let hosts: Vec<String> =
                        per_host.iter().map(|(host, count)| format!("{host}={count}")).collect();
                    eprintln!(
                        "[probe] {} / {} : total={} session={} {}",
                        profile.browser,
                        profile.profile_name,
                        total,
                        session_total,
                        hosts.join(" ")
                    );
                }
                Err(error) => {
                    eprintln!("[probe] {} / {} : counts failed: {}", profile.browser, profile.profile_name, error);
                }
            }
            let outcome = read_session_cookies(profile);
            if let Ok((key_len, prefixes, outcomes)) = probe_decrypt_breakdown(profile) {
                eprintln!(
                    "[probe] {} / {} : key_len={} prefixes={:?} outcomes={:?}",
                    profile.browser, profile.profile_name, key_len, prefixes, outcomes
                );
            }
            match outcome {
                Ok(cookies) => {
                    let mut names: Vec<&str> = cookies.iter().map(|cookie| cookie.name.as_str()).collect();
                    names.sort_unstable();
                    let has_sapisid = names.iter().any(|name| *name == "SAPISID" || *name == "__Secure-3PAPISID");
                    eprintln!(
                        "[probe] {} / {} : db ok, {} session cookie(s), names=[{}], has_sapisid={}",
                        profile.browser,
                        profile.profile_name,
                        names.len(),
                        names.join(","),
                        has_sapisid,
                    );
                }
                Err(error) => {
                    eprintln!(
                        "[probe] {} / {} : {}",
                        profile.browser, profile.profile_name, error
                    );
                }
            }
        }
    }
}
