import { useState, useMemo, useRef, useEffect } from "react";
import type { Album, Artist } from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import { AlbumCard } from "../components/AlbumCard";
import { TrackArtwork } from "../components/TrackArtwork";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { CheckIcon, PlayActiveIcon, ListIcon } from "@/ui/icons";
import { AlbumGridSkeleton } from "../components/Skeleton";
import { cn } from "@/lib/utils";

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4", className)} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z" />
    </svg>
  );
}

type ReleaseFilter = "all" | "this-month" | "album" | "ep" | "single";

export function ReleasesPage({
  artist,
  releases: initialReleases,
  libraryController,
  onOpenAlbum,
  onOpenArtist: _onOpenArtist,
}: {
  artist?: Artist;
  releases?: Album[];
  libraryController?: LibraryController;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist?: (artist: Artist) => void;
}) {
  const [filter, setFilter] = useState<ReleaseFilter>("all");
  const [sort, setSort] = useState<"date" | "title">("date");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [fetchedReleases, setFetchedReleases] = useState<Album[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const releases = initialReleases && initialReleases.length > 0 ? initialReleases : fetchedReleases;

  const sortRef = useRef<HTMLDivElement | null>(null);
  const { openAlbumMenu } = usePlaylistContextMenu();

  useEffect(() => {
    if (initialReleases && initialReleases.length > 0) return;
    if (!libraryController) return;
    let active = true;
    setIsLoading(true);

    const fetchPromises = [
      libraryController.getReleases((updated) => {
        if (active && updated.length > 0) {
          setFetchedReleases((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const fresh = updated.filter((r) => !seen.has(r.id));
            return [...prev, ...fresh];
          });
          setIsLoading(false);
        }
      }),
      libraryController.getBrowsePage({ browseId: "FEmusic_new_releases_albums", title: "New releases" }).catch(() => null),
    ];

    Promise.allSettled(fetchPromises)
      .then(([releasesRes, browseRes]) => {
        if (!active) return;
        const all: Album[] = [];
        if (releasesRes.status === "fulfilled" && Array.isArray(releasesRes.value)) {
          all.push(...releasesRes.value);
        }
        if (browseRes.status === "fulfilled" && browseRes.value && typeof browseRes.value === "object" && "shelves" in browseRes.value) {
          const browsePage = browseRes.value as { shelves: Array<{ albums?: Album[] }> };
          for (const shelf of browsePage.shelves) {
            if (shelf.albums?.length) all.push(...shelf.albums);
          }
        }
        const seen = new Set<string>();
        const unique: Album[] = [];
        for (const a of all) {
          if (a?.id && !seen.has(a.id)) {
            seen.add(a.id);
            unique.push(a);
          }
        }
        if (unique.length > 0) {
          setFetchedReleases(unique);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialReleases, libraryController]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

function getEffectiveReleaseType(r: Album): "album" | "ep" | "single" {
  if (r.releaseType === "album" || r.releaseType === "ep" || r.releaseType === "single") {
    return r.releaseType;
  }
  const title = (r.title || "").toLowerCase();
  if (title.includes(" - single") || title.includes("(single)") || title.endsWith(" single")) {
    return "single";
  }
  if (title.includes(" - ep") || title.includes("(ep)") || title.endsWith(" ep")) {
    return "ep";
  }
  return "album";
}

  const currentYear = new Date().getFullYear().toString();

  const filteredReleases = useMemo(() => {
    let list = (releases ?? []).slice();
    if (filter === "this-month") {
      list = list.filter((r) => !r.year || r.year === currentYear || r.year === (parseInt(currentYear, 10) - 1).toString());
    } else if (filter === "album") {
      list = list.filter((r) => getEffectiveReleaseType(r) === "album");
    } else if (filter === "ep") {
      list = list.filter((r) => getEffectiveReleaseType(r) === "ep");
    } else if (filter === "single") {
      list = list.filter((r) => getEffectiveReleaseType(r) === "single");
    }

    if (sort === "title") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      list.sort((a, b) => {
        const yearA = parseInt(a.year || "0", 10);
        const yearB = parseInt(b.year || "0", 10);
        return yearB - yearA;
      });
    }
    return list;
  }, [releases, filter, sort, currentYear]);

  const sortLabel = sort === "date" ? "Release date" : "Name";

  const releaseTypeCounts = useMemo(() => {
    const counts = { all: 0, "this-month": 0, album: 0, ep: 0, single: 0 };
    (releases ?? []).forEach((r) => {
      counts.all++;
      if (!r.year || r.year === currentYear) counts["this-month"]++;
      const type = getEffectiveReleaseType(r);
      counts[type]++;
    });
    return counts;
  }, [releases, currentYear]);

  return (
    <div className="flex flex-col gap-6 p-2 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/30 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {artist?.name ? `${artist.name} - Releases` : "New releases"}
        </h1>

        <div className="flex items-center gap-3">
          {/* Category Filter Pills - separate from search filters */}
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter releases">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === "all"
                  ? "bg-white/20 text-foreground font-bold"
                  : "bg-white/[0.05] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
              )}
            >
              All
              <span className="ml-1.5 tabular-nums opacity-60">{releaseTypeCounts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "this-month"}
              onClick={() => setFilter("this-month")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === "this-month"
                  ? "bg-white/20 text-foreground font-bold"
                  : "bg-white/[0.05] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
              )}
            >
              This Month
              <span className="ml-1.5 tabular-nums opacity-60">{releaseTypeCounts["this-month"]}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "album"}
              onClick={() => setFilter("album")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === "album"
                  ? "bg-white/20 text-foreground font-bold"
                  : "bg-white/[0.05] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
              )}
            >
              Albums
              <span className="ml-1.5 tabular-nums opacity-60">{releaseTypeCounts.album}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "ep"}
              onClick={() => setFilter("ep")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === "ep"
                  ? "bg-white/20 text-foreground font-bold"
                  : "bg-white/[0.05] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
              )}
            >
              EPs
              <span className="ml-1.5 tabular-nums opacity-60">{releaseTypeCounts.ep}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "single"}
              onClick={() => setFilter("single")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === "single"
                  ? "bg-white/20 text-foreground font-bold"
                  : "bg-white/[0.05] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
              )}
            >
              Singles
              <span className="ml-1.5 tabular-nums opacity-60">{releaseTypeCounts.single}</span>
            </button>
          </div>

          {/* Spotify-style View & Sort Dropdown Menu */}
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => {
                setIsSortDropdownOpen((prev) => !prev);
              }}
              className="flex items-center gap-2 rounded-full bg-white/[0.07] px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{sortLabel}</span>
              {viewMode === "grid" ? <GridIcon className="size-3.5 text-muted-foreground" /> : <ListIcon className="size-3.5 text-muted-foreground" />}
              <svg className={cn("size-3.5 text-muted-foreground transition-transform", isSortDropdownOpen && "rotate-180")} viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" />
              </svg>
            </button>

            {isSortDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[190px] rounded-xl border border-border/50 bg-popover/95 p-1.5 shadow-2xl backdrop-blur-md text-popover-foreground">
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Sort by
                </div>
                <button
                  type="button"
                  onClick={() => { setSort("date"); setIsSortDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted",
                    sort === "date" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <span>Release date</span>
                  {sort === "date" && <span className="text-primary text-sm font-bold">↓</span>}
                </button>
                <button
                  type="button"
                  onClick={() => { setSort("title"); setIsSortDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted",
                    sort === "title" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <span>Name</span>
                  {sort === "title" && <CheckIcon size={14} className="text-primary" />}
                </button>

                <div className="my-1.5 border-t border-border/40" />

                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  View as
                </div>
                <button
                  type="button"
                  onClick={() => { setViewMode("list"); setIsSortDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted",
                    viewMode === "list" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ListIcon className="size-4" />
                    <span>List</span>
                  </div>
                  {viewMode === "list" && <CheckIcon size={14} className="text-primary" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setViewMode("grid"); setIsSortDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted",
                    viewMode === "grid" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <GridIcon className="size-4" />
                    <span>Grid</span>
                  </div>
                  {viewMode === "grid" && <CheckIcon size={14} className="text-primary" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading && filteredReleases.length === 0 && (
        <AlbumGridSkeleton label="Loading new releases" />
      )}

      {/* Grid View */}
      {!isLoading && viewMode === "grid" && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
          {filteredReleases.map((release) => {
            const releaseTypeLabel = release.releaseType === "ep" ? "EP" : release.releaseType === "single" ? "Single" : "Album";
            const subtitleText = release.year ? `${release.year} • ${releaseTypeLabel}` : (release.releaseType ? releaseTypeLabel : release.artist);
            return (
              <AlbumCard
                key={release.id}
                artworkUrl={release.artworkUrl}
                title={release.title}
                subtitle={subtitleText}
                onClick={() => onOpenAlbum(release)}
                onContextMenu={(event) => openAlbumMenu(event, release)}
              />
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <div className="flex flex-col gap-2">
          {filteredReleases.map((release, index) => {
            const releaseTypeLabel = release.releaseType === "ep" ? "EP" : release.releaseType === "single" ? "Single" : "Album";
            const subtitleText = release.year ? `${release.year} • ${releaseTypeLabel}` : (release.releaseType ? releaseTypeLabel : release.artist);
            return (
              <div
                key={release.id}
                onClick={() => onOpenAlbum(release)}
                onContextMenu={(event) => openAlbumMenu(event, release)}
                className="group flex items-center justify-between rounded-xl p-2.5 transition-colors hover:bg-card cursor-pointer border border-transparent hover:border-border/40"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="w-6 text-center text-xs tabular-nums text-muted-foreground group-hover:hidden">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    aria-label="Play release"
                    className="hidden size-6 items-center justify-center text-foreground group-hover:flex"
                  >
                    <PlayActiveIcon size={14} />
                  </button>
                  <TrackArtwork
                    artworkUrl={release.artworkUrl}
                    variant="album"
                    size={48}
                    className="size-12 rounded-lg shadow-sm shrink-0"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-sm font-medium text-foreground group-hover:underline">
                      {release.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {subtitleText}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 pr-2">
                  <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider">
                    {releaseTypeLabel}
                  </span>
                  {release.year && <span className="tabular-nums">{release.year}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}