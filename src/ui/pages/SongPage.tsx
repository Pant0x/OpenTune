import { useEffect, useMemo, useState } from "react";
import { cn, formatMinutesSeconds, formatPlayCount } from "@/lib/utils";
import { HeartActiveIcon, HeartIcon } from "@/ui/icons";
import { Tooltip } from "@/components/motion/tooltip";
import { TrackRow } from "../components/TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import type { Album, Artist, Track } from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import { searchController, useLibraryState } from "../../player/playerStore";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { queueDownloads, useOfflineState } from "../../player/offlineStore";
import { ArtistLinks } from "../components/ArtistLinks";
import { MediaHeader } from "../components/MediaHeader";
import { AlbumCard } from "../components/AlbumCard";
import { TrackArtwork } from "../components/TrackArtwork";

interface SongPageProps {
  song?: Track;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenAlbum?: (album: Album) => void;
  onOpenArtist?: (artist: Artist) => void;
  onOpenSong?: (song: Track) => void;
}

export function SongPage({
  song,
  playerController,
  libraryController,
  onOpenAlbum,
  onOpenArtist,
}: SongPageProps) {
  const { openPlaylistPicker } = useTrackContextMenu();
  const {
    currentTrackId,
    isPlaying,
    isLoading: isPlayerLoading,
    playbackOrderMode,
  } = useNowPlaying();

  const [artistDetails, setArtistDetails] = useState<Artist | null>(null);
  const [artistReleases, setArtistReleases] = useState<Album[]>([]);
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [_isLoading, _setIsLoading] = useState(true);

  const isCurrentSong = currentTrackId === song?.id;
  const isCurrentlyPlaying = isCurrentSong && isPlaying;

  const currentSong = song;

  const offlineState = useOfflineState();
  const isDownloaded = Boolean(currentSong?.id && offlineState.entries[currentSong.id]);

  const libraryState = useLibraryState();
  const isLiked = useMemo(() => {
    if (!currentSong?.id || !libraryState.library?.likedSongs) return false;
    return libraryState.library.likedSongs.some((t) => t.id === currentSong.id);
  }, [currentSong?.id, libraryState.library]);
  const [isLiking, setIsLiking] = useState(false);

  const isInvalidArtist = (name?: string) => {
    if (!name) return true;
    const lower = name.trim().toLowerCase();
    if (!lower) return true;
    if (/^\d+$/.test(lower)) return true;
    if (/^(?:19|20)\d{2}$/.test(lower)) return true;
    const generic = new Set(["single", "album", "ep", "video", "unknown artist", "various artists", "unknown", "music", "topic"]);
    return generic.has(lower);
  };

  const rawArtist = currentSong?.artists?.[0]?.name || currentSong?.artist;
  const resolvedArtistName = isInvalidArtist(rawArtist) ? undefined : rawArtist;
  const resolvedArtistId = currentSong?.artists?.[0]?.id;

  // Load artist details, other releases, and related recommendations
  useEffect(() => {
    if (!currentSong) return;
    let active = true;
    _setIsLoading(true);

    const loadSongDetails = async () => {
      try {
        // Fetch related tracks
        const related = await libraryController.getRelated(currentSong).catch(() => []);
        if (active) {
          const flatTracks: Track[] = [];
          for (const shelf of related) {
            if (shelf.tracks?.length) {
              flatTracks.push(...shelf.tracks);
            }
          }
          setRelatedTracks(flatTracks.slice(0, 10));
        }

        // Fetch artist details & discography
        let targetId = resolvedArtistId;
        if (!targetId && resolvedArtistName) {
          try {
            const results = await searchController.search(resolvedArtistName);
            targetId = results.artists[0]?.id;
          } catch {
            // ignore
          }
        }

        if (targetId && active) {
          try {
            const artistPage = await libraryController.getArtist(targetId);
            if (active && artistPage) {
              setArtistDetails(artistPage.artist);
              setArtistReleases(artistPage.releases?.slice(0, 8) ?? []);
            }
          } catch {
            // ignore
          }
        }
      } finally {
        if (active) _setIsLoading(false);
      }
    };

    void loadSongDetails();
    return () => {
      active = false;
    };
  }, [currentSong?.id, resolvedArtistId, resolvedArtistName, libraryController]);

  if (!currentSong) {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
        No song selected.
      </div>
    );
  }

  const handlePlayToggle = () => {
    if (isCurrentSong) {
      void playerController.togglePlayPause();
    } else {
      void playerController.playTrackById(currentSong.id, [currentSong, ...relatedTracks]);
    }
  };

  const handlePlayInLoop = () => {
    playerController.setPlaybackOrderMode("repeat-one");
    void playerController.playTrackById(currentSong.id, [currentSong, ...relatedTracks]);
  };

  const toggleLike = async () => {
    if (!currentSong || isLiking) return;
    setIsLiking(true);
    try {
      await libraryController.setTrackRating(currentSong, isLiked ? "none" : "like");
    } catch {
      // ignore
    } finally {
      setIsLiking(false);
    }
  };

  const releaseTypeLabel = currentSong.releaseType
    ? currentSong.releaseType.toUpperCase()
    : currentSong.album
      ? "ALBUM TRACK"
      : "SINGLE";

  const viewCountDisplay = formatPlayCount(currentSong.viewCount ?? currentSong.viewCountText);
  const durationDisplay = currentSong.durationSec
    ? formatMinutesSeconds(currentSong.durationSec)
    : currentSong.duration || "";

  const metaParts: string[] = [];
  if (currentSong.year || currentSong.releaseDate) {
    metaParts.push(currentSong.year || currentSong.releaseDate || "");
  }
  if (durationDisplay) {
    metaParts.push(durationDisplay);
  }
  if (viewCountDisplay) {
    metaParts.push(viewCountDisplay);
  }

  return (
    <div className="flex flex-col gap-8 pb-16">
      <MediaHeader
        eyebrow={releaseTypeLabel}
        title={currentSong.title}
        subtitle={
          <div className="flex items-center gap-2">
            {artistDetails?.artworkUrl && (
              <button
                type="button"
                className="group/avatar shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => artistDetails && onOpenArtist?.(artistDetails)}
              >
                <TrackArtwork
                  artworkUrl={artistDetails.artworkUrl}
                  size={120}
                  variant="artist"
                  preferProxy
                  className="size-6 rounded-md object-cover transition-opacity group-hover/avatar:opacity-80"
                />
              </button>
            )}
            <ArtistLinks artists={currentSong.artists} fallback={currentSong.artist} />
            {currentSong.album && (
              <>
                <span className="text-muted-foreground">•</span>
                <button
                  type="button"
                  className="truncate text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none"
                  onClick={() => {
                    if (onOpenAlbum) {
                      onOpenAlbum({
                        id: currentSong.albumId || currentSong.album || "",
                        title: currentSong.album || "Album",
                        artist: currentSong.artist,
                        artworkUrl: currentSong.artworkUrl,
                        releaseType: currentSong.releaseType || "album",
                      });
                    }
                  }}
                >
                  {currentSong.album}
                </button>
              </>
            )}
          </div>
        }
        meta={metaParts.join(" • ")}
        artworkUrl={currentSong.artworkUrl}
        artworkVariant="track"
        actionsDisabled={false}
        actions={
          <div className="flex items-center gap-1.5">
            <Tooltip content={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}>
              <button
                type="button"
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isLiked && "text-primary hover:text-primary",
                )}
                onClick={toggleLike}
                aria-pressed={isLiked}
                aria-label={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
              >
                {isLiked ? <HeartActiveIcon size={20} /> : <HeartIcon size={20} />}
              </button>
            </Tooltip>
          </div>
        }
        playback={{
          onToggle: handlePlayToggle,
          isPlaying: isCurrentlyPlaying,
          isLoading: isCurrentSong && isPlayerLoading,
        }}
        loop={{
          onPlay: handlePlayInLoop,
          mode: playbackOrderMode,
        }}
        onAddToQueue={() => {
          playerController.addToQueue(currentSong);
        }}
        onAddToPlaylist={() => {
          openPlaylistPicker(currentSong);
        }}
        download={{
          onStart: () => {
            void queueDownloads([currentSong]);
          },
          counts: {
            downloaded: isDownloaded ? 1 : 0,
            total: 1,
          },
        }}
      />

      {/* Song Metadata Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-md">
        <h3 className="mb-4 text-base font-semibold text-foreground">Song Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</div>
            <div className="mt-1 font-medium text-foreground">{currentSong.title}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Artist</div>
            <div className="mt-1 font-medium text-foreground">{currentSong.artist}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Release Type</div>
            <div className="mt-1 font-medium text-foreground">{releaseTypeLabel}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Duration</div>
            <div className="mt-1 font-medium text-foreground">{durationDisplay || "—"}</div>
          </div>
          {(currentSong.viewCount || currentSong.viewCountText) && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Play / View Count</div>
              <div className="mt-1 font-medium text-foreground">{formatPlayCount(currentSong.viewCount ?? currentSong.viewCountText)}</div>
            </div>
          )}
          {currentSong.album && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Album / Collection</div>
              <div className="mt-1 font-medium text-foreground">{currentSong.album}</div>
            </div>
          )}
        </div>
      </div>

      {/* Related / Next Songs */}
      {relatedTracks.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Related Tracks</h2>
          </div>
          <div className="flex flex-col">
            {relatedTracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                isCurrent={currentTrackId === track.id}
                isPlaying={isPlaying && currentTrackId === track.id}
                onSelect={() => {
                  void playerController.playTrackById(track.id, [track, ...relatedTracks]);
                }}
                onQuickAddToQueue={() => playerController.addToQueue(track)}
                onQuickAdd={() => openPlaylistPicker(track)}
              />
            ))}
          </div>
        </section>
      )}

      {/* More by Artist */}
      {artistReleases.length > 0 && resolvedArtistName && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">
              More by {resolvedArtistName}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {artistReleases.map((rel) => (
              <AlbumCard
                key={rel.id}
                artworkUrl={rel.artworkUrl}
                title={rel.title}
                subtitle={rel.year ? `${rel.year} • ${rel.releaseType === "ep" ? "EP" : rel.releaseType === "single" ? "Single" : "Album"}` : rel.artist}
                onClick={() => onOpenAlbum?.(rel)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
