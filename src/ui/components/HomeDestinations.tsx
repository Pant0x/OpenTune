import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { AlbumIcon, ClockIcon, CompassIcon, DownloadIcon, MusicNoteIcon, RadioIcon } from "@/ui/icons";
import { useOfflineState } from "../../player/offlineStore";
import { usePlayHistory } from "../../player/playHistory";
import { useLibraryState } from "../../player/playerStore";

export interface HomeDestinationHandlers {
  onOpenLibrary: () => void;
  onOpenBrowse: () => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
}

/**
 * The app's four destinations, on the home page rather than in the rail.
 *
 * They moved here because a permanently collapsed 72px rail could only ever show them as
 * unlabelled glyphs — three icons you had to hover to identify, competing for attention with
 * the playlist artwork that is the rail's actual job. On the home page they can carry a name
 * and a live count, which is what makes them worth a click.
 */
export function HomeDestinations({
  onOpenLibrary,
  onOpenBrowse,
  onOpenHistory,
  onOpenDownloads,
}: HomeDestinationHandlers) {
  const libraryState = useLibraryState();
  const offline = useOfflineState();
  const history = usePlayHistory();

  const library = libraryState.library;
  const savedCount = (library?.playlists.length ?? 0) + (library?.albums.length ?? 0);
  const downloadCount = Object.keys(offline.entries).length;

  const cards: Array<{
    key: string;
    label: string;
    hint: string;
    icon: typeof AlbumIcon | typeof MusicNoteIcon | typeof CompassIcon | typeof RadioIcon | typeof ClockIcon | typeof DownloadIcon;
    onClick: () => void;
    /** Live state, so the card says something the label alone cannot. */
    badge?: string;
  }> = [
    {
      key: "library",
      label: "Library",
      hint: "Songs, albums, artists",
      icon: MusicNoteIcon,
      onClick: onOpenLibrary,
      badge: savedCount > 0 ? `${savedCount} saved` : undefined,
    },
    {
      key: "trending",
      label: "Trending",
      hint: "Top charts & viral hits",
      icon: CompassIcon,
      onClick: onOpenBrowse,
    },
    {
      key: "history",
      label: "History",
      hint: "Everything you played",
      icon: ClockIcon,
      onClick: onOpenHistory,
      badge: history.length > 0 ? `${history.length} plays` : undefined,
    },
    {
      key: "downloads",
      label: "Downloads",
      hint: "Saved for offline",
      icon: DownloadIcon,
      onClick: onOpenDownloads,
      // A download in flight outranks the total: it is the thing that is changing.
      badge: offline.downloadingId
        ? offline.progress !== null
          ? `${offline.progress}%`
          : "downloading"
        : downloadCount > 0
          ? `${downloadCount} songs`
          : undefined,
    },
  ];

  return (
    <section className="flex flex-col gap-3" aria-label="Go to">
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        {cards.map((card) => (
          <motion.button
            key={card.key}
            type="button"
            onClick={card.onClick}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            className={cn(
              "group/dest relative flex items-center gap-3.5 rounded-xl bg-card/80 p-3.5 text-left border border-border/80 shadow-xs",
              "transition-all hover:bg-card hover:border-primary/40 hover:shadow-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover/dest:bg-primary/20">
              <card.icon
                size={22}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </div>

            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold leading-tight text-foreground">
                {card.label}
              </span>
              {card.badge ? (
                <span className="truncate text-xs font-medium tabular-nums text-foreground/75">
                  {card.badge}
                </span>
              ) : (
                <span className="truncate text-xs text-muted-foreground">{card.hint}</span>
              )}
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
