import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SpinnerSteps } from "@/components/motion/loader";
import { cn } from "@/lib/utils";
import { FullScreenIcon, NowPlayingViewIcon, PlayActiveIcon, QueuePanelIcon } from "@/ui/icons";
import { tauriFetch } from "../../../datasource/youtube/tauriFetch";
import { usePlayerSelector } from "../../../player/playerStore";
import { getVideoArtworkFallback } from "../../../datasource/youtube/artwork";
import { SpotifyService } from "../../../services/SpotifyService";
import { useArtworkDominantColor } from "../../hooks/useArtworkDominantColor";
import { TrackInfo } from "./TrackInfo";
import { PlaybackControls } from "./PlaybackControls";
import { SeekBar } from "./SeekBar";
import { DownloadButton } from "./DownloadButton";
import { VolumeControl } from "./VolumeControl";
import { LyricsButton } from "./LyricsButton";
import { playerUIStore, usePlayerUIState } from "../../stores/playerUIStore";
import {
  useExtraPlayerControlsAlwaysVisible,
} from "../../settings/playerControls";
import { useCoverAmbienceEnabled } from "../../settings/coverAmbience";

interface PlayerBarProps {
  onToggleLyrics: () => void;
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  onConnectionRestored: () => Promise<void>;
  handlePlayerBarClick:()=>void;
}

/*
 * Two endpoints so one being blocked does not read as "offline", and both answer 204 with an
 * empty body. This used to lead with `https://music.youtube.com/`, which is 380 KB of HTML
 * fetched only to prove the network exists — and `allSettled` requests both, so every check
 * paid for it. gstatic keeps the "can we reach Google" signal at zero bytes.
 */
const CONNECTION_CHECK_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
];

