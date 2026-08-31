import { useState, useMemo } from "react";
import type { Album, Artist } from "../../datasource/types";
import { AlbumCard } from "../components/AlbumCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";

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
  const { openAlbumMenu } = usePlaylistContextMenu();

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

  return (
    <div className="flex flex-col gap-6 p-1 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{artist?.name || "Discography"}</h1>
        <div className="flex items-center gap-3">
          <Select value={filter} onValueChange={(val) => setFilter(val as any)}>
            <SelectTrigger className="h-8 min-w-[120px] gap-2 rounded-full bg-white/[0.06] px-3.5 text-xs font-medium text-foreground hover:bg-white/[0.1] border-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[150px]">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="album">Albums</SelectItem>
              <SelectItem value="singles_eps">Singles and EPs</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(val) => setSort(val as any)}>
            <SelectTrigger className="h-8 min-w-[120px] gap-2 rounded-full bg-white/[0.06] px-3.5 text-xs font-medium text-foreground hover:bg-white/[0.1] border-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[150px]">
              <SelectItem value="date">Release date</SelectItem>
              <SelectItem value="title">Alphabetical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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
    </div>
  );
}
