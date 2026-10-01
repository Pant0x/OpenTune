import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DiceIcon,
  PauseIcon,
  PlayIcon,
  PlaylistAddIcon,
  PlusIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  TrashIcon,
  MenuDotsIcon,
} from "@/ui/icons";
import { Loader, MusicVisualizer } from "@/components/motion/loader";
import { useLibraryState } from "../../../player/playerStore";
import { logInternalError } from "../../../internal/logging";
import {
  isArtistFollowedLocally,
  setArtistFollowedLocally,
  useFollowedArtistLocally,
} from "../../../player/followedArtists";
import type { Artist, BrowseShelf, Track } from "../../../datasource/types";
import {
  libraryController,
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
import {
  ArtistLinks,
  parseTrackArtistsWithFeatures,
  useAlbumNavigation,
  useArtistNavigation,
} from "../ArtistLinks";
import type { ArtistReference } from "../../../datasource/types";
import { TrackArtwork } from "../TrackArtwork";
import { useTrackContextMenu } from "../TrackContextMenu";
import { usePlayerUIState, playerUIStore } from "../../stores/playerUIStore";
import { SquareAltArrowLeftIcon } from "@solar-icons/react/linear";

import { usePlayHistory } from "../../../player/playHistory";
import { SpotifyCreditsModal } from "./SpotifyCreditsModal";
import { SpotifyScannableModal } from "./SpotifyScannableModal";
import { SpotifyService, type SpotifyTrackCredits, type SpotifyArtistOverview } from "../../../services/SpotifyService";
import {
  findActiveLineIndex,
  getDynamicVocalMultiplier,
  getLineProgress,
  isAdlibLine,
  isSyncedLyrics,
} from "../../pages/lyricsTiming";
import { LyricLineView, setLineSweepState, updateLineWordsSweep } from "../lyrics/LyricLineView";
import { useTrackLyrics } from "../../hooks/useTrackLyrics";
import { getLyricsOffset } from "../../settings/lyricsOffset";

interface QueuePanelProps {
  onClose: () => void;
  onOpenHistory?: () => void;
}

interface SpotifyAboutArtistCardProps {
  artistName: string;
  artistOverview: SpotifyArtistOverview | null;
  fallbackArtwork?: string;
  descriptionFallback?: string;
  isFollowing: boolean;
  onToggleFollow: () => void;
  onNavigateArtist?: ((artist: Artist, openInNewTab: boolean) => void) | null;
  artistId?: string;
  artists?: ArtistReference[];
  trackTitle?: string;
}

function SpotifyAboutArtistCard({
  artistName,
  artistOverview,
  fallbackArtwork,
  descriptionFallback,
  isFollowing,
  onToggleFollow,
  onNavigateArtist,
  artistId,
  artists,
  trackTitle,
}: SpotifyAboutArtistCardProps) {
  const bio = artistOverview?.cleanBio || artistOverview?.bio || descriptionFallback;
  const image = artistOverview?.headerUrl || artistOverview?.avatarUrl || fallbackArtwork;
  const monthly = artistOverview?.monthlyListeners;
  const worldRank = artistOverview?.worldRank;

  return (
    <div
      onClick={() => {
        if (onNavigateArtist) {
          onNavigateArtist(
            {
              id: artistId || artistOverview?.spotifyId || artistName,
              name: artistName,
              artworkUrl: artistOverview?.avatarUrl || fallbackArtwork,
            },
            false,
          );
        }
      }}
      className="group relative shrink-0 overflow-hidden rounded-2xl bg-[#242424] border border-white/5 cursor-pointer transition-all duration-300 hover:bg-[#282828] shadow-lg flex flex-col"
    >
      {/* Top Banner / Hero */}
      <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-black/40">
        {image ? (
          <img
            src={image}
            alt={artistName}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="size-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center">
            <span className="text-3xl font-bold text-white/30">{artistName[0]}</span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#242424] via-[#242424]/40 to-black/30" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white drop-shadow-md">
            About the artist
          </span>
          {worldRank ? (
            <span className="px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-bold text-white shadow-sm">
              #{worldRank} in the world
            </span>
          ) : null}
        </div>

        {/* Bottom Details overlay inside image with split individual artist links */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-0.5">
          <div
            className="text-lg font-bold text-white tracking-tight leading-tight"
            onClick={(e) => e.stopPropagation()}
          >
            <ArtistLinks
              artists={artists}
              fallback={artistName}
              trackTitle={trackTitle}
              className="text-white hover:underline drop-shadow-md"
            />
          </div>
          {monthly ? (
            <span className="text-xs font-medium text-[#b3b3b3] drop-shadow-md">
              {monthly.toLocaleString()} monthly listeners
            </span>
          ) : null}
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 flex flex-col gap-3">
        {/* Action row with Follow Button */}
        <div className="flex items-center justify-between gap-2">
          {monthly && !image ? (
            <span className="text-xs text-[#b3b3b3]">
              {monthly.toLocaleString()} monthly listeners
            </span>
          ) : <div />}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFollow();
            }}
            className={cn(
              "px-4 py-1 rounded-full border text-xs font-bold transition-all shrink-0 cursor-pointer shadow-sm",
              isFollowing
                ? "border-white bg-white text-black"
                : "border-[#b3b3b3] text-white hover:border-white hover:scale-105",
            )}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        </div>

        {/* Biography */}
        {bio ? (
          <p className="text-xs text-[#b3b3b3] group-hover:text-white/90 leading-relaxed line-clamp-4 transition-colors">
            {bio}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface RelatedShelfViewProps {
  shelf: BrowseShelf;
  sIdx: number;
  navigateArtist: ((artist: Artist, openInNewTab: boolean) => void) | null;
  navigateAlbum: ((album: any, openInNewTab?: boolean) => void) | null;
  onPlayTrack: (id: string) => void;
  onAddToQueue: (track: Track) => void;
}

function RelatedShelfView({
  shelf,
  sIdx,
  navigateArtist,
  navigateAlbum,
  onPlayTrack,
  onAddToQueue,
}: RelatedShelfViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const hasTracks = shelf.tracks && shelf.tracks.length > 0;
  const hasArtists = shelf.artists && shelf.artists.length > 0;
  const hasAlbums = shelf.albums && shelf.albums.length > 0;
  const hasDesc = Boolean(shelf.description);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 6);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 6);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const timer = setTimeout(checkScroll, 80);
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, shelf.artists, shelf.albums]);

  const handleScroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = direction === "left" ? -240 : 240;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <div
      key={`related-tab-shelf-${sIdx}-${shelf.title}`}
      className="relative shrink-0 overflow-hidden rounded-2xl bg-[#242424] border border-white/5 p-4 flex flex-col gap-3 shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[#b3b3b3]">
          {shelf.title}
        </span>
        {(hasArtists || hasAlbums) && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleScroll("left")}
              disabled={!canScrollLeft}
              aria-label="Scroll left"
              className="size-7 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/15 text-[#b3b3b3] hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer border border-white/5 shadow-xs"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleScroll("right")}
              disabled={!canScrollRight}
              aria-label="Scroll right"
              className="size-7 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/15 text-[#b3b3b3] hover:text-white disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer border border-white/5 shadow-xs"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {hasTracks && (
        <div className="flex flex-col gap-1.5">
          {shelf.tracks.map((track) => (
            <div
              key={track.id}
              className="group flex items-center justify-between gap-2 w-full rounded-xl p-1.5 text-left transition-colors hover:bg-white/10"
            >
              <button
                type="button"
                onClick={() => onPlayTrack(track.id)}
                className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none"
              >
                <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-black/40">
                  <TrackArtwork
                    className="size-full object-cover rounded-lg"
                    size={40}
                    artworkUrl={track.artworkUrl}
                    iconSize={16}
                  />
                  <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <PlayIcon size={16} fill="currentColor" className="text-white" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-semibold text-white group-hover:underline">
                    {track.title}
                  </span>
                  <span className="truncate text-[11px] text-[#b3b3b3]">
                    {track.artist}
                  </span>
                </div>
              </button>
              <Tooltip content="Add to queue">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToQueue(track);
                  }}
                  aria-label="Add to queue"
                  className="size-7 shrink-0 rounded-full flex items-center justify-center text-[#b3b3b3] hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 transition-all opacity-80 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                >
                  <PlusIcon size={14} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      {hasArtists && (
        <div
          ref={scrollRef}
          className="flex items-center gap-3 overflow-x-auto pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {shelf.artists.map((artist) => (
            <button
              key={artist.id || artist.name}
              type="button"
              onClick={() => {
                if (navigateArtist) {
                  navigateArtist(artist, false);
                }
              }}
              className="group flex flex-col items-center gap-1.5 shrink-0 w-16 text-center cursor-pointer hover:scale-105 transition-transform"
            >
              <div className="size-12 rounded-full overflow-hidden bg-black/40 border border-white/10 ring-1 ring-white/10 group-hover:border-white/30">
                {artist.artworkUrl ? (
                  <img
                    src={artist.artworkUrl}
                    alt={artist.name}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="size-full flex items-center justify-center text-xs font-bold text-white/50">
                    {artist.name[0]}
                  </div>
                )}
              </div>
              <span className="truncate text-[11px] font-medium text-white/90 group-hover:text-white w-full">
                {artist.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {hasAlbums && (
        <div
          ref={scrollRef}
          className="flex items-center gap-3 overflow-x-auto pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {shelf.albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => {
                if (navigateAlbum) {
                  navigateAlbum(album);
                }
              }}
              className="group flex flex-col items-center gap-1.5 shrink-0 w-20 text-left cursor-pointer hover:scale-105 transition-transform"
            >
              <div className="size-20 rounded-xl overflow-hidden bg-black/40 border border-white/10">
                <TrackArtwork
                  className="size-full object-cover rounded-xl"
                  size={80}
                  artworkUrl={album.artworkUrl}
                  iconSize={24}
                />
              </div>
              <span className="truncate text-[11px] font-semibold text-white/90 group-hover:text-white w-full text-center">
                {album.title}
              </span>
            </button>
          ))}
        </div>
      )}

      {hasDesc && (
        <div className="text-xs text-white/80 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5">
          <p className="line-clamp-6">{shelf.description}</p>
        </div>
      )}
    </div>
  );
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

export function QueuePanel({ onClose, onOpenHistory }: QueuePanelProps) {
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
  const recentlyPlayed = useMemo(() => {
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const result: Track[] = [];
    for (const item of playHistory) {
      if (!item.track?.id) continue;
      const title = (item.track.title || "")
        .trim()
        .toLowerCase()
        .replace(/\s*\(.*?\)\s*/g, "")
        .replace(/\s*\[.*?\]\s*/g, "")
        .trim();
      const artist = (item.track.artist || "").trim().toLowerCase();
      const key = title && artist ? `${title}:::${artist}` : item.track.id;
      if (!seenIds.has(item.track.id) && !seenKeys.has(key)) {
        seenIds.add(item.track.id);
        seenKeys.add(key);
        result.push(item.track);
      }
    }
    return result;
  }, [playHistory]);

  const [relatedShelves, setRelatedShelves] = useState<BrowseShelf[] | null>(null);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const [artistOverview, setArtistOverview] = useState<SpotifyArtistOverview | null>(null);

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
  const [credits, setCredits] = useState<SpotifyTrackCredits | null>(null);
  // Shared per-track fetch (same data as the Now Playing screen): loading/error included,
  // so a failed fetch reads as a state instead of a blank card.
  const { status: lyricsStatus, lyrics, reload: reloadLyrics } = useTrackLyrics(currentTrack ?? null);
  const [currentTime, setCurrentTime] = useState(0);
  const [spotifyCover, setSpotifyCover] = useState<string | null>(null);

  useEffect(() => {
    setSpotifyCover(null);
    if (!currentTrack || currentTrack.source === "local" || !currentTrack.title) return;
    let active = true;
    void SpotifyService.getTrackCoverUrl(currentTrack.title, currentTrack.artist, currentTrack.album)
      .then((url) => {
        if (active && url) setSpotifyCover(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album]);

  useEffect(() => {
    setCredits(null);
    if (!currentTrack || currentTrack.source === "local" || !currentTrack.title || !currentTrack.artist) return;
    let active = true;
    void SpotifyService.getTrackCredits(currentTrack.title, currentTrack.artist).then((data) => {
      if (active && data) {
        setCredits(data);
      }
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.title, currentTrack?.artist]);

  const previewLineRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!currentTrack) {
      setRelatedShelves(null);
      return;
    }
    let active = true;
    setIsRelatedLoading(true);
    void libraryController.getRelated(currentTrack)
      .then(async (shelves) => {
        if (!active) return;
        if (shelves && shelves.length > 0) {
          setRelatedShelves(shelves);
          return;
        }

        // Build fallback shelves so Related tab is never blank (e.g. Odysseus or tracks lacking YT related data)
        const fallbackShelves: BrowseShelf[] = [];

        // 1. You might also like
        try {
          const recTracks = await libraryController.getRecommendations(currentTrack);
          if (recTracks && recTracks.length > 0) {
            fallbackShelves.push({
              title: "You might also like",
              tracks: recTracks.slice(0, 10),
              albums: [],
              playlists: [],
              artists: [],
              links: [],
            });
          }
        } catch {}

        // 2. Similar artists
        try {
          const artistId = currentTrack.artists?.[0]?.id;
          if (artistId) {
            const artistPage = await libraryController.getArtist(artistId).catch(() => null);
            if (artistPage?.fansAlsoLike && artistPage.fansAlsoLike.length > 0) {
              fallbackShelves.push({
                title: "Similar artists",
                tracks: [],
                albums: [],
                playlists: [],
                artists: artistPage.fansAlsoLike.slice(0, 16),
                links: [],
              });
            }
          }
        } catch {}

        // 3. More from [Artist]
        try {
          const discography = await SpotifyService.getArtistDiscography(currentTrack.artist);
          if (discography && discography.length > 0) {
            fallbackShelves.push({
              title: `More from ${currentTrack.artist}`,
              tracks: [],
              albums: discography.slice(0, 16).map((d) => ({
                id: d.id,
                title: d.name,
                artist: currentTrack.artist,
                artworkUrl: d.coverUrl,
              })),
              playlists: [],
              artists: [],
              links: [],
            });
          }
        } catch {}

        if (active) {
          setRelatedShelves(fallbackShelves);
        }
      })
      .catch(async () => {
        if (!active) return;
        const fallbackShelves: BrowseShelf[] = [];
        try {
          const recTracks = await libraryController.getRecommendations(currentTrack);
          if (recTracks && recTracks.length > 0) {
            fallbackShelves.push({
              title: "You might also like",
              tracks: recTracks.slice(0, 10),
              albums: [],
              playlists: [],
              artists: [],
              links: [],
            });
          }
        } catch {}
        try {
          const discography = await SpotifyService.getArtistDiscography(currentTrack.artist);
          if (discography && discography.length > 0) {
            fallbackShelves.push({
              title: `More from ${currentTrack.artist}`,
              tracks: [],
              albums: discography.slice(0, 8).map((d) => ({
                id: d.id,
                title: d.name,
                artist: currentTrack.artist,
                artworkUrl: d.coverUrl,
              })),
              playlists: [],
              artists: [],
              links: [],
            });
          }
        } catch {}
        if (active) setRelatedShelves(fallbackShelves);
      })
      .finally(() => {
        if (active) setIsRelatedLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentTrack?.id]);

  const parsedArtists = useMemo(() => {
    return parseTrackArtistsWithFeatures(currentTrack?.title, currentTrack?.artist, currentTrack?.artists);
  }, [currentTrack?.title, currentTrack?.artist, currentTrack?.artists]);

  const primaryArtist = useMemo(() => {
    return parsedArtists.mainArtists[0] || { id: currentTrack?.artists?.[0]?.id || "", name: currentTrack?.artist || "" };
  }, [parsedArtists, currentTrack?.artists, currentTrack?.artist]);

  useEffect(() => {
    setArtistOverview(null);
    const targetArtist = primaryArtist.name || currentTrack?.artist;
    if (!targetArtist || currentTrack?.source === "local") return;
    let active = true;
    void SpotifyService.getArtistOverview(targetArtist).then((overview) => {
      if (active && overview) {
        setArtistOverview(overview);
      }
    });
    return () => {
      active = false;
    };
  }, [primaryArtist.name, currentTrack?.artist, currentTrack?.source]);

  const effectiveArtwork = spotifyCover || currentTrack?.artworkUrl;
  const isFollowedLocally = useFollowedArtistLocally(
    primaryArtist.name,
    primaryArtist.id,
    currentTrack?.artist,
  );
  const isSubscribedInLibrary = useMemo(() => {
    const pName = primaryArtist.name.toLowerCase();
    const pId = primaryArtist.id;
    return (libraryState.library?.artists ?? []).some(
      (a) => (pName && a.name.toLowerCase() === pName) || (pId && a.id === pId),
    );
  }, [primaryArtist, libraryState.library?.artists]);

  const isFollowingArtist = isSubscribedInLibrary || isFollowedLocally;

  const toggleFollowingArtist = async (artistToToggle: { id?: string; name: string } = primaryArtist) => {
    if (!artistToToggle?.name) return;
    const isCurrentlyFollowed = isArtistFollowedLocally(artistToToggle.name, artistToToggle.id);
    const nextState = !isCurrentlyFollowed;
    setArtistFollowedLocally(artistToToggle.id, artistToToggle.name, nextState);
    try {
      await libraryController.setArtistSubscribed(
        { id: artistToToggle.id || "", name: artistToToggle.name },
        nextState,
      );
    } catch (err) {
      console.warn("Could not sync artist subscription:", err);
    }
  };

  useEffect(() => {
    if (!currentTrack) {
      setCredits(null);
      return;
    }
    let active = true;
    void SpotifyService.getTrackCredits(currentTrack.title, primaryArtist.name || currentTrack.artist).then((data) => {
      if (!active) return;
      if (data) {
        setCredits(data);
      } else {
        const allArtists = [...parsedArtists.mainArtists, ...parsedArtists.featuredArtists];
        setCredits({
          trackTitle: currentTrack.title,
          artists: allArtists.length > 0
            ? allArtists.map((a, i) => ({
                name: a.name,
                role: i === 0 ? "Main Artist" : "Featured Artist",
                avatarUrl: i === 0 ? (artistOverview?.avatarUrl || currentTrack.artworkUrl) : undefined,
              }))
            : [{ name: currentTrack.artist, role: "Main Artist", avatarUrl: currentTrack.artworkUrl }],
          writers: allArtists.length > 0
            ? allArtists.map((a) => ({ name: a.name, role: "Composer, Lyricist" }))
            : [{ name: currentTrack.artist, role: "Composer, Lyricist" }],
          producers: [],
          label: currentTrack.album ? `Released by ${currentTrack.album}` : undefined,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.title, currentTrack?.artist, primaryArtist.name, parsedArtists, artistOverview?.avatarUrl, currentTrack?.artworkUrl]);

  useEffect(() => {
    const updateTime = () => setCurrentTime(playerController.getCurrentTime());
    updateTime();
    if (activeTab !== "nowplaying") return;
    const interval = window.setInterval(updateTime, 250);
    return () => window.clearInterval(interval);
  }, [activeTab]);

  const synced = isSyncedLyrics(lyrics);
  const autoIntro = lyrics?.autoIntroOffsetSec ?? 0;
  const userOffset = getLyricsOffset(currentTrack?.id);
  const effectiveCurrentTime = currentTime - autoIntro + userOffset;
  const activeLyricIndex = synced && lyrics?.lines ? findActiveLineIndex(lyrics.lines, effectiveCurrentTime) : -1;
  /*
   * The whole song, not a 4-line window: the card is a Spotify-tall scrolling pane and the
   * active line glides through it. Rows are keyed by absolute index and memoised inside
   * LyricLineView, so the 250ms tick re-renders at most the rows whose state flipped.
   */
  const previewLyricsRows = useMemo(() => {
    if (!lyrics?.lines?.length) return [];
    return lyrics.lines.map((line, globalIndex) => ({
      line,
      globalIndex,
      isCurrent: globalIndex === activeLyricIndex,
      isAdlib: isAdlibLine(line.text),
      sweep: globalIndex === activeLyricIndex && synced ? 1 : 1,
    }));
  }, [lyrics, synced, activeLyricIndex]);

  // Follow the sung line: keep it centred in the card without touching ancestor scrollers.
  const lyricsPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const activePreviewNodeRef = useRef<HTMLElement | null>(null);
  const setActivePreviewNode = useCallback((el: HTMLElement | null) => {
    // Set-only: on a backward seek React detaches the old row after attaching the new one,
    // and a null-write there must not blank the fresh node.
    if (el) activePreviewNodeRef.current = el;
  }, []);
  useEffect(() => {
    const node = activePreviewNodeRef.current;
    const scroller = lyricsPreviewScrollRef.current;
    if (!node || !scroller || !scroller.isConnected || activeLyricIndex < 0) {
      if (scroller && activeLyricIndex < 0 && scroller.scrollTop !== 0) {
        scroller.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    const rowTop = node.offsetTop;
    const rowBottom = rowTop + node.clientHeight;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    // Already fully on screen: touching scrollTop would only yank a settled view.
    if (rowTop >= viewTop && rowBottom <= viewBottom) return;
    const top = Math.max(0, rowTop - scroller.clientHeight / 2 + node.clientHeight / 2);
    scroller.scrollTo({ top, behavior: "smooth" });
  }, [activeLyricIndex, lyrics]);

  /*
   * Buttery karaoke fill on the active preview row (Spicy Lyrics style). The panel already
   * re-renders on a 250ms tick, but the fill would step visibly at that cadence, so the
   * percentage is written straight to the row's `--sweep` var on every frame instead — no
   * re-render involved. Parked unless the Now Playing tab is up and something is playing.
   */
  useEffect(() => {
    if (activeTab !== "nowplaying" || !isPlaying) return;
    let raf = 0;
    const tickSweep = () => {
      if (synced && lyrics?.lines?.length && activeLyricIndex >= 0) {
        const lineAutoIntro = lyrics.autoIntroOffsetSec ?? 0;
        const lineUserOffset = getLyricsOffset(currentTrack?.id);
        const effectiveTime = playerController.getCurrentTime() - lineAutoIntro + lineUserOffset;
        const progress = getLineProgress(
          lyrics.lines,
          activeLyricIndex,
          effectiveTime,
          currentTrack?.durationSec,
        );
        const multiplier = getDynamicVocalMultiplier(
          lyrics.lines[activeLyricIndex],
          lyrics.lines[activeLyricIndex + 1],
          currentTrack?.durationSec,
        );
        const vocalProgress = Math.min(1, progress * multiplier);
        const row = previewLineRefs.current[activeLyricIndex] || activePreviewNodeRef.current;
        if (row) {
          row.style.setProperty("--sweep", `${Math.round(vocalProgress * 100)}%`);
          updateLineWordsSweep(row, vocalProgress);
        }

        const count = lyrics.lines.length;
        for (let i = 0; i < count; i++) {
          const el = previewLineRefs.current[i];
          if (!el) continue;
          if (i < activeLyricIndex) {
            setLineSweepState(el, "sung");
          } else if (i > activeLyricIndex) {
            setLineSweepState(el, "unsung");
          }
        }
      }
      raf = requestAnimationFrame(tickSweep);
    };
    raf = requestAnimationFrame(tickSweep);
    return () => cancelAnimationFrame(raf);
  }, [activeTab, isPlaying, synced, lyrics, activeLyricIndex, currentTrack?.id, currentTrack?.durationSec]);

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
        className="flex h-full flex-col items-center overflow-y-auto overscroll-contain py-2 select-none"
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
          "flex h-full flex-col overflow-hidden bg-[#121212]",
          draggedIndex !== null && "select-none",
        )}
        aria-label="Now Playing and Queue"
      >
      {/* Top Header: Unified Right Sidebar Tabs */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/5 bg-[#121212] px-3 py-2 z-10">
        <div className="flex items-center gap-1" role="tablist" aria-label="Sidebar views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "nowplaying"}
            onClick={() => playerUIStore.setRightPanelTab("nowplaying")}
            className={cn(
              "relative px-2.5 py-1.5 text-xs sm:text-sm font-bold transition-colors focus-visible:outline-none cursor-pointer",
              activeTab === "nowplaying"
                ? "text-white after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-[#b3b3b3] hover:text-white",
            )}
          >
            Now playing
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "queue"}
            onClick={() => playerUIStore.setRightPanelTab("queue")}
            className={cn(
              "relative px-2.5 py-1.5 text-xs sm:text-sm font-bold transition-colors focus-visible:outline-none cursor-pointer",
              activeTab === "queue"
                ? "text-white after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-[#b3b3b3] hover:text-white",
            )}
          >
            Queue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "related"}
            onClick={() => playerUIStore.setRightPanelTab("related")}
            className={cn(
              "relative px-2.5 py-1.5 text-xs sm:text-sm font-bold transition-colors focus-visible:outline-none cursor-pointer",
              activeTab === "related"
                ? "text-white after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-[#b3b3b3] hover:text-white",
            )}
          >
            Related
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeTab === "nowplaying" && currentTrack && (
            <Tooltip side="bottom" content="More options">
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-full text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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
              className="flex size-8 items-center justify-center rounded-full text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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
        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 overscroll-contain">
          {currentTrack ? (
            <>
              {/* Square Album Artwork (Spotify 1:1, Cover Art only) */}
              <div className="relative w-full aspect-square shrink-0 overflow-hidden rounded-xl bg-black/40 shadow-2xl select-none">
                <TrackArtwork
                  className="size-full object-cover rounded-xl"
                  size={640}
                  artworkUrl={effectiveArtwork}
                  iconSize={56}
                />
              </div>

              {/* Title & Artist & Spotify Plus/Like Button */}
              <div className="flex shrink-0 items-start justify-between gap-3 pt-1">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight tracking-tight line-clamp-2">
                    {currentTrack.title}
                  </h2>
                  <div className="text-sm font-medium text-[#b3b3b3]">
                    <ArtistLinks
                      artists={currentTrack.artists}
                      fallback={currentTrack.artist}
                      trackTitle={currentTrack.title}
                      className="text-[#b3b3b3] hover:text-white transition-colors no-underline"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {/* Video button */}
                  <Tooltip content="Watch video">
                    <button
                      type="button"
                      onClick={() => playerUIStore.openVideoMode()}
                      className="flex size-8 items-center justify-center rounded-full text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label="Watch video"
                    >
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" fill="currentColor" stroke="none" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    </button>
                  </Tooltip>

                  {/* Share button */}
                  <Tooltip content="Share">
                    <button
                      type="button"
                      onClick={handleShare}
                      className="flex size-8 items-center justify-center rounded-full text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label="Share track"
                    >
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    </button>
                  </Tooltip>

                  {/* Liked / Add Button (Spotify style - Brand Red, no green!) */}
                  <button
                    type="button"
                    className="p-1 rounded-full transition-transform active:scale-95 cursor-pointer"
                    onClick={() => toggleTrackLike(currentTrack)}
                    title={isLiked ? "Added to Liked Songs" : "Save to Your Library"}
                    aria-label={isLiked ? "Added to Liked Songs" : "Save to Your Library"}
                  >
                    {isLiked ? (
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                        <CheckIcon size={14} className="stroke-[3]" />
                      </span>
                    ) : (
                      <span className="flex size-7 items-center justify-center rounded-full border border-[#b3b3b3]/60 text-[#b3b3b3] hover:border-white hover:text-white transition-colors">
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Lyrics Preview Card (Spotify 1:1 Style with glowing active line) */}
              <div
                className="relative shrink-0 overflow-hidden rounded-2xl bg-[#242424] border border-white/5 p-4 transition-all hover:bg-[#282828] cursor-pointer group flex flex-col gap-3 shadow-md"
                onClick={() => playerUIStore.setLyricsOpen(true)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-white tracking-tight">
                    Lyrics
                  </span>
                </div>

                {lyricsStatus === "loading" || lyricsStatus === "idle" ? (
                  <div className="flex flex-col gap-2.5 py-2 min-h-[160px] justify-center" aria-label="Loading lyrics">
                    {[92, 78, 86, 64, 84].map((width, i) => (
                      <div
                        key={i}
                        className="h-4 rounded-full bg-white/15 animate-pulse"
                        style={{ width: `${width}%`, animationDelay: `${i * 120}ms` }}
                      />
                    ))}
                  </div>
                ) : lyricsStatus === "error" || (lyricsStatus === "ready" && previewLyricsRows.length === 0) ? (
                  <div className="flex flex-col items-center justify-center gap-2.5 py-8 min-h-[160px] text-center">
                    <span className="text-xs font-semibold text-[#b3b3b3]">No lyrics available for this song.</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        reloadLyrics();
                      }}
                      className="rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      Retry search
                    </button>
                  </div>
                ) : (
                  <div
                    ref={lyricsPreviewScrollRef}
                    className="relative flex flex-col gap-2 py-1 min-h-[140px] max-h-[220px] overflow-y-auto overscroll-contain select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {previewLyricsRows.map((item) => {
                      const dist = activeLyricIndex < 0 ? 1 : Math.abs(item.globalIndex - activeLyricIndex);
                      return (
                        <LyricLineView
                          key={item.globalIndex}
                          index={item.globalIndex}
                          text={item.line.text}
                          isActive={item.isCurrent}
                          size="preview"
                          forceAdlibLine={item.isAdlib}
                          depthStyle={{
                            opacity: item.isCurrent ? 1 : Math.max(0.28, 0.65 - dist * 0.12),
                            filter: item.isCurrent ? "none" : `blur(${Math.min(2, 0.4 + dist * 0.4)}px)`,
                            transform: item.isCurrent ? "scale(1.03) translateZ(0)" : "scale(0.98) translateZ(0)",
                          }}
                          emptyStyle="note"
                          onSeek={synced && item.line.startTimeSec !== undefined ? (index) => {
                            const autoIntroOffset = lyrics?.autoIntroOffsetSec ?? 0;
                            const offset = getLyricsOffset(currentTrack?.id);
                            const targetTime = Math.max(0, (lyrics?.lines[index]?.startTimeSec ?? 0) + autoIntroOffset - offset);
                            void playerController.seekTo(targetTime);
                          } : undefined}
                          register={(i, el) => {
                            previewLineRefs.current[i] = el;
                          }}
                          elementRef={item.isCurrent ? setActivePreviewNode : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>



              {/* Credits Card (Spotify style) */}
              <div className="relative shrink-0 overflow-hidden rounded-2xl bg-[#242424] border border-white/5 p-4 flex flex-col gap-3.5 transition-all hover:bg-[#282828] shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    Credits
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCreditsModal(true)}
                    className="text-xs font-bold text-[#b3b3b3] hover:text-white underline cursor-pointer"
                  >
                    Show all
                  </button>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                  {/* Performed by */}
                  <div className="flex flex-col gap-1">
                    <span className="font-bold text-[11px] uppercase tracking-wider text-[#b3b3b3]/80">
                      Performed by
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {credits?.artists?.length ? (
                        credits.artists.slice(0, 5).map((a, i) => {
                          const isFollowed = isArtistFollowedLocally(a.name, a.uri?.replace("spotify:artist:", ""));
                          return (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => navigateArtist?.({ id: a.uri?.replace("spotify:artist:", "") || "", name: a.name }, false)}
                                className="font-semibold text-white truncate hover:underline text-left cursor-pointer"
                              >
                                {a.name}
                              </button>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[11px] text-[#b3b3b3]">{a.role || (i === 0 ? "Main Artist" : "Featured Artist")}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void toggleFollowingArtist({ id: a.uri ? a.uri.replace("spotify:artist:", "") : "", name: a.name });
                                  }}
                                  className={cn(
                                    "px-3 py-0.5 rounded-full border text-[11px] font-bold transition-all shrink-0 cursor-pointer",
                                    isFollowed
                                      ? "border-white bg-white text-black"
                                      : "border-[#b3b3b3] text-white hover:border-white",
                                  )}
                                >
                                  {isFollowed ? "Following" : "Follow"}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => navigateArtist?.({ id: primaryArtist.id || "", name: primaryArtist.name }, false)}
                            className="font-semibold text-white truncate hover:underline text-left cursor-pointer"
                          >
                            {primaryArtist.name}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleFollowingArtist();
                            }}
                            className={cn(
                              "px-3 py-0.5 rounded-full border text-[11px] font-bold transition-all shrink-0 cursor-pointer",
                              isFollowingArtist
                                ? "border-white bg-white text-black"
                                : "border-[#b3b3b3] text-white hover:border-white",
                            )}
                          >
                            {isFollowingArtist ? "Following" : "Follow"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Written by */}
                  {credits?.writers?.length ? (
                    <div className="flex flex-col gap-1 pt-1 border-t border-white/10">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-[#b3b3b3]/80">
                        Written by
                      </span>
                      <div className="flex flex-col gap-0.5">
                        {credits.writers.slice(0, 4).map((w, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => navigateArtist?.({ id: w.uri?.replace("spotify:artist:", "") || "", name: w.name }, false)}
                              className="font-medium text-white truncate hover:underline text-left cursor-pointer"
                            >
                              {w.name}
                            </button>
                            <span className="text-[11px] text-[#b3b3b3] shrink-0">{w.role || "Composer, Lyricist"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Produced by */}
                  {credits?.producers?.length ? (
                    <div className="flex flex-col gap-1 pt-1 border-t border-white/10">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-[#b3b3b3]/80">
                        Produced by
                      </span>
                      <div className="flex flex-col gap-0.5">
                        {credits.producers.slice(0, 4).map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => navigateArtist?.({ id: p.uri?.replace("spotify:artist:", "") || "", name: p.name }, false)}
                              className="font-medium text-white truncate hover:underline text-left cursor-pointer"
                            >
                              {p.name}
                            </button>
                            <span className="text-[11px] text-[#b3b3b3] shrink-0">{p.role || "Producer"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Source / Label */}
                  {(credits?.label || currentTrack.album) && (
                    <div className="pt-1 border-t border-white/10 flex flex-col gap-0.5 text-[11px] text-[#b3b3b3]">
                      <span className="font-bold uppercase tracking-wider text-[#b3b3b3]/80">
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
                  className="relative shrink-0 overflow-hidden rounded-2xl bg-[#242424] border border-white/5 p-3.5 flex items-center gap-3 cursor-pointer hover:bg-[#282828] transition-all group shadow-md"
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
                  <div className="size-12 rounded-lg overflow-hidden bg-black/40 shrink-0">
                    <TrackArtwork
                      className="size-full object-cover rounded-lg"
                      size={48}
                      artworkUrl={effectiveArtwork}
                      iconSize={20}
                    />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#b3b3b3]">
                      From the album
                    </span>
                    <span className="font-semibold text-sm text-white truncate group-hover:underline transition-all">
                      {currentTrack.album}
                    </span>
                  </div>
                </div>
              )}

              {/* About the artist Card (Spotify-style) */}
              <SpotifyAboutArtistCard
                artistName={currentTrack.artist}
                artistOverview={artistOverview}
                fallbackArtwork={artistOverview?.avatarUrl || effectiveArtwork}
                isFollowing={isFollowingArtist}
                onToggleFollow={() => void toggleFollowingArtist()}
                onNavigateArtist={navigateArtist}
                artistId={primaryArtist.id || currentTrack.artists?.[0]?.id}
                artists={currentTrack.artists}
                trackTitle={currentTrack.title}
              />

              {/* Next in Queue Preview Card */}
              {(manual.length > 0 || automatic.length > 0) && (
                <div className="relative shrink-0 overflow-hidden rounded-2xl bg-[#242424] border border-white/5 p-3.5 flex items-center justify-between gap-3 shadow-md">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-11 rounded-lg overflow-hidden bg-black/40 shrink-0">
                      <TrackArtwork
                        className="size-full object-cover rounded-lg"
                        size={44}
                        artworkUrl={(manual[0]?.track || automatic[0]?.track)?.artworkUrl}
                        iconSize={18}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#b3b3b3]">
                        Next in queue
                      </span>
                      <span className="font-semibold text-sm text-white truncate">
                        {(manual[0]?.track || automatic[0]?.track)?.title}
                      </span>
                      <span className="text-xs text-[#b3b3b3] truncate">
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

          {/* Recently Played Section in Queue */}
          {recentlyPlayed.length > 0 && (
            <div className="flex flex-col gap-1 px-2 pt-3 pb-6 border-t border-white/10">
              <div className="flex items-center justify-between px-1 py-1 mb-0.5">
                <button
                  type="button"
                  onClick={() => onOpenHistory?.()}
                  className="group flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#b3b3b3] hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 py-0.5"
                  title="Open listening history"
                >
                  <ClockIcon size={13} className="text-[#b3b3b3] group-hover:text-white transition-colors shrink-0" />
                  <span className="group-hover:underline">Recently played</span>
                  <span className="text-xs opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-transform">→</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenHistory?.()}
                  className="text-[11px] font-medium text-[#b3b3b3] hover:text-white transition-colors cursor-pointer"
                  title="Open listening history"
                >
                  View all ({recentlyPlayed.length})
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {recentlyPlayed.slice(0, 15).map((track, idx) => (
                  <div
                    key={`queue-recent-${track.id}-${idx}`}
                    className="group flex items-center justify-between gap-2 w-full rounded-xl p-1.5 text-left transition-colors hover:bg-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => void playerController.loadTrack(track)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none"
                    >
                      <div className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-black/40">
                        <TrackArtwork
                          className="size-full object-cover"
                          size={36}
                          artworkUrl={track.artworkUrl}
                          iconSize={16}
                        />
                        <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <PlayIcon size={14} className="text-white fill-white" />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-xs font-semibold text-white group-hover:text-primary transition-colors">
                          {track.title}
                        </span>
                        <span className="truncate text-[11px] text-[#b3b3b3]">
                          {track.artist}
                        </span>
                      </div>
                    </button>
                    <Tooltip content="Add to queue">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playerController.addToQueue(track);
                        }}
                        aria-label="Add to queue"
                        className="size-7 shrink-0 rounded-full flex items-center justify-center text-[#b3b3b3] hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 transition-all opacity-80 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                      >
                        <PlusIcon size={14} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: Related Section (You might also like, Similar artists, etc.) ── */}
      {(activeTab === "related" || activeTab === "recent") && (
        <div className="flex flex-1 flex-col overflow-y-auto p-3 gap-3 overscroll-contain">
          {isRelatedLoading && !relatedShelves ? (
            <div className="flex flex-col gap-2.5 p-4 rounded-2xl bg-[#242424] border border-white/5 animate-pulse">
              <div className="h-4 w-28 rounded bg-white/10" />
              <div className="flex flex-col gap-2 pt-2">
                <div className="h-10 w-full rounded-lg bg-white/5" />
                <div className="h-10 w-full rounded-lg bg-white/5" />
                <div className="h-10 w-full rounded-lg bg-white/5" />
              </div>
            </div>
          ) : !currentTrack ? (
            <p className="px-4 py-12 text-center text-sm text-[#b3b3b3]">
              Play a track to discover related songs and artists.
            </p>
          ) : !relatedShelves || relatedShelves.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-[#b3b3b3]">
              No related songs or artists found for this track.
            </p>
          ) : (
            <>
              {relatedShelves.map((shelf, sIdx) => {
                const hasTracks = shelf.tracks && shelf.tracks.length > 0;
                const hasArtists = shelf.artists && shelf.artists.length > 0;
                const hasAlbums = shelf.albums && shelf.albums.length > 0;
                const hasDesc = Boolean(shelf.description);
                const isAboutShelf = shelf.title.toLowerCase().includes("about");

                if (!hasTracks && !hasArtists && !hasAlbums && !hasDesc && !isAboutShelf) return null;

                // When YouTube returns an "About the artist" shelf, render Spotify-style About card!
                if (isAboutShelf || (!hasTracks && !hasArtists && !hasAlbums && hasDesc)) {
                  return (
                    <SpotifyAboutArtistCard
                      key={`related-tab-about-${sIdx}`}
                      artistName={currentTrack.artist}
                      artistOverview={artistOverview}
                      fallbackArtwork={effectiveArtwork}
                      descriptionFallback={shelf.description}
                      isFollowing={isFollowingArtist}
                      onToggleFollow={() => void toggleFollowingArtist()}
                      onNavigateArtist={navigateArtist}
                      artistId={currentTrack.artists?.[0]?.id}
                    />
                  );
                }

                return (
                  <RelatedShelfView
                    key={`related-tab-shelf-${sIdx}-${shelf.title}`}
                    shelf={shelf}
                    sIdx={sIdx}
                    navigateArtist={navigateArtist}
                    navigateAlbum={navigateAlbum}
                    onPlayTrack={(id) => void playerController.playTrackById(id)}
                    onAddToQueue={(track) => playerController.addToQueue(track)}
                  />
                );
              })}

              {/* About the artist card if not already rendered by an about shelf */}
              {!relatedShelves.some((s) => s.title.toLowerCase().includes("about") || (!s.tracks?.length && !s.artists?.length && !s.albums?.length && s.description)) && (
                <SpotifyAboutArtistCard
                  artistName={currentTrack.artist}
                  artistOverview={artistOverview}
                  fallbackArtwork={artistOverview?.avatarUrl || effectiveArtwork}
                  isFollowing={isFollowingArtist}
                  onToggleFollow={() => void toggleFollowingArtist()}
                  onNavigateArtist={navigateArtist}
                  artistId={primaryArtist.id || currentTrack.artists?.[0]?.id}
                  artists={currentTrack.artists}
                  trackTitle={currentTrack.title}
                />
              )}
            </>
          )}
        </div>
      )}
      {showCreditsModal && currentTrack && (
        <SpotifyCreditsModal
          isOpen={showCreditsModal}
          track={currentTrack}
          isFollowingArtist={isFollowingArtist}
          onToggleFollowArtist={() => void toggleFollowingArtist()}
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
