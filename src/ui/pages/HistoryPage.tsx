import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ClockIcon, TrashIcon } from "@/ui/icons";
import type { Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import {
  clearPlayHistory,
  removePlayHistoryEntry,
  usePlayHistory,
  type PlayHistoryEntry,
} from "../../player/playHistory";
import { TrackRow } from "../components/TrackRow";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";
import type { LibraryState } from "../../player/LibraryController";
import { useLibraryState } from "../../player/playerStore";

const DAY_MS = 86_400_000;

/** "Today" / "Yesterday" / a written date, so the list reads as a diary rather than a dump. */
function formatDayLabel(timestamp: number): string {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDay = startOfToday.getTime();

  if (timestamp >= startOfDay) return "Today";
  if (timestamp >= startOfDay - DAY_MS) return "Yesterday";

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === startOfToday.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface HistoryDay {
  label: string;
  entries: PlayHistoryEntry[];
}

/**
 * Everything you have played, newest first, merged into one single chronological list.
 */
export function HistoryPage({
  playerController,
  libraryState: externalLibraryState,
}: {
  playerController: PlayerControllerActions;
  libraryState?: LibraryState;
}) {
  const localLibraryState = useLibraryState();
  const libraryState = externalLibraryState ?? localLibraryState;
  const ytHistoryTracks = libraryState.library?.recentlyPlayed ?? [];
  const entries = usePlayHistory();
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyClearedAt, setHistoryClearedAt] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("amber_history_cleared_at") || 0);
    } catch {
      return 0;
    }
  });

  // Combine device play history and account recently played into a single chronological stream
  const days = useMemo<HistoryDay[]>(() => {
    const validEntries = historyClearedAt > 0
      ? entries.filter((e) => e.playedAt > historyClearedAt)
      : entries;
    const combined: PlayHistoryEntry[] = [...validEntries];
    const seenTrackIds = new Set(validEntries.map((e) => e.track.id));

    // Base timestamp for account tracks that were not recorded on this local device session
    const baseTime = validEntries.length > 0
      ? validEntries[validEntries.length - 1].playedAt - 1000
      : Date.now();

    // Only merge account tracks if not cleared or if tracks were played after clear
    if (historyClearedAt === 0 || validEntries.length > 0) {
      ytHistoryTracks.forEach((track, i) => {
        const estTime = baseTime - (i + 1) * 60_000;
        if (estTime > historyClearedAt && !seenTrackIds.has(track.id)) {
          seenTrackIds.add(track.id);
          combined.push({
            playedAt: estTime,
            track,
          });
        }
      });
    }

    const grouped: HistoryDay[] = [];
    for (const entry of combined) {
      const label = formatDayLabel(entry.playedAt);
      const last = grouped[grouped.length - 1];
      if (last?.label === label) {
        if (!last.entries.some((e) => e.track.id === entry.track.id)) {
          last.entries.push(entry);
        }
      } else {
        grouped.push({ label, entries: [entry] });
      }
    }
    return grouped;
  }, [entries, ytHistoryTracks]);

  const INITIAL_LIMIT = 60;
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_LIMIT);

  const totalEntriesCount = useMemo(() => {
    return days.reduce((sum, d) => sum + d.entries.length, 0);
  }, [days]);

  // Slice days and day.entries up to visibleLimit to avoid freezing the DOM with thousands of items
  const visibleDays = useMemo(() => {
    let remaining = visibleLimit;
    const result: HistoryDay[] = [];
    for (const day of days) {
      if (remaining <= 0) break;
      if (day.entries.length <= remaining) {
        result.push(day);
        remaining -= day.entries.length;
      } else {
        result.push({
          label: day.label,
          entries: day.entries.slice(0, remaining),
        });
        remaining = 0;
      }
    }
    return result;
  }, [days, visibleLimit]);

  const allHistoryTracks = useMemo(() => {
    return days.flatMap((day) => day.entries.map((entry) => entry.track));
  }, [days]);

  const playHistoryTrack = (track: Track) => {
    void playerController.playTrackById(track.id, allHistoryTracks, true);
  };

  const hasAnyHistory = days.length > 0 && allHistoryTracks.length > 0;

  if (!hasAnyHistory) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center py-24">
        <span className="grid size-12 place-items-center rounded-full bg-card text-muted-foreground">
          <ClockIcon size={24} aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-foreground">No listening history yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Songs you play appear here with the time you played them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">History</h1>
          <p className="text-xs text-muted-foreground">
            {allHistoryTracks.length} {allHistoryTracks.length === 1 ? "track" : "tracks"}
          </p>
        </div>

        {allHistoryTracks.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirmClear) {
                const now = Date.now();
                try {
                  localStorage.setItem("amber_history_cleared_at", now.toString());
                } catch {}
                setHistoryClearedAt(now);
                clearPlayHistory();
                setConfirmClear(false);
                return;
              }
              setConfirmClear(true);
            }}
            onBlur={() => setConfirmClear(false)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              confirmClear
                ? "bg-destructive/10 text-destructive"
                : "bg-card text-muted-foreground hover:text-foreground border border-border/40",
            )}
          >
            <TrashIcon size={14} aria-hidden="true" />
            {confirmClear ? "Click again to clear" : "Clear history"}
          </button>
        )}
      </header>

      {/* Unified Chronological History View */}
      <div className="flex flex-col gap-4">
        {visibleDays.map((day) => (
          <section key={day.label} className="flex flex-col gap-2">
            <h2 className="sticky top-0 z-10 -mx-2 bg-background/85 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-md">
              {day.label}
            </h2>

            <div className="flex flex-col gap-0.5">
              {day.entries.map((entry, index) => (
                <TrackRow
                  key={`${entry.playedAt}:${entry.track.id}:${index}`}
                  track={entry.track}
                  index={index}
                  showAlbum
                  isCurrent={currentTrackId === entry.track.id}
                  isPlaying={isPlaying && currentTrackId === entry.track.id}
                  onSelect={() => playHistoryTrack(entry.track)}
                  onContextMenu={(event) => openTrackMenu(event, entry.track)}
                  onQuickAdd={() => openPlaylistPicker(entry.track)}
                  showDownload
                  showRating
                  onQuickAddToQueue={() => playerController.addToQueue(entry.track)}
                  trailing={
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatTime(entry.playedAt)}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove ${entry.track.title} from history`}
                        className="grid size-7 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground group-hover/row:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                        onClick={(event) => {
                          event.stopPropagation();
                          removePlayHistoryEntry(entry.playedAt);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          removePlayHistoryEntry(entry.playedAt);
                        }}
                      >
                        <TrashIcon size={14} aria-hidden="true" />
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
          </section>
        ))}

        {totalEntriesCount > visibleLimit && (
          <div className="flex justify-center pt-2 pb-6">
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + 60)}
              className="rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-6 py-2.5 text-xs font-semibold text-foreground transition-all duration-200 border border-white/10 active:scale-95 cursor-pointer shadow-sm"
            >
              Show more ({totalEntriesCount - visibleLimit} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
