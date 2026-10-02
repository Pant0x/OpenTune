import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import rewindAudioUrl from "@/assets/sounds/rewind.mp3";
import { useRewindButton } from "../../settings/playerAddons";
import {
  PauseActiveIcon,
  PlayActiveIcon,
  RepeatActiveIcon,
  RepeatIcon,
  RepeatOneActiveIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from "@/ui/icons";
import { shallowEqual, usePlayerSelector } from "../../../player/playerStore";
import { playerController } from "../../../player/playerStore";

/**
 * Vinyl record icon from NickColley/spicetify-rewind.
 */
function VinylRecordIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 55.33 55.33"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="28.16" cy="27.67" r="3.37" />
      <path d="M28.16 1.89a25.78 25.78 0 1 0-.99 51.55 25.78 25.78 0 0 0 .99-51.55Zm-9.83 6.4a21.63 21.63 0 0 1 10.44-2.32c.34 0 .58.85.53 1.88l-.27 5.29c-.05 1.02-.27 1.85-.48 1.84h-.4c-1.86 0-3.63.4-5.21 1.12-.94.42-2.07.17-2.6-.72l-2.7-4.57a1.79 1.79 0 0 1 .69-2.51Zm-1.06 9.72-3.98-3.5a1.73 1.73 0 0 1-.06-2.6 1.7 1.7 0 0 1 2.54.24l3.26 4.17c.64.81.78 1.77.37 2.16-.42.4-1.35.2-2.13-.47Zm1.76 9.66a9.12 9.12 0 1 1 18.25 0 9.12 9.12 0 0 1-18.25 0Zm18.9 19.38a21.62 21.62 0 0 1-10.46 2.32c-.39-.01-.66-.87-.6-1.9l.29-5.28c.05-1.03.3-1.85.55-1.84h.45c1.7 0 3.33-.33 4.82-.94.95-.4 2.12-.13 2.68.73l2.88 4.44c.56.87.32 2.01-.6 2.48Zm5.09-3.55c-.72.67-1.87.51-2.52-.28l-3.35-4.12c-.66-.79-.81-1.71-.4-2.1.4-.37 1.34-.16 2.11.52L42.85 41c.78.68.88 1.83.17 2.5Z" />
    </svg>
  );
}

interface PlaybackControlsProps {
  extraControlsAlwaysVisible?: boolean;
}

const CONTROL_BUTTON =
  "flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Crossfade+scale used by the play/pause glyph swap. */
const GLYPH_MOTION = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { type: "spring" as const, stiffness: 620, damping: 34 },
};

