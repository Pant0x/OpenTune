import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, ArrowRightIcon, MenuDotsIcon, PauseActiveIcon, PlayActiveIcon } from "@/ui/icons";
import type { Album, Artist, BrowseLink, BrowseShelf, Playlist, Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import { AlbumCard } from "./AlbumCard";
import { TrackArtwork } from "./TrackArtwork";
import { TrackRow } from "./TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "./PlaylistContextMenu";
import { useTrackContextMenu } from "./TrackContextMenu";
import { playerUIStore } from "../stores/playerUIStore";

function VideoCard({
  track,
  isPlaying,
  isCurrent,
  onSelect,
  onContextMenu,
}: {
  track: Track;
  isPlaying: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const formattedDuration = useMemo(() => {
    if (!track.durationSec || track.durationSec <= 0) return null;
    const hours = Math.floor(track.durationSec / 3600);
    const mins = Math.floor((track.durationSec % 3600) / 60);
    const secs = Math.floor(track.durationSec % 60);
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, [track.durationSec]);

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className="group relative flex flex-col gap-2 rounded-2xl p-2 cursor-pointer transition-all hover:bg-card/70 hover:scale-[1.01] active:scale-[0.99] select-none"
      role="button"
      tabIndex={0}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-card shadow-md ring-1 ring-white/5">
        <TrackArtwork
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          artworkUrl={track.artworkUrl}
          size={500}
          iconSize={48}
        />
        <div className="absolute inset-0 bg-black/25 group-hover:bg-black/45 transition-colors flex items-center justify-center">
          <div className="size-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 group-hover:scale-105 active:scale-95 transition-all">
            {isPlaying && isCurrent ? (
              <PauseActiveIcon size={20} />
            ) : (
              <PlayActiveIcon size={20} className="translate-x-0.5" />
            )}
          </div>
        </div>

        {formattedDuration && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/80 backdrop-blur-xs px-2 py-0.5 text-[11px] font-mono font-semibold text-white/90 shadow-sm">
            {formattedDuration}
          </div>
        )}

        {onContextMenu && (
          <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              aria-label={`Options for ${track.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu(e);
              }}
              className="flex size-7 items-center justify-center rounded-full bg-black/70 hover:bg-black/90 text-white/90 hover:text-white shadow-md backdrop-blur-sm transition-all hover:scale-110 active:scale-95 cursor-pointer"
            >
              <MenuDotsIcon size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col min-w-0 px-0.5">
        <span className="text-sm sm:text-base font-bold text-foreground tracking-tight line-clamp-1 group-hover:text-primary transition-colors">
          {track.title}
        </span>
        <span className="text-xs sm:text-sm text-muted-foreground line-clamp-1 mt-0.5">
          {track.artist}
        </span>
      </div>
    </div>
  );
}

function ArtistTile({ artist, onOpen }: { artist: Artist; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-36 shrink-0 flex-col items-center gap-2.5 rounded-2xl p-3 text-center transition-all hover:bg-card hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TrackArtwork
        className="size-28 rounded-full shadow-md transition-transform group-hover:scale-105"
        size={112}
        artworkUrl={artist.artworkUrl}
        iconSize={32}
        variant="artist"
      />
      <span className="line-clamp-2 text-xs font-semibold text-foreground tracking-tight">{artist.name}</span>
    </button>
  );
}

function PlaylistTile({
  playlist,
  onOpen,
  onContextMenu,
}: {
  playlist: Playlist;
  onOpen: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="group relative flex w-40 shrink-0 flex-col gap-2 rounded-2xl p-2.5 text-left transition-all hover:bg-card hover:scale-[1.02] active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="button"
      tabIndex={0}
    >
      <div className="relative overflow-hidden rounded-xl shadow-md">
        <TrackArtwork
          className="size-36 rounded-xl object-cover transition-transform group-hover:scale-105"
          size={144}
          artworkUrl={playlist.artworkUrl}
          iconSize={32}
          variant="playlist"
        />
        {onContextMenu && (
          <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              aria-label={`Options for ${playlist.title || "playlist"}`}
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu(e);
              }}
              className="flex size-8 items-center justify-center rounded-full bg-black/70 hover:bg-black/90 text-white/90 hover:text-white shadow-lg backdrop-blur-sm transition-all hover:scale-110 active:scale-95 cursor-pointer"
            >
              <MenuDotsIcon size={16} />
            </button>
          </div>
        )}
      </div>
      <span className="line-clamp-2 text-xs font-semibold text-foreground tracking-tight">{playlist.title}</span>
      {playlist.owner ? (
        <span className="line-clamp-1 text-[11px] text-muted-foreground">{playlist.owner}</span>
      ) : null}
    </div>
  );
}

function BrowseShelfSection({
  shelf,
  playerController,
  currentTrackId,
  isPlaying,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onFollowLink,
  onOpenReleases,
  onOpenTrending,
}: {
  shelf: BrowseShelf;
  playerController: PlayerControllerActions;
  currentTrackId: string | null;
  isPlaying: boolean;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onFollowLink?: (link: BrowseLink) => void;
  onOpenReleases?: () => void;
  onOpenTrending?: () => void;
}) {
  const { openTrackMenu } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<HTMLDivElement>(null);
  const artistsScrollRef = useRef<HTMLDivElement>(null);

  const isVideoShelf =
    shelf.title.toLowerCase().includes("music video") ||
    shelf.title.toLowerCase().includes("live performance") ||
    shelf.title.toLowerCase().includes("live concert") ||
    shelf.title.toLowerCase().includes("podcast") ||
    shelf.title.toLowerCase().includes("episode") ||
    shelf.title.toLowerCase().includes("بودكاست") ||
    shelf.title.toLowerCase().includes("حلقات") ||
    (shelf.tracks.length > 0 && shelf.tracks.every((t) => t.isVideo));

  const scrollTracks = (direction: "left" | "right") => {
    if (!tracksScrollRef.current) return;
    const distance = isVideoShelf
      ? (direction === "left" ? -tracksScrollRef.current.clientWidth : tracksScrollRef.current.clientWidth)
      : (direction === "left" ? -480 : 480);
    tracksScrollRef.current.scrollBy({ left: distance, behavior: "smooth" });
  };

  const scrollCards = (direction: "left" | "right") => {
    if (!cardsScrollRef.current) return;
    const distance = direction === "left" ? -480 : 480;
    cardsScrollRef.current.scrollBy({ left: distance, behavior: "smooth" });
  };

  const scrollArtists = (direction: "left" | "right") => {
    if (!artistsScrollRef.current) return;
    const distance = direction === "left" ? -480 : 480;
    artistsScrollRef.current.scrollBy({ left: distance, behavior: "smooth" });
  };

  const playShelfTrack = (shelfTracks: Track[], track: Track) => {
    void playerController.playTrackById(track.id, shelfTracks, true);
    if (isVideoShelf || track.isVideo) {
      playerUIStore.setLyricsMediaMode("video");
      playerUIStore.setLyricsOpen(true);
      playerUIStore.setNowPlayingFullscreen(false);
    }
  };

  const hasTracks = shelf.tracks.length > 0;
  const cardsCount = shelf.playlists.length + shelf.albums.length;
  const hasCards = cardsCount > 0;
  const hasArtists = shelf.artists.length > 0;

  const hasMultipleTrackItems = isVideoShelf ? shelf.tracks.length > 2 : shelf.tracks.length > 4;
  const hasMultipleCardItems = cardsCount > 4;
  const hasMultipleArtistItems = shelf.artists.length > 4;

  const isLongListens = shelf.title.toLowerCase().includes("long listen");

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          {shelf.title.toLowerCase().includes("new release") && onOpenReleases ? (
            <button
              type="button"
              onClick={onOpenReleases}
              className="group/title flex items-center gap-2 text-left transition hover:opacity-80 focus-visible:outline-none cursor-pointer"
            >
              <h2 className="text-xl font-bold text-foreground tracking-tight group-hover/title:underline">
                {shelf.title}
              </h2>
              <ArrowRightIcon size={16} className="text-muted-foreground group-hover/title:text-foreground transition-transform group-hover/title:translate-x-0.5" />
            </button>
          ) : (shelf.title.toLowerCase().includes("trending") && onOpenTrending) ? (
            <button
              type="button"
              onClick={onOpenTrending}
              className="group/title flex items-center gap-2 text-left transition hover:opacity-80 focus-visible:outline-none cursor-pointer"
            >
              <h2 className="text-xl font-bold text-foreground tracking-tight group-hover/title:underline">
                {shelf.title}
              </h2>
              <ArrowRightIcon size={16} className="text-muted-foreground group-hover/title:text-foreground transition-transform group-hover/title:translate-x-0.5" />
            </button>
          ) : (
            <h2 className="text-xl font-bold text-foreground tracking-tight">{shelf.title}</h2>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasTracks && (
            <button
              type="button"
              onClick={() => playShelfTrack(shelf.tracks, shelf.tracks[0])}
              className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium text-foreground transition-all hover:bg-muted hover:scale-105 active:scale-95 border border-border/40 cursor-pointer"
            >
              <PlayActiveIcon size={14} className="text-primary" />
              <span>Play all</span>
            </button>
          )}

          {hasTracks ? (
            hasMultipleTrackItems && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Scroll left"
                  onClick={() => scrollTracks("left")}
                  className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                >
                  <ArrowLeftIcon size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Scroll right"
                  onClick={() => scrollTracks("right")}
                  className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                >
                  <ArrowRightIcon size={14} />
                </button>
              </div>
            )
          ) : hasCards ? (
            hasMultipleCardItems && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Scroll left"
                  onClick={() => scrollCards("left")}
                  className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                >
                  <ArrowLeftIcon size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Scroll right"
                  onClick={() => scrollCards("right")}
                  className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                >
                  <ArrowRightIcon size={14} />
                </button>
              </div>
            )
          ) : hasArtists ? (
            hasMultipleArtistItems && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Scroll left"
                  onClick={() => scrollArtists("left")}
                  className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                >
                  <ArrowLeftIcon size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Scroll right"
                  onClick={() => scrollArtists("right")}
                  className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                >
                  <ArrowRightIcon size={14} />
                </button>
              </div>
            )
          ) : null}
        </div>
      </div>

      {hasTracks && (
        isVideoShelf ? (
          <div
            ref={tracksScrollRef}
            className="flex gap-4 sm:gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory"
          >
            {shelf.tracks.map((track, index) => (
              <div
                key={`${track.id}:${index}`}
                className="w-[calc(50%-10px)] min-w-[280px] max-w-[560px] shrink-0 snap-start"
              >
                <VideoCard
                  track={track}
                  isPlaying={isPlaying && currentTrackId === track.id}
                  isCurrent={currentTrackId === track.id}
                  onSelect={() => playShelfTrack(shelf.tracks, track)}
                  onContextMenu={(event) => openTrackMenu(event, track)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div
            ref={tracksScrollRef}
            className={cn(
              shelf.tracks.length >= 4
                ? "grid grid-rows-4 grid-flow-col auto-cols-[280px] sm:auto-cols-[320px] md:auto-cols-[350px] gap-x-5 gap-y-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory"
                : "flex flex-col gap-1 max-w-2xl",
            )}
          >
            {shelf.tracks.map((track, index) => (
              <div
                key={`${track.id}:${index}`}
                className={cn(
                  shelf.tracks.length >= 4
                    ? "w-[280px] sm:w-[320px] md:w-[350px] shrink-0 snap-start"
                    : "w-full",
                )}
              >
                <TrackRow
                  track={track}
                  index={index}
                  showIndex={false}
                  isCurrent={currentTrackId === track.id}
                  isPlaying={isPlaying && currentTrackId === track.id}
                  onSelect={() => playShelfTrack(shelf.tracks, track)}
                  onContextMenu={(event) => openTrackMenu(event, track)}
                  showRating
                  trailing={
                    isLongListens && track.durationSec && track.durationSec > 0 ? (
                      <span className="text-xs font-mono font-medium text-muted-foreground/80 tabular-nums pr-1">
                        {Math.floor(track.durationSec / 3600) > 0
                          ? `${Math.floor(track.durationSec / 3600)}:${Math.floor((track.durationSec % 3600) / 60).toString().padStart(2, "0")}:${Math.floor(track.durationSec % 60).toString().padStart(2, "0")}`
                          : `${Math.floor(track.durationSec / 60)}:${Math.floor(track.durationSec % 60).toString().padStart(2, "0")}`}
                      </span>
                    ) : undefined
                  }
                />
              </div>
            ))}
          </div>
        )
      )}

      {onFollowLink && shelf.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shelf.links.map((link) => (
            <button
              key={link.browseId}
              type="button"
              onClick={() => onFollowLink(link)}
              className="rounded-full bg-card px-3.5 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-muted hover:scale-105 active:scale-95 border border-border/40"
            >
              {link.title}
            </button>
          ))}
        </div>
      )}

      {hasCards && (
        <div className="flex flex-col gap-2">
          {hasTracks && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-semibold text-muted-foreground">Playlists & albums</span>
              {hasMultipleCardItems && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Scroll playlists left"
                    onClick={() => scrollCards("left")}
                    className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                  >
                    <ArrowLeftIcon size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Scroll playlists right"
                    onClick={() => scrollCards("right")}
                    className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 border border-border/40 cursor-pointer"
                  >
                    <ArrowRightIcon size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            ref={cardsScrollRef}
            className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory"
          >
            {shelf.playlists.map((playlist) => (
              <div
                key={playlist.id}
                className="w-40 shrink-0 snap-start"
              >
                <PlaylistTile
                  playlist={playlist}
                  onOpen={() => onOpenPlaylist(playlist)}
                  onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                />
              </div>
            ))}
            {shelf.albums.map((album) => {
              const releaseLabel = album.releaseType === "ep" ? "EP" : album.releaseType === "single" ? "Single" : "Album";
              return (
                <div
                  key={album.id}
                  className="w-40 shrink-0 snap-start"
                  onContextMenu={(event) => openAlbumMenu(event, album)}
                >
                  <AlbumCard
                    artworkUrl={album.artworkUrl}
                    title={album.title}
                    subtitleContent={
                      album.artist ? (
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          <span>{releaseLabel}</span>
                          <span>•</span>
                          {(album.artists && album.artists.length > 0
                            ? album.artists
                            : album.artist.split(",").map((n) => ({ id: "", name: n.trim() })).filter((a) => a.name.length > 0)
                          ).map((art, idx, arr) => (
                            <span key={`${art.name}:${idx}`} className="inline-flex items-center">
                              <span
                                role="link"
                                tabIndex={0}
                                className="cursor-pointer hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenArtist({
                                    id: art.id ?? "",
                                    name: art.name,
                                  });
                                }}
                              >
                                {art.name}
                              </span>
                              {idx < arr.length - 1 && <span className="mr-1">,</span>}
                            </span>
                          ))}
                        </span>
                      ) : undefined
                    }
                    onClick={() => onOpenAlbum(album)}
                    onContextMenu={(event) => openAlbumMenu(event, album)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasArtists && (
        <div
          ref={artistsScrollRef}
          className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory"
        >
          {shelf.artists.map((artist) => (
            <div key={artist.id} className="snap-start">
              <ArtistTile artist={artist} onOpen={() => onOpenArtist(artist)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Renders browse shelves with responsive Spotify/YT Music styling, Play all, and scroll arrows.
 */
export function BrowseShelves({
  shelves,
  playerController,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onFollowLink,
  onOpenReleases,
  onOpenTrending,
  className,
}: {
  shelves: readonly BrowseShelf[];
  playerController: PlayerControllerActions;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** Absent hides the chips: a surface with nowhere to drill into should not offer to. */
  onFollowLink?: (link: BrowseLink) => void;
  onOpenReleases?: () => void;
  onOpenTrending?: () => void;
  className?: string;
}) {
  const { currentTrackId, isPlaying } = useNowPlaying();

  return (
    <div className={cn("flex flex-col gap-10", className)}>
      {shelves.map((shelf) => (
        <BrowseShelfSection
          key={shelf.title}
          shelf={shelf}
          playerController={playerController}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          onOpenPlaylist={onOpenPlaylist}
          onFollowLink={onFollowLink}
          onOpenReleases={onOpenReleases}
          onOpenTrending={onOpenTrending}
        />
      ))}
    </div>
  );
}
