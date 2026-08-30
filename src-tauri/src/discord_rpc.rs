use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const DISCORD_CLIENT_ID: &str = "1515682467154100344";
const GITHUB_REPO: &str = "https://github.com/Pant0x/Amber-Music-Platform";
/// Asset key for the Amber logo uploaded to Discord Developer Portal
/// Upload assets/img/discordlogo-W.png (white version for dark theme) with key "amber-logo"
const AMBER_LOGO_ASSET_KEY: &str = "amber-logo";

/// How often to refresh presence while playing (Discord runs its own clock but
/// periodic updates keep the connection alive and handle edge cases).
const PRESENCE_REFRESH_INTERVAL_MS: u64 = 30_000;

/// How long to wait before retrying a failed connection (milliseconds).
const RECONNECT_DELAY_MS: u64 = 5_000;

/// Maximum number of consecutive reconnection attempts before giving up.
const MAX_RECONNECT_ATTEMPTS: u32 = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscordPresenceData {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork_url: Option<String>,
    pub song_url: Option<String>,
    pub artist_url: Option<String>,
    pub album_url: Option<String>,
    pub duration: u64,
    pub current_time: u64,
    pub is_playing: bool,
}

pub struct DiscordRpcManager {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
    connected: Arc<Mutex<bool>>,
    reconnect_attempts: Arc<Mutex<u32>>,
    last_presence: Arc<Mutex<Option<DiscordPresenceData>>>,
    refresh_task_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    shutdown: Arc<Mutex<bool>>,
}

