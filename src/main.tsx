import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ui/App";
import { ErrorBoundary } from "./ui/components/ErrorBoundary";
import "./ui/styles/global.css";
import { logInternalError, logInternalInfo } from "./internal/logging";
import { applyPaperPcMode, hydratePaperPcMode } from "./ui/settings/paperPcMode";
import { applyTheme, hydrateTheme, watchSystemTheme } from "./ui/settings/theme";
import {
  applyNativeWindowControls,
  hydrateWindowControlSettings,
} from "./ui/settings/windowControls";
import { hydratePlayerControlSettings } from "./ui/settings/playerControls";
import { hydrateQueuePanelSettings } from "./ui/settings/queuePanel";
import { hydrateTraySettings } from "./ui/settings/tray";
import { hydrateMediaSessionSettings } from "./ui/settings/mediaSession";
import { hydrateAudioQualitySettings } from "./internal/audioQuality";
import { hydrateAudioEngineMode } from "./ui/settings/audioEngine";
import { hydrateHiddenPlaylists } from "./ui/settings/hiddenPlaylists";
import { hydrateOutputDevice } from "./ui/settings/audioOutputDevice";
import { hydrateYouTubeAccountSettings } from "./ui/settings/youtubeAccount";
import { notifyLocalPlaylistsChanged, syncLocalAudioWatcher } from "./player/localPlaylists";
import { listen } from "@tauri-apps/api/event";
import { hydrateDiscordSettings } from "./ui/settings/discord";
import { hydrateSidebarSettings } from "./ui/settings/sidebarMode";
import { hydrateKeyboardShortcuts } from "./ui/settings/keyboardShortcuts";
import {
  hydrateMainWindowGeometry,
  restoreMainWindowGeometry,
} from "./ui/settings/mainWindowGeometry";
import { applyPlatformAttributes, detectTilingWindowManager } from "./ui/platform";
import { hydrateArtworkCache } from "./internal/artworkCache";
import { DiscordRpcService } from "./player/DiscordRPC";
import { hydratePlaybackSettings } from "./player/playbackSettings";
import { hydratePlayHistory } from "./player/playHistory";
import { hydrateFollowedArtists } from "./player/followedArtists";
import { startMiniBridge } from "./player/miniBridge";
import { hydrateSessionRestoreSetting } from "./ui/settings/sessionRestore";
import { hydrateToolbarItemSettings } from "./ui/settings/toolbarItems";
import { hydrateHomeSectionSettings } from "./ui/settings/homeSections";
import { hydrateDownloadLocation } from "./ui/settings/downloadLocation";
import { applyRenderEffects, hydrateRenderEffects } from "./ui/settings/renderEffects";
import { purgeAllSnippets } from "./ui/settings/snippets";
import { hydratePlayerAddonSettings } from "./ui/settings/playerAddons";
import { startMemoryReport } from "./internal/memoryReport";
import { applyStoredZoom, hydrateZoom } from "./ui/hooks/useZoom";
import { hydrateCoverAmbience } from "./ui/settings/coverAmbience";
import { hydrateLyricsEnhancements } from "./ui/settings/lyricsEnhancements";
import { hydrateLyricsSourcePreference } from "./internal/lyricsSourcePreference";
import { hydrateLyricsFontScale } from "./ui/settings/lyricsFontScale";
import { hydrateLyricsTranslation } from "./ui/settings/lyricsTranslation";
import { hydrateLyricsOffset } from "./ui/settings/lyricsOffset";
import { hydrateLocalMusicFolder } from "./player/localFilesManager";
import { hydrateFriendsListeningSettings } from "./lib/friendsListeningService";

function checkAndHandleWebOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  const isTauri = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  if (isTauri) return false;

  const hash = window.location.hash || "";
  const search = window.location.search || "";
  const hasAuth =
    hash.includes("access_token=") ||
    search.includes("code=") ||
    hash.includes("error=") ||
    search.includes("error=");

  if (!hasAuth) return false;

  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <div style="background:#0b0f17;color:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:20px;box-sizing:border-box;">
        <div style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:36px 40px;text-align:center;max-width:420px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);">
          <div style="width:52px;height:52px;background:rgba(16,185,129,0.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin:0 auto 20px;color:#10b981;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <h2 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#ffffff;">Successfully Signed In!</h2>
          <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">Connecting to OpenTune Desktop...</p>
          <div id="sync-status" style="margin-top:18px;font-size:13px;color:#10b981;font-weight:500;">Syncing session...</div>
        </div>
      </div>
    `;
  }

  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(search.replace(/^\?/, ""));
  const payload = {
    code: searchParams.get("code") || hashParams.get("code"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    error: searchParams.get("error") || hashParams.get("error") || searchParams.get("error_description"),
  };

  const deliverTokens = async () => {
    const ports = [8000, 8001, 8080];
    let delivered = false;

    for (const port of ports) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/token_handshake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          delivered = true;
          break;
        }
      } catch {
        try {
          const query = hash ? hash.replace(/^#/, "") : search.replace(/^\?/, "");
          await fetch(`http://127.0.0.1:${port}/token_handshake?` + query, { mode: "no-cors" });
          delivered = true;
          break;
        } catch {}
      }
    }

    const statusEl = document.getElementById("sync-status");
    if (statusEl) {
      if (delivered) {
        statusEl.innerText = "✓ Connected to OpenTune! You may close this tab.";
        setTimeout(() => {
          try { window.close(); } catch {}
        }, 1800);
      } else {
        statusEl.innerText = "✓ Authenticated! Please return to OpenTune.";
      }
    }

    try {
      window.location.replace(`http://localhost:8000/callback` + hash);
    } catch {}
  };

  void deliverTokens();
  return true;
}

if (!checkAndHandleWebOAuthCallback()) {
  bootstrap();
}

function bootstrap() {
logInternalInfo("main.bootstrap start");
// Before React mounts: a resolution restored after first paint is a resolution that already
// let its image flash the fallback icon.
hydrateArtworkCache();
applyPlatformAttributes();
void detectTilingWindowManager();
// Before React mounts: a late theme apply shows a flash of the wrong palette.
applyTheme();
watchSystemTheme();
applyStoredZoom();
applyPaperPcMode();
applyRenderEffects();
purgeAllSnippets();
// One line a minute in the app log, so "the renderer is using 220 MB" can be split into heap,
// DOM, images and subframes instead of guessed at. Settings → Troubleshooting → Open log.
startMemoryReport();
void applyNativeWindowControls();
void hydrateMainWindowGeometry().then(restoreMainWindowGeometry).catch((error) => {
  logInternalError("mainWindowGeometry.restore failed", error);
});
void Promise.all([
  hydratePaperPcMode(),
  hydrateRenderEffects(),
  hydrateTheme(),
  hydrateWindowControlSettings(),
  hydrateMediaSessionSettings(),
  hydratePlayerControlSettings(),
  hydratePlayerAddonSettings(),
  hydrateQueuePanelSettings(),
  hydrateTraySettings(),
  hydrateAudioQualitySettings(),
  hydrateAudioEngineMode(),
  hydrateHiddenPlaylists(),
  // Same reason: a fresh Rust process opens the OS default device until told otherwise.
  hydrateOutputDevice(),
  hydrateYouTubeAccountSettings(),
  hydrateDiscordSettings(),
  hydrateSidebarSettings(),
  hydrateKeyboardShortcuts(),
  hydrateToolbarItemSettings(),
  hydrateHomeSectionSettings(),
  hydrateDownloadLocation(),
  hydratePlaybackSettings(),
  hydratePlayHistory(),
  // Read synchronously from local storage at boot, so this only backfills a machine whose
  // local storage was cleared — it takes effect from the next launch.
  hydrateSessionRestoreSetting(),
  // Same convention: durable wins, localStorage is backfilled, so saves survive a restart.
  hydrateFollowedArtists(),
  hydrateCoverAmbience(),
  hydrateLyricsEnhancements(),
  hydrateLyricsSourcePreference(),
  hydrateLyricsFontScale(),
  hydrateLyricsTranslation(),
  hydrateLyricsOffset(),
  hydrateZoom(),
  hydrateLocalMusicFolder(),
  hydrateFriendsListeningSettings(),
]).catch((error) => {
  logInternalError("settings hydration failed", error);
});

// Initialize Discord RPC (non-blocking)
logInternalInfo("[Discord RPC] Initializing Discord RPC service");
try {
  void DiscordRpcService.init().catch((error) => {
    logInternalError("[Discord RPC] initialization error", error);
  });
} catch (error) {
  logInternalError("[Discord RPC] failed to initialize", error);
}

window.addEventListener("error", (event) => {
  logInternalError("window.error", event.error ?? event.message, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  logInternalError("window.unhandledrejection", event.reason);
});

/*
 * Clean up Discord RPC on app close
 */
window.addEventListener("beforeunload", () => {
  void DiscordRpcService.shutdown();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary label="OpenTune">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

syncLocalAudioWatcher();
void listen("local-audio-changed", () => notifyLocalPlaylistsChanged());
// Feeds the external mini player window (snapshots out, transport commands in).
startMiniBridge();
}



