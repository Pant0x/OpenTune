import { useCallback, useEffect, useRef, useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CloseIcon,
  FullScreenIcon,
  HeartActiveIcon,
  HeartIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  QuitFullScreenIcon,
  RepeatActiveIcon,
  RepeatIcon,
  RepeatOneActiveIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  VolumeLoudIcon,
  VolumeMutedIcon,
  VolumeSmallIcon,
} from "@/ui/icons";
import {
  libraryController,
  playerController,
  shallowEqual,
  useLibraryState,
  usePlayerSelector,
  usePlayerSessionSelector,
} from "../../player/playerStore";
import type { PlayerSession } from "../../player/PlayerController";
import type { Lyrics, Track } from "../../datasource/types";
import { playerUIStore } from "../stores/playerUIStore";
import { SpotifyService, type SpotifyArtistOverview } from "../../services/SpotifyService";
import { TrackArtwork } from "../components/TrackArtwork";
import { ArtistLinks, useArtistNavigation } from "../components/ArtistLinks";
import { findActiveLineIndex, isSyncedLyrics } from "./lyricsTiming";

interface NowPlayingFullscreenViewProps {
  onClose: () => void;
}

function selectQueueSlice(session: PlayerSession | null) {
  return {
    queue: session?.queue ?? [],
    queueIndex: session?.queueIndex ?? -1,
  };
}

function queueSliceEqual(
  a: ReturnType<typeof selectQueueSlice>,
  b: ReturnType<typeof selectQueueSlice>,
) {
  return (
    a.queueIndex === b.queueIndex &&
    a.queue.length === b.queue.length &&
    a.queue.every((t, i) => t === b.queue[i])
  );
}

