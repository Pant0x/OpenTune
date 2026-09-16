import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DiceIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  PlaylistAddIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  TrashIcon,
  MenuDotsIcon,
  FullScreenIcon,
} from "@/ui/icons";
import { Loader, MusicVisualizer } from "@/components/motion/loader";
import { libraryController, useLibraryState } from "../../../player/playerStore";
import { logInternalError } from "../../../internal/logging";
import type { Lyrics, Track } from "../../../datasource/types";
import {
  playerController,
  shallowEqual,
  usePlayerSelector,
  usePlayerSessionSelector,
} from "../../../player/playerStore";
import type { PlayerSession } from "../../../player/PlayerController";
import {
  toggleQueuePanelCollapsed,
  useQueuePanelCollapsed,
} from "../../settings/queuePanel";
import { ArtistLinks, useAlbumNavigation, useArtistNavigation } from "../ArtistLinks";
import { TrackArtwork } from "../TrackArtwork";
import { useTrackContextMenu } from "../TrackContextMenu";
import { usePlayerUIState, playerUIStore } from "../../stores/playerUIStore";
import { SquareAltArrowLeftIcon } from "@solar-icons/react/linear";

import { usePlayHistory } from "../../../player/playHistory";
import { SidebarAudioVisualizer } from "./SidebarAudioVisualizer";
import { SpotifyCreditsModal } from "./SpotifyCreditsModal";
import { SpotifyScannableModal } from "./SpotifyScannableModal";
import { SpotifyService, type SpotifyArtistOverview, type SpotifyTrackCredits } from "../../../services/SpotifyService";
import { getMediaCounterpart } from "../../../datasource/youtube/videoService";
import { findActiveLineIndex, isSyncedLyrics } from "../../pages/lyricsTiming";

interface QueuePanelProps {
  onClose: () => void;
}

/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_SLOP_PX = 6;
/** Auto-generated tail rows rendered before "Show more" is needed. */
const AUTOMATIC_PAGE_SIZE = 30;

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type QueueSection = "manual" | "automatic";

/** A queue entry paired with the absolute index the controller needs to act on it. */
interface QueueEntry {
  track: Track;
  /** Index into the whole queue — what removeFromQueueAt / moveQueueTrack expect. */
  absoluteIndex: number;
  /** 1-based position among upcoming tracks, for display. */
  position: number;
  section: QueueSection;
  /**
   * React key. Deliberately not `absoluteIndex`: every entry's absolute index shifts by one
   * the moment the current track advances, which used to give every row in the panel a new
   * key on every single track change — React read that as "all of these are different rows"
   * and remounted the entire list each time a song ended, throwing away images already
   * decoded and any hover/focus state. `track.id` is stable across that shift; the counter
   * only kicks in for the same track queued twice, which `track.id` alone can't disambiguate.
   */
  key: string;
}

