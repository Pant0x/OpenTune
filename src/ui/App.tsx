import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import type { Album, Artist, Playlist, SearchResults, Track } from "../datasource/types";
import { looksLikeYouTubeLink } from "../datasource/youtube/links";
import { useDisableContextMenu } from "./hooks/useDisableContextMenu";
import { useZoom } from "./hooks/useZoom";
import { ZoomHudOverlay } from "./components/ZoomMeter";
import { HomePage } from "./pages/HomePage";

/*
 * Every page used to be statically imported, so the whole app — settings, lyrics, all four
 * browse views — was parsed before the first frame could paint. Only Home is reachable at
 * startup, so the rest load on first navigation.
 *
 * The chunks come off local disk in a Tauri app, not the network, so the win here is startup
 * parse/compile time rather than transfer size. Each page is a named export, hence the
 * default-shim; `lazy` requires a module whose default is the component.
 */
const AlbumView = lazy(() => import("./pages/AlbumView").then((m) => ({ default: m.AlbumView })));
const ArtistView = lazy(() => import("./pages/ArtistView").then((m) => ({ default: m.ArtistView })));
const DiscographyPage = lazy(() =>
  import("./pages/DiscographyPage").then((m) => ({ default: m.DiscographyPage })));
const PlaylistView = lazy(() =>
  import("./pages/PlaylistView").then((m) => ({ default: m.PlaylistView })));
const RelatedPage = lazy(() =>
  import("./pages/RelatedPage").then((m) => ({ default: m.RelatedPage })));
const SearchResultsPage = lazy(() =>
  import("./pages/SearchResultsPage").then((m) => ({ default: m.SearchResultsPage })));
const LibraryPage = lazy(() =>
  import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);
const BrowsePage = lazy(() =>
  import("./pages/BrowsePage").then((m) => ({ default: m.BrowsePage })),
);
const HistoryPage = lazy(() =>
  import("./pages/HistoryPage").then((m) => ({ default: m.HistoryPage })),
);
const LocalFilesPage = lazy(() =>
  import("./pages/LocalFilesPage").then((m) => ({ default: m.LocalFilesPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const LyricsView = lazy(() => import("./pages/LyricsView").then((m) => ({ default: m.LyricsView })));
const NowPlayingFullscreenView = lazy(() => import("./pages/NowPlayingFullscreenView").then((m) => ({ default: m.NowPlayingFullscreenView })));
const ReleasesPage = lazy(() => import("./pages/ReleasesPage").then((m) => ({ default: m.ReleasesPage })));
const SongPage = lazy(() => import("./pages/SongPage").then((m) => ({ default: m.SongPage })));
import { TrackContextMenuProvider } from "./components/TrackContextMenu";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PlaylistContextMenuProvider } from "./components/PlaylistContextMenu";
import { VolumeSyncBridge } from "./components/player/VolumeSyncBridge";
import { AlbumNavigationProvider, ArtistNavigationProvider, SongNavigationProvider } from "./components/ArtistLinks";
import { cn } from "@/lib/utils";
import { TitleBar } from "./components/TitleBar";
import { PlayerBar } from "./components/player/PlayerBar";
import { QueuePanel } from "./components/player/QueuePanel";
import { useQueuePanelCollapsed } from "./settings/queuePanel";
import { useNativeWindowControls } from "./settings/windowControls";

/** Wide enough for a 44px cover plus breathing room, matching the sidebar rail's feel. */
const COLLAPSED_QUEUE_WIDTH = 62;
import { Layout } from "./components/Layout";
import type { AppViewState } from "./types/tab";
import {
  libraryController,
  playerController,
  searchController,
  useLibraryState,
  usePlayerSelector,
  shallowEqual,
} from "../player/playerStore";
import { clearAppSession, hydrateAppSessionAsync, hydrateLastPlayedTrackAsync, saveAppSession } from "../player/appSession";
import { readSessionRestoreEnabled } from "./settings/sessionRestore";
import { useMediaSession } from "../player/useMediaSession";
import { playerUIStore, usePlayerUIState } from "./stores/playerUIStore";
import {
  clearAppSettings,
  getAppSetting,
  removeAppSetting,
  setAppSetting,
} from "../internal/appSettings";
import { clearCache } from "../internal/cache";
import {
  Onboarding,
  OnboardingCompleteToast,
  KeychainNotice,
  OnboardingWelcome,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStep,
} from "./components/Onboarding";
import { isMacOS } from "./platform";
import { useReduceMotion } from "./settings/renderEffects";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logInternalWarn } from "../internal/logging";
import { setAutostartEnabled } from "./settings/autostart";
import {
  eventMatchesShortcut,
  useKeyboardShortcuts,
} from "./settings/keyboardShortcuts";
import { persistMainWindowGeometry } from "./settings/mainWindowGeometry";
import { hydratePlaybackSettings } from "../player/playbackSettings";
const ONBOARDING_COMPLETE_KEY = "amber:onboarding-complete";
const ONBOARDING_COMPLETE_SETTING_KEY = "onboardingComplete";
const KEYCHAIN_NOTICE_COMPLETE_KEY = "amber:keychain-notice-complete";
const MOUSE_BACK_BUTTON = 3;
const MOUSE_FORWARD_BUTTON = 4;
/** How often the session is written purely to keep the restored playback position fresh. */
const SESSION_HEARTBEAT_MS = 2500;
const SLEEP_RECOVERY_TIMER_INTERVAL_MS = 15000;
const SLEEP_RECOVERY_TIMER_DRIFT_MS = 60000;

/**
 * How many pages back navigation history remembers.
 */
const MAX_NAVIGATION_HISTORY = 50;

function pushNavigationState(
  entries: readonly AppViewState[],
  state: AppViewState,
): AppViewState[] {
  return [...entries, state].slice(-MAX_NAVIGATION_HISTORY);
}

function getNavigationKey(state: AppViewState): string {
  switch (state.view) {
    case "album":
      return `album:${state.album?.id ?? ""}`;
    case "song":
      return `song:${state.song?.id ?? ""}`;
    case "artist":
      return `artist:${state.artist?.id ?? state.artist?.name ?? ""}`;
    case "discography":
      return `discography:${state.artist?.id ?? state.artist?.name ?? ""}`;
    case "releases":
      return "releases";
    case "playlist":
      return `playlist:${state.playlist?.id ?? ""}`;
    case "related":
      return `related:${state.relatedTrack?.id ?? ""}`;
    case "search":
      return `search:${state.searchQuery ?? ""}`;
    case "home":
      return "home";
    case "history":
      return "history";
    case "browse":
      return `browse:${state.browseTab ?? "explore"}`;
    case "library":
      return "library";
    case "local-files":
      return "local-files";
    case "settings":
      return "settings";
  }
}



function readLocalOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveLocalOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
  } catch {
    // Durable app settings are the source of truth.
  }
}