export function PlaybackControls({ extraControlsAlwaysVisible = true }: PlaybackControlsProps) {
  const state = usePlayerSelector(
    (player) => ({
      currentTrack: player.currentTrack,
      status: player.status,
      playbackOrderMode: player.playbackOrderMode,
      shuffleEnabled: player.shuffleEnabled,
    }),
    shallowEqual,
  );
  const showRewindButton = useRewindButton();
  const [isRewinding, setIsRewinding] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const isPlaying = state.status === "playing";
  const hasCurrentTrack = Boolean(state.currentTrack);

  const handleRewind = () => {
    if (!hasCurrentTrack) return;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio(rewindAudioUrl);
    }

    const audio = audioRef.current;
    audio.currentTime = 0.612; // REWIND_AUDIO_START_TIME
    const vol = playerController.getVolume();
    audio.volume = Math.max(0.1, Math.min(0.85, Math.pow(vol, 2)));

    setIsRewinding(true);
    void audio.play().catch(() => {});
    void playerController.pause();
    void playerController.seekTo(0);

    timerRef.current = window.setTimeout(() => {
      setIsRewinding(false);
      audio.pause();
      audio.currentTime = 0.612;
      void playerController.play();
    }, 2200);
  };

  const handlePlayPause = () => {
    void playerController.togglePlayPause();
  };

  const handleSkipNext = () => {
    void playerController.skipToNext();
  };

  const handleSkipPrevious = () => {
    void playerController.skipToPrevious();
  };

  const handlePlaybackOrderCycle = () => {
    playerController.cyclePlaybackOrderMode();
  };

  const handleShuffleToggle = () => {
    playerController.toggleShuffle();
  };

  const orderLabel =
    state.playbackOrderMode === "repeat-one"
      ? "Loop current song"
      : state.playbackOrderMode === "repeat-all"
        ? "Loop the queue"
        : "Play in order";

  // In-order is the resting state, so it reads as Linear; the other two are Bold.
  const isOrderActive = state.playbackOrderMode !== "in-order";
  const isShuffled = state.shuffleEnabled;

  return (
    <div className="flex items-center gap-1">
      {/*
        Shuffle sits opposite repeat, the arrangement every player shares — and it is what the
        spacer here used to stand in for, so the previous/play/next trio stays centred without
        a placeholder. Both fade together when the extra controls are set to appear on hover.
      */}
      <div
        className={cn(
          "size-9 shrink-0 transition-opacity",
          !extraControlsAlwaysVisible &&
            "opacity-0 focus-within:opacity-100 group-hover/playerbar:opacity-100",
        )}
      >
        <button
          type="button"
          className={cn(CONTROL_BUTTON, isShuffled && "text-primary hover:text-primary")}
          onClick={handleShuffleToggle}
          aria-pressed={isShuffled}
          aria-label={isShuffled ? "Turn off shuffle" : "Shuffle"}
          title={isShuffled ? "Shuffle is on" : "Shuffle"}
        >
          {isShuffled ? <ShuffleActiveIcon size={20} /> : <ShuffleIcon size={20} />}
        </button>
      </div>

      {showRewindButton && (
        <button
          type="button"
          className={cn(
            CONTROL_BUTTON,
            isRewinding && "text-primary scale-110",
          )}
          onClick={handleRewind}
          disabled={!hasCurrentTrack}
          aria-label="Rewind track"
          title="Rewind (Boiler room vinyl scratch)"
        >
          <VinylRecordIcon
            size={18}
            className={cn(
              "transition-transform",
              isRewinding
                ? "animate-[spin_0.2s_linear_infinite_reverse]"
                : isPlaying
                  ? "animate-[spin_2.5s_linear_infinite]"
                  : "",
            )}
          />
        </button>
      )}

      <button
        type="button"
        className={CONTROL_BUTTON}
        onClick={handleSkipPrevious}
        disabled={!hasCurrentTrack}
        aria-label="Previous track"
      >
        <SkipPreviousIcon size={20} />
      </button>

      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-transform duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        onClick={handlePlayPause}
        disabled={!hasCurrentTrack}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        <span className="relative grid size-5 place-items-center" aria-hidden="true">
          <AnimatePresence initial={false} mode="popLayout">
            {isPlaying ? (
              <motion.span key="pause" {...GLYPH_MOTION} className="absolute">
                <PauseActiveIcon size={18} fill="currentColor" />
              </motion.span>
            ) : (
              <motion.span key="play" {...GLYPH_MOTION} className="absolute ml-0.5">
                <PlayActiveIcon size={18} fill="currentColor" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </button>

      <button
        type="button"
        className={CONTROL_BUTTON}
        onClick={handleSkipNext}
        disabled={!hasCurrentTrack}
        aria-label="Next track"
      >
        <SkipNextIcon size={20} />
      </button>

      <div
        className={cn(
          "size-9 shrink-0 transition-opacity",
          !extraControlsAlwaysVisible &&
            "opacity-0 focus-within:opacity-100 group-hover/playerbar:opacity-100",
        )}
      >
        <button
          type="button"
          className={cn(CONTROL_BUTTON, isOrderActive && "text-primary hover:text-primary")}
          onClick={handlePlaybackOrderCycle}
          aria-label={orderLabel}
          title={orderLabel}
        >
          {state.playbackOrderMode === "repeat-one" ? (
            <RepeatOneActiveIcon size={20} />
          ) : state.playbackOrderMode === "repeat-all" ? (
            <RepeatActiveIcon size={20} />
          ) : (
            <RepeatIcon size={20} />
          )}
        </button>
      </div>
    </div>
  );
}