/** Sums across the sections in place; spreading them into one array copied every upcoming track. */
function formatRemaining(...sections: QueueEntry[][]): string | null {
  let seconds = 0;
  for (const section of sections) {
    for (const { track } of section) {
      // One missing duration makes the total a lie, so don't show one at all.
      if (!track.durationSec) return null;
      seconds += track.durationSec;
    }
  }
  if (seconds === 0) return null;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

/**
 * One row of the queue.
 *
 * Memoised because an auto-queue is routinely 25+ tracks and the panel re-renders on every
 * player emit — including once per track change. Every prop here is a primitive or a stable
 * reference, so the comparison actually holds.
 */
const QueueRow = memo(function QueueRow({
  entry,
  collapsed,
  isDragged,
  isStopAfter,
  isGenerating,
  dropEdge,
  onPlay,
  onRemove,
  onStopAfter,
  onGenerateAfter,
  onPointerDown,
}: {
  entry: QueueEntry;
  collapsed: boolean;
  isDragged: boolean;
  /** Playback stops once this entry finishes. */
  isStopAfter: boolean;
  isGenerating: boolean;
  dropEdge: "before" | "after" | null;
  onPlay: (absoluteIndex: number) => void;
  onRemove: (absoluteIndex: number) => void;
  onStopAfter: (absoluteIndex: number) => void;
  onGenerateAfter: (absoluteIndex: number) => void;
  onPointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
    absoluteIndex: number,
    section: QueueSection,
  ) => void;
}) {
  const { track, absoluteIndex, position, section } = entry;

  const row = (
    <div
      data-queue-index={absoluteIndex}
      data-queue-section={section}
      className={cn(
        "group/queue-item relative flex items-center rounded transition-colors hover:bg-card",
        // The pointer handler writes --drag-translation; this is what renders the lift.
        "[transform:translateY(var(--drag-translation,0px))]",
        collapsed ? "justify-center" : "gap-1",
        isDragged && "opacity-40",
        // The stop marker has to read without hovering, so it draws a rule under the row —
        // the queue visibly ends here.
        isStopAfter && "after:absolute after:inset-x-2 after:-bottom-px after:h-px after:bg-primary/70",
        dropEdge === "before" &&
          "before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
        dropEdge === "after" &&
          "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex min-w-0 items-center rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "p-1.5" : "flex-1 gap-2.5 p-1.5",
        )}
        onPointerDown={(event) => onPointerDown(event, absoluteIndex, section)}
        onClick={() => onPlay(absoluteIndex)}
        aria-label={collapsed ? `Play ${track.title}` : undefined}
      >
        {/* The cover carries the position and the play affordance so the row needs no
            separate number column — that is what buys back the width when collapsed. */}
        <span className="relative shrink-0">
          <TrackArtwork
            className={cn("rounded", collapsed ? "size-11" : "size-10")}
            size={collapsed ? 44 : 40}
            artworkUrl={track.artworkUrl}
            iconSize={collapsed ? 20 : 18}
          />
          <span
            className={cn(
              "absolute inset-0 grid place-items-center rounded-lg bg-background/70 text-[11px] font-semibold tabular-nums text-foreground",
              /*
               * The blur is applied on hover, not hidden by the opacity. `backdrop-filter` is
               * what forces an element onto its own compositor layer, and this badge is
               * mounted on every row in the queue — at `opacity-0` it showed nothing while
               * still asking for a layer per row.
               */
              "opacity-0 transition-opacity group-hover/queue-item:opacity-100 group-hover/queue-item:backdrop-blur-[2px]",
            )}
            aria-hidden="true"
          >
            {position}
          </span>
        </span>

        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-foreground">{track.title}</span>
            <ArtistLinks
              className="truncate text-xs text-muted-foreground"
              artists={track.artists}
              fallback={track.artist}
              trackTitle={track.title}
            />
          </span>
        )}
      </button>

      {!collapsed && (
        <span
          className={cn(
            "mr-1 flex shrink-0 items-center transition-opacity",
            // The stop marker stays visible unhovered — it is state, not an affordance.
            isStopAfter
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover/queue-item:opacity-100",
          )}
        >
          <Tooltip content={isStopAfter ? "Don't end queue here" : "End queue after this"}>
            <button
              type="button"
              className={cn(ICON_BUTTON, isStopAfter && "text-primary")}
              onClick={() => onStopAfter(absoluteIndex)}
              aria-pressed={isStopAfter}
            >
              <PauseIcon size={15} aria-hidden="true" />
              <span className="sr-only">
                {isStopAfter ? "Don't end queue here" : "End queue after this"}
              </span>
            </button>
          </Tooltip>
          <Tooltip content="Generate a new queue from here">
            <button
              type="button"
              className={cn(ICON_BUTTON, isGenerating && "text-primary")}
              disabled={isGenerating}
              onClick={() => onGenerateAfter(absoluteIndex)}
            >
              <DiceIcon
                size={15}
                aria-hidden="true"
                className={isGenerating ? "motion-safe:animate-spin" : undefined}
              />
              <span className="sr-only">Generate a new queue from here</span>
            </button>
          </Tooltip>
          <Tooltip content="Remove from queue">
            <button
              type="button"
              className={cn(ICON_BUTTON, "hover:text-primary")}
              onClick={() => onRemove(absoluteIndex)}
            >
              <TrashIcon size={15} aria-hidden="true" />
              <span className="sr-only">{`Remove ${track.title} from queue`}</span>
            </button>
          </Tooltip>
        </span>
      )}
    </div>
  );

  // Collapsed hides the title, so the tooltip is the only way to read the row. Expanded
  // already shows everything, and a tooltip on every row would be noise.
  if (!collapsed) return row;
  return (
    <Tooltip
      side="left"
      content={
        <span className="flex flex-col">
          <span className="font-medium">{track.title}</span>
          <span className="text-muted-foreground">{track.artist}</span>
        </span>
      }
    >
      {row}
    </Tooltip>
  );
});

const EMPTY_QUEUE: Track[] = [];

/*
 * `exportSession()` rebuilds the queue window with `.slice()` on every player emit — including
 * ones that never touch the queue, like a volume drag firing dozens of times a gesture — so a
 * plain read of `session.queue` gets a new array identity far more often than the queue itself
 * changes. Comparing by track identity (not the wrapping array) is what lets
 * `usePlayerSessionSelector` hand back the previous, still-equal snapshot on those emits.
 */
function selectQueueSlice(session: PlayerSession | null) {
  return {
    queue: session?.queue ?? EMPTY_QUEUE,
    queueIndex: session?.queueIndex ?? -1,
    manualQueueLength: session?.manualQueueLength ?? 0,
    stopAfterQueueIndex: session?.stopAfterQueueIndex ?? null,
    queueWindowStart: session?.queueWindowStart ?? 0,
  };
}

function queueSliceEqual(
  a: ReturnType<typeof selectQueueSlice>,
  b: ReturnType<typeof selectQueueSlice>,
) {
  return a.queueIndex === b.queueIndex
    && a.manualQueueLength === b.manualQueueLength
    && a.stopAfterQueueIndex === b.stopAfterQueueIndex
    && a.queueWindowStart === b.queueWindowStart
    && a.queue.length === b.queue.length
    && a.queue.every((track, index) => track === b.queue[index]);
}

/**
 * Reveals more of the auto-generated tail, a page at a time.
 *
 * Collapsed has no room for "Show 30 more", so it shrinks to a plain "+N" chip — the count
 * still reads on its own, and the full sentence is one tooltip away.
 */
