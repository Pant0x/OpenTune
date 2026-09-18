import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import {
  PlayActiveIcon,
  RefreshIcon,
} from "@/ui/icons";
import {
  libraryController,
  playerController,
  useLibraryState,
  usePlayerSelector,
  usePlayerSessionSelector,
} from "../../player/playerStore";
import type { PlayerSession } from "../../player/PlayerController";
import type { Lyrics, Track } from "../../datasource/types";
import { playerUIStore } from "../stores/playerUIStore";
import { SpotifyService, type SpotifyArtistOverview } from "../../services/SpotifyService";
import { SpotifyCreditsModal } from "../components/player/SpotifyCreditsModal";
import { TrackArtwork } from "../components/TrackArtwork";
import { useArtistNavigation } from "../components/ArtistLinks";
import {
  findActiveLineIndex,
  getLineProgress,
  isAdlibLine,
  isSyncedLyrics,
} from "./lyricsTiming";
import { LyricLineView } from "../components/lyrics/LyricLineView";
import { VideoPlayerView } from "../components/player/VideoPlayerView";
import { getMediaCounterpart } from "../../datasource/youtube/videoService";
import { CoverAmbienceCanvas } from "../components/CoverAmbienceCanvas";
import {
  isArtistFollowedLocally,
  setArtistFollowedLocally,
  subscribeToFollowedArtists,
} from "../../player/followedArtists";

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
  const track = usePlayerSelector((player) => player.currentTrack);
  const isPlaying = usePlayerSelector((player) => player.status === "playing");
  const navigateArtist = useArtistNavigation();

  const { queue, queueIndex } = usePlayerSessionSelector(selectQueueSlice, queueSliceEqual);
  const nextTrack: Track | undefined =
    queueIndex >= 0 && queueIndex + 1 < queue.length ? queue[queueIndex + 1] : undefined;

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
    /*
     * A fresh track starts at zero. In video mode the time-sync interval is parked, so without
     * this reset the next video would seek to the stale position of the track before it.
     */
    setCurrentTime(0);

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

  // Playback time for synced lyrics and initial video seek
  const [currentTime, setCurrentTime] = useState(0);

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
      playerController.silenceAudioEngine();
      setMediaMode("video");
    } else {
      setMediaMode("song");
      const videoTime = playerController.getCurrentTime();
      if (track.isVideo && songCounterpart) {
        void playerController.playTrackById(songCounterpart.id, [songCounterpart], true);
      } else if (isPlaying) {
        void playerController.play();
      }
      if (videoTime > 0) {
        void playerController.seekTo(videoTime);
      }
    }
  }, [track, mediaMode, songCounterpart, isPlaying]);

  // Artist Overview for "About the artist"
  const libraryState = useLibraryState();
  const [isCreditsModalOpen, setIsCreditsModalOpen] = useState(false);
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

  // Sync playback time. In video mode the interval is parked: nothing here consumes the time
  // (lyrics only render in song mode, and the video reports its own time to the dock), and a
  // 250ms re-render of the whole view while a video plays is pure churn.
  const isVideoMode = mediaMode === "video";
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(playerController.getCurrentTime());
    };
    updateTime();
    if (isVideoMode) return;
    const interval = window.setInterval(updateTime, 250);
    return () => window.clearInterval(interval);
  }, [isVideoMode]);

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

  // Follow state unified across About-the-artist, Credits, and Library
  useEffect(() => {
    const resolveFollowing = () => {
      if (!track?.artist) {
        setIsFollowingArtist(false);
        return;
      }
      const artistNameLower = track.artist.toLowerCase();
      const artistId = track.artists?.[0]?.id;
      const followedInLibrary = (libraryState.library?.artists ?? []).some(
        (a) => a.name.toLowerCase() === artistNameLower || (artistId && a.id === artistId),
      );
      const followedInStorage = isArtistFollowedLocally(artistNameLower, artistId ?? null);
      setIsFollowingArtist(followedInLibrary || followedInStorage);
    };

    resolveFollowing();
    return subscribeToFollowedArtists(resolveFollowing);
  }, [track?.artist, track?.artists, libraryState.library?.artists]);

  const toggleFollowingArtist = async () => {
    const name = track?.artist;
    if (!name) return;
    const nextState = !isFollowingArtist;
    setIsFollowingArtist(nextState);

    const artistId = track.artists?.[0]?.id;
    setArtistFollowedLocally(artistId, name, nextState);

    try {
      await libraryController.setArtistSubscribed(
        { id: artistId || "", name },
        nextState,
      );
    } catch (err) {
      console.warn("Could not sync artist subscription:", err);
    }
  };

  // Fetch Lyrics
  useEffect(() => {
    if (!track) return;
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
  }, [track]);

  // Update active lyrics line
  useEffect(() => {
    if (!lyrics || !isSyncedLyrics(lyrics)) return;
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
  }, [lyrics, currentTime, isLyricsSyncLocked, isDetailsInView]);

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

  return (
    <div
      ref={containerRef}
      onPointerMove={resetIdleTimer}
      onClick={resetIdleTimer}
      className={cn(
      "relative h-full w-full overflow-hidden bg-black/95 text-white selection:bg-white/20 select-none flex flex-col",
      isIdle && "cursor-none",
    )}
  >
    {/* Dynamic moving ambient background ("Cover Ambience") */}
    <CoverAmbienceCanvas artworkUrl={track?.artworkUrl} />

    {/* Top Header Bar */}
    <header
      className={cn(
        "sticky top-0 inset-x-0 px-6 py-3.5 flex items-center justify-between z-30 transition-all duration-300 bg-black/40 backdrop-blur-md border-b border-white/10 shrink-0",
        isIdle && !isDetailsInView ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
      )}
    >
      {/* Left: Back button */}
      <button
        type="button"
        onClick={() => {
          if (isDetailsInView) {
            scrollToPlayerTop();
          } else {
            onClose();
          }
        }}
        className="flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white px-4 py-2 text-xs font-bold border border-white/15 transition-all shadow-sm cursor-pointer"
      >
        <span>{isDetailsInView ? "← Back to Player" : "Back"}</span>
      </button>

      {/* Media Switcher: Song / Video */}
      <div className="flex items-center rounded-full bg-black/60 backdrop-blur-md p-1 border border-white/15 text-xs font-semibold text-white/80 shadow-lg">
        <button
          type="button"
          onClick={() => void handleSwitchMediaMode("song")}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-all cursor-pointer",
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
            "flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-all cursor-pointer",
            mediaMode === "video"
              ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
              : "hover:text-white",
          )}
        >
          <span>Video</span>
        </button>
      </div>

      {/* Right Action: Spacer to keep Song/Video switch centered */}
      <div className="w-9" />
    </header>

    {/* Main Scrollable Area containing Hero Screen and Details Section */}
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="relative flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scroll-smooth [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 hover:[&::-webkit-scrollbar-thumb]:bg-white/40 [&::-webkit-scrollbar-track]:bg-transparent"
    >
      {mediaMode === "video" ? (
        <div className="relative min-h-full w-full flex flex-col justify-start items-center p-4 sm:p-8 pt-4 pb-16 max-w-6xl mx-auto">
          {track && (
            <VideoPlayerView
              videoId={activeVideoId}
              track={track}
              initialTime={currentTime}
              initialPlaying={isPlaying}
            />
          )}
        </div>
      ) : (
        <>
          {/* Screen 1: Synced Lyrics */}
          <div className="relative min-h-[calc(100vh-180px)] w-full flex flex-col justify-center items-center p-6 sm:p-10 pt-6 pb-12">
            <main className="relative my-auto flex-1 flex items-center justify-center py-4 w-full">
              <div className="relative w-full max-w-3xl h-[60vh] flex items-center justify-center px-4">
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
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-white/50 text-base">
                      <span>No lyrics available for this track.</span>
                      <button
                        type="button"
                        onClick={scrollToDetails}
                        className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 hover:text-white transition-colors cursor-pointer"
                      >
                        View track details & credits ↓
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6 py-28">
                      {lyrics.lines.map((line, idx) => (
                        <LyricLineView
                          key={`${idx}:${line.text}`}
                          index={idx}
                          text={line.text}
                          isActive={idx === activeLyricIndex}
                          size="song"
                          forceAdlibLine={isAdlibLine(line.text)}
                          sweep01={idx === activeLyricIndex
                            ? getLineProgress(lyrics.lines, idx, currentTime, track?.durationSec)
                            : 1}
                          emptyStyle="note"
                          onSeek={(i) => {
                            const start = lyrics.lines[i]?.startTimeSec;
                            if (start !== undefined) {
                              void playerController.seekTo(start);
                            }
                          }}
                          register={(i, el) => {
                            lyricsLineRefs.current[i] = el;
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </main>

            {/* Scroll down indicator to details */}
            <button
              type="button"
              onClick={scrollToDetails}
              className="flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              <span>Scroll for details & credits</span>
              <span>↓</span>
            </button>
          </div>

          {/* Floating Re-sync Lyrics Button */}
          {!isLyricsSyncLocked && !isDetailsInView && lyrics && isSyncedLyrics(lyrics) && (
            <button
              type="button"
              onClick={handleResyncLyrics}
              className="sticky bottom-6 mr-8 self-end z-20 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-black shadow-2xl backdrop-blur-md transition-all hover:scale-105 hover:bg-white active:scale-95 cursor-pointer select-none"
              aria-label="Re-sync lyrics"
            >
              <RefreshIcon size={14} className="text-black shrink-0" />
              <span>Sync lyrics</span>
            </button>
          )}

          {/* Details Section: Visible by scrolling down in all modes */}
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
                  <button
                    type="button"
                    onClick={() => setIsCreditsModalOpen(true)}
                    className="text-xs font-semibold text-white/60 hover:text-white cursor-pointer transition-colors bg-transparent border-0 p-0"
                  >
                    Show all
                  </button>
                </div>

                <div className="rounded-2xl bg-white/5 border border-white/10 p-5 flex flex-col gap-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-base font-bold text-white">{track?.artist}</span>
                      <span className="text-xs text-white/60">Main Artist</span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleFollowingArtist}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                        isFollowingArtist
                          ? "border-white/60 bg-white text-black hover:bg-white/90"
                          : "border-white/30 text-white hover:bg-white/15",
                      )}
                    >
                      {isFollowingArtist ? "Following" : "Follow"}
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

      {track && (
        <SpotifyCreditsModal
          isOpen={isCreditsModalOpen}
          onClose={() => setIsCreditsModalOpen(false)}
          track={track}
          isFollowingArtist={isFollowingArtist}
          onToggleFollowArtist={toggleFollowingArtist}
        />
      )}
    </div>
  );
}
