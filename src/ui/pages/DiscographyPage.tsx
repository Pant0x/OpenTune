import { useState, useMemo, useRef, useEffect } from "react";
import type { Album, Artist } from "../../datasource/types";
import { AlbumCard } from "../components/AlbumCard";
import { TrackArtwork } from "../components/TrackArtwork";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { CheckIcon, PlayActiveIcon } from "@/ui/icons";
import { cn } from "@/lib/utils";

// Grid icon (4 squares)
function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4", className)} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z" />
    </svg>
  );
}

// List icon (3 horizontal lines with bullets)
function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4", className)} viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
}

export function DiscographyPage({
  artist,
  releases,
  onOpenAlbum,
}: {
  artist?: Artist;
  releases?: Album[];
  onOpenAlbum: (album: Album) => void;
}) {
  const [filter, setFilter] = useState<"all" | "album" | "singles_eps">("all");
  const [sort, setSort] = useState<"date" | "title">("date");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

  const filterRef = useRef<HTMLDivElement | null>(null);
  const sortRef = useRef<HTMLDivElement | null>(null);
  const { openAlbumMenu } = usePlaylistContextMenu();

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const filteredReleases = useMemo(() => {
    let list = (releases ?? []).slice();
    if (filter === "album") {
      list = list.filter((r) => r.releaseType === "album");
    } else if (filter === "singles_eps") {
      list = list.filter((r) => r.releaseType === "single" || r.releaseType === "ep");
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
  }, [releases, filter, sort]);

  const filterLabel = filter === "album" ? "Albums" : filter === "singles_eps" ? "Singles and EPs" : "All";
  const sortLabel = sort === "date" ? "Release date" : "Name";

  return (
    <div className="flex flex-col gap-6 p-2 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/30 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{artist?.name || "Discography"}</h1>

        <div className="flex items-center gap-3">
          {/* Category Filter Dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => {
                setIsFilterDropdownOpen((prev) => !prev);
                setIsSortDropdownOpen(false);
              }}
              className="flex items-center gap-2 rounded-full bg-white/[0.07] px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{filterLabel}</span>
              <svg className={cn("size-3.5 text-muted-foreground transition-transform", isFilterDropdownOpen && "rotate-180")} viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" />
              </svg>
            </button>

            {isFilterDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[170px] rounded-xl border border-white/10 bg-[#1e1e1e]/95 p-1.5 shadow-2xl backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => { setFilter("all"); setIsFilterDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
                    filter === "all" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <span>All</span>
                  {filter === "all" && <CheckIcon size={14} className="text-primary" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setFilter("album"); setIsFilterDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
                    filter === "album" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <span>Albums</span>
                  {filter === "album" && <CheckIcon size={14} className="text-primary" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setFilter("singles_eps"); setIsFilterDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
                    filter === "singles_eps" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <span>Singles and EPs</span>
                  {filter === "singles_eps" && <CheckIcon size={14} className="text-primary" />}
                </button>
              </div>
            )}
          </div>

          {/* Sort & View Dropdown Menu matching Image 3 */}
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => {
                setIsSortDropdownOpen((prev) => !prev);
                setIsFilterDropdownOpen(false);
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
              <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[190px] rounded-xl border border-white/10 bg-[#1e1e1e]/95 p-1.5 shadow-2xl backdrop-blur-md">
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Sort by
                </div>
                <button
                  type="button"
                  onClick={() => { setSort("date"); setIsSortDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
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
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
                    sort === "title" ? "text-primary font-semibold" : "text-foreground"
                  )}
                >
                  <span>Name</span>
                  {sort === "title" && <CheckIcon size={14} className="text-primary" />}
                </button>

                <div className="my-1.5 border-t border-white/10" />

                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  View as
                </div>
                <button
                  type="button"
                  onClick={() => { setViewMode("list"); setIsSortDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
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
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/10",
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

      {/* Grid View */}
      {viewMode === "grid" && (
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
