import {
  type KeyboardEvent,
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
  LyricsIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  RefreshIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from "@/ui/icons";
import type { Lyrics, LyricsSourceAttempt, LyricsSourceStatus } from "../../datasource/types";
import { LYRICS_SOURCES } from "../../datasource/youtube/lyricsSources";
import { FloatingPanel } from "../components/FloatingPanel";
import { logInternalWarn } from "../../internal/logging";
import { playerController, shallowEqual, usePlayerSelector } from "../../player/playerStore";
import { playerUIStore, usePlayerUIState } from "../stores/playerUIStore";
import { ArtistLinks } from "../components/ArtistLinks";
import { TrackArtwork } from "../components/TrackArtwork";
import { CoverAmbienceCanvas } from "../components/CoverAmbienceCanvas";
import { setAmbientArtwork } from "../stores/ambientArtworkStore";
import { SpotifyService } from "../../services/SpotifyService";
import { getVideoArtworkFallback } from "../../datasource/youtube/artwork";
import { OFFSET_STEP_SEC, setLyricsOffset, useLyricsOffset } from "../settings/lyricsOffset";
import { useLyricsFontScale } from "../settings/lyricsFontScale";
import { TRANSLATION_OFF, useLyricsTranslationLang } from "../settings/lyricsTranslation";
import { useLyricsDuetMode, useLyricsAdlibsMode } from "../settings/lyricsEnhancements";
import { translateLines } from "../../datasource/translate";
import { LyricLineView } from "../components/lyrics/LyricLineView";
import {
  findActiveLineIndex,
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
    (player) => ({ currentTrack: player.currentTrack, status: player.status }),
    shallowEqual,
  );
  const track = playerState.currentTrack;
  const isPlaying = playerState.status === "playing";
  const reduce = useReduceMotion();
  const isFullscreen = usePlayerUIState().isLyricsFullscreen;
  const isDuetMode = useLyricsDuetMode();
  const isAdlibsMode = useLyricsAdlibsMode();
  const offset = useLyricsOffset(track?.id);
  const fontScale = useLyricsFontScale();
  const translationLang = useLyricsTranslationLang();
  const [translations, setTranslations] = useState<string[] | null>(null);

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

  const toggleSplitMode = () => {
    setShowPlaybackCard((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("lyrics_fullscreen_split", String(next));
      } catch {}
      return next;
    });
  };
  void toggleSplitMode;
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [showRemainingTime, setShowRemainingTime] = useState(true);

  const handleClose = () => {
    playerUIStore.setLyricsFullscreen(false);
    playerUIStore.setLyricsOpen(false);
    onClose();
  };

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
      setCurrentPlaybackTime(engineTime);
      const autoIntro = lyrics?.autoIntroOffsetSec ?? 0;
      const time = engineTime - autoIntro + offset;
      const currentLines = linesRef.current;
      const next = findActiveLineIndex(currentLines, time);

      /* Committing every frame would re-render the whole column sixty times a second for a
         value that flips a few times a minute. Only the flip is worth a render. */
      if (next !== current) {
        if (current >= 0 && lineRefs.current[current]) {
          lineRefs.current[current]?.style.setProperty("--sweep", "100%");
        }
        current = next;
        setActiveIndex(next);
      }

      if (reduce || next < 0) return;
      /* The sweep is written straight onto the node. It changes every frame by definition,
         so routing it through state would undo the optimisation directly above. */
      const progress = getLineProgress(currentLines, next, time, durationRef.current);
      lineRefs.current[next]?.style.setProperty("--sweep", `${(progress * 100).toFixed(1)}%`);
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

  // A fresh song starts at the top, whether or not it turned out to be synced.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [lyrics]);

  useEffect(() => {
    if (activeIndex < 0 || isFollowPaused) return;
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
    resumeFollow();
    // Lines are matched against `currentTime - autoIntro + offset`, so the audio for this line sits that
    // far back. Seeking to the raw start time would land a whole offset away from the words.
    const autoIntro = lyrics?.autoIntroOffsetSec ?? 0;
    const target = Math.max(0, start + autoIntro - offset);
    pendingSeekRef.current = { target, at: performance.now() };
    setCurrentPlaybackTime(target);
    setActiveIndex(index);
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

  const handleLineKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  return (
    <section
      className={cn(
        "@container/lyrics relative flex h-full min-h-0 w-full flex-col overflow-hidden",
        isFullscreen && "fixed inset-0 h-screen w-screen min-h-screen z-50 bg-black/95 overflow-hidden",
      )}
      aria-label="Lyrics"
    >
      {/*
        The cover, oversized and blurred past recognition, is the only colour on the screen.
        Sized at the smallest variant deliberately: nothing above 120px survives the blur, so a
        larger source would cost texture memory and show nothing.

        The radius is 32px, not 70px. This is the most expensive single element in the app: a
        136%-of-window box, so ~2600x1470 on a 1080p display, which is a 15 MB layer before the
        filter has done anything — and blur cost scales with radius, because Chromium runs more
        downsample passes and allocates intermediates expanded by it.

        70px was buying almost nothing. The source is a 120px image stretched roughly twenty
        times, so one source pixel already covers ~20 display pixels and the upscale is doing
        the softening; 70px of filter was ~3.5 source pixels of extra blur on top of that.
        32px is the radius `Layout` settled on for the same trick at the same upscale, for the
        same reason. Toggle Settings > Potato PC > Manage > "Blur and colour filters" to see
        the whole class of effect on and off.
      */}
      {/* Dynamic moving ambient background ("Cover Ambience") */}
      <CoverAmbienceCanvas artworkUrl={activeBackgroundUrl} />

      {/*
        The buttons below are navigable but never announced as they light up, so a listener
        using a screen reader would get a static sheet and no sense of where the song is.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {isSynced && activeIndex >= 0 ? lines[activeIndex]?.text ?? "" : ""}
      </p>

      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        {/* Close Button */}
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-md border border-white/10 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer shadow-md"
          onClick={() => void handleClose()}
          aria-label="Close lyrics"
          title="Close lyrics"
        >
          <CloseIcon size={19} />
        </button>
      </div>

      {isFullscreen ? (
        /* Split Screen Fullscreen View (Matches media_1788521601006.png) */
        <div className="relative min-h-0 flex-1 flex flex-col justify-center">
          <div className={cn(
            "grid gap-8 lg:gap-14 items-center max-w-7xl mx-auto w-full h-full px-6 md:px-12 py-8 overflow-hidden",
            showPlaybackCard ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1 max-w-4xl",
          )}>
            {/* Left Column: Artwork Card + Mini Transport Player (Only when showPlaybackCard is true) */}
            {showPlaybackCard && (
              <div className="lg:col-span-5 flex flex-col items-center justify-center">
                <div className="relative size-64 sm:size-72 md:size-80 lg:size-[380px] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/15 bg-card">
                  <TrackArtwork
                    artworkUrl={effectiveArtworkUrl}
                    size={420}
                    className="size-full object-cover"
                    iconSize={64}
                    loading="eager"
                  />
                </div>

                {/* Mini Player Under Artwork */}
                {track && (
                  <div className="w-full max-w-[380px] mt-6 flex flex-col gap-2.5">
                    <div className="flex min-w-0 flex-col mb-1 text-center lg:text-left">
                      <span className="truncate text-lg font-bold text-white tracking-tight">{track.title}</span>
                      <span className="truncate text-sm text-white/70">
                        <ArtistLinks artists={track.artists} fallback={track.artist} />
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-white/60 tabular-nums font-medium">
                      <span>{formatMinutesSeconds(currentPlaybackTime)}</span>
                      <button
                        type="button"
                        onClick={() => setShowRemainingTime((prev) => !prev)}
                        className="hover:text-white transition-colors cursor-pointer select-none font-medium tabular-nums focus-visible:outline-none"
                        title={showRemainingTime ? "Click to show total length" : "Click to show remaining time"}
                        aria-label={showRemainingTime ? "Click to show total length" : "Click to show remaining time"}
                      >
                        {showRemainingTime
                          ? `-${formatMinutesSeconds(Math.max(0, (track.durationSec || 0) - currentPlaybackTime))}`
                          : formatMinutesSeconds(track.durationSec || 0)}
                      </button>
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
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white hover:accent-primary transition-all"
                      aria-label="Seek track"
                    />

                    <div className="flex items-center justify-center gap-5 mt-2 text-white">
                      <button
                        type="button"
                        onClick={() => void playerController.skipToPrevious()}
                        className="flex size-10 items-center justify-center rounded-full hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
                        className="flex size-10 items-center justify-center rounded-full hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                        aria-label="Next track"
                      >
                        <SkipNextIcon size={22} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Right Column: Synced Lyrics */}
            <div className={cn(
              "h-[70vh] lg:h-[80vh] relative",
              showPlaybackCard ? "lg:col-span-7" : "lg:col-span-12 flex justify-center w-full",
            )}>
              <div
                ref={scrollerRef}
                className={cn(
                  "relative h-full overflow-y-auto overscroll-contain px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  !showPlaybackCard && "w-full max-w-3xl",
                )}
                onWheel={pauseFollow}
                onPointerDown={pauseFollow}
                onTouchMove={pauseFollow}
              >
                <div className={cn("max-w-xl", isSynced ? "py-[40vh]" : "pb-20 pt-8")}>
                  {isLoading && <LyricsSkeleton />}

                  {!isLoading && !track && <LyricsMessage text="Play something to see its lyrics." />}

                  {!isLoading && track && !hasLines && (
                    <LyricsMessage
                      text={emptyMessage}
                      onRetry={isOnline ? () => setReloadToken((token) => token + 1) : undefined}
                    />
                  )}

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
                            onFocusLine={setFocusIndex}
                            register={registerLine}
                          />
                        ) : (
                          <p
                            key={`${index}:${line.text}`}
                            ref={(element) => registerLine(index, element)}
                            dir={isRtlText(displayText) ? "rtl" : "ltr"}
                            className={cn(
                              "text-pretty py-1 leading-relaxed text-foreground/85 max-w-[88%]",
                              alignment === "right" && "self-end text-right",
                              alignment === "center" && "self-center text-center",
                              (!alignment || alignment === "left") && "self-start text-start",
                              isRtlText(displayText) && "text-start font-sans font-medium",
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
                isSynced ? "py-[38vh]" : "pb-12 pt-8",
              )}
            >
              {isLoading && <LyricsSkeleton />}

              {!isLoading && !track && <LyricsMessage text="Play something to see its lyrics." />}

              {!isLoading && track && !hasLines && (
                <LyricsMessage
                  text={emptyMessage}
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
                          isRtlText(line.text) && "text-start font-sans font-medium",
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

              {/* Inline Details Section — scroll down past lyrics to see */}
              {track && !isLoading && (
                <div className="mx-auto max-w-xl mt-16 mb-12 flex flex-col gap-3 text-sm text-white/80">
                  <div className="h-px w-full bg-white/10 mb-2" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-1">Track Details</h3>
                  {track.album && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-white/50">Album</span>
                      <span className="font-semibold text-white/90 truncate text-right">{track.album}</span>
                    </div>
                  )}
                  {track.durationSec ? (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-white/50">Duration</span>
                      <span className="font-semibold text-white/90 tabular-nums">{formatMinutesSeconds(track.durationSec)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-white/50">Lyrics</span>
                    <span className="font-semibold text-white/90 truncate text-right">
                      {lyrics?.sourceLabel ? `Provided by ${lyrics.sourceLabel}` : isSynced ? "Synchronized lyrics" : "Standard lyrics"}
                    </span>
                  </div>
                  {(track.viewCount || track.viewCountText) && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-white/50">Plays</span>
                      <span className="font-semibold text-white/90 tabular-nums">
                        {track.viewCount ? Number(track.viewCount).toLocaleString() : track.viewCountText}
                      </span>
                    </div>
                  )}
                  {track.artist && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-white/50">Artist</span>
                      <span className="font-semibold text-white/90 truncate text-right">{track.artist}</span>
                    </div>
                  )}
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
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-card/70 p-0.5"
      role="group"
      aria-label="Lyric timing"
    >
      <OffsetButton
        label="−"
        ariaLabel={`Delay lyrics by ${OFFSET_STEP_SEC} seconds`}
        onClick={() => step(-OFFSET_STEP_SEC)}
      />
      <button
        type="button"
        className="min-w-[4.25rem] rounded-full px-1 py-0.5 text-center tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:text-muted-foreground"
        onClick={() => setLyricsOffset(trackId, 0)}
        disabled={offset === 0}
        aria-label={offset === 0 ? "Lyrics are in sync" : "Reset lyric timing"}
        title={offset === 0 ? undefined : "Reset"}
      >
        {formatOffset(offset)}
      </button>
      <OffsetButton
        label="+"
        ariaLabel={`Advance lyrics by ${OFFSET_STEP_SEC} seconds`}
        onClick={() => step(OFFSET_STEP_SEC)}
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
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex size-6 items-center justify-center rounded-full text-sm leading-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      aria-label={ariaLabel}
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

void LyricsOffsetControl;
void formatOffset;
void OffsetButton;