export function NowPlayingFullscreenView({ onClose }: NowPlayingFullscreenViewProps) {
  const playerState = usePlayerSelector(
    (player) => ({
      currentTrack: player.currentTrack,
      status: player.status,
      playbackOrderMode: player.playbackOrderMode,
      shuffleEnabled: player.shuffleEnabled,
      volume: player.volume,
      muted: player.muted,
    }),
    shallowEqual,
  );
  const track = playerState.currentTrack;
  const isPlaying = playerState.status === "playing";
  const libraryState = useLibraryState();
  const navigateArtist = useArtistNavigation();

  const { queue, queueIndex } = usePlayerSessionSelector(selectQueueSlice, queueSliceEqual);
  const nextTrack: Track | undefined = queueIndex >= 0 && queueIndex + 1 < queue.length ? queue[queueIndex + 1] : undefined;

  // View mode: "artwork" or "lyrics"
  const [viewMode, setViewMode] = useState<"artwork" | "lyrics">("artwork");
  const [isIdle, setIsIdle] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  // Playback & seek
  const [currentTime, setCurrentTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // Volume
  const [volume, setVolume] = useState(() => playerController.getVolume());
  const [isMuted, setIsMuted] = useState(() => playerController.isMuted());
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Fullscreen
  const [isOsFullscreen, setIsOsFullscreen] = useState(false);

  // Artist Overview for "About the artist"
  const [artistOverview, setArtistOverview] = useState<SpotifyArtistOverview | null>(null);

  // Lyrics
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const lyricsScrollerRef = useRef<HTMLDivElement>(null);
  const lyricsLineRefs = useRef<Array<HTMLElement | null>>([]);

  // Check initial OS fullscreen
  useEffect(() => {
    try {
      void getCurrentWindow().isFullscreen().then(setIsOsFullscreen);
    } catch {}
  }, []);

  const toggleOsFullscreen = async () => {
    try {
      const next = !isOsFullscreen;
      await getCurrentWindow().setFullscreen(next);
      setIsOsFullscreen(next);
    } catch {}
  };

  // Keyboard navigation: Escape closes this view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Idle timer for auto-hiding dock and controls (Spotify behavior)
  const resetIdleTimer = useCallback(() => {
    setIsIdle(false);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      setIsIdle(true);
    }, 2800);
  }, []);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [resetIdleTimer]);

  // Sync playback time
  useEffect(() => {
    const updateTime = () => {
      if (!isSeeking) {
        setCurrentTime(playerController.getCurrentTime());
      }
    };
    updateTime();
    const interval = window.setInterval(updateTime, 250);
    return () => window.clearInterval(interval);
  }, [isSeeking]);

  // Sync volume state
  useEffect(() => {
    setVolume(playerState.volume);
    setIsMuted(playerState.muted);
  }, [playerState.volume, playerState.muted]);

  // Fetch Artist Overview
  useEffect(() => {
    if (!track?.artist) {
      setArtistOverview(null);
      return;
    }
    let active = true;
    void SpotifyService.getArtistOverview(track.artist).then((overview) => {
      if (active && overview) {
        setArtistOverview(overview);
      }
    });
    return () => {
      active = false;
    };
  }, [track?.artist]);

  // Fetch Lyrics when viewMode is "lyrics"
  useEffect(() => {
    if (viewMode !== "lyrics" || !track) return;
    let cancelled = false;
    setIsLoadingLyrics(true);
    setLyrics(null);
    setActiveLyricIndex(-1);

    void playerController
      .getLyrics(track)
      .then((res) => {
        if (!cancelled) setLyrics(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingLyrics(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewMode, track]);

  // Update active lyrics line
  useEffect(() => {
    if (viewMode !== "lyrics" || !lyrics || !isSyncedLyrics(lyrics)) return;
    const lines = lyrics.lines;
    const index = findActiveLineIndex(lines, currentTime);
    setActiveLyricIndex(index);

    if (index >= 0 && lyricsLineRefs.current[index]) {
      lyricsLineRefs.current[index]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [viewMode, lyrics, currentTime]);

  const displayedTime = isSeeking ? seekTime : currentTime;
  const duration = track?.durationSec || 100;
  const isLiked = track
    ? libraryState.library?.likedSongs.some((s) => s.id === track.id) ?? false
    : false;

  const handleSeekChange = (val: number) => {
    setSeekTime(val);
  };

  const handleSeekCommit = (val: number) => {
    setIsSeeking(false);
    setCurrentTime(val);
    void playerController.seekTo(val);
  };

  const handleToggleLike = async () => {
    if (track) {
      await libraryController.setTrackRating(track, isLiked ? "none" : "like");
    }
  };

  const handleVolumeChange = (nextPercent: number) => {
    const next = Math.min(1, Math.max(0, nextPercent / 100));
    setVolume(next);
    setIsMuted(next === 0);
    void playerController.setVolume(next);
  };

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
    void playerController.toggleMute();
  };

  const displayedVolume = isMuted ? 0 : volume;
  const VolumeGlyph = isMuted
    ? VolumeMutedIcon
    : displayedVolume < 0.5
      ? VolumeSmallIcon
      : VolumeLoudIcon;

  return (
    <div
      onPointerMove={resetIdleTimer}
      onClick={resetIdleTimer}
      className="fixed inset-0 z-50 overflow-y-auto bg-black text-white selection:bg-white/20 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* Dynamic blurred ambient background from track artwork */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        {track?.artworkUrl && (
          <div
            className="absolute -inset-[30%] opacity-65 blur-[90px] saturate-[2.5] scale-125 transition-all duration-1000"
            style={{
              backgroundImage: `url(${track.artworkUrl})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }}
          />
        )}
        <div className="absolute inset-0 bg-black/45" />
      </div>

      {/* Screen 1: 100vh Full Viewport */}
      <div className="relative min-h-screen flex flex-col justify-between p-6 sm:p-10">
        {/* Top Header Bar */}
        <header
          className={cn(
            "flex items-center justify-between transition-opacity duration-300 z-30",
            isIdle ? "opacity-0 pointer-events-none" : "opacity-100",
          )}
        >
          {/* View Switcher Pill: Artwork / Lyrics */}
          <div className="flex items-center rounded-full bg-black/40 backdrop-blur-md p-1 border border-white/15 text-xs font-semibold text-white/80 shadow-lg">
            <button
              type="button"
              onClick={() => setViewMode("artwork")}
              className={cn(
                "rounded-full px-4 py-1.5 transition-all cursor-pointer",
                viewMode === "artwork"
                  ? "bg-white/20 text-white shadow-sm font-bold"
                  : "hover:text-white",
              )}
            >
              Artwork
            </button>
            <button
              type="button"
              onClick={() => setViewMode("lyrics")}
              className={cn(
                "rounded-full px-4 py-1.5 transition-all cursor-pointer",
                viewMode === "lyrics"
                  ? "bg-white/20 text-white shadow-sm font-bold"
                  : "hover:text-white",
              )}
            >
              Lyrics
            </button>
          </div>

          {/* Right Action Icons: Fullscreen & Exit */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void toggleOsFullscreen()}
              className={cn(
                "flex size-10 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-md border border-white/15 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shadow-lg",
                isOsFullscreen && "bg-white/25 text-white",
              )}
              aria-label="Toggle OS fullscreen"
              title="Toggle OS fullscreen"
            >
              {isOsFullscreen ? <QuitFullScreenIcon size={18} /> : <FullScreenIcon size={18} />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex size-10 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-md border border-white/15 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shadow-lg"
              aria-label="Exit fullscreen"
              title="Exit fullscreen (Esc)"
            >
              <CloseIcon size={20} />
            </button>
          </div>
        </header>

        {/* Center Display: Album Art OR Lyrics */}
        <main className="relative my-auto flex-1 flex items-center justify-center py-6">
          {viewMode === "artwork" ? (
            <div className="relative size-64 sm:size-80 md:size-96 lg:size-[440px] xl:size-[500px] rounded-2xl overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] ring-1 ring-white/15 transition-transform duration-500 hover:scale-[1.02]">
              <TrackArtwork
                artworkUrl={track?.artworkUrl}
                size={540}
                className="size-full object-cover"
                iconSize={80}
                loading="eager"
              />
            </div>
          ) : (
            <div className="relative max-w-3xl w-full h-[60vh] flex flex-col items-center justify-center">
              <div
                ref={lyricsScrollerRef}
                className="relative h-full w-full overflow-y-auto px-6 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {isLoadingLyrics ? (
                  <div className="flex h-full items-center justify-center text-white/50 text-base">
                    Loading lyrics...
                  </div>
                ) : !lyrics?.lines?.length ? (
                  <div className="flex h-full items-center justify-center text-white/50 text-base">
                    No lyrics available for this track.
                  </div>
                ) : (
                  <div className="flex flex-col gap-6 py-32">
                    {lyrics.lines.map((line, idx) => {
                      const isActive = idx === activeLyricIndex;
                      return (
                        <button
                          key={`${idx}:${line.text}`}
                          ref={(el) => {
                            lyricsLineRefs.current[idx] = el;
                          }}
                          type="button"
                          onClick={() => {
                            if (line.startTimeSec !== undefined) {
                              void playerController.seekTo(line.startTimeSec);
                            }
                          }}
                          className={cn(
                            "cursor-pointer font-bold leading-tight tracking-tight transition-all duration-300 select-text",
                            isActive
                              ? "text-white text-2xl sm:text-3xl lg:text-4xl scale-105"
                              : "text-white/40 text-lg sm:text-xl lg:text-2xl hover:text-white/80",
                          )}
                        >
                          {line.text}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Bottom Section: Left Track Info + Floating Centered Player Dock */}
        <footer className="relative z-30 flex items-end justify-between min-h-[96px] pb-2">
          {/* Bottom Left: Track Title, Artist, & Like */}
          <div className="flex items-center gap-4 max-w-sm sm:max-w-md lg:max-w-lg min-w-0 pr-4">
            <div className="flex flex-col min-w-0">
              <span className="truncate text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                {track?.title ?? "Unknown Title"}
              </span>
              <span className="truncate text-sm sm:text-base text-white/75 font-medium mt-0.5">
                <ArtistLinks artists={track?.artists} fallback={track?.artist} />
              </span>
            </div>

            {track && (
              <button
                type="button"
                onClick={handleToggleLike}
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer",
                  isLiked ? "text-primary" : "text-white/60 hover:text-white",
                )}
                aria-label={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
              >
                {isLiked ? <HeartActiveIcon size={22} /> : <HeartIcon size={22} />}
              </button>
            )}
          </div>

          {/* Floating Centered Player Dock (Spotify Style, Auto-hides on idle) */}
          <div
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-2xl rounded-2xl bg-black/75 backdrop-blur-2xl border border-white/15 px-6 py-3.5 shadow-2xl transition-all duration-300 flex flex-col gap-2.5 z-40",
              isIdle
                ? "translate-y-24 opacity-0 pointer-events-none"
                : "translate-y-0 opacity-100",
            )}
          >
            {/* Seek Bar Row */}
            <div className="flex items-center gap-3 w-full text-xs text-white/70 font-medium tabular-nums">
              <span>{formatMinutesSeconds(displayedTime)}</span>
              <input
                type="range"
                min={0}
                max={duration}
                step="any"
                value={displayedTime}
                onPointerDown={() => setIsSeeking(true)}
                onChange={(e) => handleSeekChange(parseFloat(e.target.value))}
                onPointerUp={(e) => handleSeekCommit(parseFloat((e.target as HTMLInputElement).value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-white hover:accent-primary transition-all"
                aria-label="Seek track"
              />
              <span>{formatMinutesSeconds(duration)}</span>
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between pt-1">
              {/* Left spacer for balance */}
              <div className="flex items-center gap-2 w-28">
                <button
                  type="button"
                  onClick={() => playerController.toggleShuffle()}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer",
                    playerState.shuffleEnabled
                      ? "text-primary"
                      : "text-white/60 hover:text-white",
                  )}
                  aria-label="Toggle shuffle"
                >
                  {playerState.shuffleEnabled ? <ShuffleActiveIcon size={18} /> : <ShuffleIcon size={18} />}
                </button>

                <button
                  type="button"
                  onClick={() => playerController.cyclePlaybackOrderMode()}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer",
                    playerState.playbackOrderMode !== "in-order"
                      ? "text-primary"
                      : "text-white/60 hover:text-white",
                  )}
                  aria-label="Cycle repeat mode"
                >
                  {playerState.playbackOrderMode === "repeat-one" ? (
                    <RepeatOneActiveIcon size={18} />
                  ) : playerState.playbackOrderMode === "repeat-all" ? (
                    <RepeatActiveIcon size={18} />
                  ) : (
                    <RepeatIcon size={18} />
                  )}
                </button>
              </div>

              {/* Center Controls: Prev, Play/Pause, Next */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => void playerController.skipToPrevious()}
                  className="flex size-9 items-center justify-center rounded-full text-white/80 hover:text-white transition-colors cursor-pointer"
                  aria-label="Previous track"
                >
                  <SkipPreviousIcon size={22} />
                </button>

                <button
                  type="button"
                  onClick={() => void playerController.togglePlayPause()}
                  className="flex size-11 items-center justify-center rounded-full bg-white text-black shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <PauseActiveIcon size={22} fill="currentColor" />
                  ) : (
                    <PlayActiveIcon size={22} fill="currentColor" className="ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void playerController.skipToNext()}
                  className="flex size-9 items-center justify-center rounded-full text-white/80 hover:text-white transition-colors cursor-pointer"
                  aria-label="Next track"
                >
                  <SkipNextIcon size={22} />
                </button>
              </div>

              {/* Right: Volume & Queue Quick Toggle */}
              <div className="flex items-center justify-end gap-2 w-28 relative">
                <div
                  className="relative flex items-center"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    className="flex size-8 items-center justify-center rounded-full text-white/70 hover:text-white transition-colors cursor-pointer"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                  >
                    <VolumeGlyph size={18} />
                  </button>

                  {showVolumeSlider && (
                    <div className="absolute bottom-full right-0 mb-2 p-2 rounded-xl bg-black/90 backdrop-blur-md border border-white/15 shadow-xl flex items-center h-28 w-8 justify-center">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(displayedVolume * 100)}
                        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                        className="h-20 w-1.5 cursor-pointer appearance-none rounded-full bg-white/30 accent-white [writing-mode:bt-lr] [-webkit-appearance:slider-vertical]"
                        aria-label="Volume slider"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => playerUIStore.toggleQueue()}
                  className="flex size-8 items-center justify-center rounded-full text-white/70 hover:text-white transition-colors cursor-pointer"
                  aria-label="Toggle queue"
                >
                  <span className="text-xs font-bold tracking-tight">Queue</span>
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Screen 2: Scroll Down for "About the artist" and "Next in queue" */}
      <section className="relative max-w-5xl mx-auto w-full px-6 sm:px-10 pb-36 pt-8 flex flex-col gap-10">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-white/60">
            More Details
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Left / Main: About the Artist Card (Matching Image 4) */}
          <div className="md:col-span-7 flex flex-col gap-4">
            <h3 className="text-lg font-bold text-white tracking-tight">About the artist</h3>
            <div
              onClick={() => {
                if (navigateArtist && track?.artist) {
                  navigateArtist({ id: "", name: track.artist }, false);
                  onClose();
                }
              }}
              className="group relative h-[360px] sm:h-[400px] w-full cursor-pointer overflow-hidden rounded-2xl bg-card border border-white/10 transition-all duration-300 hover:shadow-2xl hover:border-white/25"
            >
              <img
                src={
                  artistOverview?.headerUrl ||
                  artistOverview?.avatarUrl ||
                  track?.artworkUrl ||
                  ""
                }
                alt={track?.artist ?? "Artist"}
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

              {/* Top-Right Spotify World Rank Badge (Image 5) */}
              {artistOverview?.worldRank ? (
                <div className="absolute top-5 right-5 z-10 flex size-16 shrink-0 flex-col items-center justify-center rounded-full bg-[#0D72EC] text-white shadow-xl shadow-[#0D72EC]/40 select-none">
                  <span className="text-xl font-black tracking-tight leading-none">
                    #{artistOverview.worldRank}
                  </span>
                  <span className="text-[10px] font-bold tracking-tight text-white/95 leading-tight mt-0.5">
                    in the world
                  </span>
                </div>
              ) : null}

              <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-2">
                <span className="text-2xl font-black text-white tracking-tight">
                  {track?.artist}
                </span>
                {artistOverview?.monthlyListeners ? (
                  <span className="text-sm font-semibold text-white/90">
                    {artistOverview.monthlyListeners.toLocaleString()} monthly listeners
                  </span>
                ) : null}
                {artistOverview?.cleanBio || artistOverview?.bio ? (
                  <p className="line-clamp-3 text-sm text-white/75 leading-relaxed mt-1">
                    {artistOverview?.cleanBio || artistOverview?.bio}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Right: Next in Queue Card (Matching Image 4) */}
          <div className="md:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white tracking-tight">Next in queue</h3>
              <button
                type="button"
                onClick={() => {
                  playerUIStore.setQueueOpen(true);
                  onClose();
                }}
                className="text-xs font-semibold text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                Open queue
              </button>
            </div>

            {nextTrack ? (
              <div
                onClick={() => void playerController.skipToNext()}
                className="group relative flex items-center gap-4 rounded-2xl bg-white/5 border border-white/10 p-4 transition-all duration-200 hover:bg-white/10 hover:border-white/20 cursor-pointer shadow-lg"
              >
                <div className="relative size-16 shrink-0 rounded-xl overflow-hidden shadow-md ring-1 ring-white/10">
                  <TrackArtwork
                    artworkUrl={nextTrack.artworkUrl}
                    size={64}
                    className="size-full object-cover"
                  />
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-base font-bold text-white tracking-tight group-hover:text-primary transition-colors">
                    {nextTrack.title}
                  </span>
                  <span className="truncate text-xs text-white/70 mt-0.5">
                    {nextTrack.artist}
                  </span>
                  {nextTrack.durationSec ? (
                    <span className="text-[11px] text-white/50 tabular-nums mt-1 font-medium">
                      {formatMinutesSeconds(nextTrack.durationSec)}
                    </span>
                  ) : null}
                </div>

                <div className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <PlayActiveIcon size={16} fill="currentColor" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-44 rounded-2xl border border-dashed border-white/15 p-6 text-center text-white/50 text-sm">
                <span>No upcoming tracks in queue</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