function clearLocalOnboardingComplete(): void {
  try {
    localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  } catch {
    // Durable app settings are the source of truth.
  }
}

async function hasStoredYoutubeSession(): Promise<boolean> {
  // The cookie is the session. This used to also consult an OAuth credential, which nothing in
  // the app has ever written — a branch that could only ever be false, dressed as a second way
  // of being signed in.
  const cookie = await Promise.allSettled([invoke<string | null>("load_youtube_music_cookie")]);
  return cookie[0].status === "fulfilled" && cookie[0].value !== null;
}

export default function App() {
  useDisableContextMenu();
  useZoom();
  const libraryState = useLibraryState();
  /*
   * Only the three fields the root actually reads. Selecting the whole state here made the
   * application's largest component a subscriber to every field of it, including volume —
   * which commits on every pointer move of the slider. Narrowing it is also self-enforcing:
   * reading a field that is not selected is a type error rather than stale data.
   */
  const playerState = usePlayerSelector(
    (state) => ({
      currentTrack: state.currentTrack,
      status: state.status,
      error: state.error,
    }),
    shallowEqual,
  );
  const playerUIState = usePlayerUIState();
  const keyboardShortcuts = useKeyboardShortcuts();
  // The stylesheet kills CSS animation via !important; this is the JS half. Motion writes
  // inline styles, so no stylesheet can reach it — and its own `useReducedMotion` reads the
  // OS media query alone, which is why this is the app's hook and not that one.
  const reduceMotion = useReduceMotion();

  const [isWindowMaximizedOrFullscreen, setIsWindowMaximizedOrFullscreen] = useState(true);

  // The window is transparent so the app root can round its own corners. When the window
  // is maximised or fullscreen those corners would expose the desktop, so drop the radius.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;

    const syncWindowRadius = async () => {
      try {
        const [maximized, fullscreen] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen(),
        ]);
        if (disposed) return;
        setIsWindowMaximizedOrFullscreen(Boolean(maximized || fullscreen));
        document.documentElement.toggleAttribute(
          "data-window-maximized",
          Boolean(maximized || fullscreen),
        );
      } catch (error) {
        logInternalWarn("App.syncWindowRadius failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void syncWindowRadius();
    const unlistenResized = appWindow.onResized(() => void syncWindowRadius());

    return () => {
      disposed = true;
      void unlistenResized.then((unlisten) => unlisten());
    };
  }, []);

  // Full-screen lyrics is real OS fullscreen, not just a wider layout — the whole point is
  // the window chrome getting out of the way too.
  useEffect(() => {
    void getCurrentWindow()
      .setFullscreen(playerUIState.isLyricsFullscreen)
      .catch((error) => {
        logInternalWarn("App.syncLyricsFullscreen failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [playerUIState.isLyricsFullscreen]);

  const [currentView, setCurrentView] = useState<AppViewState>({ view: "home" });
  const [navigationHistory, setNavigationHistory] = useState<AppViewState[]>([]);
  const [forwardHistory, setForwardHistory] = useState<AppViewState[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  /*
   * The sidebar is a fixed icon rail. 72px sits below the Sidebar's own text-hide threshold,
   * so every row renders as artwork only and explains itself through a tooltip on hover.
   * Still state rather than a constant because TitleBar aligns its home button to this width.
   */
  const [sidebarWidth, setSidebarWidth] = useState(62);
  const [queuePanelWidth, setQueuePanelWidth] = useState(340);
  const isQueuePanelCollapsed = useQueuePanelCollapsed();
  const nativeWindowControls = useNativeWindowControls();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(() =>
    readLocalOnboardingComplete() ? true : null
  );
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(null);
  const [, setOnboardingSearchQuery] = useState("");
  const [showOnboardingComplete, setShowOnboardingComplete] = useState(false);
  const [showKeychainNotice, setShowKeychainNotice] = useState(
    () => isMacOS && localStorage.getItem(KEYCHAIN_NOTICE_COMPLETE_KEY) !== "true"
  );
  const [showOnboardingWelcome, setShowOnboardingWelcome] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydratePlaybackSettings().then((settings) => {
      if (cancelled) return;
      playerController.applyPlaybackSettings(settings);
    });

    // If initial sync did not restore a track (e.g. localStorage was cold or uncommitted), hydrate from disk setting
    if (readSessionRestoreEnabled() && !playerController.getState().currentTrack) {
      void hydrateAppSessionAsync().then((diskSession) => {
        if (cancelled) return;
        if (diskSession?.player?.currentTrack && !playerController.getState().currentTrack) {
          playerController.restoreSession(diskSession.player);
          return;
        }
        void hydrateLastPlayedTrackAsync().then((lastTrack) => {
          if (cancelled || !lastTrack || playerController.getState().currentTrack) return;
          playerController.restoreSession({
            currentTrack: lastTrack,
            history: [],
            queue: [lastTrack],
            queueIndex: 0,
            status: "paused",
            positionSec: 0,
            volume: 1,
            muted: false,
            autoplayEnabled: true,
            playbackOrderMode: "in-order",
            shuffleEnabled: false,
            isPlaylistMode: false,
          });
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void persistMainWindowGeometry().then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  const [isExpandedPlayerBar, setIsExpandedPlayerBar] = useState(false);
  const lastErrorAlertRef = useRef<string | null>(null);
  const sessionStateRef = useRef({ currentView, navigationHistory, forwardHistory });
  const sessionPersistenceDisabledRef = useRef(false);
  const sleepRecoveryLastTickRef = useRef(Date.now());
  const sleepRecoveryReloadingRef = useRef(false);
  sessionStateRef.current = { currentView, navigationHistory, forwardHistory };
  const persistAppSession = useCallback(() => {
    if (sessionPersistenceDisabledRef.current) return;
    const current = sessionStateRef.current;
    saveAppSession({
      version: 2,
      view: {
        ...current.currentView,
        searchLoading: false,
      },
      history: current.navigationHistory.slice(-10),
      forwardHistory: current.forwardHistory.slice(-10),
      player: playerController.exportSession(),
    });
  }, []);

  const canNavigateBack = navigationHistory.length > 0;
  const canNavigateForward = forwardHistory.length > 0;

  const navigateToView = useCallback((nextState: AppViewState) => {
    playerUIStore.setLyricsOpen(false);
    setCurrentView((current) => {
      if (getNavigationKey(current) === getNavigationKey(nextState)) {
        return nextState;
      }
      setNavigationHistory((prev) => pushNavigationState(prev, current));
      setForwardHistory([]);
      return nextState;
    });
  }, []);

  const handleNavigateBack = useCallback(() => {
    playerUIStore.setLyricsOpen(false);
    setNavigationHistory((prevBack) => {
      if (prevBack.length === 0) return prevBack;
      const previous = prevBack[prevBack.length - 1];
      const newBack = prevBack.slice(0, -1);
      setCurrentView((current) => {
        setForwardHistory((prevForward) => [current, ...prevForward]);
        return previous;
      });
      return newBack;
    });
  }, []);

  const handleNavigateForward = useCallback(() => {
    playerUIStore.setLyricsOpen(false);
    setForwardHistory((prevForward) => {
      if (prevForward.length === 0) return prevForward;
      const next = prevForward[0];
      const newForward = prevForward.slice(1);
      setCurrentView((current) => {
        setNavigationHistory((prevBack) => pushNavigationState(prevBack, current));
        return next;
      });
      return newForward;
    });
  }, []);

  const markOnboardingComplete = useCallback((showCompleteToast: boolean) => {
    saveLocalOnboardingComplete();
    setOnboardingComplete(true);
    setOnboardingStep(null);
    setShowOnboardingWelcome(false);
    if (showCompleteToast) setShowOnboardingComplete(true);
    void setAppSetting(ONBOARDING_COMPLETE_SETTING_KEY, true);
  }, []);

  useEffect(() => {
    if (showKeychainNotice) return;

    let active = true;

    const loadOnboardingCompletion = async () => {
      if (readLocalOnboardingComplete()) {
        markOnboardingComplete(false);
        return;
      }

      const storedComplete = await getAppSetting<boolean>(ONBOARDING_COMPLETE_SETTING_KEY);
      if (!active) return;

      if (storedComplete === true) {
        markOnboardingComplete(false);
        return;
      }

      if (await hasStoredYoutubeSession()) {
        if (!active) return;
        markOnboardingComplete(false);
        return;
      }

      if (!active) return;
      setOnboardingComplete(false);
      setOnboardingStep("open-search");
      setShowOnboardingWelcome(true);
    };

    void loadOnboardingCompletion();
    return () => {
      active = false;
    };
  }, [markOnboardingComplete, showKeychainNotice]);

  useMediaSession(playerState, playerController);

  const activeViewKey = [
    currentView.view,
    currentView.album?.id,
    currentView.artist?.id,
    currentView.playlist?.id,
    currentView.searchQuery,
  ].filter(Boolean).join(":");

  const handleNavigateHome = () => {
    navigateToView({ view: "home" });
  };

  useEffect(() => {
    if (showKeychainNotice) return;
    void libraryController.initialize();
  }, [showKeychainNotice]);

  useEffect(() => {
    if (libraryState.status !== "error" || !libraryState.error) return;
    const message = `YouTube Music sign-in or library sync failed:\n\n${libraryState.error}`;
    if (lastErrorAlertRef.current === message) return;
    lastErrorAlertRef.current = message;
    logInternalWarn("App library error", { error: libraryState.error });
  }, [libraryState.error, libraryState.status]);

  useEffect(() => {
    if (playerState.status !== "error" || !playerState.error) return;
    const message = `Playback failed:\n\n${playerState.error}`;
    if (lastErrorAlertRef.current === message) return;
    lastErrorAlertRef.current = message;
    logInternalWarn("App playback error", { error: playerState.error });
  }, [playerState.error, playerState.status]);

  /*
   * A heartbeat, not the primary persistence path.
   *
   * Every change to the tabs or the player session is already written by the effect below, and
   * `beforeunload` catches a clean exit. All this adds is `positionSec` freshness for a restore
   * after a crash or a kill — so it ran every second, rebuilding every tab's full queue and
   * history into a multi-megabyte object graph, stringifying it and writing it synchronously,
   * for a field that only has to be roughly right.
   *
   * At five seconds a hard kill costs at most five seconds of playback position.
   */
  useEffect(() => {
    /*
     * Only while playing. The one field this heartbeat exists to keep fresh is `positionSec`,
     * and a paused or idle player's position does not move — so on a machine sitting on the
     * home page it was rebuilding and stringifying every tab's queue and history, on a timer,
     * to write back a number that was already correct. The effect below still persists on
     * every real change, and the teardown here still writes on the way out.
     */
    const intervalId = playerState.status === "playing"
      ? window.setInterval(persistAppSession, SESSION_HEARTBEAT_MS)
      : 0;
    window.addEventListener("beforeunload", persistAppSession);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("beforeunload", persistAppSession);
      persistAppSession();
    };
  }, [persistAppSession, playerState.status]);

  useEffect(() => {
    return playerController.subscribe(persistAppSession);
  }, [persistAppSession]);

  useEffect(() => {
    persistAppSession();
  }, [currentView, persistAppSession]);

  useEffect(() => {
    const unlistenPromise = listen("main-window-recovery-reload", persistAppSession);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [persistAppSession]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWindow().onCloseRequested(() => {
      persistAppSession();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [persistAppSession]);

  useEffect(() => {
    const unlistenPromise = listen("os-close-requested", persistAppSession);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [persistAppSession]);

  useEffect(() => {
    sleepRecoveryLastTickRef.current = Date.now();

    const resetSleepTimerOnVisible = () => {
      if (document.visibilityState === "visible") {
        sleepRecoveryLastTickRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", resetSleepTimerOnVisible);

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - sleepRecoveryLastTickRef.current;
      sleepRecoveryLastTickRef.current = now;

      if (
        elapsed < SLEEP_RECOVERY_TIMER_INTERVAL_MS + SLEEP_RECOVERY_TIMER_DRIFT_MS
        || document.visibilityState === "hidden"
        || sleepRecoveryReloadingRef.current
      ) {
        return;
      }

      sleepRecoveryReloadingRef.current = true;
      persistAppSession();
      window.location.reload();
    }, SLEEP_RECOVERY_TIMER_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", resetSleepTimerOnVisible);
    };
  }, [persistAppSession]);

  const handleDeleteAllAppData = useCallback(async () => {
    sessionPersistenceDisabledRef.current = true;
    playerUIStore.setLyricsOpen(false);
    setIsSearchOpen(false);
    setOnboardingComplete(null);
    setOnboardingStep(null);
    setShowOnboardingComplete(false);
    setShowOnboardingWelcome(false);

    setCurrentView({ view: "home" });
    setNavigationHistory([]);
    setForwardHistory([]);
    setSidebarWidth(240);
    setQueuePanelWidth(340);
    clearAppSession();

    const results = await Promise.allSettled([
      setAutostartEnabled(false),
      libraryController.signOut(),
      clearCache(),
      clearAppSettings(),
    ]);

    try {
      localStorage.clear();
    } catch {
      clearLocalOnboardingComplete();
      clearAppSession();
    }

    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      throw failed.reason;
    }
  }, []);

  useEffect(() => {
    if (!playerState.currentTrack && playerUIState.isLyricsOpen) {
      playerUIStore.setLyricsOpen(false);
    }
    if (!playerState.currentTrack && playerUIState.isNowPlayingFullscreen) {
      playerUIStore.setNowPlayingFullscreen(false);
    }
  }, [playerState.currentTrack, playerUIState.isLyricsOpen, playerUIState.isNowPlayingFullscreen]);

  const handleNavigateAlbum = (album: Album) => {
    playerUIStore.setLyricsOpen(false);
    playerUIStore.setNowPlayingFullscreen(false);
    navigateToView({
      title: album.title,
      view: "album",
      album,
    });
  };

  const handleNavigateAlbumForTrack = async (track: Track) => {
    if (track.albumId) {
      handleNavigateAlbum({
        id: track.albumId,
        title: track.album ?? "Album",
        artist: track.artist ?? "",
        artists: track.artists,
        artworkUrl: track.artworkUrl,
        year: track.year,
        releaseDate: track.releaseDate,
        releaseType: track.releaseType || "album",
      });
      return;
    }

    if (!track.album) {
      handleNavigateAlbum({
        id: track.id,
        title: track.title,
        artist: track.artist ?? "",
        artists: track.artists,
        artworkUrl: track.artworkUrl,
        releaseType: "single",
        year: track.year,
        releaseDate: track.releaseDate,
      });
      return;
    }

    const query = [track.album, track.artist].filter(Boolean).join(" ").trim();
    if (!query) {
      handleNavigateAlbum({
        id: track.id,
        title: track.album || track.title,
        artist: track.artist ?? "",
        artists: track.artists,
        artworkUrl: track.artworkUrl,
        releaseType: "single",
        year: track.year,
        releaseDate: track.releaseDate,
      });
      return;
    }

    try {
      const results = await searchController.search(query);
      const album = results?.albums?.[0];
      if (album) {
        handleNavigateAlbum(album);
        return;
      }
    } catch (error) {
      logInternalWarn("App.handleNavigateAlbumForTrack failed", {
        trackId: track.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    handleNavigateAlbum({
      id: track.id,
      title: track.album || track.title,
      artist: track.artist ?? "",
      artists: track.artists,
      artworkUrl: track.artworkUrl,
      releaseType: "single",
      year: track.year,
      releaseDate: track.releaseDate,
    });
  };

  const handleNavigateSong = (song: Track) => {
    void handleNavigateAlbumForTrack(song);
  };

  const handleNavigateArtist = (artist: Artist) => {
    playerUIStore.setLyricsOpen(false);
    playerUIStore.setNowPlayingFullscreen(false);
    if (!artist.id) {
      const fallbackToSearch = () => handleSearch(artist.name);
      void searchController.search(artist.name)
        .then((results) => {
          const normalizedName = artist.name.trim().toLocaleLowerCase();
          const resolved = results.artists.find(
            (candidate) => candidate.name.trim().toLocaleLowerCase() === normalizedName,
          ) ?? results.artists.find((candidate) => {
            const candidateName = candidate.name.trim().toLocaleLowerCase();
            return candidateName.includes(normalizedName)
              || normalizedName.includes(candidateName);
          }) ?? results.artists[0];

          if (resolved) {
            handleNavigateArtist(resolved);
            return;
          }

          fallbackToSearch();
        })
        .catch(fallbackToSearch);
      return;
    }

    navigateToView({
      view: "artist",
      artist,
      title: artist.name,
    });
  };

  const handleNavigateDiscography = (artist: Artist, releases?: Album[]) => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({
      title: `${artist.name} - Discography`,
      view: "discography",
      artist,
      releases,
    });
  };

  const handleConnectionRestored = useCallback(async () => {
    await libraryController.recoverConnection();
  }, []);

  const handleNavigatePlaylist = (playlist: Playlist) => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({
      title: playlist.title,
      view: "playlist",
      playlist,
    });
  };

  const handleNavigateRelated = (track: Track) => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({
      title: `Related to ${track.title}`,
      view: "related",
      relatedTrack: track,
    });
  };

  const handleSignIn = async () => {
    await libraryController.signIn();
    if (libraryController.getState().status !== "ready") return;

    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "home" });
  };

  const handleOpenLink = async (url: string): Promise<boolean> => {
    let resolved: Awaited<ReturnType<typeof libraryController.resolveLink>> = null;
    try {
      resolved = await libraryController.resolveLink(url);
    } catch {
      return false;
    }
    if (!resolved) return false;

    playerUIStore.setLyricsOpen(false);
    if (resolved.kind === "track") {
      await playerController.playTrackById(resolved.id);
      return true;
    }

    if (resolved.kind === "artist") {
      const page = await libraryController.getArtist(resolved.id);
      handleNavigateArtist(page.artist);
      return true;
    }

    if (resolved.kind === "album") {
      const stub: Album = { id: resolved.id, title: "Album", artist: "" };
      const tracks = await libraryController.getAlbumTracks(stub).catch(() => [] as Track[]);
      handleNavigateAlbum({
        ...stub,
        title: tracks[0]?.album ?? stub.title,
        artist: tracks[0]?.artist ?? "",
        artworkUrl: tracks[0]?.artworkUrl,
      });
      return true;
    }

    const saved = libraryController.getState().library?.playlists.find(
      (item) => item.id.replace(/^VL/, "") === resolved.id.replace(/^VL/, ""),
    );
    handleNavigatePlaylist(saved ?? {
      id: resolved.id,
      title: "Playlist",
      owner: "",
    });
    return true;
  };

  const handleSearch = (query: string) => {
    playerUIStore.setLyricsOpen(false);

    if (looksLikeYouTubeLink(query)) {
      void handleOpenLink(query).then((opened) => {
        if (!opened) runSearch(query);
      });
      return;
    }

    runSearch(query);
  };

  const runSearch = (query: string) => {
    navigateToView({
      view: "search",
      title: query,
      searchQuery: query,
      searchResults: [],
      mixedSearchResults: { artists: [], tracks: [], albums: [], playlists: [] },
      searchLoading: true,
    });

    if (onboardingStep === "type-first") setOnboardingStep("play-first");
    const applySearchResults = (results: SearchResults) => {
      setCurrentView((current) => {
        if (current.view === "search" && current.searchQuery === query) {
          return {
            ...current,
            searchResults: results.tracks,
            mixedSearchResults: results,
            searchLoading: false,
          };
        }
        return current;
      });
    };

    void searchController.search(query, applySearchResults)
      .then(applySearchResults)
      .catch(() => {
        setCurrentView((current) => {
          if (current.view === "search" && current.searchQuery === query) {
            return {
              ...current,
              searchLoading: false,
            };
          }
          return current;
        });
      });
  };

  const handleOpenSettings = () => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "settings" });
  };

  const handleOpenHistory = () => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "history", title: "History" });
  };

  const handleOpenLibrary = () => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "library", title: "Library" });
  };

  const handleOpenBrowse = (requestedTab: string = "explore") => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "browse", title: "Browse", browseTab: requestedTab });
  };

  const handleOpenLocalFiles = () => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "local-files", title: "Local Files" });
  };

  const handleOpenReleases = () => {
    playerUIStore.setLyricsOpen(false);
    navigateToView({ view: "releases", title: "Releases" });
  };

  const finishOnboarding = () => {
    markOnboardingComplete(false);
  };

  const skipOnboardingStep = () => {
    if (!onboardingStep) return;
    const next = nextOnboardingStep(onboardingStep);
    if (next) setOnboardingStep(next);
    else markOnboardingComplete(true);
  };

  const backOnboardingStep = () => {
    if (!onboardingStep) return;
    const previous = previousOnboardingStep(onboardingStep);
    if (previous) setOnboardingStep(previous);
  };

  const handlePlaySearchResult = async (track: Track) => {
    const started = await playerController.playTrackById(track.id, [track], true);
    if (!started) return;

    if (onboardingStep === "play-first") {
      markOnboardingComplete(true);
    }
  };

  const dismissSearch = () => {
    setIsSearchOpen(false);
    if (onboardingStep === "type-first" || onboardingStep === "play-first") {
      setOnboardingSearchQuery("");
      setOnboardingStep("open-search");
    }
  };

  const restartOnboarding = () => {
    clearLocalOnboardingComplete();
    setOnboardingComplete(false);
    setOnboardingSearchQuery("");
    setOnboardingStep("open-search");
    setShowOnboardingWelcome(false);
    void removeAppSetting(ONBOARDING_COMPLETE_SETTING_KEY);
    handleNavigateHome();
  };

  useEffect(() => {
    if (onboardingStep === "open-search" && isSearchOpen) {
      setOnboardingSearchQuery("");
      setOnboardingStep("type-first");
    }
  }, [isSearchOpen, onboardingStep]);

  useEffect(() => {
    if (!showOnboardingComplete) return;
    const timer = window.setTimeout(() => setShowOnboardingComplete(false), 3400);
    return () => window.clearTimeout(timer);
  }, [showOnboardingComplete]);

  useEffect(() => {
    if (!showOnboardingWelcome) return;
    const timer = window.setTimeout(() => setShowOnboardingWelcome(false), 2600);
    return () => window.clearTimeout(timer);
  }, [showOnboardingWelcome]);

  const handleToggleLyrics = () => {
    playerUIStore.setLyricsOpen(!playerUIState.isLyricsOpen);
  };

  const handleToggleQueue = () => {
    playerUIStore.setQueueOpen(!playerUIState.isQueueOpen);
  };

  const handleKeychainNoticeContinue = () => {
    localStorage.setItem(KEYCHAIN_NOTICE_COMPLETE_KEY, "true");
    setShowKeychainNotice(false);
  };

  useEffect(() => {
    const preventTabFocusTraversal = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };

    window.addEventListener("keydown", preventTabFocusTraversal);
    return () => window.removeEventListener("keydown", preventTabFocusTraversal);
  }, []);

  useEffect(() => {
    const isTextEntry = (target: EventTarget | null) => {
      return target instanceof Element
        && target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) !== null;
    };

    let lastNavTime = 0;
    const handleMouseNavigation = (event: MouseEvent) => {
      if (
        event.button !== MOUSE_BACK_BUTTON
        && event.button !== MOUSE_FORWARD_BUTTON
      ) {
        return;
      }
      if (isTextEntry(event.target)) return;

      const now = Date.now();
      if (now - lastNavTime < 350) return;
      lastNavTime = now;

      if (event.button === MOUSE_BACK_BUTTON) {
        if (playerUIState.isNowPlayingFullscreen) {
          event.preventDefault();
          playerUIStore.setNowPlayingFullscreen(false);
          return;
        }
        if (playerUIState.isLyricsOpen) {
          event.preventDefault();
          playerUIStore.setLyricsOpen(false);
          return;
        }
        if (isSearchOpen && currentView.view !== "settings") {
          event.preventDefault();
          setIsSearchOpen(false);
          return;
        }
        if (canNavigateBack) {
          event.preventDefault();
          handleNavigateBack();
        }
        return;
      }

      if (canNavigateForward) {
        event.preventDefault();
        handleNavigateForward();
      }
    };

    const preventAuxNavigation = (event: MouseEvent) => {
      if (
        event.button === MOUSE_BACK_BUTTON
        || event.button === MOUSE_FORWARD_BUTTON
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("mouseup", handleMouseNavigation);
    window.addEventListener("auxclick", preventAuxNavigation);
    return () => {
      window.removeEventListener("mouseup", handleMouseNavigation);
      window.removeEventListener("auxclick", preventAuxNavigation);
    };
  }, [
    canNavigateBack,
    canNavigateForward,
    currentView.view,
    handleNavigateBack,
    handleNavigateForward,
    isSearchOpen,
    playerUIState.isLyricsOpen,
    playerUIState.isNowPlayingFullscreen,
  ]);

  useEffect(() => {
    const isTextEntry = (target: EventTarget | null) => {
      return target instanceof Element
        && target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) !== null;
    };

    const handleShortcut = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.defaultPrevented) return;
      const textEntry = isTextEntry(event.target);
      if (textEntry) return;

      if (
        eventMatchesShortcut(event, keyboardShortcuts.search)
        && currentView.view !== "settings"
      ) {
        event.preventDefault();
        if (isSearchOpen) dismissSearch();
        else setIsSearchOpen(true);
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.navigateBack)) {
        if (isSearchOpen && currentView.view !== "settings") {
          event.preventDefault();
          setIsSearchOpen(false);
          return;
        }
        if (canNavigateBack) {
          event.preventDefault();
          handleNavigateBack();
        }
        return;
      }

      if (eventMatchesShortcut(event, keyboardShortcuts.navigateForward)) {
        if (canNavigateForward) {
          event.preventDefault();
          handleNavigateForward();
        }
        return;
      }

      const isHardwarePlayPause =
        event.code === "MediaPlayPause" || event.key === "MediaPlayPause";
      const isHardwareNext =
        event.code === "MediaTrackNext" || event.key === "MediaTrackNext";
      const isHardwarePrevious =
        event.code === "MediaTrackPrevious" || event.key === "MediaTrackPrevious";
      const isHardwareStop =
        event.code === "MediaStop" || event.key === "MediaStop";

      if (
        (isHardwarePlayPause || eventMatchesShortcut(event, keyboardShortcuts.playPause))
        && playerState.currentTrack
        && playerState.status !== "loading"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.target instanceof HTMLElement) {
          event.target.blur();
        }
        void playerController.togglePlayPause();
        return;
      }

      if (
        isHardwareStop
        && playerState.currentTrack
        && playerState.status !== "loading"
      ) {
        event.preventDefault();
        event.stopPropagation();
        void playerController.pause();
        return;
      }

      if (
        eventMatchesShortcut(event, keyboardShortcuts.mute)
        && playerState.currentTrack
        && playerState.status !== "loading"
      ) {
        event.preventDefault();
        void playerController.toggleMute();
        return;
      }

      if (
        (isHardwarePrevious || eventMatchesShortcut(event, keyboardShortcuts.previousTrack))
        && playerState.currentTrack
        && playerState.status !== "loading"
      ) {
        event.preventDefault();
        void playerController.skipToPrevious();
        return;
      }

      if (
        (isHardwareNext || eventMatchesShortcut(event, keyboardShortcuts.nextTrack))
        && playerState.currentTrack
        && playerState.status !== "loading"
      ) {
        event.preventDefault();
        void playerController.skipToNext();
      }
    };

    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, [
    canNavigateBack,
    canNavigateForward,
    currentView.view,
    handleNavigateBack,
    handleNavigateForward,
    isSearchOpen,
    keyboardShortcuts,
    playerState.currentTrack,
    playerState.status,
  ]);

  const handlePlayerBarClick = () => {
    setIsExpandedPlayerBar(!isExpandedPlayerBar);
  };

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
    <AlbumNavigationProvider onNavigate={handleNavigateAlbum}>
    <SongNavigationProvider onNavigate={(song) => handleNavigateSong(song)}>
    <ArtistNavigationProvider onNavigate={handleNavigateArtist}>
    <TrackContextMenuProvider
      libraryController={libraryController}
      onOpenRelated={handleNavigateRelated}
      onOpenAlbum={(track) => void handleNavigateAlbumForTrack(track)}
    >
    <PlaylistContextMenuProvider libraryController={libraryController}>
    <VolumeSyncBridge />
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden bg-black ${
        nativeWindowControls || isWindowMaximizedOrFullscreen || playerUIState.isLyricsFullscreen || playerUIState.isNowPlayingFullscreen
          ? "rounded-none border-0 ring-0 p-0 m-0"
          : "rounded-[var(--window-radius)] border border-border ring-1 ring-inset ring-[var(--window-edge)]"
      }`}
    >
      {!playerUIState.isLyricsFullscreen && (
        <TitleBar
          sidebarWidth={sidebarWidth}
          isHomeActive={currentView.view === "home"}
          onNavigateHome={handleNavigateHome}
          onOpenSettings={handleOpenSettings}
          onOpenDownloads={() => handleOpenBrowse("downloads")}
          onSearch={(q) => handleSearch(q)}
          onOpenSearch={() => setIsSearchOpen(true)}
          canGoBack={canNavigateBack}
          canGoForward={canNavigateForward}
          onNavigateBack={handleNavigateBack}
          onNavigateForward={handleNavigateForward}
          onNavigatePlaylist={handleNavigatePlaylist}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <Layout
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
          onNavigateAlbum={handleNavigateAlbum}
          onNavigatePlaylist={handleNavigatePlaylist}
          onNavigateArtist={handleNavigateArtist}
          onNavigateHistory={handleOpenHistory}
          onNavigateLibrary={handleOpenLibrary}
          onNavigateSettings={handleOpenSettings}
          onNavigateBrowse={() => handleOpenBrowse()}
          onNavigateDownloads={() => handleOpenBrowse("downloads")}
          onNavigateReleases={handleOpenReleases}
          onNavigateLocalFiles={handleOpenLocalFiles}
          onSearch={(q) => handleSearch(q)}
          showSearchBar={currentView.view !== "settings" && !playerUIState.isLyricsOpen}
          onOpenSearch={() => setIsSearchOpen(true)}
          canGoBack={canNavigateBack}
          canGoForward={canNavigateForward}
          onNavigateBack={handleNavigateBack}
          onNavigateForward={handleNavigateForward}
          fullBleedContent={playerUIState.isLyricsOpen}
          hideSidebar={playerUIState.isLyricsFullscreen}
          showTransientScrollbar={
            !playerUIState.isLyricsOpen
            && (currentView.view === "playlist" || currentView.view === "album")
          }
          rightPanel={playerUIState.isQueueOpen ? <QueuePanel onClose={() => playerUIStore.setQueueOpen(false)} /> : undefined}
          rightPanelWidth={isQueuePanelCollapsed ? COLLAPSED_QUEUE_WIDTH : queuePanelWidth}
          onRightPanelWidthChange={isQueuePanelCollapsed ? undefined : setQueuePanelWidth}
          scrollKey={activeViewKey}
        >
          <ErrorBoundary
            key={`boundary:${activeViewKey}`}
            label="This page"
            onDismiss={canNavigateBack ? handleNavigateBack : undefined}
          >
          <Suspense fallback={<div className="min-h-0 flex-1" />}>
          {playerUIState.isLyricsOpen && !playerUIState.isLyricsFullscreen && currentView.view !== "settings" ? (
            <LyricsView onClose={() => playerUIStore.setLyricsOpen(false)} />
          ) : (
          <div key={activeViewKey} className="min-h-0 flex-1">
            {currentView.view === "home" && (
              <HomePage
                tabId="1"
                playerController={playerController}
                libraryController={libraryController}
                libraryState={libraryState}
                searchController={searchController}
                onSignIn={handleSignIn}
                destinations={{
                  onOpenLibrary: handleOpenLibrary,
                  onOpenBrowse: () => handleOpenBrowse("charts"),
                  onOpenHistory: handleOpenHistory,
                  onOpenDownloads: () => handleOpenBrowse("downloads"),
                }}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={handleNavigateArtist}
                onOpenPlaylist={handleNavigatePlaylist}
                onOpenReleases={handleOpenReleases}
              />
            )}
            {currentView.view === "album" && (
              <AlbumView
                album={currentView.album}
                playerController={playerController}
                libraryController={libraryController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenDiscography={handleNavigateDiscography}
              />
            )}
            {currentView.view === "song" && (
              <SongPage
                song={currentView.song}
                playerController={playerController}
                libraryController={libraryController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenSong={handleNavigateSong}
              />
            )}
            {currentView.view === "artist" && (
              <ArtistView
                artist={currentView.artist}
                playerController={playerController}
                libraryController={libraryController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenPlaylist={handleNavigatePlaylist}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenSong={handleNavigateSong}
                onOpenDiscography={handleNavigateDiscography}
                onOpenSettings={handleOpenSettings}
              />
            )}
            {currentView.view === "discography" && (
              <DiscographyPage
                artist={currentView.artist}
                releases={currentView.releases}
                onOpenAlbum={handleNavigateAlbum}
              />
            )}
            {currentView.view === "releases" && (
              <ReleasesPage
                artist={currentView.artist}
                releases={currentView.releases}
                libraryController={libraryController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
              />
            )}
            {currentView.view === "playlist" && (
              <PlaylistView
                playlist={currentView.playlist}
                playerController={playerController}
                libraryController={libraryController}
              />
            )}
            {currentView.view === "related" && currentView.relatedTrack && (
              <RelatedPage
                track={currentView.relatedTrack}
                playerController={playerController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenPlaylist={handleNavigatePlaylist}
              />
            )}
            {currentView.view === "search" && (
              <SearchResultsPage
                query={currentView.searchQuery ?? ""}
                results={currentView.mixedSearchResults ?? {
                  artists: [],
                  tracks: currentView.searchResults ?? [],
                  albums: [],
                  playlists: [],
                }}
                isLoading={currentView.searchLoading ?? false}
                playerController={playerController}
                onSearch={(q) => handleSearch(q)}
                onPlayTrack={handlePlaySearchResult}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenAlbum={handleNavigateAlbum}
                onOpenPlaylist={handleNavigatePlaylist}
              />
            )}
            {currentView.view === "library" && (
              <LibraryPage
                libraryState={libraryState}
                playerController={playerController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenPlaylist={handleNavigatePlaylist}
              />
            )}
            {currentView.view === "browse" && (
              <BrowsePage
                key={currentView.browseTab ?? "explore"}
                initialTab={(currentView.browseTab ?? "explore") as never}
                playerController={playerController}
                libraryController={libraryController}
                onOpenAlbum={handleNavigateAlbum}
                onOpenArtist={(artist) => handleNavigateArtist(artist)}
                onOpenPlaylist={handleNavigatePlaylist}
              />
            )}
            {currentView.view === "history" && (
              <HistoryPage playerController={playerController} libraryState={libraryState} />
            )}
            {currentView.view === "local-files" && (
              <LocalFilesPage
                playerController={playerController}
                onNavigatePlaylist={handleNavigatePlaylist}
              />
            )}
            {currentView.view === "settings" && (
              <SettingsPage
                libraryController={libraryController}
                libraryState={libraryState}
                onRestartOnboarding={restartOnboarding}
                onSignIn={handleSignIn}
                onDeleteAllAppData={handleDeleteAllAppData}
              />
            )}
          </div>
          )}
          </Suspense>
          </ErrorBoundary>
        </Layout>
      </div>
      
      <VolumeSyncBridge />

      {/*
        Fullscreen lyrics: the bar becomes a bottom overlay instead of a row that permanently
        eats height, hidden until the pointer reaches the bottom edge — same reveal-on-hover
        contract as a fullscreen video player's controls. `group/immersive-playerbar` is a
        different name than PlayerBar's own `group/playerbar` (used internally for its icon
        fade-in), so nesting them here doesn't make PlayerBar's hover styling fire early.
      */}
      <div
        className={cn(
          "group/immersive-playerbar",
          playerUIState.isLyricsFullscreen && "absolute inset-x-0 bottom-0 z-40",
        )}
      >
        {playerUIState.isLyricsFullscreen && (
          /*
           * Translating the bar away moves its hitbox with it, so there is nothing left under
           * the pointer to hover — this stand-in strip is what the reveal actually triggers
           * on. Kept to the literal screen edge (8px) rather than a comfortable target size:
           * this sits above the lyrics footer's own buttons (offset controls, source panel),
           * so anything taller would eat clicks meant for them before the bar is revealed. A
           * mouse run to the physical bottom of the window hits it regardless of how thin it
           * is — that's the same trick fullscreen video controls rely on.
           */
          <div className="absolute inset-x-0 bottom-0 h-2" aria-hidden="true" />
        )}
        <div
          className={cn(
            playerUIState.isLyricsFullscreen &&
              "translate-y-full transition-transform duration-300 ease-out group-hover/immersive-playerbar:translate-y-0 group-focus-within/immersive-playerbar:translate-y-0",
          )}
        >
          {/* Its own boundary: the player bar is the one region whose loss ends the session —
              audio keeps playing but nothing can pause or skip it. */}
          <ErrorBoundary label="Playback controls">
            <PlayerBar
              onToggleLyrics={handleToggleLyrics}
              onToggleQueue={handleToggleQueue}
              isQueueOpen={playerUIState.isQueueOpen}
              onConnectionRestored={handleConnectionRestored}
              handlePlayerBarClick={handlePlayerBarClick}
            />
          </ErrorBoundary>
        </div>
      </div>
{/* <SearchOverlay
        isOpen={isSearchOpen}
        activeTabId={activeTabId}
        searchController={searchController}
        albums={libraryState.library?.albums ?? []}
        playlists={libraryState.library?.playlists ?? []}
        onClose={() => setIsSearchOpen(false)}
        onDismiss={dismissSearch}
        onSubmit={handleSearch}
        onOpenAlbum={handleNavigateAlbum}
        onOpenArtist={(artist) => handleNavigateArtist(artist)}
        onOpenPlaylist={handleNavigatePlaylist}
        onQueryChange={setOnboardingSearchQuery}
      /> */}
      {showKeychainNotice ? (
        <KeychainNotice onContinue={handleKeychainNoticeContinue} />
      ) : (
        <>
          {showOnboardingWelcome && (
            <OnboardingWelcome />
          )}
          {onboardingComplete === false && !showOnboardingWelcome && onboardingStep && (
            <Onboarding
              step={onboardingStep}
              onSkip={finishOnboarding}
              onSkipStep={skipOnboardingStep}
              onBack={backOnboardingStep}
            />
          )}
          {showOnboardingComplete && <OnboardingCompleteToast />}
        </>
      )}

      {playerUIState.isLyricsOpen && playerUIState.isLyricsFullscreen && (
        <Suspense fallback={null}>
          <LyricsView onClose={() => playerUIStore.setLyricsOpen(false)} />
        </Suspense>
      )}

      {playerUIState.isNowPlayingFullscreen && (
        <Suspense fallback={null}>
          <NowPlayingFullscreenView onClose={() => playerUIStore.setNowPlayingFullscreen(false)} />
        </Suspense>
      )}

      <ZoomHudOverlay />

{/* <ReleaseNoteDialog
        version={releaseNoteVersion}
        onDismiss={() => {
          if (releaseNoteVersion) markReleaseNoteSeen(releaseNoteVersion);
          setReleaseNoteVersion(null);
        }}
      /> */}
      {/*
        Mounted only while a sign-in is running: `signInProgress` is null at every other moment,
        so the overlay and its animation cost nothing for the whole rest of the session.
      */}
      {/* <AnimatePresence>
        {libraryState.authProgress && (
          <AuthOverlay
            progress={libraryState.authProgress}
            onCancel={() => void libraryController.cancelSignIn()}
          />
        )}
      </AnimatePresence> */}
    </div>
    </PlaylistContextMenuProvider>
    </TrackContextMenuProvider>
    </ArtistNavigationProvider>
    </SongNavigationProvider>
    </AlbumNavigationProvider>
    </MotionConfig>
  );
}

