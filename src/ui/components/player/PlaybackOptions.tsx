import { useEffect, useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { ClockIcon } from "@/ui/icons";
import { playerController } from "../../../player/playerStore";
import { FloatingPanel } from "../FloatingPanel";

/** Sleep durations, plus "end of track" which is handled separately. */
const SLEEP_MINUTES = [15, 30, 45, 60, 90] as const;

// Ceil, not floor: a countdown showing 0:00 while a second is still running reads as stuck.
const formatCountdown = (remainingMs: number) => formatMinutesSeconds(Math.ceil(remainingMs / 1000));

/**
 * Sleep timer options popup in the player bar.
 */
export function PlaybackOptions() {
  const [isOpen, setIsOpen] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(
    () => playerController.getSleepTimerRemainingMs(),
  );

  const isSleeping = remainingMs !== null;

  useEffect(() => {
    if (!isSleeping) return;
    const tick = () => setRemainingMs(playerController.getSleepTimerRemainingMs());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isSleeping]);

  const applySleep = (minutes: number | null) => {
    playerController.setSleepTimer(minutes);
    setRemainingMs(playerController.getSleepTimerRemainingMs());
  };

  return (
    <FloatingPanel
      open={isOpen}
      onOpenChange={setIsOpen}
      side="top"
      triggerClassName="shrink-0"
      className="w-56"
      trigger={
        <Tooltip content={isSleeping ? `Sleep timer: ${formatCountdown(remainingMs)} left` : "Sleep timer"}>
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-label="Sleep timer"
            className={cn(
              "flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-muted-foreground transition-colors",
              "hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSleeping && "text-primary",
            )}
          >
            <ClockIcon size={17} aria-hidden="true" />
            {isSleeping && (
              <span className="text-[11px] tabular-nums font-medium">{formatCountdown(remainingMs)}</span>
            )}
          </button>
        </Tooltip>
      }
    >
      <div className="flex flex-col gap-2.5 p-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">Sleep timer</span>
          {isSleeping && (
            <span className="text-xs tabular-nums text-primary font-medium">
              {formatCountdown(remainingMs)} left
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SLEEP_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => applySleep(minutes)}
              className="rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {minutes} min
            </button>
          ))}
          {isSleeping && (
            <button
              type="button"
              onClick={() => applySleep(null)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel timer
            </button>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          Fades out over the last 20 seconds.
        </span>
      </div>
    </FloatingPanel>
  );
}