function ShowMoreQueueButton({
  collapsed,
  remaining,
  onClick,
}: {
  collapsed: boolean;
  remaining: number;
  onClick: () => void;
}) {
  const label = `Show ${Math.min(AUTOMATIC_PAGE_SIZE, remaining)} more`;
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed
          ? "mx-auto flex size-7 items-center justify-center text-sm"
          : "mt-0.5 px-3 py-1.5 text-left text-xs font-medium",
      )}
    >
      {collapsed ? "+" : label}
    </button>
  );
  return collapsed ? (
    <Tooltip side="left" content={label}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function QueuePanel({ onClose }: QueuePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const draggedElementRef = useRef<HTMLElement | null>(null);
  const captureElementRef = useRef<HTMLElement | null>(null);
  const pointerDragRef = useRef<{
    pointerId: number;
    sourceIndex: number;
    section: QueueSection;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    insertAfter: boolean;
  } | null>(null);
  /*
   * The drop target is read inside a window listener that must not be torn down and rebuilt
   * on every pointermove — that is what the previous version did, since dropTarget was in the
   * effect's dependency list. The ref carries the value; the state only drives the paint.
   */
  const dropTargetRef = useRef(dropTarget);
  dropTargetRef.current = dropTarget;

  const collapsed = useQueuePanelCollapsed();
  const uiState = usePlayerUIState();
  const activeTab = uiState.rightPanelTab ?? "nowplaying";
  const libraryState = useLibraryState();
  const navigateArtist = useArtistNavigation();
  const navigateAlbum = useAlbumNavigation();
  const { toggleTrackLike, openTrackMenu } = useTrackContextMenu();
  const playHistory = usePlayHistory();
  const recentlyPlayed = useMemo(
    () => playHistory.map((item) => item.track),
    [playHistory],
  );

  const { queue, queueIndex, manualQueueLength, stopAfterQueueIndex, queueWindowStart } =
    usePlayerSessionSelector(selectQueueSlice, queueSliceEqual);
  // `stopAfterQueueIndex` comes off the session window-relative, like `queueIndex`; rebased once
  // here so every comparison against `entry.absoluteIndex` (already absolute) lines up.
  const stopAfterAbsoluteIndex = stopAfterQueueIndex === null
    ? null
    : stopAfterQueueIndex + queueWindowStart;
  const playerState = usePlayerSelector(
    (player) => ({ currentTrack: player.currentTrack, status: player.status }),
    shallowEqual,
  );
  const currentTrack = playerState.currentTrack;
  const isPlaying = playerState.status === "playing";
  const isLiked = Boolean(
    currentTrack && libraryState.library?.likedSongs?.some((t) => t.id === currentTrack.id),
  );

  // Generating hits the network, so the row it was started from shows it is working.
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  /* null = idle, string = the draft name being edited. */
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [visibleAutomaticCount, setVisibleAutomaticCount] = useState(AUTOMATIC_PAGE_SIZE);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [showScannableModal, setShowScannableModal] = useState(false);

  // Spotify Now Playing sidebar states
  const [isVisualExpanded, setIsVisualExpanded] = useState(false);
  const [artistOverview, setArtistOverview] = useState<SpotifyArtistOverview | null>(null);
  const [credits, setCredits] = useState<SpotifyTrackCredits | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoCounterpart, setVideoCounterpart] = useState<Track | null>(null);

  useEffect(() => {
    if (!currentTrack?.artist) {
      setArtistOverview(null);
      return;
    }
    let active = true;
    void SpotifyService.getArtistOverview(currentTrack.artist).then((data) => {
      if (active) setArtistOverview(data);
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.artist]);

  useEffect(() => {
    if (!currentTrack) {
      setCredits(null);
      return;
    }
    let active = true;
    void SpotifyService.getTrackCredits(currentTrack.title, currentTrack.artist).then((data) => {
      if (!active) return;
      if (data) {
        setCredits(data);
      } else {
        setCredits({
          trackTitle: currentTrack.title,
          artists: [{ name: currentTrack.artist, role: "Main Artist", avatarUrl: currentTrack.artworkUrl }],
          writers: [{ name: currentTrack.artist, role: "Composer, Lyricist" }],
          producers: [{ name: "Production Team", role: "Producer, Engineer" }],
          label: currentTrack.album ? `Released by ${currentTrack.album}` : undefined,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.title, currentTrack?.artist]);

  useEffect(() => {
    if (!currentTrack) {
      setLyrics(null);
      return;
    }
    let active = true;
    void playerController.getLyrics(currentTrack).then((res) => {
      if (active) setLyrics(res);
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    const updateTime = () => setCurrentTime(playerController.getCurrentTime());
    updateTime();
    const interval = window.setInterval(updateTime, 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!currentTrack) {
      setVideoCounterpart(null);
      return;
    }
    let active = true;
    void getMediaCounterpart(currentTrack, "video").then((res) => {
      if (active) setVideoCounterpart(res);
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.id]);

  const synced = isSyncedLyrics(lyrics);
  const activeLyricIndex = synced && lyrics?.lines ? findActiveLineIndex(lyrics.lines, currentTime) : -1;
  const previewLyricsLines = useMemo(() => {
    if (!lyrics?.lines?.length) return [];
    if (!synced) return lyrics.lines.slice(0, 4);
    const start = Math.max(0, activeLyricIndex >= 0 ? activeLyricIndex : 0);
    return lyrics.lines.slice(start, start + 4);
  }, [lyrics, synced, activeLyricIndex]);

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack) return;
    setShowScannableModal(true);
  };

  /*
   * One flat pass over the upcoming tracks, tagged with everything a row needs. The old panel
   * sliced the queue three times and then recomputed the same absolute index inline at four
   * different call sites, each with its own `upcomingStartIndex + manualQueueLength + index`
   * arithmetic — which is exactly the sort of thing that drifts out of sync.
   */
  const { manual, automatic } = useMemo(() => {
    const start = Math.max(queueIndex + 1, 0);
    const manualEntries: QueueEntry[] = [];
    const automaticEntries: QueueEntry[] = [];
    // How many times each track id has been seen so far, so the same song queued twice still
    // gets two distinct keys.
    const seen = new Map<string, number>();

    for (let offset = 0; start + offset < queue.length; offset += 1) {
      const track = queue[start + offset];
      const occurrence = seen.get(track.id) ?? 0;
      seen.set(track.id, occurrence + 1);

      const entry: QueueEntry = {
        track,
        absoluteIndex: queueWindowStart + start + offset,
        position: offset + 1,
        section: offset < manualQueueLength ? "manual" : "automatic",
        key: occurrence === 0 ? track.id : `${track.id}:${occurrence}`,
      };
      (entry.section === "manual" ? manualEntries : automaticEntries).push(entry);
    }

    return { manual: manualEntries, automatic: automaticEntries };
  }, [manualQueueLength, queue, queueIndex, queueWindowStart]);

  const upcomingCount = manual.length + automatic.length;
  /*
   * Summed over the two lists in place rather than by spreading them into a third.
   *
   * `manual` and `automatic` are rebuilt whenever the queue array identity changes — which is
   * on every session export, not only when the queue actually changes — so this ran a full
   * copy plus a pass over every upcoming track far more often than the contents moved.
   */
  const remaining = useMemo(
    () => formatRemaining(manual, automatic),
    [automatic, manual],
  );

  const handleRemove = (absoluteIndex: number) => {
    playerController.removeFromQueueAt(absoluteIndex);
  };

  /*
   * Saves what is *upcoming* plus the track playing now — the queue as you see it. Tracks
   * already behind the playhead are history, and silently including them would produce a
   * playlist that does not match the panel it was made from.
   */
  const handleSaveQueue = async () => {
    if (saveDraft === null || saveState === "saving") return;
    const title = saveDraft.trim();
    if (!title) return;

    const trackIds = [
      ...(currentTrack ? [currentTrack.id] : []),
      ...manual.map((entry) => entry.track.id),
      ...automatic.map((entry) => entry.track.id),
    ].filter((id) => !id.startsWith("local:"));

    setSaveState("saving");
    try {
      await libraryController.createPlaylist(title, { trackIds });
      setSaveDraft(null);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2000);
    } catch (error) {
      logInternalError("QueuePanel.saveQueueAsPlaylist failed", error);
      setSaveState("idle");
    }
  };

  const handleStopAfter = (absoluteIndex: number) => {
    playerController.setStopAfterQueueIndex(absoluteIndex);
  };

  const handleGenerateAfter = async (absoluteIndex: number) => {
    setGeneratingIndex(absoluteIndex);
    try {
      await playerController.generateQueueAfter(absoluteIndex);
    } finally {
      setGeneratingIndex(null);
    }
  };

  const handlePlay = (absoluteIndex: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    void playerController.playQueueTrackAt(absoluteIndex);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      if (!drag.isDragging) {
        const distance = Math.hypot(
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        );
        if (distance < DRAG_SLOP_PX) return;
        drag.isDragging = true;
        setDraggedIndex(drag.sourceIndex);
      }

      event.preventDefault();
      const translationY = event.clientY - drag.startY;
      draggedElementRef.current?.style.setProperty(
        "--drag-translation",
        `${translationY}px`,
      );

      // Reordering across the manual/automatic boundary is rejected by Queue.move, so the
      // drop indicator must never suggest it is possible.
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>("[data-queue-index]") ?? [],
      ).filter((item) =>
        Number(item.dataset.queueIndex) !== drag.sourceIndex
        && item.dataset.queueSection === drag.section,
      );

      if (items.length === 0) {
        setDropTarget(null);
        return;
      }

      let targetElement = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>("[data-queue-index]"))
        .find((item) =>
          Boolean(item)
          && Number(item?.dataset.queueIndex) !== drag.sourceIndex
          && item?.dataset.queueSection === drag.section,
        ) ?? null;

      const panelBounds = panelRef.current?.getBoundingClientRect();
      if (panelBounds && event.clientY < panelBounds.top) {
        targetElement = items[0];
      } else if (panelBounds && event.clientY > panelBounds.bottom) {
        targetElement = items[items.length - 1];
      } else if (!targetElement) {
        targetElement = items.reduce<HTMLElement | null>((closest, item) => {
          if (!closest) return item;
          const itemBounds = item.getBoundingClientRect();
          const closestBounds = closest.getBoundingClientRect();
          const itemCenter = itemBounds.top + itemBounds.height / 2;
          const closestCenter = closestBounds.top + closestBounds.height / 2;
          return Math.abs(itemCenter - event.clientY)
            < Math.abs(closestCenter - event.clientY)
            ? item
            : closest;
        }, null);
      }

      if (!targetElement) {
        setDropTarget(null);
        return;
      }

      const targetIndex = Number(targetElement.dataset.queueIndex);
      const bounds = targetElement.getBoundingClientRect();
      const insertAfter = event.clientY >= bounds.top + bounds.height / 2;
      const current = dropTargetRef.current;
      if (current?.index === targetIndex && current.insertAfter === insertAfter) return;
      setDropTarget({ index: targetIndex, insertAfter });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      const drop = dropTargetRef.current;
      if (drag.isDragging && drop && drop.index !== drag.sourceIndex) {
        playerController.moveQueueTrack(drag.sourceIndex, drop.index, drop.insertAfter);
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }

      pointerDragRef.current = null;
      draggedElementRef.current?.style.removeProperty("--drag-translation");
      draggedElementRef.current?.style.removeProperty("will-change");
      captureElementRef.current?.releasePointerCapture?.(event.pointerId);
      draggedElementRef.current = null;
      captureElementRef.current = null;
      setDraggedIndex(null);
      setDropTarget(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const handleTrackPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    absoluteIndex: number,
    section: QueueSection,
  ) => {
    if (event.button !== 0) return;
    const trackItem = event.currentTarget.closest<HTMLElement>("[data-queue-index]");
    if (!trackItem) return;

    pointerDragRef.current = {
      pointerId: event.pointerId,
      sourceIndex: absoluteIndex,
      section,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
    draggedElementRef.current = trackItem;
    captureElementRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
    trackItem.style.willChange = "transform";
  };

  const renderRows = (entries: QueueEntry[]) =>
    entries.map((entry) => (
      <QueueRow
        key={entry.key}
        entry={entry}
        collapsed={collapsed}
        isDragged={draggedIndex === entry.absoluteIndex}
        isStopAfter={stopAfterAbsoluteIndex === entry.absoluteIndex}
        isGenerating={generatingIndex === entry.absoluteIndex}
        dropEdge={
          dropTarget?.index === entry.absoluteIndex
            ? (dropTarget.insertAfter ? "after" : "before")
            : null
        }
        onPlay={handlePlay}
        onRemove={handleRemove}
        onStopAfter={handleStopAfter}
        onGenerateAfter={(index) => void handleGenerateAfter(index)}
        onPointerDown={handleTrackPointerDown}
      />
    ));

  const sectionLabel = (label: string, count: number) =>
    collapsed ? (
      // A hairline instead of a heading: at 76px a word would either truncate or wrap.
      <span
        className="mx-auto my-1.5 h-px w-6 rounded-full bg-border"
        role="separator"
        aria-label={label}
      />
    ) : (
      <div className="flex items-baseline justify-between gap-2 px-2 pb-1.5 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      </div>
    );

  if (collapsed) {
    return (
      <aside
        ref={panelRef}
        className="flex h-full flex-col items-center overflow-y-auto overscroll-contain bg-card py-2 select-none"
        aria-label="Queue"
      >
        <Tooltip side="left" content="Expand panel">
          <button type="button" className={ICON_BUTTON} onClick={toggleQueuePanelCollapsed}>
            <SquareAltArrowLeftIcon size={22} aria-hidden="true" />
            <span className="sr-only">Expand panel</span>
          </button>
        </Tooltip>

        {currentTrack && (
          <div className="my-3 flex flex-col items-center">
            <span className="relative">
              <TrackArtwork
                className="size-11 rounded-lg ring-1 ring-primary/60 object-cover"
                size={44}
                artworkUrl={currentTrack.artworkUrl}
                iconSize={20}
              />
              {isPlaying && (
                <span
                  className="absolute inset-0 grid place-items-center rounded-lg bg-background/60 backdrop-blur-[2px]"
                  aria-hidden="true"
                >
                  <MusicVisualizer
                    bars={4}
                    className="[--music-gap:2px] [--music-height:16px] [--music-width:20px]"
                  />
                </span>
              )}
            </span>
          </div>
        )}

        <span className="my-auto h-px w-6 rounded-full bg-border/40" />

        <div className="mt-auto flex flex-col items-center gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
            {upcomingCount}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={cn(
        "flex h-full flex-col overflow-y-auto overscroll-contain bg-card border-l border-border/40",
        draggedIndex !== null && "select-none",
      )}
      aria-label="Now Playing and Queue"
    >
      {/* Top Header */}
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-border/40 bg-card/95 backdrop-blur-md px-3 py-2">
        {activeTab === "nowplaying" && currentTrack?.album ? (
          <button
            type="button"
            onClick={() => {
              if (navigateAlbum) {
                navigateAlbum({
                  id: currentTrack.albumId || currentTrack.album!,
                  title: currentTrack.album!,
                  artist: currentTrack.artist,
                });
              }
            }}
            className="flex items-center gap-2 min-w-0 text-left hover:opacity-85 transition-opacity cursor-pointer group"
            title={currentTrack.album}
          >
            <span className="font-bold text-sm text-foreground truncate group-hover:underline">
              {currentTrack.album}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => playerUIStore.setRightPanelTab("nowplaying")}
              className={cn(
                "relative px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none",
                activeTab === "nowplaying"
                  ? "text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Now Playing
            </button>
            <button
              type="button"
              onClick={() => playerUIStore.setRightPanelTab("queue")}
              className={cn(
                "relative px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none",
                activeTab === "queue"
                  ? "text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Queue
            </button>
            <button
              type="button"
              onClick={() => playerUIStore.setRightPanelTab("recent")}
              className={cn(
                "relative px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none",
                activeTab === "recent"
                  ? "text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Recently played
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          {activeTab === "nowplaying" && (
            <button
              type="button"
              onClick={() => playerUIStore.setRightPanelTab("queue")}
              className="px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary/40"
              title="Switch to Queue"
            >
              Queue
            </button>
          )}

          {currentTrack && activeTab === "nowplaying" && (
            <Tooltip side="bottom" content="More options">
              <button
                type="button"
                className={ICON_BUTTON}
                onClick={(e) => openTrackMenu(e, currentTrack)}
                aria-label="Track options"
              >
                <MenuDotsIcon size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          )}

          <Tooltip side="bottom" content="Close">
            <button
              type="button"
              className={ICON_BUTTON}
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <CloseIcon size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>

      {/* ── Tab 1: Now Playing / Song View (Spotify style 1:1) ── */}
      {activeTab === "nowplaying" && (
        <div className="flex flex-1 flex-col overflow-y-auto p-4 gap-4">
          {currentTrack ? (
            <>
              {/* Tall Vertical Visual Card (Spotify Canvas / Video Loop / Release More View) */}
              <div
                className={cn(
                  "relative w-full overflow-hidden rounded-2xl bg-muted/20 shadow-2xl ring-1 ring-border/20 transition-all duration-300 cursor-pointer group select-none",
                  isVisualExpanded ? "aspect-[9/16] max-h-[68vh]" : "aspect-[9/13]",
                )}
                onClick={() => setIsVisualExpanded((prev) => !prev)}
                title={isVisualExpanded ? "Click to collapse visual" : "Click to expand visual (Release more view)"}
              >
                <div className="relative size-full overflow-hidden">
                  <TrackArtwork
                    className="size-full object-cover rounded-2xl transition-transform duration-500 group-hover:scale-105"
                    size={600}
                    artworkUrl={videoCounterpart?.artworkUrl || currentTrack.artworkUrl}
                    iconSize={56}
                  />
                  {isPlaying && (
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end">
                      <SidebarAudioVisualizer isPlaying={isPlaying} color="#1ed760" className="w-full h-10" />
                    </div>
                  )}
                </div>

                {/* Expand Indicator Badge on Hover */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-md rounded-full p-1.5 text-white/90 border border-white/10 shadow-lg">
                  <FullScreenIcon size={14} />
                </div>
              </div>

              {/* Title & Artist & Share & Like */}
              <div className="flex items-start justify-between gap-3 pt-1">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="text-xl sm:text-2xl font-black text-foreground leading-tight tracking-tight line-clamp-2">
                    {currentTrack.title}
                  </h2>
                  <div className="text-sm font-medium text-muted-foreground">
                    <ArtistLinks
                      artists={currentTrack.artists}
                      fallback={currentTrack.artist}
                      trackTitle={currentTrack.title}
                      className="hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {/* Share button */}
                  <Tooltip content="Share / Spotify Code">
                    <button
                      type="button"
                      onClick={handleShare}
                      className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors cursor-pointer"
                      aria-label="Share track"
                    >
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    </button>
                  </Tooltip>

                  {/* Liked button (Spotify signature green circle checkmark) */}
                  <button
                    type="button"
                    className="p-2 rounded-full transition-transform active:scale-95 cursor-pointer"
                    onClick={() => toggleTrackLike(currentTrack)}
                    title={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                    aria-label={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                  >
                    {isLiked ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-[#1ed760] text-black shadow-xs">
                        <CheckIcon size={12} className="stroke-[3]" />
                      </span>
                    ) : (
                      <HeartIcon size={20} className="text-muted-foreground hover:text-foreground" />
                    )}
                  </button>
                </div>
              </div>

              {/* Lyrics Preview Card (Spotify Style) */}
              <div
                className="relative overflow-hidden rounded-2xl bg-secondary/35 border border-border/40 p-4 transition-all hover:bg-secondary/45 cursor-pointer group flex flex-col gap-3.5 shadow-sm"
                onClick={() => playerUIStore.setLyricsOpen(true)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Lyrics
                  </span>
                  <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                    <Tooltip content="Open full lyrics">
                      <span className="flex size-6 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
                        <FullScreenIcon size={12} />
                      </span>
                    </Tooltip>
                  </div>
                </div>

                {previewLyricsLines.length > 0 ? (
                  <div className="flex flex-col gap-2 min-h-[90px] justify-center">
                    {previewLyricsLines.map((line, idx) => {
                      const isCurrent = idx === 0 && activeLyricIndex >= 0;
                      return (
                        <p
                          key={idx}
                          className={cn(
                            "text-sm font-bold leading-snug transition-all duration-200 line-clamp-2",
                            isCurrent
                              ? "text-white text-base drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"
                              : "text-muted-foreground/60 font-medium",
                          )}
                        >
                          {line.text}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                    <span>Lyrics available in full screen. Click to open.</span>
                  </div>
                )}
              </div>

              {/* About the artist Card (Spotify-style) */}
              <div
                className="relative overflow-hidden rounded-2xl bg-secondary/35 border border-border/40 transition-all hover:bg-secondary/45 cursor-pointer group flex flex-col shadow-sm"
                onClick={() => {
                  if (navigateArtist && currentTrack.artist) {
                    navigateArtist(
                      {
                        id: currentTrack.artists?.[0]?.id || "",
                        name: currentTrack.artist,
                      },
                      false,
                    );
                  }
                }}
              >
                {/* Artist Header Photo / Banner */}
                <div className="relative h-44 w-full overflow-hidden bg-muted/40">
                  <img
                    src={artistOverview?.headerUrl || artistOverview?.avatarUrl || currentTrack.artworkUrl}
                    alt={currentTrack.artist}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <span className="absolute top-3 left-3 text-xs font-bold uppercase tracking-wider text-white drop-shadow-md">
                    About the artist
                  </span>
                  <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-0.5 text-white">
                    <span className="font-extrabold text-base leading-tight truncate group-hover:underline">
                      {currentTrack.artist}
                    </span>
                    {artistOverview?.monthlyListeners ? (
                      <span className="text-xs text-white/80 font-medium">
                        {Number(artistOverview.monthlyListeners).toLocaleString()} monthly listeners
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="p-4 flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                    {artistOverview?.bio
                      ? artistOverview.bio.replace(/<[^>]*>?/gm, "")
                      : `Click to explore top tracks, discography, and albums from ${currentTrack.artist}.`}
                  </p>
                </div>
              </div>

              {/* Credits Card (Spotify style, placed UNDER About the artist) */}
              <div className="rounded-2xl bg-secondary/35 border border-border/40 p-4 flex flex-col gap-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Credits
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCreditsModal(true)}
                    className="text-xs font-bold text-foreground/80 hover:text-white underline cursor-pointer"
                  >
                    Show all
                  </button>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                  {/* Performed by */}
                  <div className="flex flex-col gap-1">
                    <span className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground/80">
                      Performed by
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {credits?.artists?.length ? (
                        credits.artists.slice(0, 3).map((a, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground truncate">{a.name}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">{a.role || (i === 0 ? "Main Artist" : "Featured Artist")}</span>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground truncate">{currentTrack.artist}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">Main Artist</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Written by */}
                  {credits?.writers?.length ? (
                    <div className="flex flex-col gap-1 pt-1 border-t border-border/20">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground/80">
                        Written by
                      </span>
                      <div className="flex flex-col gap-0.5">
                        {credits.writers.slice(0, 2).map((w, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate">{w.name}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">{w.role || "Composer, Lyricist"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Produced by */}
                  {credits?.producers?.length ? (
                    <div className="flex flex-col gap-1 pt-1 border-t border-border/20">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground/80">
                        Produced by
                      </span>
                      <div className="flex flex-col gap-0.5">
                        {credits.producers.slice(0, 2).map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate">{p.name}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">{p.role || "Producer"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Source / Label */}
                  {(credits?.label || currentTrack.album) && (
                    <div className="pt-1 border-t border-border/20 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                      <span className="font-bold uppercase tracking-wider text-muted-foreground/80">
                        Source
                      </span>
                      <span className="truncate">{credits?.label || `Released by ${currentTrack.album}`}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* From the album Card (Spotify-style) */}
              {currentTrack.album && (
                <div
                  className="rounded-2xl bg-secondary/35 border border-border/40 p-3.5 flex items-center gap-3 cursor-pointer hover:bg-secondary/45 transition-colors group shadow-sm"
                  onClick={() => {
                    if (navigateAlbum) {
                      navigateAlbum({
                        id: currentTrack.albumId || currentTrack.album!,
                        title: currentTrack.album!,
                        artist: currentTrack.artist,
                      });
                    }
                  }}
                >
                  <div className="size-12 rounded-lg overflow-hidden bg-muted/40 shrink-0">
                    <TrackArtwork
                      className="size-full object-cover"
                      size={48}
                      artworkUrl={currentTrack.artworkUrl}
                      iconSize={20}
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      From the album
                    </span>
                    <span className="font-semibold text-sm text-foreground truncate group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all">
                      {currentTrack.album}
                    </span>
                  </div>
                </div>
              )}

              {/* Next in Queue Preview Card */}
              {(manual.length > 0 || automatic.length > 0) && (
                <div className="rounded-2xl bg-secondary/35 border border-border/40 p-3.5 flex items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-11 rounded-lg overflow-hidden bg-muted/40 shrink-0">
                      <TrackArtwork
                        className="size-full object-cover"
                        size={44}
                        artworkUrl={(manual[0]?.track || automatic[0]?.track)?.artworkUrl}
                        iconSize={18}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Next in queue
                      </span>
                      <span className="font-semibold text-sm text-foreground truncate">
                        {(manual[0]?.track || automatic[0]?.track)?.title}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {(manual[0]?.track || automatic[0]?.track)?.artist}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void playerController.skipToNext()}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                    title="Play next track"
                    aria-label="Play next track"
                  >
                    <PlayIcon size={14} fill="currentColor" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground p-8">
              Play a song to view details, lyrics, and artist info.
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Queue View (Spotify style) ── */}
      {activeTab === "queue" && (
        <div className="flex flex-1 flex-col overflow-y-auto">
          {/* Action Toolbar for Queue */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{upcomingCount === 0 ? "Nothing queued" : `${upcomingCount} songs`}</span>
              {remaining && (
                <>
                  <ClockIcon size={11} aria-hidden="true" />
                  <span>{remaining}</span>
                </>
              )}
            </div>

            {upcomingCount > 0 && (
              <div className="flex items-center gap-1">
                <Tooltip content="Shuffle what's next">
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    onClick={() => playerController.shuffleUpcomingQueue()}
                  >
                    <ShuffleIcon size={15} aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Shuffle all">
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    onClick={() => playerController.shuffleEntirePlaylist()}
                  >
                    <ShuffleActiveIcon size={15} aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Save as playlist">
                  <button
                    type="button"
                    className={cn(ICON_BUTTON, saveState === "saved" && "text-primary")}
                    onClick={() => setSaveDraft((draft) => (draft === null ? "My queue" : null))}
                  >
                    {saveState === "saving" ? (
                      <Loader variant="spinner" size={14} />
                    ) : saveState === "saved" ? (
                      <CheckIcon size={15} aria-hidden="true" />
                    ) : (
                      <PlaylistAddIcon size={15} aria-hidden="true" />
                    )}
                  </button>
                </Tooltip>
                <Tooltip content="Clear queue">
                  <button
                    type="button"
                    className={cn(ICON_BUTTON, "hover:text-primary")}
                    onClick={() => playerController.clearUpcomingQueue()}
                  >
                    <TrashIcon size={15} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          {/* Save queue draft modal */}
          {saveDraft !== null && (
            <div className="mx-2 my-2 flex shrink-0 flex-col gap-2 rounded-xl bg-card border border-border/40 p-2.5">
              <input
                autoFocus
                value={saveDraft}
                onChange={(event) => setSaveDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSaveQueue();
                  if (event.key === "Escape") setSaveDraft(null);
                }}
                aria-label="New playlist name"
                className="w-full rounded-lg bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {upcomingCount + (currentTrack ? 1 : 0)} songs
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSaveDraft(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saveState === "saving" || !saveDraft.trim()}
                    className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    onClick={() => void handleSaveQueue()}
                  >
                    {saveState === "saving" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pinned Current Track */}
          {currentTrack && (
            <div className="mx-3 my-2 flex shrink-0 items-center gap-3 rounded-xl bg-primary/10 p-2.5 border border-primary/20">
              <span className="relative shrink-0">
                <TrackArtwork
                  className="size-10 rounded-lg ring-1 ring-primary/40 object-cover"
                  size={40}
                  artworkUrl={currentTrack.artworkUrl}
                  iconSize={18}
                />
                {isPlaying && (
                  <span
                    className="absolute inset-0 grid place-items-center rounded-lg bg-background/60 backdrop-blur-[2px]"
                    aria-hidden="true"
                  >
                    <MusicVisualizer
                      bars={4}
                      className="[--music-gap:2px] [--music-height:16px] [--music-width:20px]"
                    />
                  </span>
                )}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {isPlaying ? "Now playing" : "Paused"}
                </span>
                <span className="truncate text-sm font-semibold text-foreground">
                  {currentTrack.title}
                </span>
                <ArtistLinks
                  className="truncate text-xs text-muted-foreground"
                  artists={currentTrack.artists}
                  fallback={currentTrack.artist}
                  trackTitle={currentTrack.title}
                />
              </div>
            </div>
          )}

          {/* Queue Rows */}
          {upcomingCount === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing queued. Songs you add with "Play next" land here.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 px-2 pb-4">
              {manual.length > 0 && (
                <>
                  {sectionLabel("Added by you", manual.length)}
                  {renderRows(manual)}
                </>
              )}
              {automatic.length > 0 && (
                <>
                  {manual.length > 0 && sectionLabel("Up next", automatic.length)}
                  {renderRows(automatic.slice(0, visibleAutomaticCount))}
                  {automatic.length > visibleAutomaticCount && (
                    <ShowMoreQueueButton
                      collapsed={collapsed}
                      remaining={automatic.length - visibleAutomaticCount}
                      onClick={() =>
                        setVisibleAutomaticCount((count) => count + AUTOMATIC_PAGE_SIZE)}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: Recently Played View (Spotify style) ── */}
      {activeTab === "recent" && (
        <div className="flex flex-1 flex-col overflow-y-auto px-2 py-2">
          {recentlyPlayed.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No recently played songs recorded yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {recentlyPlayed.map((track, idx) => (
                <button
                  key={`${track.id}-${idx}`}
                  type="button"
                  onClick={() => void playerController.loadTrack(track)}
                  className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-card ring-1 ring-border/20">
                    <TrackArtwork
                      className="size-full object-cover"
                      size={40}
                      artworkUrl={track.artworkUrl}
                      iconSize={18}
                    />
                    <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <PlayIcon size={18} className="text-white fill-white" />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {track.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {track.artist}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {showCreditsModal && currentTrack && (
        <SpotifyCreditsModal
          isOpen={showCreditsModal}
          track={currentTrack}
          isFollowingArtist={false}
          onToggleFollowArtist={() => {}}
          onClose={() => setShowCreditsModal(false)}
        />
      )}
      {showScannableModal && currentTrack && (
        <SpotifyScannableModal
          isOpen={showScannableModal}
          track={currentTrack}
          onClose={() => setShowScannableModal(false)}
        />
      )}
    </aside>
  );
}
