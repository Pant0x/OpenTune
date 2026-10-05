use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
#[cfg(target_os = "windows")]
use base64::Engine;
#[cfg(target_os = "windows")]
use rusqlite::Connection;

#[cfg(target_os = "windows")]
#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[cfg(target_os = "windows")]
#[link(name = "crypt32")]
extern "system" {
    fn CryptUnprotectData(
        p_data_in: *const DataBlob,
        ppsz_data_descr: *mut *mut u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *const std::ffi::c_void,
        p_prompt_struct: *const std::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut DataBlob,
    ) -> i32;
    fn LocalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let in_blob = DataBlob {
        cb_data: encrypted.len() as u32,
        pb_data: encrypted.as_ptr() as *mut u8,
    };
    let mut out_blob = DataBlob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };

    let success = unsafe {
        CryptUnprotectData(
            &in_blob,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut out_blob,
        )
    };

    if success == 0 || out_blob.pb_data.is_null() {
        return Err("CryptUnprotectData failed".to_string());
    }

    let slice = unsafe {
        std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize)
    };
    let result = slice.to_vec();
    unsafe {
        LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
    }
    Ok(result)
}

#[cfg(target_os = "windows")]
fn get_chromium_master_key(local_state_path: &Path) -> Result<Vec<u8>, String> {
    let content = std::fs::read_to_string(local_state_path)
        .map_err(|e| format!("Failed to read Local State: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Local State JSON: {e}"))?;

    let enc_key_b64 = json
        .pointer("/os_crypt/encrypted_key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No os_crypt.encrypted_key found".to_string())?;

    let enc_key_raw = base64::engine::general_purpose::STANDARD
        .decode(enc_key_b64)
        .map_err(|e| format!("Base64 decode failed: {e}"))?;

    if enc_key_raw.len() < 5 || &enc_key_raw[..5] != b"DPAPI" {
        return Err("Invalid DPAPI prefix".to_string());
    }

    let master_key = dpapi_decrypt(&enc_key_raw[5..])?;
    Ok(master_key)
}

#[cfg(target_os = "windows")]
fn decrypt_cookie_value(encrypted_val: &[u8], master_key: &[u8]) -> Option<String> {
    if encrypted_val.is_empty() {
        return None;
    }

    if encrypted_val.starts_with(b"v10") || encrypted_val.starts_with(b"v11") {
        if encrypted_val.len() < 3 + 12 + 16 {
            return None;
        }
        let nonce_bytes = &encrypted_val[3..15];
        let ciphertext = &encrypted_val[15..];

        let cipher = Aes256Gcm::new_from_slice(master_key).ok()?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let decrypted = cipher.decrypt(nonce, ciphertext).ok()?;
        String::from_utf8(decrypted).ok()
    } else {
        // Fallback for older Chromium with raw DPAPI
        let decrypted = dpapi_decrypt(encrypted_val).ok()?;
        String::from_utf8(decrypted).ok()
    }
}

