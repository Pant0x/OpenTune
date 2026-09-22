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
import { handleOAuthPopupRedirect, isOAuthPopup } from "./lib/oauthService";

if (isOAuthPopup()) {
  void handleOAuthPopupRedirect();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0a0a0a] text-white gap-3 select-none">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <span className="text-xs font-medium text-white/80">Signing in to Amber...</span>
    </div>
  );
} else {
  logInternalInfo("main.bootstrap start");
  // Before React mounts: a resolution restored after first paint is a resolution that already
  // let its image flash the fallback icon.
  hydrateArtworkCache();
  applyPlatformAttributes();
  void detectTilingWindowManager();
  // Before React mounts: a late theme apply shows a flash of the wrong palette.
  applyTheme();
  watchSystemTheme();
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
      <ErrorBoundary label="Amber">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );

  syncLocalAudioWatcher();
  void listen("local-audio-changed", () => notifyLocalPlaylistsChanged());
  // Feeds the external mini player window (snapshots out, transport commands in).
  startMiniBridge();
}


