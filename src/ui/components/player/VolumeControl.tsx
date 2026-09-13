import { useEffect, useState } from "react";
import { RangeSlider } from "@/components/motion/range-slider";
import { VolumeLoudIcon, VolumeMutedIcon, VolumeSmallIcon } from "@/ui/icons";
import { playerController, shallowEqual, usePlayerSelector } from "../../../player/playerStore";

/** Scroll step over the icon, matching the old inline slider's wheel behaviour. */
const WHEEL_STEP_PERCENT = 5;

/**
 * Volume as a single icon that opens a slider on hover.
 *
 * The bar previously carried a permanently visible 96px slider for a control most people
 * touch rarely. Collapsing it to the icon returns that width to the track title, and the
 * slider is one hover away rather than hidden behind a click.
 *
 * The panel is portalled (see FloatingPanel): the player bar sits inside the window's
 * `overflow-hidden` root, so a panel positioned within the bar would be clipped by it.
 */
export function VolumeControl() {
  /* This component writes volume on every pointer move of the slider, so it is the last one
     that should be subscribed to fields it does not read. */
  const playerState = usePlayerSelector(
    (state) => ({ volume: state.volume, muted: state.muted }),
    shallowEqual,
  );
  const [volume, setVolume] = useState(() => playerController.getVolume());
  const [isMuted, setIsMuted] = useState(() => playerController.isMuted());

  // The engine is the source of truth: the mini player and OS media keys change it too.
  useEffect(() => {
    setVolume(playerState.volume);
    setIsMuted(playerState.muted);
  }, [playerState.muted, playerState.volume]);

  const displayedVolume = isMuted ? 0 : volume;
  const percent = Math.round(displayedVolume * 100);

  const applyVolume = (nextPercent: number) => {
    const next = Math.min(1, Math.max(0, nextPercent / 100));
    setVolume(next);
    // Dragging to a level is itself an unmute; dragging to zero is a mute.
    setIsMuted(next === 0);
    void playerController.setVolume(next);
  };

  const toggleMute = () => {
    setIsMuted((muted) => !muted);
    void playerController.toggleMute();
  };

  const handleWheel = (event: React.WheelEvent) => {
    const delta = event.deltaY || event.deltaX;
    if (delta === 0) return;
    applyVolume(percent + (delta < 0 ? 1 : -1) * WHEEL_STEP_PERCENT);
  };

  const VolumeGlyph = isMuted
    ? VolumeMutedIcon
    : displayedVolume < 0.5
      ? VolumeSmallIcon
      : VolumeLoudIcon;

  return (
    <div
      className="flex items-center gap-1 group/volume"
      onWheel={handleWheel}
    >
      <button
        type="button"
        onClick={toggleMute}
        aria-label={isMuted ? `Unmute (volume ${percent}%)` : `Mute (volume ${percent}%)`}
        title={isMuted ? `Unmute (${percent}%)` : `Mute (${percent}%)`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
      >
        <VolumeGlyph size={18} aria-hidden="true" />
      </button>
      <div className="w-20 sm:w-24 flex items-center">
        <RangeSlider
          value={percent}
          onValueChange={applyVolume}
          min={0}
          max={100}
          step={1}
          showTicks={false}
          aria-label={`Volume (${percent}%)`}
          className="w-full cursor-pointer"
        />
      </div>
    </div>
  );
}