#[cfg(target_os = "windows")]
fn copy_locked_file(src_path: &Path, dst_path: &Path) -> std::io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    let mut src = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(7) // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        .open(src_path)?;
    let mut dst = std::fs::File::create(dst_path)?;
    std::io::copy(&mut src, &mut dst)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn extract_cookies_from_db(db_path: &Path, master_key: &[u8]) -> Result<Vec<(String, String)>, String> {
    let temp_dir = std::env::temp_dir();
    let temp_db = temp_dir.join(format!("opentune_cookies_{}.tmp", rand::random::<u32>()));

    // Copy db file to temporary location to avoid database locks
    copy_locked_file(db_path, &temp_db).map_err(|e| format!("Failed to copy cookies db: {e}"))?;

    // Also copy wal file if exists
    let wal_path = PathBuf::from(format!("{}-wal", db_path.display()));
    let temp_wal = PathBuf::from(format!("{}-wal", temp_db.display()));
    if wal_path.exists() {
        let _ = copy_locked_file(&wal_path, &temp_wal);
    }

    let conn = Connection::open(&temp_db).map_err(|e| {
        let _ = std::fs::remove_file(&temp_db);
        let _ = std::fs::remove_file(&temp_wal);
        format!("Failed to open SQLite db: {e}")
    })?;

    let mut stmt = conn
        .prepare(
            "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%youtube.com' OR host_key LIKE '%google.com'"
        )
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_db);
            let _ = std::fs::remove_file(&temp_wal);
            format!("Prepare query failed: {e}")
        })?;

    let cookie_rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let enc_val: Vec<u8> = row.get(1)?;
            Ok((name, enc_val))
        })
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_db);
            let _ = std::fs::remove_file(&temp_wal);
            format!("Query map failed: {e}")
        })?;

    let mut cookies = Vec::new();
    for row in cookie_rows.flatten() {
        let (name, enc_val) = row;
        if let Some(decrypted) = decrypt_cookie_value(&enc_val, master_key) {
            cookies.push((name, decrypted));
        }
    }

    drop(stmt);
    drop(conn);
    let _ = std::fs::remove_file(&temp_db);
    let _ = std::fs::remove_file(&temp_wal);

    Ok(cookies)
}

#[cfg(target_os = "windows")]
pub fn try_import_youtube_cookies_from_browsers() -> Option<String> {
    let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
    let app_data = std::env::var("APPDATA").unwrap_or_default();

    let mut browser_dirs = vec![
        // Brave Browser (Primary priority)
        PathBuf::from(&local_app_data).join("BraveSoftware\\Brave-Browser\\User Data"),
        // Google Chrome
        PathBuf::from(&local_app_data).join("Google\\Chrome\\User Data"),
        // Microsoft Edge
        PathBuf::from(&local_app_data).join("Microsoft\\Edge\\User Data"),
        // Vivaldi
        PathBuf::from(&local_app_data).join("Vivaldi\\User Data"),
    ];

    if !app_data.is_empty() {
        // Opera & Opera GX
        browser_dirs.push(PathBuf::from(&app_data).join("Opera Software\\Opera Stable"));
        browser_dirs.push(PathBuf::from(&app_data).join("Opera Software\\Opera GX Stable"));
    }

    for user_data_dir in browser_dirs {
        if !user_data_dir.exists() {
            continue;
        }

        let local_state = user_data_dir.join("Local State");
        if !local_state.exists() {
            continue;
        }

        let Ok(master_key) = get_chromium_master_key(&local_state) else {
            continue;
        };

        // Try profiles: Default, Profile 1, Profile 2, etc., and directory itself (Opera)
        let mut profile_candidates = vec![user_data_dir.join("Default"), user_data_dir.clone()];
        if let Ok(entries) = std::fs::read_dir(&user_data_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("Profile ") {
                    profile_candidates.push(entry.path());
                }
            }
        }

        for profile_dir in profile_candidates {
            let cookie_candidates = vec![
                profile_dir.join("Network\\Cookies"),
                profile_dir.join("Cookies"),
            ];

            for cookie_path in cookie_candidates {
                if !cookie_path.exists() {
                    continue;
                }

                if let Ok(cookies) = extract_cookies_from_db(&cookie_path, &master_key) {
                    let has_auth = cookies.iter().any(|(name, _)| {
                        name == "SAPISID" || name == "__Secure-1PAPISID" || name == "__Secure-3PAPISID"
                    });

                    if has_auth {
                        let mut map = std::collections::BTreeMap::new();
                        for (k, v) in cookies {
                            map.insert(k, v);
                        }
                        let cookie_header = map
                            .iter()
                            .map(|(k, v)| format!("{k}={v}"))
                            .collect::<Vec<_>>()
                            .join("; ");

                        eprintln!(
                            "[internal][tauri][info] Successfully auto-imported YouTube cookies from {:?}",
                            cookie_path
                        );
                        return Some(cookie_header);
                    }
                }
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
pub fn try_import_youtube_cookies_from_browsers() -> Option<String> {
    None
}
