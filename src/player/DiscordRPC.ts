import { invoke } from "@tauri-apps/api/core";
import { logInternalDebug, logInternalWarn } from "../internal/logging";
import {
  getDiscordPresenceEnabled,
  setDiscordPresenceEnabled,
} from "../ui/settings/discord";

export interface DiscordPresenceData {
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  songUrl?: string;
  artistUrl?: string;
  albumUrl?: string;
  duration: number; // in seconds
  currentTime: number; // in seconds
  isPlaying: boolean;
}

const DISCORD_TEXT_LIMIT = 128;
const DISCORD_ASSET_URL_LIMIT = 1024;
const TRUSTED_PRESENCE_LINK_HOSTS = new Set([
  "music.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "github.com",
]);

function sanitizeDiscordText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= DISCORD_TEXT_LIMIT) return text;
  return `${text.slice(0, DISCORD_TEXT_LIMIT - 3)}...`;
}

function sanitizeArtworkUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    const url = parsed.toString();
    if (url.length > DISCORD_ASSET_URL_LIMIT) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function sanitizePresenceLink(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    if (!TRUSTED_PRESENCE_LINK_HOSTS.has(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Identity of a presence payload for dedupe purposes — everything but `currentTime`. */
export function presenceDedupeKey(data: DiscordPresenceData): string {
  const { currentTime: _currentTime, ...rest } = data;
  return JSON.stringify(rest);
}

function sanitizePresenceData(data: DiscordPresenceData): DiscordPresenceData {
  return {
    title: sanitizeDiscordText(data.title),
    artist: sanitizeDiscordText(data.artist),
    album: sanitizeDiscordText(data.album),
    artworkUrl: sanitizeArtworkUrl(data.artworkUrl),
    songUrl: sanitizePresenceLink(data.songUrl),
    artistUrl: sanitizePresenceLink(data.artistUrl),
    albumUrl: sanitizePresenceLink(data.albumUrl),
    duration: Math.max(0, Math.floor(Number.isFinite(data.duration) ? data.duration : 0)),
    currentTime: Math.max(0, Math.floor(Number.isFinite(data.currentTime) ? data.currentTime : 0)),
    isPlaying: data.isPlaying,
  };
}

/**
 * Manages Discord Rich Presence integration
 * Calls Tauri commands that handle the actual Discord connection in Rust
 */
export class DiscordRpcService {
  private static isInitialized = false;
  private static isShuttingDown = false;
  private static currentTrackData: DiscordPresenceData | null = null;
  private static presenceUpdateInterval: number | null = null;
  private static lastUpdateTime = 0;

  /**
   * Read per call rather than cached, so toggling the setting takes effect on the next track
   * update without anything having to notify this service.
   */
  private static get isEnabled(): boolean {
    return getDiscordPresenceEnabled();
  }

  /**
   * The last payload actually sent, everything but `currentTime`.
   *
   * `PlayerController.emit()` fires on every state change — a queue reorder, a rate change, a
   * sleep timer — most of which leave the track and play state untouched. Discord runs its own
   * clock off the timestamps `discord_rpc.rs` derives from `currentTime`, so it never needed
   * repolling either; comparing on everything else and always excluding `currentTime` is what
   * turns those into no-ops instead of a fresh IPC round trip (and a jittered progress bar) on
   * every unrelated change.
   */
  private static lastSentKey: string | null = null;

  /**
   * Initialize Discord RPC
   * The actual connection happens on the Rust backend
   */
  static async init(): Promise<void> {
    if (this.isInitialized && !this.isShuttingDown) {
      logInternalDebug("Discord.init", { message: "Already initialized" });
      return;
    }

    this.isShuttingDown = false;

    if (!this.isEnabled) {
      logInternalDebug("Discord.init", { message: "Discord presence disabled in settings" });
      return;
    }

    try {
      logInternalDebug("Discord.init", { message: "Initializing Discord RPC connection" });
      await invoke("discord_rpc_init");
      this.isInitialized = true;
      logInternalDebug("Discord.init.success", {});
    } catch (error) {
      // Discord might not be running - this is expected and not an error
      logInternalWarn("Discord.init.connectionFailed", error as Record<string, unknown>);
      this.isInitialized = false;
    }
  }

  /**
   * Stops publishing presence and wipes whatever is already showing.
   *
   * Turning the setting off has to clear as well as stop: presence persists on Discord's side
   * until something replaces it, so without this the last track stays on the user's profile
   * indefinitely — the opposite of what switching it off is asking for.
   */
  static async setEnabled(enabled: boolean): Promise<void> {
    setDiscordPresenceEnabled(enabled);
    if (enabled) {
      try {
        await invoke("discord_rpc_init");
        this.isInitialized = true;
        logInternalDebug("Discord.setEnabled initialized connection", {});
      } catch (error) {
        logInternalWarn("Discord.setEnabled.initFailed", error as Record<string, unknown>);
        this.isInitialized = false;
      }
      return;
    }

    try {
      await invoke("discord_rpc_clear");
      await this.stopPeriodicUpdates();
      this.lastSentKey = null;
      this.currentTrackData = null;
      this.isInitialized = false;
      logInternalDebug("Discord.setEnabled cleared presence", {});
    } catch (error) {
      logInternalWarn("Discord.setEnabled.clearFailed", error as Record<string, unknown>);
    }
  }

  /**
   * Update Discord presence with current track information
   * @param data The current track and playback information
   */
  static async updatePresence(data: DiscordPresenceData): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const safeData = sanitizePresenceData(data);
    const nextKey = presenceDedupeKey(safeData);
    if (nextKey === this.lastSentKey) return;

    // Store current track data for pause/resume operations
    this.currentTrackData = safeData;

    try {
      logInternalDebug("Discord.updatePresence", {
        title: safeData.title,
        artist: safeData.artist,
        isPlaying: safeData.isPlaying,
      });

      // Call Tauri command to update presence in Rust backend
      await invoke("discord_rpc_update", {
        title: safeData.title,
        artist: safeData.artist,
        album: safeData.album,
        artworkUrl: safeData.artworkUrl,
        songUrl: safeData.songUrl,
        artistUrl: safeData.artistUrl,
        albumUrl: safeData.albumUrl,
        duration: safeData.duration,
        currentTime: safeData.currentTime,
        isPlaying: safeData.isPlaying,
      });

      this.lastSentKey = nextKey;
      this.lastUpdateTime = Date.now();
      logInternalDebug("Discord.updatePresence.success", {});
    } catch (error) {
      logInternalWarn("Discord.updatePresence.failed", error as Record<string, unknown>);
      // Connection might have been lost, will be re-established on next call
      this.isInitialized = false;
    }
  }

  /**
   * Pause Discord presence - removes timestamps so progress bar stops
   * This is called when playback is paused
   */
  static async pausePlayback(): Promise<void> {
    if (!this.isEnabled || !this.currentTrackData) {
      return;
    }

    try {
      logInternalDebug("Discord.pausePlayback", {});
      await invoke("discord_rpc_pause");
      // Update local state
      this.currentTrackData = { ...this.currentTrackData, isPlaying: false };
      await this.stopPeriodicUpdates();
      logInternalDebug("Discord.pausePlayback.success", {});
    } catch (error) {
      logInternalWarn("Discord.pausePlayback.failed", error as Record<string, unknown>);
    }
  }

  /**
   * Resume Discord presence - restores timestamps for progress bar
   * This is called when playback resumes
   */
  static async resumePlayback(): Promise<void> {
    if (!this.isEnabled || !this.currentTrackData) {
      return;
    }

    try {
      logInternalDebug("Discord.resumePlayback", {});
      await invoke("discord_rpc_resume");
      // Update local state
      this.currentTrackData = { ...this.currentTrackData, isPlaying: true };
      this.lastSentKey = null; // Force resend on next update
      logInternalDebug("Discord.resumePlayback.success", {});
    } catch (error) {
      logInternalWarn("Discord.resumePlayback.failed", error as Record<string, unknown>);
    }
  }

  /**
   * Toggle playback state (pause/resume)
   */
  static async togglePlayback(isPlaying: boolean): Promise<void> {
    if (isPlaying) {
      await this.resumePlayback();
    } else {
      await this.pausePlayback();
    }
  }

  /**
   * Clear Discord presence (show as idle)
   */
  static async clearPresence(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      logInternalDebug("Discord.clearPresence", {});
      await invoke("discord_rpc_clear");
      await this.stopPeriodicUpdates();
      // The next real track has to go out even if it matches whatever was showing before
      // the clear.
      this.lastSentKey = null;
      this.currentTrackData = null;
      logInternalDebug("Discord.clearPresence.success", {});
    } catch (error) {
      logInternalWarn("Discord.clearPresence.failed", error as Record<string, unknown>);
    }
  }

  /**
   * Start periodic presence updates to keep the connection alive
   * and ensure the progress bar stays accurate
   */
  static async startPeriodicUpdates(): Promise<void> {
    if (this.presenceUpdateInterval !== null) {
      return; // Already running
    }

    // Update every 30 seconds while playing
    this.presenceUpdateInterval = window.setInterval(() => {
      if (this.currentTrackData?.isPlaying) {
        // Force an update by clearing the dedupe key
        this.lastSentKey = null;
        if (this.currentTrackData) {
          // Update currentTime to now for accurate progress
          const elapsed = Math.floor((Date.now() - this.lastUpdateTime) / 1000);
          this.currentTrackData.currentTime = Math.min(
            this.currentTrackData.currentTime + elapsed,
            this.currentTrackData.duration
          );
          this.updatePresence(this.currentTrackData);
        }
      }
    }, 30_000);
  }

  /**
   * Stop periodic presence updates
   */
  static async stopPeriodicUpdates(): Promise<void> {
    if (this.presenceUpdateInterval !== null) {
      window.clearInterval(this.presenceUpdateInterval);
      this.presenceUpdateInterval = null;
    }
  }

  /**
   * Shutdown - clean up all resources
   * Called on app exit
   */
  static async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await this.stopPeriodicUpdates();
    await this.clearPresence();
    this.isInitialized = false;
    logInternalDebug("Discord.shutdown", {});
  }

  /**
   * Get current initialization status
   */
  static getInitialized(): boolean {
    return this.isInitialized;
  }
}

export default DiscordRpcService;