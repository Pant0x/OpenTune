import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import {
  CloseIcon,
  HeartActiveIcon,
  HeartIcon,
  LyricsActiveIcon,
  LyricsIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  QueuePanelIcon,
  QuitFullScreenIcon,
  RefreshIcon,
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
import { findActiveLineIndex, isRtlText, isSyncedLyrics } from "./lyricsTiming";
import { VideoPlayerView } from "../components/player/VideoPlayerView";
import { getMediaCounterpart } from "../../datasource/youtube/videoService";

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
  const nextTrack: Track | undefined =
    queueIndex >= 0 && queueIndex + 1 < queue.length ? queue[queueIndex + 1] : undefined;

  // View mode: "artwork" | "lyrics" | "split"
  const [viewMode, setViewMode] = useState<"artwork" | "lyrics" | "split">("split");
  const [mediaMode, setMediaMode] = useState<"song" | "video">(() => (track?.isVideo ? "video" : "song"));
  const [videoCounterpart, setVideoCounterpart] = useState<Track | null>(null);
  const [songCounterpart, setSongCounterpart] = useState<Track | null>(null);

  const isPodcast = useMemo(() => {
    if (!track) return false;
    const lower = `${track.title} ${track.artist || ""}`.toLowerCase();
    return lower.includes("podcast") || lower.includes("episode") || lower.includes("show");
  }, [track]);

  const activeVideoId = useMemo(() => {
    if (!track) return "";
    if (track.isVideo) return track.id;
    if (videoCounterpart?.id) return videoCounterpart.id;
    return track.id;
  }, [track, videoCounterpart]);

  useEffect(() => {
    if (!track) return;
    setVideoCounterpart(null);
    setSongCounterpart(null);
    setMediaMode(track.isVideo ? "video" : "song");

    let active = true;
    if (track.isVideo) {
      void getMediaCounterpart(track, "song").then((res) => {
        if (active && res) setSongCounterpart(res);
      });
    } else {
      void getMediaCounterpart(track, "video").then((res) => {
        if (active && res) setVideoCounterpart(res);
      });
    }
    return () => {
      active = false;
    };
  }, [track?.id]);

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

  // Scroll container and details visibility
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const detailsSectionRef = useRef<HTMLElement>(null);
  const [isDetailsInView, setIsDetailsInView] = useState(false);

  const scrollToPlayerTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToDetails = useCallback(() => {
    detailsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    resetIdleTimer();
    const scrollTop = e.currentTarget.scrollTop;
    const threshold = window.innerHeight * 0.35;
    setIsDetailsInView(scrollTop > threshold);
  };

  const handleSwitchMediaMode = useCallback(async (mode: "song" | "video") => {
    if (!track || mode === mediaMode) return;
    if (mode === "video") {
      void playerController.pause();
      setMediaMode("video");
    } else {
      setMediaMode("song");
      if (track.isVideo && songCounterpart) {
        void playerController.playTrackById(songCounterpart.id, [songCounterpart], true);
      } else {
        void playerController.play();
      }
      if (currentTime > 0) {
        void playerController.seekTo(currentTime);
      }
    }
  }, [track, mediaMode, songCounterpart, currentTime]);

  // Artist Overview for "About the artist"
  const [artistOverview, setArtistOverview] = useState<SpotifyArtistOverview | null>(null);
  const [isFollowingArtist, setIsFollowingArtist] = useState(false);

  // Lyrics
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const [isLyricsSyncLocked, setIsLyricsSyncLocked] = useState(true);
  const lyricsScrollerRef = useRef<HTMLDivElement>(null);
  const lyricsLineRefs = useRef<Array<HTMLElement | null>>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLyricsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    setIsLyricsSyncLocked(false);
    const el = lyricsScrollerRef.current;
    if (!el || !scrollContainerRef.current) return;

    if (e.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 15) {
      scrollContainerRef.current.scrollBy({ top: e.deltaY, behavior: "auto" });
    }
  };

  useEffect(() => {
    setIsLyricsSyncLocked(true);
  }, [track?.id]);



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
    const handlePointerMove = () => resetIdleTimer();
    const handlePointerDown = () => resetIdleTimer();
    const handleKeyDown = () => resetIdleTimer();
    const handleMouseLeave = () => {
      // Mouse is away from the app: hide dock, title, and cards immediately
      setIsIdle(true);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("blur", handleMouseLeave);

    resetIdleTimer();

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("blur", handleMouseLeave);
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

  // Follow state for the About-the-artist card, keyed by name in the same store the artist
  // page writes (the fullscreen view has the artist's name only, never its channel id).
  useEffect(() => {
    if (!track?.artist) {
      setIsFollowingArtist(false);
      return;
    }
    try {
      const raw = localStorage.getItem("amber_followed_artists");
      const parsed = raw ? JSON.parse(raw) : [];
      setIsFollowingArtist(
        Array.isArray(parsed) && parsed.includes(track.artist.toLowerCase()),
      );
    } catch {
      setIsFollowingArtist(false);
    }
  }, [track?.artist]);

  const toggleFollowingArtist = () => {
    const name = track?.artist;
    if (!name) return;
    const key = name.toLowerCase();
    let next: Set<string>;
    try {
      const raw = localStorage.getItem("amber_followed_artists");
      const parsed = raw ? JSON.parse(raw) : [];
      next = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      next = new Set();
    }
    if (next.has(key)) {
      next.delete(key);
      setIsFollowingArtist(false);
    } else {
      next.add(key);
      setIsFollowingArtist(true);
    }
    try {
      localStorage.setItem("amber_followed_artists", JSON.stringify([...next]));
    } catch {}
  };

  // Fetch Lyrics when viewMode is "lyrics" or "split"
  useEffect(() => {
    if (viewMode === "artwork" || !track) return;
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
    if (viewMode === "artwork" || !lyrics || !isSyncedLyrics(lyrics)) return;
    const lines = lyrics.lines;
    const index = findActiveLineIndex(lines, currentTime);
    setActiveLyricIndex(index);

    // Only auto-scroll when user has not manually scrolled away and not viewing details
    if (isLyricsSyncLocked && !isDetailsInView && index >= 0 && lyricsScrollerRef.current) {
      const container = lyricsScrollerRef.current;
      const lineEl = lyricsLineRefs.current[index];
      if (lineEl) {
        const containerRect = container.getBoundingClientRect();
        const lineRect = lineEl.getBoundingClientRect();
        const offset = lineRect.top - containerRect.top - (containerRect.height / 2) + (lineRect.height / 2);
        container.scrollBy({
          top: offset,
          behavior: "smooth",
        });
      }
    }
  }, [viewMode, lyrics, currentTime, isLyricsSyncLocked, isDetailsInView]);

  const handleResyncLyrics = () => {
    setIsLyricsSyncLocked(true);
    if (activeLyricIndex >= 0 && lyricsScrollerRef.current) {
      const container = lyricsScrollerRef.current;
      const lineEl = lyricsLineRefs.current[activeLyricIndex];
      if (lineEl) {
        const containerRect = container.getBoundingClientRect();
        const lineRect = lineEl.getBoundingClientRect();
        const offset = lineRect.top - containerRect.top - (containerRect.height / 2) + (lineRect.height / 2);
        container.scrollBy({
          top: offset,
          behavior: "smooth",
        });
      }
    }
  };

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
      ref={containerRef}
      onPointerMove={resetIdleTimer}
      onClick={resetIdleTimer}
      className={cn(
        "fixed inset-0 z-[100] overflow-hidden bg-black text-white selection:bg-white/20 select-none",
        isIdle && "cursor-none",
      )}
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
        <div className="absolute inset-0 bg-black/50" />
      </div>

      {/* Top Header Bar (Hides when isIdle on player screen) */}
      <header
        className={cn(
          "fixed top-0 inset-x-0 p-6 sm:p-8 flex items-center justify-between z-40 transition-all duration-300",
          isIdle && !isDetailsInView ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
        )}
      >
        {/* Left: Close / Back link */}
        <button
          type="button"
          onClick={() => {
            if (isDetailsInView) {
              scrollToPlayerTop();
            } else {
              onClose();
            }
          }}
          className="flex items-center gap-2 rounded-full bg-black/40 text-white/80 hover:text-white backdrop-blur-md px-4 py-2 text-xs font-bold border border-white/15 transition-all shadow-lg cursor-pointer"
        >
          <span>{isDetailsInView ? "← Back to Player" : "Back"}</span>
        </button>

        {/* Media & View Switcher Pills */}
        <div className="flex items-center gap-2">
          {/* Song / Video Switcher */}
          <div className="flex items-center rounded-full bg-black/60 backdrop-blur-md p-1 border border-white/15 text-xs font-semibold text-white/80 shadow-lg">
            <button
              type="button"
              onClick={() => void handleSwitchMediaMode("song")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-all cursor-pointer",
                mediaMode === "song"
                  ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                  : "hover:text-white",
              )}
            >
              <span>{isPodcast ? "Audio" : "Song"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSwitchMediaMode("video")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-all cursor-pointer",
                mediaMode === "video"
                  ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                  : "hover:text-white",
              )}
            >
              <span>Video</span>
            </button>
          </div>

          {/* View Switcher Pill: Artwork / Lyrics / Split / Details */}
          {mediaMode === "song" && (
            <div className="flex items-center rounded-full bg-black/60 backdrop-blur-md p-1 border border-white/15 text-xs font-semibold text-white/80 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setViewMode("artwork");
                  scrollToPlayerTop();
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 transition-all cursor-pointer",
                  !isDetailsInView && viewMode === "artwork"
                    ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                    : "hover:text-white",
                )}
              >
                Artwork
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("lyrics");
                  scrollToPlayerTop();
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 transition-all cursor-pointer",
                  !isDetailsInView && viewMode === "lyrics"
                    ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                    : "hover:text-white",
                )}
              >
                Lyrics
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("split");
                  scrollToPlayerTop();
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 transition-all cursor-pointer",
                  !isDetailsInView && viewMode === "split"
                    ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                    : "hover:text-white",
                )}
              >
                Split
              </button>
              <button
                type="button"
                onClick={scrollToDetails}
                className={cn(
                  "rounded-full px-4 py-1.5 transition-all cursor-pointer",
                  isDetailsInView
                    ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                    : "hover:text-white",
                )}
              >
                Details
              </button>
            </div>
          )}
        </div>

        {/* Right Action Icons: In-app Fullscreen Toggle & Exit */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-md border border-white/15 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shadow-lg"
            aria-label="Exit full screen"
            title="Exit full screen (Esc)"
          >
            <QuitFullScreenIcon size={18} />
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

      {/* Main Scrollable Area containing Hero Screen and Details Section */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative h-full w-full overflow-y-auto overflow-x-hidden scroll-smooth [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 hover:[&::-webkit-scrollbar-thumb]:bg-white/40 [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {mediaMode === "video" ? (
          <div className="relative min-h-screen w-full flex flex-col justify-start items-center p-4 sm:p-8 pt-20 pb-20 max-w-6xl mx-auto">
            {track && (
              <VideoPlayerView
                videoId={activeVideoId}
                track={track}
                initialTime={currentTime}
                onSwitchToSong={() => void handleSwitchMediaMode("song")}
                isPodcast={isPodcast}
              />
            )}
          </div>
        ) : (
          <>
            {/* Screen 1: Hero Player (Artwork / Lyrics / Split) */}
            <div className="relative min-h-screen w-full flex flex-col justify-center items-center p-6 sm:p-10 pt-20 pb-28">
          {/* Center Display: Album Art, Lyrics, or Split */}
          <main className="relative my-auto flex-1 flex items-center justify-center py-6 w-full">
            {viewMode === "artwork" && (
              <div className="relative size-64 sm:size-80 md:size-96 lg:size-[440px] xl:size-[500px] rounded-2xl overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] ring-1 ring-white/15 transition-transform duration-500 hover:scale-[1.01]">
                <TrackArtwork
                  artworkUrl={track?.artworkUrl}
                  size={540}
                  className="size-full object-cover"
                  iconSize={80}
                  loading="eager"
                />
              </div>
            )}

            {viewMode === "lyrics" && (
              <div className="relative w-full max-w-3xl h-[65vh] flex items-center justify-center px-4">
                <div
                  className="relative h-full w-full overflow-y-auto px-6 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  ref={lyricsScrollerRef}
                  onWheel={handleLyricsWheel}
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
                        const isRtl = isRtlText(line.text);
                        return (
                          <button
                            key={`${idx}:${line.text}`}
                            dir={isRtl ? "rtl" : "ltr"}
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
                              isRtl && "font-sans font-medium leading-relaxed",
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

            {viewMode === "split" && (
              <div className="relative w-full max-w-6xl h-[65vh] grid grid-cols-1 lg:grid-cols-12 gap-8 items-center px-4">
                {/* Left Column: Artwork Card */}
                <div className="lg:col-span-5 flex flex-col items-center justify-center">
                  <div className="relative size-60 sm:size-72 md:size-80 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/15">
                    <TrackArtwork
                      artworkUrl={track?.artworkUrl}
                      size={400}
                      className="size-full object-cover"
                    />
                  </div>
                  <div className="mt-4 text-center">
                    <h3 className="text-xl font-bold text-white tracking-tight">{track?.title}</h3>
                    <p className="text-sm text-white/70 mt-0.5">{track?.artist}</p>
                  </div>
                </div>

                {/* Right Column: Synced Lyrics */}
                <div
                  className="relative h-full lg:col-span-7 overflow-y-auto px-6 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  ref={lyricsScrollerRef}
                  onWheel={handleLyricsWheel}
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
                        const isRtl = isRtlText(line.text);
                        return (
                          <button
                            key={`${idx}:${line.text}`}
                            dir={isRtl ? "rtl" : "ltr"}
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
                              isRtl && "font-sans font-medium leading-relaxed",
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
        </div>

        {/* Floating Re-sync Lyrics Button */}
        {!isLyricsSyncLocked && !isDetailsInView && lyrics && isSyncedLyrics(lyrics) && (
          <button
            type="button"
            onClick={handleResyncLyrics}
            className="fixed bottom-28 right-8 z-50 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-black shadow-2xl backdrop-blur-md transition-all hover:scale-105 hover:bg-white active:scale-95 cursor-pointer select-none"
            aria-label="Re-sync lyrics"
          >
            <RefreshIcon size={14} className="text-black shrink-0" />
            <span>Sync lyrics</span>
          </button>
        )}

        {/* Clean Bottom-Left Floating Song Title & Artist - Visible ONLY when isIdle and not in details */}
        <div
          className={cn(
            "fixed bottom-8 left-8 sm:bottom-12 sm:left-12 z-20 flex flex-col pointer-events-none transition-all duration-500 ease-out",
            isIdle && !isDetailsInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          )}
        >
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight drop-shadow-lg max-w-xl truncate">
            {track?.title ?? "Unknown Title"}
          </h2>
          <p className="text-base sm:text-lg lg:text-xl text-white/80 font-bold mt-1 drop-shadow-md max-w-xl truncate">
            {track?.artist ?? "Unknown Artist"}
          </p>
        </div>

        {/* Details Section: Visible by scrolling down in all modes (Artwork / Lyrics / Split) */}
        <section
          ref={detailsSectionRef}
          id="details-section"
          className="relative max-w-5xl mx-auto w-full flex flex-col gap-10 px-6 sm:px-10 pt-8 pb-36 scroll-mt-24"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={scrollToPlayerTop}
                className="rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
              >
                ← Back to player
              </button>
              <span className="text-xs font-bold uppercase tracking-wider text-white/60">
                More Details
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
            {/* Left Column: About the Artist Card */}
            <div className="md:col-span-7 flex flex-col gap-4">
              <h3 className="text-lg font-bold text-white tracking-tight">About the artist</h3>
              <div
                onClick={() => {
                  if (navigateArtist && track?.artist) {
                    /* The primary artist reference carries the real channel id when the
                       source has one — navigating by the raw artist string would search the
                       name and can land on a different artist's page. */
                    const primary = track.artists?.[0];
                    navigateArtist(
                      primary?.id || primary?.name
                        ? { id: primary.id, name: primary.name || track.artist }
                        : { id: "", name: track.artist },
                      false,
                    );
                    onClose();
                  }
                }}
                className="group relative h-[380px] sm:h-[420px] w-full cursor-pointer overflow-hidden rounded-2xl bg-card border border-white/10 transition-all duration-300 hover:shadow-2xl hover:border-white/25"
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

                {/* Top-Right Spotify World Rank Badge */}
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
                  <div className="flex items-center justify-between">
                    <span className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                      {track?.artist}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFollowingArtist();
                      }}
                      className={cn(
                        "rounded-full border px-4 py-1 text-xs font-bold transition-colors",
                        isFollowingArtist
                          ? "border-white/60 bg-white text-black hover:bg-white/90"
                          : "border-white/40 text-white hover:bg-white/20",
                      )}
                    >
                      {isFollowingArtist ? "Following" : "Follow"}
                    </button>
                  </div>

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

            {/* Right Column: Credits Card + Next in Queue Card */}
            <div className="md:col-span-5 flex flex-col gap-6">
              {/* Credits Card */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white tracking-tight">Credits</h3>
                  <span className="text-xs font-semibold text-white/60 hover:text-white cursor-pointer transition-colors">
                    Show all
                  </span>
                </div>

                <div className="rounded-2xl bg-white/5 border border-white/10 p-5 flex flex-col gap-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-base font-bold text-white">{track?.artist}</span>
                      <span className="text-xs text-white/60">Main Artist</span>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 transition-colors"
                    >
                      Following
                    </button>
                  </div>

                  <div className="flex flex-col border-t border-white/10 pt-3">
                    <span className="text-sm font-semibold text-white/90">
                      {track?.artist}
                    </span>
                    <span className="text-xs text-white/60">Composer • Lyricist</span>
                  </div>

                  <div className="flex flex-col border-t border-white/10 pt-3">
                    <span className="text-sm font-semibold text-white/90">
                      Production Team
                    </span>
                    <span className="text-xs text-white/60">Engineer • Producer</span>
                  </div>
                </div>
              </div>

              {/* Next in Queue Card */}
              <div className="flex flex-col gap-3">
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
                  <div className="flex flex-col items-center justify-center h-32 rounded-2xl border border-dashed border-white/15 p-6 text-center text-white/50 text-sm">
                    <span>No upcoming tracks in queue</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
          </>
        )}
      </div>

    {/* Full-Width Bottom Spotify Player Dock - Slides in when mouse is active */}
    <footer
      className={cn(
        "fixed bottom-0 inset-x-0 h-20 bg-[#121212]/95 backdrop-blur-2xl border-t border-white/10 px-6 sm:px-8 flex items-center justify-between z-40 transition-transform duration-300 ease-out",
        (isIdle && !isDetailsInView) || mediaMode === "video" ? "translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
      )}
    >
      {/* Left section: Thumbnail + Title + Artist + Like */}
      <div className="flex items-center gap-3.5 min-w-0 w-64 sm:w-72 shrink-0">
        <div className="relative size-12 sm:size-13 shrink-0 rounded-md overflow-hidden ring-1 ring-white/10 shadow-md">
          <TrackArtwork
            artworkUrl={track?.artworkUrl}
            size={56}
            className="size-full object-cover"
          />
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate text-sm sm:text-base font-bold text-white tracking-tight hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all cursor-pointer">
            {track?.title ?? "Unknown Title"}
          </span>
          <span className="truncate text-xs text-white/70 hover:text-white mt-0.5 font-medium">
            <ArtistLinks artists={track?.artists} fallback={track?.artist} />
          </span>
        </div>

        {track && (
          <button
            type="button"
            onClick={handleToggleLike}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95 cursor-pointer",
              isLiked ? "text-primary" : "text-white/60 hover:text-white",
            )}
            aria-label={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
          >
            {isLiked ? <HeartActiveIcon size={20} /> : <HeartIcon size={20} />}
          </button>
        )}
      </div>

      {/* Center section: Transport Controls & Seekbar */}
      <div className="flex flex-col items-center gap-1.5 flex-1 max-w-2xl px-4">
        {/* Controls Row */}
        <div className="flex items-center gap-4 sm:gap-6">
          <button
            type="button"
            onClick={() => playerController.toggleShuffle()}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer",
              playerState.shuffleEnabled ? "text-primary" : "text-white/60 hover:text-white",
            )}
            aria-label="Toggle shuffle"
          >
            {playerState.shuffleEnabled ? <ShuffleActiveIcon size={17} /> : <ShuffleIcon size={17} />}
          </button>

          <button
            type="button"
            onClick={() => void playerController.skipToPrevious()}
            className="flex size-8 items-center justify-center rounded-full text-white/80 hover:text-white transition-colors cursor-pointer"
            aria-label="Previous track"
          >
            <SkipPreviousIcon size={20} />
          </button>

          <button
            type="button"
            onClick={() => void playerController.togglePlayPause()}
            className="flex size-9 sm:size-10 items-center justify-center rounded-full bg-white text-black shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <PauseActiveIcon size={20} fill="currentColor" />
            ) : (
              <PlayActiveIcon size={20} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void playerController.skipToNext()}
            className="flex size-8 items-center justify-center rounded-full text-white/80 hover:text-white transition-colors cursor-pointer"
            aria-label="Next track"
          >
            <SkipNextIcon size={20} />
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
              <RepeatOneActiveIcon size={17} />
            ) : playerState.playbackOrderMode === "repeat-all" ? (
              <RepeatActiveIcon size={17} />
            ) : (
              <RepeatIcon size={17} />
            )}
          </button>
        </div>

        {/* Seek Bar Row with Red Accent Progress Path */}
        <div className="flex items-center gap-2.5 w-full text-[11px] text-white/60 font-medium tabular-nums">
          <span>{formatMinutesSeconds(displayedTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step="any"
            value={displayedTime}
            onPointerDown={() => setIsSeeking(true)}
            onChange={(e) => handleSeekChange(parseFloat(e.target.value))}
            onPointerUp={(e) => handleSeekCommit(parseFloat((e.target as HTMLInputElement).value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-transparent disabled:cursor-default disabled:opacity-50 focus-visible:outline-none [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-primary)_var(--slider-progress),rgba(255,255,255,0.2)_var(--slider-progress))] [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/20 [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white"
            style={{
              "--slider-progress": `${duration > 0 ? (displayedTime / duration) * 100 : 0}%`,
            } as React.CSSProperties}
            aria-label="Seek track"
          />
          <span>{formatMinutesSeconds(duration)}</span>
        </div>
      </div>

      {/* Right section: Lyrics, Queue/Details, Volume, Fullscreen Exit */}
      <div className="flex items-center justify-end gap-2.5 w-64 sm:w-72 shrink-0">
        {/* Lyrics toggle button */}
        <button
          type="button"
          onClick={() => {
            if (isDetailsInView) {
              scrollToPlayerTop();
            }
            setViewMode(viewMode === "artwork" ? "split" : "artwork");
          }}
          className={cn(
            "flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer",
            viewMode !== "artwork" && !isDetailsInView ? "text-primary" : "text-white/70 hover:text-white",
          )}
          aria-label="Toggle lyrics"
          title="Toggle lyrics"
        >
          {viewMode !== "artwork" && !isDetailsInView ? <LyricsActiveIcon size={18} /> : <LyricsIcon size={18} />}
        </button>

        {/* Queue & Details toggle */}
        <button
          type="button"
          onClick={() => {
            if (isDetailsInView) {
              scrollToPlayerTop();
            } else {
              scrollToDetails();
            }
          }}
          className={cn(
            "flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer",
            isDetailsInView ? "text-primary" : "text-white/70 hover:text-white",
          )}
          aria-label="Toggle details and queue"
          title="Toggle details and queue"
        >
          <QueuePanelIcon size={18} />
        </button>

        {/* Volume Control */}
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
            <div className="absolute bottom-full right-0 mb-3 p-2 rounded-xl bg-black/90 backdrop-blur-md border border-white/15 shadow-2xl flex items-center h-28 w-8 justify-center z-50">
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

        {/* In-app Fullscreen Exit */}
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full text-white/70 hover:text-white transition-colors cursor-pointer"
          aria-label="Exit full screen"
          title="Exit full screen (Esc)"
        >
          <QuitFullScreenIcon size={17} />
        </button>
      </div>
    </footer>
    </div>
  );
}
