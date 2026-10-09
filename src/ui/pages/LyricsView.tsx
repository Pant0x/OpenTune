import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReduceMotion } from "../settings/renderEffects";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import {
  CloseIcon,
  HeartActiveIcon,
  HeartBrokenIcon,
  HeartIcon,
  LyricsIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  RefreshIcon,
  RepeatActiveIcon,
  RepeatIcon,
  RepeatOneActiveIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from "@/ui/icons";
import type { Lyrics, LyricsSourceAttempt, LyricsSourceStatus, Track } from "../../datasource/types";
import { LYRICS_SOURCES } from "../../datasource/youtube/lyricsSources";
import { FloatingPanel } from "../components/FloatingPanel";
import { logInternalWarn } from "../../internal/logging";
import { getAppSetting, setAppSetting } from "../../internal/appSettings";
import { playerController, shallowEqual, usePlayerSelector, useLibraryState } from "../../player/playerStore";
import { playerUIStore, usePlayerUIState } from "../stores/playerUIStore";
import { useTrackContextMenu } from "../components/trackContextMenuContext";
import { DownloadButton } from "../components/player/DownloadButton";
import { ArtistLinks } from "../components/ArtistLinks";
import { TrackArtwork } from "../components/TrackArtwork";
import { ArtworkLightboxModal } from "../components/ArtworkLightboxModal";
import { CoverAmbienceCanvas } from "../components/CoverAmbienceCanvas";
import { setAmbientArtwork } from "../stores/ambientArtworkStore";
import { SpotifyService } from "../../services/SpotifyService";
import { getVideoArtworkFallback } from "../../datasource/youtube/artwork";
import { OFFSET_STEP_SEC, setLyricsOffset, useLyricsOffset } from "../settings/lyricsOffset";
import { useLyricsFontScale } from "../settings/lyricsFontScale";
import { TRANSLATION_OFF, useLyricsTranslationLang } from "../settings/lyricsTranslation";
import { useLyricsDuetMode, useLyricsAdlibsMode } from "../settings/lyricsEnhancements";
import { translateLines } from "../../datasource/translate";
import { VideoPlayerView } from "../components/player/VideoPlayerView";
import { getMediaCounterpart } from "../../datasource/youtube/videoService";
import {
  LyricLineView,
  setLineSweepState,
  updateLineWordsSweep,
} from "../components/lyrics/LyricLineView";
import {
  findActiveLineIndex,
  getDynamicVocalMultiplier,
  getLineProgress,
  isRtlText,
  isSyncedLyrics,
  parseLyricTokens,
  processDuetLyrics,
  type DuetAlignment,
} from "./lyricsTiming";

/** How long a manual scroll keeps the auto-follow parked. */
const AUTO_SCROLL_RESUME_MS = 4500;
/** Sampling rate while paused — see the frame loop for why it is not zero. */
const PAUSED_SAMPLE_MS = 250;

/**
 * Depth by distance from the active line: opacity, then blur.
 *
 * The blur is what makes the column read as a focal plane rather than a dimmed list, but it
 * is a GPU filter and every blurred node is its own layer — so it stops after four lines
 * either side. Past that the opacity alone is low enough that nobody can tell.
 */
const DEPTH = [
  { opacity: 1, blur: 0 },
  { opacity: 0.55, blur: 0.7 },
  { opacity: 0.36, blur: 1.5 },
  { opacity: 0.24, blur: 2.4 },
  { opacity: 0.16, blur: 3.2 },
  { opacity: 0.12, blur: 0 },
];

/*
 * Type scale, driven by the container's width so opening the queue panel reflows it rather
 * than overflowing. The Tailwind size classes on the elements are a floor, not decoration:
 * if these ever fail to resolve the lines fall back to a display size instead of to 16px.
 */
const LINE_FONT_SIZE = "clamp(1.625rem, 2.6cqi + 0.85rem, 2.875rem)";
const LINE_GAP = "clamp(0.95rem, 1.2cqi + 0.45rem, 1.9rem)";
/** Unsynced lyrics are read, not followed — smaller, with the leading a paragraph wants. */
const READING_FONT_SIZE = "clamp(1.125rem, 1cqi + 0.7rem, 1.5rem)";

const STATUS_DOT: Record<LyricsSourceStatus, string> = {
  hit: "bg-primary",
  miss: "bg-muted-foreground/40",
  timeout: "bg-destructive/60",
  error: "bg-destructive",
  skipped: "bg-muted-foreground/20",
};

const ARROW_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

interface LyricsViewProps {
  onClose: () => void;
}

export function LyricsView({ onClose }: LyricsViewProps) {
  const playerState = usePlayerSelector(
    (player) => ({
      currentTrack: player.currentTrack,
      status: player.status,
      shuffleEnabled: player.shuffleEnabled,
      playbackOrderMode: player.playbackOrderMode,
    }),
    shallowEqual,
  );
  const track = playerState.currentTrack;
  const isPlaying = playerState.status === "playing";
  const libraryState = useLibraryState();
  const { toggleTrackLike } = useTrackContextMenu();
  const canLikeCurrentTrack = Boolean(track && track.source !== "local");
  const isLikePending = Boolean(track && canLikeCurrentTrack && libraryState.pendingLikeTrackIds.has(track.id));
  const isLiked = Boolean(track && canLikeCurrentTrack && (libraryState.library?.likedSongs.some(
    (t: Track) => t.id === track.id,
  ) ?? false));
  const isShuffled = playerState.shuffleEnabled;
  const isRepeatActive = playerState.playbackOrderMode !== "in-order";
  const repeatMode = playerState.playbackOrderMode;
  const reduce = useReduceMotion();
  const playerUIState = usePlayerUIState();
  const isFullscreen = playerUIState.isLyricsFullscreen;
  const mediaMode = playerUIState.lyricsMediaMode ?? "song";
  const isDuetMode = useLyricsDuetMode();
  const isAdlibsMode = useLyricsAdlibsMode();
  const offset = useLyricsOffset(track?.id);
  const fontScale = useLyricsFontScale();
  const translationLang = useLyricsTranslationLang();
  const [translations, setTranslations] = useState<string[] | null>(null);

  const [videoCounterpart, setVideoCounterpart] = useState<Track | null>(null);
  const [songCounterpart, setSongCounterpart] = useState<Track | null>(null);

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

  const handleSwitchMediaMode = useCallback(async (mode: "song" | "video") => {
    if (!track || mode === mediaMode) return;
    if (mode === "video") {
      playerController.silenceAudioEngine();
      playerUIStore.setLyricsMediaMode("video");
    } else {
      playerUIStore.setLyricsMediaMode("song");
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

  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFollowPaused, setIsFollowPaused] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [showPlaybackCard, setShowPlaybackCard] = useState(() => {
    try {
      return localStorage.getItem("lyrics_fullscreen_split") !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    void getAppSetting<boolean>("lyrics_fullscreen_split").then((stored) => {
      if (typeof stored === "boolean") {
        setShowPlaybackCard(stored);
      }
    });
  }, []);

  const toggleSplitMode = () => {
    setShowPlaybackCard((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("lyrics_fullscreen_split", String(next));
      } catch {}
      void setAppSetting("lyrics_fullscreen_split", next);
      return next;
    });
  };
  void toggleSplitMode;
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);

  const handleClose = () => {
    playerUIStore.setLyricsFullscreen(false);
    playerUIStore.setLyricsOpen(false);
    onClose();
  };

  useEffect(() => {
    if (isFullscreen && typeof window !== "undefined") {
      window.focus();
      document.body?.focus();
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (isFullscreen) {
          playerUIStore.setLyricsFullscreen(false);
        } else {
          handleClose();
        }
      } else if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (track) {
          e.preventDefault();
          setLyricsOffset(track.id, offset - OFFSET_STEP_SEC);
        }
      } else if (e.key === "]" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (track) {
          e.preventDefault();
          setLyricsOffset(track.id, offset + OFFSET_STEP_SEC);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isFullscreen, track?.id, offset]);

  const [spotifyCover, setSpotifyCover] = useState<string | null>(null);

  useEffect(() => {
    setSpotifyCover(null);
    if (!track || track.source === "local" || !track.title) return;
    let active = true;
    void SpotifyService.getTrackCoverUrl(track.title, track.artist, track.album)
      .then((url: string | null) => {
        if (active && url) setSpotifyCover(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [track?.id, track?.title, track?.artist, track?.album]);

  const effectiveArtworkUrl = spotifyCover
    ?? (track?.artworkUrl
      || (track?.id ? getVideoArtworkFallback(track.id) : undefined));

  const activeBackgroundUrl = effectiveArtworkUrl;

  const pendingSeekRef = useRef<{ target: number; at: number } | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const engineTime = playerController.getCurrentTime();
      const pending = pendingSeekRef.current;
      if (pending) {
        if (performance.now() - pending.at < 800 && Math.abs(engineTime - pending.target) > 0.75) {
          setCurrentPlaybackTime(pending.target);
          return;
        }
        pendingSeekRef.current = null;
      }
      setCurrentPlaybackTime(engineTime);
    };
    updateTime();
    const interval = window.setInterval(updateTime, 100);
    return () => window.clearInterval(interval);
  }, []);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLElement | null>>([]);
  const resumeTimerRef = useRef<number | null>(null);

  const lines = lyrics?.lines ?? [];
  const isSynced = isSyncedLyrics(lyrics);
  const hasLines = lines.length > 0;

  const duetProcessedLines = useMemo(() => {
    if (!isDuetMode) {
      return lines.map((l) => ({ displayText: l.text, alignment: "left" as DuetAlignment }));
    }
    return processDuetLyrics(lines, track?.artists);
  }, [lines, isDuetMode, track?.artists]);

  /* Read inside the sampling loop below, which must not restart when these change — a new
     array identity every render would tear it down sixty times a second. */
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const durationRef = useRef(track?.durationSec);
  durationRef.current = track?.durationSec;

  /** Lines a listener can actually land on: blanks are instrumental beats, not targets. */
  const seekableIndices = useMemo(() => {
    const indices: number[] = [];
    lyrics?.lines.forEach((line, index) => {
      if (line.text.trim()) indices.push(index);
    });
    return indices;
  }, [lyrics]);

  // The same wash Layout paints for album and playlist pages, so the chrome above this view
  // stays tinted by the cover instead of ending at a hard edge.
  useEffect(() => {
    setAmbientArtwork(track?.artworkUrl ?? null);
    return () => setAmbientArtwork(null);
  }, [track?.artworkUrl]);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLyrics(null);
    setFailed(false);
    setActiveIndex(-1);
    setFocusIndex(null);
    lineRefs.current = [];
    if (!track) return;

    setIsLoading(true);
    void playerController.getLyrics(track)
      .then((result) => {
        if (!cancelled) setLyrics(result);
      })
      .catch((error) => {
        logInternalWarn("LyricsView load failed", {
          trackId: track.id,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [track?.id, reloadToken]);

  /*
   * Every provider is a network call, so a song opened offline has nothing to show. Retrying
   * the moment the connection returns saves the listener from noticing and pressing a button
   * about it — keyed on the transition only, so a genuinely lyric-less song is asked for
   * exactly once per reconnect rather than in a loop.
   */
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    // The offline → online edge only. On the level it would also be true on mount, firing a
    // second fetch on top of the one the effect above has already started.
    if (!isOnline || wasOnline) return;
    if (isLoading || hasLines || !track) return;
    setReloadToken((token) => token + 1);
  }, [isOnline]);

  /*
   * Own the scroll maths instead of scrollIntoView.
   *
   * This scroller is nested inside Layout's page scroll root; scrollIntoView walks up the
   * ancestor chain and moves that one too, which drags the whole page under the header.
   */
  const scrollToLine = useCallback((index: number, smooth: boolean) => {
    const scroller = scrollerRef.current;
    const line = lineRefs.current[index];
    if (!scroller || !line) return;
    scroller.scrollTo({
      top: Math.max(0, line.offsetTop - scroller.clientHeight / 2 + line.offsetHeight / 2),
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  /* Read by the ResizeObserver below, which must not be torn down and rebuilt every time
     either value changes — it would miss the resize it exists to catch. */
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const isFollowPausedRef = useRef(isFollowPaused);
  isFollowPausedRef.current = isFollowPaused;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    /*
     * Opening the queue panel narrows this column, which re-wraps every line and invalidates
     * the offsets the last scroll was computed from — the active line drifts off centre and
     * stays there until the next line happens to come round and trigger a fresh scroll.
     *
     * Jumped, not animated: this is a correction to a layout change the user made, so it
     * should look like the text was always there, not like the page scrolled by itself.
     */
    const observer = new ResizeObserver(() => {
      if (isFollowPausedRef.current) return;
      const index = activeIndexRef.current;
      if (index >= 0) scrollToLine(index, false);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollToLine]);

  useEffect(() => {
    if (!isSynced) {
      setActiveIndex(-1);
      return;
    }

    let current = -1;
    const sample = () => {
      const rawEngineTime = playerController.getCurrentTime();
      const pending = pendingSeekRef.current;
      let engineTime = rawEngineTime;
      if (pending) {
        if (performance.now() - pending.at < 800 && Math.abs(rawEngineTime - pending.target) > 0.75) {
          engineTime = pending.target;
        } else {
          pendingSeekRef.current = null;
        }
      }
      const time = engineTime + offset;
      const currentLines = linesRef.current;
      const next = findActiveLineIndex(currentLines, time);

      /* Committing every frame would re-render the whole column sixty times a second for a
         value that flips a few times a minute. Only the flip is worth a render. */
      if (next !== current) {
        if (current >= 0 && lineRefs.current[current]) {
          const prevEl = lineRefs.current[current]!;
          setLineSweepState(prevEl, "sung");
          prevEl.classList.remove("is-active", "lyrics-lyricsContent-active");
        }
        if (next >= 0 && lineRefs.current[next]) {
          const nextEl = lineRefs.current[next]!;
          nextEl.classList.add("is-active", "lyrics-lyricsContent-active", "lyric-sweep");
        }
        current = next;
        setActiveIndex(next);
      }

      if (reduce || next < 0) return;
      /* The sweep is written straight onto the node. It changes every frame by definition,
         so routing it through state would undo the optimisation directly above. */
      const rawProgress = getLineProgress(currentLines, next, time, durationRef.current, true);
      const multiplier = getDynamicVocalMultiplier(
        currentLines[next],
        currentLines[next + 1],
        durationRef.current,
      );
      const vocalProgress = Math.min(1, rawProgress * multiplier);
      if (lineRefs.current[next]) {
        updateLineWordsSweep(lineRefs.current[next]!, vocalProgress);
      }
    };

    sample();

    /*
     * Paused is not idle — the listener can still drag the scrubber, and the highlight has to
     * follow it. But a paused window has no business holding a frame loop open: this used to
     * poll at 60fps for as long as the view stayed open, which on a laptop is a core kept
     * awake to watch a number that is not changing.
     */
    if (!isPlaying) {
      const interval = window.setInterval(sample, PAUSED_SAMPLE_MS);
      return () => window.clearInterval(interval);
    }

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      sample();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isSynced, isPlaying, lyrics, offset, reduce]);

  /*
   * Translation is best-effort and entirely optional: a failure leaves `translations` null
   * and the screen shows the original words, which is what it would have shown anyway. The
   * stale guard matters more than usual here — the request is slow enough that skipping two
   * tracks while it is in flight is easy, and a late reply would caption the wrong song.
   */
  useEffect(() => {
    setTranslations(null);
    if (translationLang === TRANSLATION_OFF || !hasLines || !track) return;

    let cancelled = false;
    void translateLines(lines.map((line) => line.text), translationLang, track.id)
      .then((result) => {
        if (!cancelled) setTranslations(result);
      })
      .catch((error) => {
        logInternalWarn("LyricsView translation failed", {
          trackId: track.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [lyrics, translationLang, track?.id]);

  // When a track finishes, loops, or a fresh track is loaded, scroll smoothly back to the top
  const hasFinishedRef = useRef(false);
  useEffect(() => {
    hasFinishedRef.current = false;
    scrollerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [track?.id, lyrics]);

  useEffect(() => {
    const duration = track?.durationSec || 0;
    if (duration > 5 && currentPlaybackTime >= duration - 1.2 && !hasFinishedRef.current) {
      hasFinishedRef.current = true;
      scrollerRef.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    } else if (currentPlaybackTime < 2) {
      hasFinishedRef.current = false;
    }
  }, [currentPlaybackTime, track?.durationSec, reduce]);

  useEffect(() => {
    if (activeIndex < 0) {
      if (!isFollowPaused) {
        scrollerRef.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }
      return;
    }
    if (isFollowPaused) return;
    scrollToLine(activeIndex, !reduce);
  }, [activeIndex, isFollowPaused, reduce, scrollToLine]);

  useEffect(() => () => {
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
  }, []);



  const pauseFollow = () => {
    if (!isSynced || activeIndex < 0) return;
    setIsFollowPaused(true);
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      setIsFollowPaused(false);
    }, AUTO_SCROLL_RESUME_MS);
  };

  const resumeFollow = () => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setIsFollowPaused(false);
    scrollToLine(activeIndex, !reduce);
  };

  const handleLineClick = (index: number) => {
    const start = lines[index]?.startTimeSec;
    if (start === undefined) return;
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    setIsFollowPaused(false);
    const target = Math.max(0, start - offset);
    pendingSeekRef.current = { target, at: performance.now() };
    setCurrentPlaybackTime(target);
    setActiveIndex(index);
    scrollToLine(index, !reduce);

    // Immediately update line sweep states across the column
    for (let i = 0; i < index; i++) {
      if (lineRefs.current[i]) setLineSweepState(lineRefs.current[i]!, "sung");
    }
    if (lineRefs.current[index]) {
      setLineSweepState(lineRefs.current[index]!, "unsung");
    }
    for (let i = index + 1; i < lines.length; i++) {
      if (lineRefs.current[i]) setLineSweepState(lineRefs.current[i]!, "unsung");
    }

    void playerController.seekTo(target);
  };

  /*
   * Handed to every memoised line, so they have to be referentially stable for the lifetime
   * of the view. Reading through a ref keeps the identity fixed while the behaviour still
   * tracks the latest render — a `useCallback` with real dependencies would change identity
   * whenever the offset or the line list did, re-rendering the whole column.
   */
  const lineClickRef = useRef(handleLineClick);
  lineClickRef.current = handleLineClick;
  const seekLine = useCallback((index: number) => lineClickRef.current(index), []);
  const handleSyncLine = useCallback((index: number) => {
    const start = lines[index]?.startTimeSec;
    if (start === undefined || !track?.id) return;
    const current = playerController.getCurrentTime();
    const newOffset = start - current;
    setLyricsOffset(track.id, newOffset);
  }, [lines, track?.id]);
  const registerLine = useCallback((index: number, element: HTMLElement | null) => {
    lineRefs.current[index] = element;
  }, []);

  /*
   * Roving tabindex.
   *
   * A synced song is a hundred-odd buttons. Leaving them all tabbable means a keyboard user
   * has to walk the entire lyric sheet to reach the close button, so exactly one line is in
   * the tab order and the arrows move between them — the same contract as a listbox.
   */
  const tabbableIndex = focusIndex
    ?? (seekableIndices.includes(activeIndex) ? activeIndex : seekableIndices[0] ?? -1);

  const handleLineKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();

    const position = seekableIndices.indexOf(tabbableIndex);
    const nextPosition = event.key === "Home"
      ? 0
      : event.key === "End"
        ? seekableIndices.length - 1
        : Math.min(
            seekableIndices.length - 1,
            Math.max(0, position + (event.key === "ArrowDown" ? 1 : -1)),
          );

    const nextIndex = seekableIndices[nextPosition];
    if (nextIndex === undefined) return;
    setFocusIndex(nextIndex);
    pauseFollow();
    // `preventScroll` because this view owns its scrolling: the default focus scroll would
    // put the line at the nearest edge rather than the centre the whole design is built on.
    lineRefs.current[nextIndex]?.focus({ preventScroll: true });
    scrollToLine(nextIndex, !reduce);
  };

  // sourceLabel & timingLabel hidden per user request
  void lyrics?.sourceLabel;
  const emptyMessage = !isOnline
    ? "You're offline. Lyrics need a connection."
    : failed
      ? "Lyrics could not be loaded."
      : "No lyrics found for this song.";

  const renderPlaybackControls = () => {
    if (!track) return null;
    return (
      <div className="w-full max-w-[380px] mt-6 flex flex-col gap-2.5">
        {/* Track Title, Artist, Love (Heart) & Download */}
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex min-w-0 flex-col text-left">
            <span className="truncate text-lg font-bold text-white tracking-tight">{track.title}</span>
            <span className="truncate text-sm text-white/70">
              <ArtistLinks artists={track.artists} fallback={track.artist} />
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canLikeCurrentTrack && (
              <button
                type="button"
                className={cn(
                  "group/like flex size-8 shrink-0 items-center justify-center rounded-full transition-all cursor-pointer",
                  "hover:scale-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50",
                  isLiked ? "text-primary" : "text-white/60 hover:text-white hover:bg-white/10",
                )}
                onClick={() => void toggleTrackLike(track)}
                disabled={isLikePending}
                title={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                aria-label={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
              >
                {isLiked ? (
                  <span className="relative grid size-[18px] place-items-center">
                    <HeartActiveIcon size={18} className="absolute group-hover/like:opacity-0" />
                    <HeartBrokenIcon size={18} className="absolute opacity-0 group-hover/like:opacity-100" />
                  </span>
                ) : (
                  <HeartIcon size={18} />
                )}
              </button>
            )}
            <DownloadButton className="text-white/60 hover:text-white hover:bg-white/10 hover:scale-110 active:scale-95" />
          </div>
        </div>

        {/* Time progress bar without '-' */}
        <div className="flex items-center justify-between text-xs text-white/60 tabular-nums font-medium">
          <span>{formatMinutesSeconds(currentPlaybackTime)}</span>
          <span>{formatMinutesSeconds(track.durationSec || 0)}</span>
        </div>

        <input
          type="range"
          min={0}
          max={track.durationSec || 100}
          step="any"
          value={currentPlaybackTime}
          onChange={(e) => {
            const t = parseFloat(e.target.value);
            pendingSeekRef.current = { target: t, at: performance.now() };
            setCurrentPlaybackTime(t);
            void playerController.seekTo(t);
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/20 focus-visible:outline-none transition-all [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,#ffffff_var(--slider-progress),rgba(255,255,255,0.25)_var(--slider-progress))] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(255,255,255,0.9)]"
          style={{
            "--slider-progress": `${(track.durationSec && track.durationSec > 0) ? (currentPlaybackTime / track.durationSec) * 100 : 0}%`,
          } as React.CSSProperties}
          aria-label="Seek track"
        />

        {/* Dock Controls: Shuffle, Previous, Play/Pause, Next, Repeat */}
        <div className="flex items-center justify-between px-1 mt-2 text-white">
          <button
            type="button"
            onClick={() => playerController.toggleShuffle()}
            className={cn(
              "flex size-9 items-center justify-center rounded-full transition-colors cursor-pointer",
              isShuffled ? "text-primary hover:text-primary" : "text-white/60 hover:text-white hover:bg-white/10",
            )}
            aria-label={isShuffled ? "Turn off shuffle" : "Shuffle"}
            title={isShuffled ? "Shuffle is on" : "Shuffle"}
          >
            {isShuffled ? <ShuffleActiveIcon size={19} /> : <ShuffleIcon size={19} />}
          </button>

          <button
            type="button"
            onClick={() => void playerController.skipToPrevious()}
            className="flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
            {isPlaying ? <PauseActiveIcon size={20} fill="currentColor" /> : <PlayActiveIcon size={20} fill="currentColor" className="ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => void playerController.skipToNext()}
            className="flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            aria-label="Next track"
          >
            <SkipNextIcon size={22} />
          </button>

          <button
            type="button"
            onClick={() => playerController.cyclePlaybackOrderMode()}
            className={cn(
              "flex size-9 items-center justify-center rounded-full transition-colors cursor-pointer",
              isRepeatActive ? "text-primary hover:text-primary" : "text-white/60 hover:text-white hover:bg-white/10",
            )}
            aria-label={
              repeatMode === "repeat-one" ? "Loop current song" : repeatMode === "repeat-all" ? "Loop the queue" : "Repeat"
            }
            title={
              repeatMode === "repeat-one" ? "Loop current song" : repeatMode === "repeat-all" ? "Loop the queue" : "Repeat"
            }
          >
            {repeatMode === "repeat-one" ? (
              <RepeatOneActiveIcon size={19} />
            ) : repeatMode === "repeat-all" ? (
              <RepeatActiveIcon size={19} />
            ) : (
              <RepeatIcon size={19} />
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section
      className={cn(
        "@container/lyrics relative flex h-full min-h-0 w-full flex-col overflow-hidden",
        isFullscreen ? "bg-black text-white" : "rounded-2xl",
      )}
      aria-label="Lyrics"
    >
      {/* Dynamic moving ambient background ("Cover Ambience") */}
      <CoverAmbienceCanvas artworkUrl={activeBackgroundUrl} className="!inset-0 !h-full !w-full" />

      {/* Floating Exit Fullscreen Button in Fullscreen Mode */}
      {isFullscreen && (
        <div className="absolute top-6 right-6 z-50 flex items-center gap-3">
          {track && isSynced && (
            <LyricsOffsetControl trackId={track.id} offset={offset} />
          )}
          <button
            type="button"
            onClick={() => playerUIStore.setLyricsFullscreen(false)}
            className="flex items-center justify-center size-9 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/15 text-white/80 hover:text-white shadow-xl transition-all cursor-pointer hover:scale-105 active:scale-95 group select-none"
            aria-label="Exit fullscreen"
            title="Exit fullscreen (Esc)"
          >
            <CloseIcon size={18} className="transition-transform group-hover:scale-110" />
          </button>
        </div>
      )}

      {/*
        The buttons below are navigable but never announced as they light up, so a listener
        using a screen reader would get a static sheet and no sense of where the song is.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {isSynced && activeIndex >= 0 ? lines[activeIndex]?.text ?? "" : ""}
      </p>

      {/* Top Header: Transparent Black Bar hosting Song / Video Switcher - Hidden in Fullscreen Mode */}
      {!isFullscreen && (
        <header className="shrink-0 z-30 flex items-center justify-between px-6 py-2.5 bg-black/60 backdrop-blur-md border-b border-white/10 shadow-sm pointer-events-auto w-full rounded-t-2xl">
          <div className="flex-1" />
          <div className="flex items-center rounded-full bg-black/60 backdrop-blur-sm p-1 border border-white/15 text-xs font-semibold text-white/80 shadow-md select-none">
            <button
              type="button"
              onClick={() => void handleSwitchMediaMode("song")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-all cursor-pointer",
                mediaMode === "song"
                  ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                  : "hover:text-white text-white/70",
              )}
            >
              <span>Song</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSwitchMediaMode("video")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-all cursor-pointer",
                mediaMode === "video"
                  ? "bg-white/25 text-white shadow-sm font-bold border border-white/20"
                  : "hover:text-white text-white/70",
              )}
            >
              <span>Video</span>
            </button>
          </div>
          <div className="flex-1 flex justify-end">
            {track && isSynced && mediaMode === "song" && (
              <LyricsOffsetControl trackId={track.id} offset={offset} />
            )}
          </div>
        </header>
      )}

      {isFullscreen ? (
        !isLoading && !hasLines ? (
          /* Centered Player in Fullscreen when there are no lyrics */
          <div className="relative min-h-0 flex-1 flex flex-col items-center justify-center p-6 sm:p-10 select-none">
            <div className="flex flex-col items-center justify-center max-w-sm sm:max-w-md w-full">
              <div className="relative size-64 sm:size-72 md:size-80 lg:size-[380px] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/15 bg-card shrink-0">
                <TrackArtwork
                  artworkUrl={effectiveArtworkUrl}
                  size={420}
                  className="size-full object-cover"
                  iconSize={64}
                  loading="eager"
                />
              </div>

              {renderPlaybackControls()}
            </div>
          </div>
        ) : (
          /* Split Screen Fullscreen View (Pure lyrics, no video section) */
          <div className="relative min-h-0 flex-1 flex flex-col justify-center">
            <div className={cn(
              "grid gap-8 lg:gap-14 items-center max-w-[1850px] w-full mx-auto px-6 md:px-10 lg:pl-10 lg:pr-8 py-8 overflow-hidden",
              showPlaybackCard ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1 max-w-5xl",
            )}>
              {/* Left Column: Artwork Card + Mini Transport Player (Only when showPlaybackCard is true) */}
              {showPlaybackCard && (
                <div className="lg:col-span-4 xl:col-span-4 flex flex-col items-center lg:items-start justify-center lg:pl-0 xl:pl-4">
                  <div className="relative size-64 sm:size-72 md:size-80 lg:size-[380px] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/15 bg-card">
                    <TrackArtwork
                      artworkUrl={effectiveArtworkUrl}
                      size={420}
                      className="size-full object-cover"
                      iconSize={64}
                      loading="eager"
                    />
                  </div>

                  {renderPlaybackControls()}
                </div>
              )}

              {/* Right Column: Synced Lyrics */}
              <div className={cn(
                "h-[70vh] lg:h-[80vh] relative",
                showPlaybackCard ? "lg:col-span-8 xl:col-span-8" : "lg:col-span-12 flex justify-center w-full",
              )}>
                <div
                  ref={scrollerRef}
                  className={cn(
                    "relative h-full overflow-y-auto overscroll-contain px-4 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    !showPlaybackCard && "w-full max-w-4xl",
                  )}
                  onWheel={pauseFollow}
                  onPointerDown={pauseFollow}
                  onTouchMove={pauseFollow}
                >
                  <div className={cn("max-w-4xl xl:max-w-5xl w-full", hasLines ? (isSynced ? "py-[40vh]" : "pb-20 pt-8") : "py-8 flex flex-col items-center justify-center min-h-[50vh]")}>
                    {isLoading && <LyricsSkeleton />}

                    {!isLoading && !track && <LyricsMessage text="Play something to see its lyrics." />}

                    {!isLoading && hasLines && (
                    <div
                      className="flex flex-col pl-5"
                      style={{
                        fontSize: `calc(${isSynced ? LINE_FONT_SIZE : READING_FONT_SIZE} * ${fontScale})`,
                        gap: isSynced ? `calc(${LINE_GAP} * ${fontScale})` : undefined,
                      }}
                      onKeyDown={isSynced ? handleLineKeyDown : undefined}
                    >
                      {/* Intro / Instrumental Beat Dots (Apple Music Style) */}
                      {isSynced && activeIndex < 0 && (
                        <div className="flex items-center gap-2 py-4 mb-2">
                          {[0, 1, 2].map((dot) => (
                            <span
                              key={dot}
                              className="size-2.5 rounded-full bg-white/70 animate-pulse"
                              style={{ animationDelay: `${dot * 250}ms` }}
                            />
                          ))}
                        </div>
                      )}

                      {lines.map((line, index) => {
                        const duetInfo = duetProcessedLines[index];
                        const displayText = duetInfo?.displayText ?? line.text;
                        const alignment = duetInfo?.alignment ?? "left";
                        const dist = activeIndex < 0
                          ? 1
                          : Math.min(DEPTH.length - 1, Math.abs(index - activeIndex));
                        const depth = DEPTH[Math.min(dist, DEPTH.length - 1)];
                        const lineActive = index === activeIndex;

                        return isSynced ? (
                          <LyricLineView
                            key={`${index}:${line.text}`}
                            index={index}
                            text={displayText}
                            isActive={lineActive}
                            alignment={alignment}
                            enableAdlibs={isAdlibsMode}
                            depthStyle={{
                              opacity: lineActive ? 1 : depth.opacity,
                              filter: lineActive ? "none" : depth.blur ? `blur(${depth.blur}px)` : undefined,
                              transform: lineActive ? "scale(1.035) translateZ(0)" : "scale(0.985) translateZ(0)",
                            }}
                            reduceMotion={reduce}
                            translation={translations?.[index] || undefined}
                            tabbable={index === tabbableIndex}
                            onSeek={seekLine}
                            onSyncLine={handleSyncLine}
                            onFocusLine={setFocusIndex}
                            register={registerLine}
                          />
                        ) : (
                          <p
                            key={`${index}:${line.text}`}
                            ref={(element) => registerLine(index, element)}
                            dir={isRtlText(displayText) ? "rtl" : "ltr"}
                            className={cn(
                              "text-pretty py-1 leading-relaxed text-foreground/85 max-w-full",
                              alignment === "right" && "self-end text-right",
                              alignment === "center" && "self-center text-center",
                              (!alignment || alignment === "left") && "self-start text-start",
                              isRtlText(displayText) && "text-start font-arabic font-bold tracking-normal leading-snug",
                            )}
                          >
                            {(isAdlibsMode ? parseLyricTokens(displayText) : [{ type: "main" as const, text: displayText }]).map((tok, i) =>
                              tok.type === "adlib" ? (
                                <span
                                  key={i}
                                  className="text-[0.78em] italic font-normal opacity-70 mx-1.5 inline-block text-white/75"
                                >
                                  {tok.text}
                                </span>
                              ) : (
                                <span key={i}>{tok.text}</span>
                              ),
                            )}
                            {translations?.[index] && (
                              <span className="mt-0.5 block text-[0.72em] text-muted-foreground">
                                {translations[index]}
                              </span>
                            )}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {isFollowPaused && activeIndex >= 0 && (
                <button
                  type="button"
                  className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl shadow-black/30 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={resumeFollow}
                  aria-label="Resync lyrics to current playback position"
                >
                  <RefreshIcon size={15} aria-hidden="true" />
                  Back to current line
                </button>
              )}
            </div>
          </div>
        </div>
        )
      ) : mediaMode === "video" ? (
        /* Video Mode View: positioned cleanly under the top header with proper padding */
        <div className="relative min-h-0 flex-1 w-full flex flex-col justify-start items-center p-4 sm:p-8 pt-4 pb-16 max-w-5xl mx-auto overflow-y-auto">
          {track && (
            <VideoPlayerView
              videoId={activeVideoId}
              track={track}
              initialTime={playerController.getCurrentTime()}
              initialPlaying={isPlaying}
            />
          )}
        </div>
      ) : (
        /* Normal Mode: Lyrics ONLY — scroll down past lyrics to see details */
        <div className="relative min-h-0 flex-1 flex flex-col">
          <div
            ref={scrollerRef}
            className="relative flex-1 overflow-y-auto overscroll-contain px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onWheel={pauseFollow}
            onPointerDown={pauseFollow}
            onTouchMove={pauseFollow}
          >
            <div
              className={cn(
                "mx-auto max-w-3xl w-full",
                hasLines ? (isSynced ? "py-[38vh]" : "pb-12 pt-8") : "py-12 flex flex-col items-center justify-center min-h-[60vh]",
              )}
            >
              {isLoading && <LyricsSkeleton />}

              {!isLoading && !track && <LyricsMessage text="Play something to see its lyrics." />}

              {!isLoading && track && !hasLines && (
                <LyricsEmptyShowcase
                  track={track}
                  artworkUrl={effectiveArtworkUrl}
                  message={emptyMessage}
                  onRetry={isOnline ? () => setReloadToken((token) => token + 1) : undefined}
                />
              )}

              {!isLoading && hasLines && (
                <div
                  className="flex flex-col pl-4"
                  style={{
                    fontSize: `calc(${isSynced ? LINE_FONT_SIZE : READING_FONT_SIZE} * ${fontScale})`,
                    gap: isSynced ? `calc(${LINE_GAP} * ${fontScale})` : undefined,
                  }}
                  onKeyDown={isSynced ? handleLineKeyDown : undefined}
                >
                  {/* Intro / Instrumental Beat Dots */}
                  {isSynced && activeIndex < 0 && (
                    <div className="flex items-center gap-2 py-4 mb-2">
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className="size-2.5 rounded-full bg-white/70 animate-pulse"
                          style={{ animationDelay: `${dot * 250}ms` }}
                        />
                      ))}
                    </div>
                  )}

                  {lines.map((line, index) => {
                    const dist = activeIndex < 0
                      ? 1
                      : Math.min(DEPTH.length - 1, Math.abs(index - activeIndex));
                    const depth = DEPTH[Math.min(dist, DEPTH.length - 1)];
                    const lineActive = index === activeIndex;
                    return isSynced ? (
                      <LyricLineView
                        key={`${index}:${line.text}`}
                        index={index}
                        text={line.text}
                        isActive={lineActive}
                        depthStyle={{
                          opacity: lineActive ? 1 : depth.opacity,
                          filter: lineActive ? "none" : depth.blur ? `blur(${depth.blur}px)` : undefined,
                          transform: lineActive ? "scale(1.035) translateZ(0)" : "scale(0.985) translateZ(0)",
                        }}
                        reduceMotion={reduce}
                        translation={translations?.[index] || undefined}
                        tabbable={index === tabbableIndex}
                        onSeek={seekLine}
                        onSyncLine={handleSyncLine}
                        onFocusLine={setFocusIndex}
                        register={registerLine}
                      />
                    ) : (
                      <p
                        key={`${index}:${line.text}`}
                        ref={(element) => registerLine(index, element)}
                        dir={isRtlText(line.text) ? "rtl" : "ltr"}
                        className={cn(
                          "text-pretty py-1 leading-relaxed text-foreground/85",
                          isRtlText(line.text) && "text-start font-arabic font-bold tracking-normal leading-snug",
                        )}
                      >
                        {line.text}
                        {translations?.[index] && (
                          <span className="mt-0.5 block text-[0.72em] text-muted-foreground">
                            {translations[index]}
                          </span>
                        )}
                      </p>
                    );
                  })}
                </div>
              )}

            </div>
          </div>

          {isFollowPaused && activeIndex >= 0 && (
            <button
              type="button"
              className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl shadow-black/30 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={resumeFollow}
              aria-label="Resync lyrics to current playback position"
            >
              <RefreshIcon size={15} aria-hidden="true" />
              Back to current line
            </button>
          )}
        </div>
      )}
    </section>
  );
}


void LYRICS_SOURCES;
// Hidden per user request - API badges removed
/**
 * Which sources were tried, in priority order, and what each one did.
 *
 * "No lyrics available" is the least useful sentence a music app can show — it gives the
 * listener nothing to act on and gives a bug report nothing to go on. This turns it into a
 * fact: which of the five ranked sources was asked, how long it took, and why it lost.
 */
function _LyricsSourcePanel({
  attempts,
  activeId,
}: {
  attempts: LyricsSourceAttempt[];
  activeId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const winner = attempts.find((attempt) => attempt.id === activeId);

  return (
    <FloatingPanel
      open={isOpen}
      onOpenChange={setIsOpen}
      side="top"
      className="w-[21rem]"
      triggerClassName="min-w-0"
      trigger={
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label="Show which lyric sources were tried"
        >
          <span
            className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[winner?.status ?? "miss"])}
            aria-hidden="true"
          />
          <span className="truncate">{winner ? `via ${winner.label}` : "No source matched"}</span>
        </button>
      }
    >
      <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Sources, best first
      </p>
      <div className="flex flex-col">
        {attempts.map((attempt) => {
          const isWinner = attempt.id === activeId;
          return (
            <div
              key={attempt.id}
              className={cn("flex items-start gap-2 rounded-lg px-2 py-1.5", isWinner && "bg-muted/40")}
              // The ranking rationale, one hover away — it explains the order without
              // spending five permanent lines of the panel on it.
              title={LYRICS_SOURCES.find((source) => source.id === attempt.id)?.note}
            >
              <span
                className={cn("mt-[0.4rem] size-1.5 shrink-0 rounded-full", STATUS_DOT[attempt.status])}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "truncate text-sm",
                      isWinner ? "font-semibold text-foreground" : "text-foreground/80",
                    )}
                  >
                    {attempt.label}
                  </span>
                  {attempt.durationMs > 0 && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {attempt.durationMs}ms
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">{attempt.detail}</span>
              </span>
            </div>
          );
        })}
      </div>
    </FloatingPanel>
  );
}
void _LyricsSourcePanel;

function formatOffset(offset: number): string {
  if (offset === 0) return "In sync";
  const magnitude = Math.abs(offset).toFixed(2).replace(/\.?0+$/, "");
  return `${offset > 0 ? "+" : "−"}${magnitude}s`;
}

/**
 * Nudges the whole lyric sheet against the audio.
 *
 * "+" advances the lyrics, matching the sign convention of an LRC `[offset:]` tag, and the
 * value doubles as the reset button so correcting a mistake costs one click rather than
 * hunting for a separate control.
 */
function LyricsOffsetControl({ trackId, offset }: { trackId: string; offset: number }) {
  const step = (delta: number) => setLyricsOffset(trackId, offset + delta);

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full bg-black/60 backdrop-blur-md p-1 border border-white/15 text-xs font-semibold text-white/80 shadow-lg select-none"
      role="group"
      aria-label="Lyric timing"
      title="Adjust lyric synchronization (or press [ and ] keys, or Shift+click any lyric line to sync)"
    >
      <OffsetButton
        label="−"
        ariaLabel="Delay lyrics by 0.5s (Shift+click for 2s)"
        onClick={(e) => step(e.shiftKey ? -2.0 : -0.5)}
      />
      <button
        type="button"
        className="min-w-[4rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-white/90 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-75 cursor-pointer"
        onClick={() => setLyricsOffset(trackId, 0)}
        disabled={offset === 0}
        aria-label={offset === 0 ? "Lyrics are in sync" : "Reset lyric timing"}
        title={offset === 0 ? "Lyrics in sync (use -/+ to nudge, or Shift+click any line to sync)" : `Current offset: ${formatOffset(offset)} (click to reset to 0s)`}
      >
        {formatOffset(offset)}
      </button>
      <OffsetButton
        label="+"
        ariaLabel="Advance lyrics by 0.5s (Shift+click for 2s)"
        onClick={(e) => step(e.shiftKey ? 2.0 : 0.5)}
      />
    </div>
  );
}

function OffsetButton({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="flex size-6 items-center justify-center rounded-full text-xs font-bold transition-all text-white/80 hover:text-white hover:bg-white/20 active:scale-95 cursor-pointer focus-visible:outline-none"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {label}
    </button>
  );
}

/* Staggered bars rather than a spinner: it previews the shape of what is arriving, so the
   swap to real lines reads as content landing instead of a screen change. */
function LyricsSkeleton() {
  const widths = [72, 58, 84, 46, 66, 78, 52];
  return (
    <div className="flex flex-col gap-7 pt-10" role="status" aria-label="Loading lyrics">
      {widths.map((width, index) => (
        <div
          key={width}
          className="h-8 animate-pulse rounded-lg bg-foreground/10"
          style={{ width: `${width}%`, animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  );
}

interface LyricsEmptyShowcaseProps {
  track: Track;
  artworkUrl?: string;
  message: string;
  onRetry?: () => void;
}

function LyricsEmptyShowcase({ track, artworkUrl, message, onRetry }: LyricsEmptyShowcaseProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12 px-4 text-center my-auto w-full select-none" role="status">
      {/* Album Artwork with smooth shadow & ambient hover */}
      <div
        className="group/hero relative size-52 sm:size-64 md:size-72 shrink-0 overflow-hidden rounded-2xl bg-black/40 shadow-2xl ring-1 ring-white/15 cursor-pointer transition-transform duration-300 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          if (artworkUrl) setIsLightboxOpen(true);
        }}
        title="Click to preview cover art"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && artworkUrl) {
            e.preventDefault();
            setIsLightboxOpen(true);
          }
        }}
      >
        <TrackArtwork
          className="size-full object-cover rounded-2xl"
          size={500}
          artworkUrl={artworkUrl}
          iconSize={56}
          loading="eager"
          preferProxy
        />
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/hero:opacity-100 transition-opacity flex items-center justify-center">
          <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-xs font-semibold shadow-md">
            Preview artwork
          </span>
        </div>
      </div>

      {/* Track Info (Title, Artists, Album) */}
      <div className="flex flex-col items-center gap-1.5 max-w-lg">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight line-clamp-2 drop-shadow-md">
          {track.title}
        </h2>
        <div className="text-base sm:text-lg font-medium text-white/80 drop-shadow-sm">
          <ArtistLinks
            artists={track.artists}
            fallback={track.artist}
            trackTitle={track.title}
            className="text-white/80 hover:text-white hover:underline transition-colors"
          />
        </div>
        {track.album && (
          <span className="text-xs sm:text-sm text-white/60 font-medium line-clamp-1 drop-shadow-sm">
            {track.album}
          </span>
        )}
      </div>

      {/* Status & Retry */}
      <div className="flex flex-col items-center gap-3 mt-1">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs sm:text-sm font-semibold text-white/90 shadow-md">
          <LyricsIcon size={16} className="text-white/70" aria-hidden="true" />
          <span>{message}</span>
        </div>

        {onRetry && (
          <button
            type="button"
            className="flex items-center gap-2 rounded-full bg-white text-black px-5 py-2 text-xs font-bold transition-transform hover:scale-105 active:scale-95 shadow-md cursor-pointer hover:bg-white/90"
            onClick={onRetry}
          >
            <RefreshIcon size={14} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>

      <ArtworkLightboxModal
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        artworkUrl={artworkUrl}
      />
    </div>
  );
}

function LyricsMessage({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-2 py-24 text-center" role="status">
      <LyricsIcon size={28} className="text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{text}</p>
      {onRetry && (
        <button
          type="button"
          className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}
        >
          <RefreshIcon size={15} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}