impl DiscordRpcManager {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            connected: Arc::new(Mutex::new(false)),
            reconnect_attempts: Arc::new(Mutex::new(0)),
            last_presence: Arc::new(Mutex::new(None)),
            refresh_task_handle: Arc::new(Mutex::new(None)),
            shutdown: Arc::new(Mutex::new(false)),
        }
    }

    /// Initialize Discord RPC connection
    pub fn connect(&self) -> Result<(), String> {
        let mut client_lock = self.client.lock().map_err(|e| e.to_string())?;

        if client_lock.is_some() {
            return Ok(());
        }

        match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
            Ok(mut client) => {
                if let Err(e) = client.connect() {
                    return Err(format!("Failed to connect to Discord: {}", e));
                }
                *client_lock = Some(client);
                let mut connected = self.connected.lock().map_err(|e| e.to_string())?;
                *connected = true;
                let mut attempts = self.reconnect_attempts.lock().map_err(|e| e.to_string())?;
                *attempts = 0;
                Ok(())
            }
            Err(e) => Err(format!("Failed to create Discord client: {}", e)),
        }
    }

    /// Update Discord presence with current track info
    pub fn update_presence(&self, data: DiscordPresenceData) -> Result<(), String> {
        // If not playing, hide activity completely (exactly like Spotify)
        if !data.is_playing {
            return self.clear_presence();
        }

        // Store the latest presence for reconnection/retry purposes
        {
            let mut last = self.last_presence.lock().map_err(|e| e.to_string())?;
            *last = Some(data.clone());
        }

        // Ensure connection exists
        if !*self.connected.lock().map_err(|e| e.to_string())? {
            if let Err(e) = self.connect() {
                eprintln!("[Discord RPC] Failed to reconnect: {}", e);
                return Ok(()); // Silent failure - Discord might not be running
            }
        }

        let mut client_lock = self.client.lock().map_err(|e| e.to_string())?;

        let client = client_lock
            .as_mut()
            .ok_or("Discord client not initialized")?;

        // Calculate progress timestamps
        let elapsed = data.current_time;
        let duration = data.duration;

        let state_str = data.artist.clone();

        let artwork_image = data.artwork_url.clone();
        let artwork_key = artwork_image.as_deref().unwrap_or(AMBER_LOGO_ASSET_KEY);

        let large_text_str = if !data.album.trim().is_empty() {
            data.album.clone()
        } else {
            "Amber".to_string()
        };

        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let start_ts = now_secs - elapsed as i64;
        let end_ts = start_ts + duration as i64;

        // Activity name: "Amber" so Discord shows "Listening to Amber"
        let activity_name = "Amber".to_string();

        let mut activity = json!({
            "name": activity_name,
            "type": 2, // LISTENING
            "details": data.title,
            "state": state_str,
            "assets": {
                "large_image": artwork_key,
                "large_text": large_text_str,
            },
            "buttons": [
                {
                    "label": "Listen on Amber",
                    "url": GITHUB_REPO,
                }
            ],
        });

        // Track URL button - primary action
        if let Some(song_url) = data.song_url {
            if let Some(buttons) = activity["buttons"].as_array_mut() {
                buttons[0] = json!({
                    "label": "Listen on Amber",
                    "url": song_url,
                });
            }
        }

        // Artist URL on state click
        if let Some(artist_url) = data.artist_url {
            activity["state_url"] = json!(artist_url);
        }

        // Album URL on artwork click
        if let Some(album_url) = data.album_url {
            activity["assets"]["large_url"] = json!(album_url);
        }

        // Timestamps only while playing - Discord runs its own clock
        if duration > 0 && data.is_playing {
            activity["timestamps"] = json!({
                "start": start_ts,
                "end": end_ts,
            });
        }

        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": std::process::id(),
                "activity": activity,
            },
            "nonce": format!("jamc-{}-{}", std::process::id(), start_ts),
        });

        if let Err(e) = client.send(payload, 1) {
            eprintln!("[Discord RPC] Failed to set activity: {}", e);
            *client_lock = None;
            if let Ok(mut connected) = self.connected.lock() {
                *connected = false;
            }
            // Schedule reconnection attempt
            self.schedule_reconnect();
        }

        Ok(())
    }

    /// Clear presence (show idle)
    pub fn clear_presence(&self) -> Result<(), String> {
        if !*self.connected.lock().map_err(|e| e.to_string())? {
            return Ok(());
        }

        let mut client_lock = self.client.lock().map_err(|e| e.to_string())?;
        let client = client_lock
            .as_mut()
            .ok_or("Discord client not initialized")?;

        if let Err(e) = client.clear_activity() {
            eprintln!("[Discord RPC] Failed to clear activity: {}", e);
            *client_lock = None;
            if let Ok(mut connected) = self.connected.lock() {
                *connected = false;
            }
        }

        // Clear stored presence
        let mut last = self.last_presence.lock().map_err(|e| e.to_string())?;
        *last = None;

        Ok(())
    }

    /// Pause presence - clears activity so it disappears like Spotify
    pub fn pause_presence(&self) -> Result<(), String> {
        self.clear_presence()
    }

    /// Resume presence - restores timestamps for progress bar
    pub fn resume_presence(&self) -> Result<(), String> {
        let last = {
            let last_lock = self.last_presence.lock().map_err(|e| e.to_string())?;
            last_lock.clone()
        };

        if let Some(mut data) = last {
            data.is_playing = true;
            self.update_presence(data)
        } else {
            Ok(())
        }
    }

    /// Schedule a reconnection attempt with exponential backoff
    fn schedule_reconnect(&self) {
        let mut attempts = match self.reconnect_attempts.lock() {
            Ok(lock) => lock,
            Err(_) => return,
        };

        if *attempts >= MAX_RECONNECT_ATTEMPTS {
            eprintln!("[Discord RPC] Max reconnection attempts reached, giving up");
            return;
        }

        *attempts += 1;
        let attempt = *attempts;
        let delay = RECONNECT_DELAY_MS * (2u64.saturating_pow(attempt.saturating_sub(1)));

        let client = self.client.clone();
        let connected = self.connected.clone();
        let reconnect_attempts = self.reconnect_attempts.clone();
        let last_presence = self.last_presence.clone();
        let shutdown = self.shutdown.clone();

        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(delay));

            // Check if shutdown was requested
            if *shutdown.lock().unwrap_or_else(|_| panic!("shutdown lock poisoned")) {
                return;
            }

            eprintln!("[Discord RPC] Attempting reconnection (attempt {})", attempt);

            let mut client_lock = match client.lock() {
                Ok(lock) => lock,
                Err(_) => return,
            };

            match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
                Ok(mut new_client) => {
                    if let Err(e) = new_client.connect() {
                        eprintln!("[Discord RPC] Reconnection failed: {}", e);
                        if let Ok(mut attempts) = reconnect_attempts.lock() {
                            *attempts = attempt; // Keep current attempt count
                        }
                        return;
                    }

                    *client_lock = Some(new_client);
                    if let Ok(mut conn) = connected.lock() {
                        *conn = true;
                    }
                    if let Ok(mut attempts) = reconnect_attempts.lock() {
                        *attempts = 0;
                    }

                    eprintln!("[Discord RPC] Reconnection successful");

                    // Re-send last known presence
                    if let Ok(last_lock) = last_presence.lock() {
                        if let Some(presence) = last_lock.as_ref() {
                            // Use a temporary manager to call update_presence
                            let temp_manager = DiscordRpcManager {
                                client: client.clone(),
                                connected: connected.clone(),
                                reconnect_attempts: reconnect_attempts.clone(),
                                last_presence: last_presence.clone(),
                                refresh_task_handle: Arc::new(Mutex::new(None)),
                                shutdown: shutdown.clone(),
                            };
                            let _ = temp_manager.update_presence(presence.clone());
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[Discord RPC] Failed to create client for reconnection: {}", e);
                    if let Ok(mut attempts) = reconnect_attempts.lock() {
                        *attempts = attempt;
                    }
                }
            }
        });
    }

    /// Start periodic presence refresh while playing
    pub fn start_periodic_refresh(&self) {
        let mut handle_lock = self.refresh_task_handle.lock().unwrap();
        if handle_lock.is_some() {
            return; // Already running
        }

        let client = self.client.clone();
        let connected = self.connected.clone();
        let last_presence = self.last_presence.clone();
        let shutdown = self.shutdown.clone();

        let handle = std::thread::spawn(move || {
            while !*shutdown.lock().unwrap_or_else(|_| panic!("shutdown lock poisoned")) {
                std::thread::sleep(std::time::Duration::from_millis(PRESENCE_REFRESH_INTERVAL_MS));

                if *shutdown.lock().unwrap_or_else(|_| panic!("shutdown lock poisoned")) {
                    break;
                }

                // Only refresh if connected and playing
                let is_connected = *connected.lock().unwrap_or_else(|_| panic!("connected lock poisoned"));
                if !is_connected {
                    continue;
                }

                let presence = match last_presence.lock() {
                    Ok(lock) => lock.clone(),
                    Err(_) => continue,
                };

                if let Some(data) = presence {
                    if data.is_playing && data.duration > 0 {
                        let mut client_lock = match client.lock() {
                            Ok(lock) => lock,
                            Err(_) => continue,
                        };

                        if let Some(client) = client_lock.as_mut() {
                            // Re-send the same activity to keep connection alive
                            let elapsed = data.current_time;
                            let duration = data.duration;
                            let now_secs = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs() as i64;
                            let start_ts = now_secs - elapsed as i64;
                            let end_ts = start_ts + duration as i64;

                            let state_str = data.artist.clone();
                            let artwork_key = data.artwork_url.as_deref().unwrap_or(AMBER_LOGO_ASSET_KEY);
                            let large_text_str = if !data.album.trim().is_empty() {
                                format!("{} • {}", data.album, data.artist)
                            } else {
                                format!("{} • Amber", data.title)
                            };
                            let activity_name = "Amber".to_string();

                            let mut activity = json!({
                                "name": activity_name,
                                "type": 2,
                                "details": data.title,
                                "state": state_str,
                                "assets": {
                                    "large_image": artwork_key,
                                    "large_text": large_text_str,
                                },
                                "buttons": [
                                    {
                                        "label": "Listen on Amber",
                                        "url": data.song_url.as_deref().unwrap_or(GITHUB_REPO),
                                    }
                                ],
                            });

                            if let Some(artist_url) = data.artist_url {
                                activity["state_url"] = json!(artist_url);
                            }
                            if let Some(album_url) = data.album_url {
                                activity["assets"]["large_url"] = json!(album_url);
                            }
                            if let Some(song_url) = data.song_url {
                                activity["details_url"] = json!(song_url);
                            }

                            activity["timestamps"] = json!({
                                "start": start_ts,
                                "end": end_ts,
                            });

                            let payload = json!({
                                "cmd": "SET_ACTIVITY",
                                "args": {
                                    "pid": std::process::id(),
                                    "activity": activity,
                                },
                                "nonce": format!("jamc-{}-{}", std::process::id(), start_ts),
                            });

                            if let Err(e) = client.send(payload, 1) {
                                eprintln!("[Discord RPC] Periodic refresh failed: {}", e);
                                *client_lock = None;
                                if let Ok(mut conn) = connected.lock() {
                                    *conn = false;
                                }
                                break; // Exit refresh loop, reconnection will be handled by update_presence
                            }
                        }
                    }
                }
            }
        });

        *handle_lock = Some(handle);
    }

    /// Stop periodic refresh
    pub fn stop_periodic_refresh(&self) {
        let mut handle_lock = self.refresh_task_handle.lock().unwrap();
        if let Some(handle) = handle_lock.take() {
            let _ = handle.join();
        }
    }

    /// Shutdown - clean up all resources
    pub fn shutdown(&self) {
        *self.shutdown.lock().unwrap_or_else(|_| panic!("shutdown lock poisoned")) = true;
        self.stop_periodic_refresh();
        let _ = self.clear_presence();
        let _ = self.client.lock().map(|mut c| c.take());
        *self.connected.lock().unwrap_or_else(|_| panic!("connected lock poisoned")) = false;
    }
}

impl Default for DiscordRpcManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for DiscordRpcManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discord_rpc_manager_creation() {
        let manager = DiscordRpcManager::new();
        assert!(!*manager.connected.lock().unwrap());
    }
}