export function PlayerBar({ onToggleLyrics, onToggleQueue: _onToggleQueue, isQueueOpen: _isQueueOpen, onConnectionRestored, handlePlayerBarClick }: PlayerBarProps) {
  const currentTrack = usePlayerSelector((player) => player.currentTrack);
  const playerUIState = usePlayerUIState();
  const isFullscreen = playerUIState.isLyricsFullscreen && playerUIState.isLyricsOpen;
  const isNowPlayingOpen = playerUIState.isQueueOpen && playerUIState.rightPanelTab === "nowplaying";
  const isQueueActive = playerUIState.isQueueOpen && playerUIState.rightPanelTab === "queue";

  const handleToggleNowPlaying = () => {
    if (isNowPlayingOpen) {
      playerUIStore.setQueueOpen(false);
    } else {
      playerUIStore.setRightPanelTab("nowplaying");
    }
  };

  const handleToggleQueueTab = () => {
    if (isQueueActive) {
      playerUIStore.setQueueOpen(false);
    } else {
      playerUIStore.setRightPanelTab("queue");
    }
  };

  const handleToggleFullscreen = () => {
    if (isFullscreen) {
      playerUIStore.setLyricsFullscreen(false);
    } else {
      playerUIStore.setLyricsOpen(true);
      playerUIStore.setLyricsFullscreen(true);
    }
  };

  const [spotifyCover, setSpotifyCover] = useState<string | null>(null);

  useEffect(() => {
    setSpotifyCover(null);
    if (!currentTrack || currentTrack.source === "local" || !currentTrack.title) return;
    let active = true;
    void SpotifyService.getTrackCoverUrl(currentTrack.title, currentTrack.artist, currentTrack.album)
      .then((url) => {
        if (active && url) setSpotifyCover(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album]);

  const effectiveArtworkUrl = spotifyCover
    ?? (currentTrack?.artworkUrl
      || (currentTrack?.id ? getVideoArtworkFallback(currentTrack.id) : undefined));

  const dominantColor = useArtworkDominantColor(effectiveArtworkUrl);

  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
 
  const connectionCheckRef = useRef<Promise<boolean> | null>(null);
  const wasOfflineRef = useRef(!navigator.onLine);
  const recoveryStartedRef = useRef(false);
  const failedChecksRef = useRef(0);

  const updateConnectionState = useCallback((connected: boolean) => {
    if (connected) failedChecksRef.current = 0;
    setIsOnline(connected);

    if (!connected) {
      wasOfflineRef.current = true;
      return;
    }

    if (wasOfflineRef.current && !recoveryStartedRef.current) {
      recoveryStartedRef.current = true;
      void onConnectionRestored();
    }
  }, [onConnectionRestored]);

  const checkConnection = useCallback(async () => {
    if (connectionCheckRef.current) return connectionCheckRef.current;

    const check = (async () => {
      if (!navigator.onLine) {
        failedChecksRef.current += 1;
        if (failedChecksRef.current >= 2) {
          updateConnectionState(false);
        } else {
          window.setTimeout(() => void checkConnection(), 1500);
        }
        return false;
      }

      const checks = await Promise.allSettled(
        CONNECTION_CHECK_URLS.map((url) =>
          tauriFetch(url, {
            cache: "no-store",
            method: "GET",
          })
        ),
      );
      const connected = checks.some((result) => result.status === "fulfilled");
      if (connected) {
        updateConnectionState(true);
      } else {
        failedChecksRef.current += 1;
        if (failedChecksRef.current >= 2) {
          updateConnectionState(false);
        } else {
          window.setTimeout(() => void checkConnection(), 1500);
        }
      }
      return connected;
    })();

    connectionCheckRef.current = check;
    try {
      return await check;
    } finally {
      connectionCheckRef.current = null;
    }
  }, [updateConnectionState]);

  useEffect(() => {
    const handleOnline = () => void checkConnection();
    const handleOffline = () => void checkConnection();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkConnection();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void checkConnection();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkConnection, updateConnectionState]);

  useEffect(() => {
    if (isOnline) return;

    const retryTimer = window.setInterval(() => {
      void checkConnection();
    }, 5000);

    return () => window.clearInterval(retryTimer);
  }, [checkConnection, isOnline]);

  const reconnect = async () => {
    setIsCheckingConnection(true);

    try {
      await checkConnection();
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const extraControlsAlwaysVisible = useExtraPlayerControlsAlwaysVisible();
  const isCoverAmbience = useCoverAmbienceEnabled();
  const coverAmbienceStyle = isCoverAmbience && dominantColor?.rgb
    ? {
        backgroundImage: `linear-gradient(to right, rgba(${dominantColor.rgb.r}, ${dominantColor.rgb.g}, ${dominantColor.rgb.b}, 0.22) 0%, rgba(12, 12, 14, 0.95) 340px, rgba(12, 12, 14, 0.98) 100%)`,
      }
    : undefined;

  return (
    <>
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex shrink-0 items-center justify-center gap-3 overflow-hidden bg-muted px-2 py-1  text-sm text-foreground"
            role="status"
            aria-live="polite"
          >
            <span>You don't have an internet connection</span>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors hover:bg-card disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void reconnect()}
              disabled={isCheckingConnection}
              aria-label="Reconnect to the internet"
            >
              {isCheckingConnection ? (
                <SpinnerSteps size={24} />
              ) : (
                <PlayActiveIcon size={14} aria-hidden="true" />
              )}
              <span>{isCheckingConnection ? "Checking" : "Reconnect"}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        style={coverAmbienceStyle}
        className="group/playerbar flex shrink-0 items-center border-t border-border/40 bg-background/95 backdrop-blur-md px-4 py-2 min-h-[72px] cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, [role='slider'], a")) {
            return;
          }
          handlePlayerBarClick();
        }}
      >
        <div className="grid w-full grid-cols-[minmax(250px,1.3fr)_minmax(320px,2fr)_minmax(180px,1fr)] items-center gap-4">
          {/* Left: Track Info & Like */}
          <div className="min-w-0 max-w-full flex items-center justify-start flex-1">
            <TrackInfo artworkUrl={effectiveArtworkUrl} dominantColor={dominantColor} />
          </div>

          {/* Center: Playback Transport + Spotify Centered Seekbar */}
          <div className="flex flex-col items-center gap-1 w-full max-w-xl justify-self-center player-controls overflow-visible">
            <PlaybackControls extraControlsAlwaysVisible={extraControlsAlwaysVisible} />
            <div className="w-full max-w-[540px] overflow-visible">
              <SeekBar />
            </div>
          </div>

          {/* Right: Secondary controls */}
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <div
              className={cn(
                "flex items-center gap-1 transition-opacity",
                !extraControlsAlwaysVisible &&
                  "opacity-0 focus-within:opacity-100 group-hover/playerbar:opacity-100",
              )}
            >
              {/* Now Playing View Button (Spotify style right sidebar) */}
              <button
                type="button"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                  isNowPlayingOpen
                    ? "bg-card text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={handleToggleNowPlaying}
                aria-label={isNowPlayingOpen ? "Close now playing view" : "Now playing view"}
                title={isNowPlayingOpen ? "Close now playing view" : "Now playing view"}
              >
                <NowPlayingViewIcon size={17} />
              </button>

              {/* Lyrics Button */}
              <LyricsButton onToggle={onToggleLyrics} />

              {/* Queue Button */}
              <button
                type="button"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                  isQueueActive
                    ? "bg-card text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={handleToggleQueueTab}
                aria-label={isQueueActive ? "Close queue" : "Open queue"}
                title={isQueueActive ? "Close queue" : "Open queue"}
              >
                <QueuePanelIcon size={18} />
              </button>

              {/* Fullscreen Button (Apple Music / Spicetify Split Fullscreen) */}
              <button
                type="button"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                  isFullscreen
                    ? "bg-card text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
                title={isFullscreen ? "Exit full screen" : "Full screen"}
              >
                <FullScreenIcon size={17} />
              </button>

              {/* Wave Player Miniplayer (03x1/Wave-Player) */}
              <button
                type="button"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                  playerUIState.isWaveMiniPlayerOpen
                    ? "bg-card text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => playerUIStore.toggleWaveMiniPlayer()}
                aria-label={playerUIState.isWaveMiniPlayerOpen ? "Close mini player" : "Open mini player"}
                title="Wave Player Miniplayer"
              >
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.2" />
                </svg>
              </button>
            </div>

            <DownloadButton />
            <VolumeControl />
          </div>
        </div>
      </div>
    </>
  );
}
