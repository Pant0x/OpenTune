use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const DISCORD_CLIENT_ID: &str = "1515682467154100344";
/// Asset key for the OpenTune logo uploaded to Discord Developer Portal
/// Upload assets/img/discordlogo-W.png (white version for dark theme) with key "opentune-logo"
const OPENTUNE_LOGO_ASSET_KEY: &str = "opentune-logo";


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
        let artwork_key = artwork_image.as_deref().unwrap_or(OPENTUNE_LOGO_ASSET_KEY);

        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let start_ts = now_secs - elapsed as i64;
        let end_ts = start_ts + duration as i64;

        let mut assets_map = serde_json::Map::new();
        assets_map.insert("large_image".to_string(), json!(artwork_key));
        if !data.album.is_empty() {
            assets_map.insert("large_text".to_string(), json!(data.album));
        }
        assets_map.insert("small_image".to_string(), json!(OPENTUNE_LOGO_ASSET_KEY));
        assets_map.insert("small_text".to_string(), json!("OpenTune"));

        let mut activity = json!({
            "name": "OpenTune",
            "type": 2, // LISTENING
            "details": data.title,
            "state": state_str,
            "assets": assets_map,
        });

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

    /// Pause presence - clears activity so it disappears like Spotify, but keeps last_presence for resume
    pub fn pause_presence(&self) -> Result<(), String> {
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

        Ok(())
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

    /// Discord manages its own internal clock accurately between start and end timestamps.
    /// Resending static current_time snapshots caused Discord playback progress to continuously reset.
    pub fn start_periodic_refresh(&self) {
        // No-op: activity timestamps are pushed on play, seek, and track change directly from frontend.
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