import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, HeartActiveIcon, HeartIcon, SearchIcon } from "@/ui/icons";
import { Tooltip } from "@/components/motion/tooltip";
import { TrackRow } from "../components/TrackRow";
import { TrackListSkeleton } from "../components/Skeleton";
import { useNowPlaying } from "../hooks/useNowPlaying";
import type { Album, Artist, Track } from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import { searchController, useLibraryState } from "../../player/playerStore";
import { shuffleTracks } from "../../player/shuffleTracks";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { SelectionBar } from "../components/SelectionBar";
import { useTrackSelection } from "../hooks/useTrackSelection";
import { queueDownloads, useOfflineState } from "../../player/offlineStore";
import { ArtistLinks } from "../components/ArtistLinks";
import { formatCollectionMeta, MediaHeader } from "../components/MediaHeader";
import { useKeyboardShortcuts } from "../settings/keyboardShortcuts";
import { shouldStartPageSearch } from "./pageSearchKeyboard";
import { AlbumCard } from "../components/AlbumCard";
import { TrackArtwork } from "../components/TrackArtwork";

const SEARCH_FIELD =
  "group/search flex min-h-8 items-center gap-1.5 overflow-hidden rounded-full bg-white/[0.04] px-2.5 " +
  "text-muted-foreground transition-[width,background-color] duration-200 cursor-text " +
  "hover:bg-white/[0.08] focus-within:bg-white/[0.08] focus-within:text-foreground " +
  "[&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-sm " +
  "[&_input]:text-foreground [&_input]:outline-none [&_input]:placeholder:text-muted-foreground";
const SEARCH_FIELD_COLLAPSED = "w-9 hover:w-56 focus-within:w-56";

import { formatCompactNumber } from "@/lib/utils";

interface AlbumViewProps {
  album?: Album;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenAlbum?: (album: Album) => void;
  onOpenArtist?: (artist: Artist) => void;
  onOpenDiscography?: (artist: Artist, releases?: Album[]) => void;
}

function getTrackRenderKey(track: Track, index: number): string {
  return track.playlistItemId ?? `${track.id}:${index}`;
}

export function AlbumView({
  album,
  playerController,
  libraryController,
  onOpenAlbum,
  onOpenArtist,
  onOpenDiscography,
}: AlbumViewProps) {
  const { openPlaylistPicker, openTrackMenu } = useTrackContextMenu();
  const keyboardShortcuts = useKeyboardShortcuts();
  const {
    currentTrackId,
    isPlaying,
    isLoading: isPlayerLoading,
    playbackOrderMode,
  } = useNowPlaying();
  const [tracks, setTracks] = useState<Track[]>([]);
  /*
   * Derived from the offline store so the header button can say what pressing it would do.
   * Recomputed from entries rather than tracked separately: a count kept in parallel with the
   * store is a count that drifts the moment a download finishes elsewhere.
   */
  const offlineState = useOfflineState();
  const downloadCounts = useMemo(
    () => ({
      downloaded: tracks.filter((track) => Boolean(offlineState.entries[track.id])).length,
      total: tracks.length,
    }),
    [tracks, offlineState.entries],
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumSearchQuery, setAlbumSearchQuery] = useState("");
  const [moreReleases, setMoreReleases] = useState<Album[]>([]);
  const [artistDetails, setArtistDetails] = useState<Artist | null>(null);
  const albumSearchInputRef = useRef<HTMLInputElement | null>(null);

  const isInvalidArtist = (name?: string) => {
    if (!name) return true;
    const trimmed = name.trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    // Pure numbers or years
    if (/^\d+$/.test(lower)) return true;
    if (/\b(?:19|20)\d{2}\b/.test(lower) && !/[a-zA-Z]{3,}/.test(lower)) return true;
    // Release metadata strings e.g. "2025 • Album", "2024 • Single", "Album • 2025"
    if (/[•·]/.test(lower) && /\b(?:19|20)\d{2}|album|single|ep|songs?|tracks?|release\b/i.test(lower)) return true;
    // Generic words
    const generic = new Set([
      "single", "album", "ep", "video", "unknown artist", "various artists",
      "unknown", "music", "topic", "artist", "release", "track", "audio", "various"
    ]);
    if (generic.has(lower)) return true;
    if (/^(?:album|single|ep|song|video|audio|artist)\s*[•·-]\s*(?:19|20)\d{2}$/i.test(lower)) return true;
    if (/^(?:19|20)\d{2}\s*[•·-]\s*(?:album|single|ep|song|video|audio|artist)$/i.test(lower)) return true;
    return false;
  };

  const trackArtist = tracks.find((t) => !isInvalidArtist(t.artists?.[0]?.name))?.artists?.[0]?.name
    || tracks.find((t) => !isInvalidArtist(t.artist))?.artist;

  const titleArtistMatch = album?.title ? album.title.match(/^([A-Za-z0-9\s_-]+?)(?:\s+(?:vol\.?|part|pt\.?|\d+))?$/i) : null;
  const inferredArtistFromTitle = (titleArtistMatch && titleArtistMatch[1] && !/^(?:album|single|ep|deluxe|remix|greatest hits|soundtrack|live)$/i.test(titleArtistMatch[1].trim()))
    ? titleArtistMatch[1].trim()
    : undefined;

  const rawArtistName = !isInvalidArtist(album?.artists?.[0]?.name)
    ? album?.artists?.[0]?.name
    : !isInvalidArtist(album?.artist)
      ? album?.artist
      : (inferredArtistFromTitle && !isInvalidArtist(inferredArtistFromTitle) && inferredArtistFromTitle.toLowerCase() !== album?.title.toLowerCase())
        ? inferredArtistFromTitle
        : trackArtist;

  const resolvedArtistName = isInvalidArtist(rawArtistName) ? undefined : rawArtistName;
  const albumMainArtistId = (album?.artists?.[0]?.name && !isInvalidArtist(album.artists[0].name) && album.artists[0].name === resolvedArtistName)
    ? album.artists[0].id
    : undefined;
  const resolvedArtistId = albumMainArtistId || undefined;
  const displayArtistName = (artistDetails?.name && !isInvalidArtist(artistDetails.name))
    ? artistDetails.name
    : (resolvedArtistName && !isInvalidArtist(resolvedArtistName))
      ? resolvedArtistName
      : undefined;

  // Reset album state when navigating between albums
  useEffect(() => {
    setArtistDetails(null);
    setMoreReleases([]);
    setTracks([]);
    setIsLoading(true);
    setError(null);
    setAlbumSearchQuery("");
  }, [album?.id]);

  useEffect(() => {
    if (!resolvedArtistName && !resolvedArtistId) {
      setMoreReleases([]);
      setArtistDetails(null);
      return;
    }
    let active = true;
    const fetchArtistData = async () => {
      let targetId = resolvedArtistId;
      if (!targetId && resolvedArtistName) {
        try {
          const searchResults = await searchController.search(resolvedArtistName);
          targetId = searchResults.artists[0]?.id;
        } catch {
          // ignore
        }
      }
      if (!targetId && !resolvedArtistName) return;

      try {
        const artistPage = targetId
          ? await libraryController.getArtist(targetId)
          : null;
        if (!active) return;
        if (artistPage && !isInvalidArtist(artistPage.artist.name)) {
          setArtistDetails(artistPage.artist);
          const otherReleases = (artistPage.releases ?? []).filter((r) => r.id !== album?.id);
          setMoreReleases(otherReleases.slice(0, 10));
        }
      } catch {
        // ignore
      }
    };
    void fetchArtistData();
    return () => {
      active = false;
    };
  }, [resolvedArtistId, resolvedArtistName, album?.id, tracks.length > 0 ? tracks[0]?.artist : "", libraryController]);

  useEffect(() => {
    if (!album) return;
    let active = true;
    setTracks([]);
    setAlbumSearchQuery("");
    setIsLoading(true);
    setError(null);
    let showedTracks = false;
    const applyAlbumMeta = (items: Track[]) =>
      items.map((t) => ({
        ...t,
        album: album.title || t.album,
        albumId: album.id || t.albumId,
        artworkUrl: album.artworkUrl || t.artworkUrl,
      }));

    void libraryController.getAlbumTracks(album, (updatedTracks) => {
      if (!active) return;
      const formatted = applyAlbumMeta(updatedTracks);
      showedTracks = formatted.length > 0;
      setTracks(formatted);
      if (formatted.length > 0) setIsLoading(false);
    })
      .then((items) => {
        if (!active) return;
        showedTracks = true;
        setTracks(applyAlbumMeta(items));
      })
      .catch(() => {
        if (active && !showedTracks) setError("Unable to load this album.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [album, libraryController]);

  const visibleTracks = useMemo(() => {
    const query = albumSearchQuery.trim().toLocaleLowerCase();
    if (!query) return tracks;
    return tracks.filter((track) => [
      track.title,
      track.artist,
      track.album,
      ...(track.artists?.map((artist) => artist.name) ?? []),
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [albumSearchQuery, tracks]);

  useEffect(() => {
    if (!album || isLoading || error || tracks.length === 0) return;

    const handlePageSearchKeyDown = (event: KeyboardEvent) => {
      if (!shouldStartPageSearch(event, keyboardShortcuts)) return;
      event.preventDefault();
      setAlbumSearchQuery((current) => `${current}${event.key}`);
      window.requestAnimationFrame(() => albumSearchInputRef.current?.focus());
    };

    window.addEventListener("keydown", handlePageSearchKeyDown);
    return () => window.removeEventListener("keydown", handlePageSearchKeyDown);
  }, [album, error, isLoading, keyboardShortcuts, tracks.length]);

  if (!album) return null;


  const trackIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks]);
  const isCurrentCollection = currentTrackId !== null && trackIds.has(currentTrackId);

  const togglePlayCollection = () => {
    if (isCurrentCollection) {
      playerController.togglePlayPause();
      return;
    }
    playInOrder();
  };

  const playInOrder = () => {
    const firstTrack = tracks[0];
    if (firstTrack) void playerController.playTrackById(firstTrack.id, tracks);
  };

  /*
   * Order is set before playback starts, not after: playTrackById resolves asynchronously,
   * and a mode applied afterwards can lose a race with a track that ends almost immediately.
   */
  const selection = useTrackSelection(visibleTracks);

  const playInLoop = () => {
    const firstTrack = tracks[0];
    if (!firstTrack) return;
    playerController.setPlaybackOrderMode("repeat-all");
    void playerController.playTrackById(firstTrack.id, tracks);
  };

  /*
   * Queued in album order with shuffle switched on afterwards, not pre-shuffled — so the player
   * bar's toggle reflects reality, and turning shuffle off restores the album's real running
   * order rather than treating the shuffle as the original.
   */
  const playShuffled = async () => {
    const firstTrack = shuffleTracks(tracks)[0];
    if (!firstTrack) return;
    const started = await playerController.playTrackById(firstTrack.id, tracks, false, true);
    if (!started) return;
    playerController.setShuffleEnabled(true);
  };

  const handleAlbumSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Backspace" || albumSearchQuery) return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const libraryState = useLibraryState();
  const isSaved = useMemo(() => {
    if (!album || !libraryState.library) return false;
    const sameAlbum = (item: Album) =>
      item.id === album.id
      || Boolean(album.playlistId && item.playlistId === album.playlistId)
      || Boolean(album.playlistId && item.id === album.playlistId)
      || Boolean(item.playlistId && item.playlistId === album.id);
    return libraryState.library.albums.some(sameAlbum);
  }, [album, libraryState.library]);
  const [isSaving, setIsSaving] = useState(false);

  const toggleSaveAlbum = async () => {
    if (!album || isSaving) return;
    setIsSaving(true);
    try {
      await libraryController.setAlbumSaved(album, !isSaved);
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
    }
  };

  const releaseTypeLabel = album.releaseType
    ? album.releaseType.toUpperCase()
    : tracks.length === 1
      ? "SINGLE"
      : tracks.length > 1 && tracks.length <= 6
        ? "EP"
        : "ALBUM";

  return (
    <div className="flex flex-col gap-8 pb-16">
      <MediaHeader
        eyebrow={album.year ? `${releaseTypeLabel} • ${album.year}` : releaseTypeLabel}
        title={album.title}
        subtitle={
          <ArtistLinks
            artists={
              album.artists?.filter((a) => !isInvalidArtist(a.name))?.length
                ? album.artists.filter((a) => !isInvalidArtist(a.name))
                : displayArtistName
                  ? [{ id: resolvedArtistId || "", name: displayArtistName }]
                  : undefined
            }
            fallback={displayArtistName || (!isInvalidArtist(album.artist) ? album.artist : undefined)}
          />
        }
        meta={formatCollectionMeta(tracks)}
        artworkUrl={album.artworkUrl || tracks[0]?.artworkUrl}
        artworkVariant="album"
        actionsDisabled={isLoading || Boolean(error) || tracks.length === 0}
        actions={
          <Tooltip content={isSaved ? "Remove from library" : "Save to library"}>
            <button
              type="button"
              onClick={() => void toggleSaveAlbum()}
              disabled={isSaving}
              aria-label={isSaved ? "Remove album from library" : "Save album to library"}
              className={cn(
                "grid size-9 place-items-center rounded-full transition-all active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSaved
                  ? "text-primary bg-primary/10 hover:bg-primary/20"
                  : "text-muted-foreground hover:bg-card hover:text-foreground",
              )}
            >
              {isSaved ? <HeartActiveIcon size={20} /> : <HeartIcon size={20} />}
            </button>
          </Tooltip>
        }
        playback={{
          onToggle: togglePlayCollection,
          isPlaying: isCurrentCollection && isPlaying,
          isLoading: isCurrentCollection && isPlayerLoading,
        }}
        onShuffle={() => void playShuffled()}
        loop={{
          onPlay: playInLoop,
          onCycle: () => playerController.setPlaybackOrderMode(
            playbackOrderMode === "repeat-all" ? "repeat-one" : "in-order",
          ),
          mode: isCurrentCollection ? playbackOrderMode : "in-order",
        }}
        onAddToQueue={() => playerController.addTracksToQueue(tracks)}
        onAddToPlaylist={() => openPlaylistPicker(tracks[0], tracks)}
        download={{ onStart: () => queueDownloads(tracks), counts: downloadCounts }}
      />
      {error && <p className="px-2 py-10 text-center text-sm text-muted-foreground">{error}</p>}
      {/*
       * The toolbar stands apart from the loading state below it: it doesn't depend on the
       * tracks being in yet, and hiding it behind the skeleton would make every album page
       * flash the search field in only once songs had already arrived.
       */}
      {!error && (isLoading || tracks.length > 0) && (
        <>
          <div
            className="flex flex-wrap items-center gap-1.5 self-start [&>button]:flex [&>button]:min-h-8 [&>button]:min-w-0 [&>button]:items-center [&>button]:justify-center [&>button]:gap-1.5 [&>button]:rounded-full [&>button]:bg-white/[0.04] [&>button]:px-3 [&>button]:text-sm [&>button]:font-medium [&>button]:text-muted-foreground [&>button]:transition-colors hover:[&>button]:bg-white/[0.08] hover:[&>button]:text-foreground focus-visible:[&>button]:outline-none focus-visible:[&>button]:ring-2 focus-visible:[&>button]:ring-ring"
            role="group"
            aria-label="Album song tools"
          >
            <div
              className={cn(SEARCH_FIELD, albumSearchQuery ? "w-56" : SEARCH_FIELD_COLLAPSED)}
              role="search"
              onClick={() => albumSearchInputRef.current?.focus()}
            >
              <span className="shrink-0">
                <SearchIcon size={16} aria-hidden="true" />
              </span>
              <input
                ref={albumSearchInputRef}
                type="text"
                value={albumSearchQuery}
                aria-label="Search songs in album"
                placeholder="Search album"
                onChange={(event) => setAlbumSearchQuery(event.target.value)}
                onKeyDown={handleAlbumSearchKeyDown}
              />
              {albumSearchQuery && (
                <button
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  aria-label="Clear album search"
                  onClick={() => setAlbumSearchQuery("")}
                >
                  <CloseIcon size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          {isLoading ? (
            <TrackListSkeleton label="Loading songs" />
          ) : visibleTracks.length === 0 && albumSearchQuery.trim() ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">No songs match this search.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {visibleTracks.map((track, index) => {
                const isCurrent = currentTrackId !== null && track.id === currentTrackId;
                const viewFormatted = formatCompactNumber(track.viewCount ?? track.viewCountText);
                return (
                  <TrackRow
                    key={getTrackRenderKey(track, index)}
                    track={track}
                    index={index}
                    isCurrent={isCurrent}
                    isPlaying={isCurrent && isPlaying}
                    isSelected={selection.isSelected(track.id)}
                    isSelectionActive={selection.isActive}
                    trailing={
                      viewFormatted ? (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {viewFormatted}
                        </span>
                      ) : undefined
                    }
                    onToggleSelected={() => selection.toggle(track.id, index)}
                    onSelect={(event) => {
                      if (selection.handleRowClick(event, index)) return;
                      void playerController.playTrackById(track.id, visibleTracks);
                    }}
                    showDownload
                    showRating
                    onQuickAddToQueue={() => playerController.addToQueue(track)}
                    onQuickAdd={() => openPlaylistPicker(track)}
                    onContextMenu={(event) => openTrackMenu(event, track)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {(album?.year || displayArtistName) && (
        <div className="text-xs text-muted-foreground pt-4 flex flex-col gap-0.5">
          <p className="text-[11px] opacity-75">
            ℗ {album?.year ? `${album.year} ` : ""}{displayArtistName && displayArtistName !== album?.year ? displayArtistName : ""}
          </p>
        </div>
      )}

      {/* Artist Profile Card */}
      {displayArtistName && (
        <div
          onClick={() => {
            if (artistDetails) {
              if (onOpenDiscography) onOpenDiscography(artistDetails, moreReleases);
              else onOpenArtist?.(artistDetails);
            } else if (resolvedArtistId) {
              const target = { id: resolvedArtistId, name: displayArtistName };
              if (onOpenDiscography) onOpenDiscography(target, moreReleases);
              else onOpenArtist?.(target);
            }
          }}
          className="group flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-white/10 transition-colors cursor-pointer"
        >
          <TrackArtwork
            artworkUrl={artistDetails?.artworkUrl}
            variant="artist"
            size={400}
            preferProxy
            className="size-16 rounded-full shadow-md object-cover transition-transform group-hover:scale-105"
          />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Artist</span>
            <span className="text-base font-bold text-foreground group-hover:underline truncate">{displayArtistName}</span>
            {artistDetails?.subscriberCount && (
              <span className="text-xs text-muted-foreground">
                {artistDetails.subscriberCount.toLowerCase().includes("subscriber")
                  ? artistDetails.subscriberCount
                  : `${artistDetails.subscriberCount} subscribers`}
              </span>
            )}
          </div>
        </div>
      )}

      {moreReleases.length > 0 && displayArtistName && (
        <section className="flex flex-col gap-3 pt-6 border-t border-border/40">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight text-foreground">More by {displayArtistName}</h2>
            {onOpenDiscography && (
              <button
                type="button"
                onClick={() => onOpenDiscography(artistDetails || { id: resolvedArtistId || "", name: displayArtistName }, moreReleases)}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline transition-colors focus-visible:outline-none cursor-pointer"
              >
                See discography
              </button>
            )}
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
            {moreReleases.map((release) => {
              const rLabel = release.releaseType === "ep" ? "EP" : release.releaseType === "single" ? "Single" : "Album";
              const sub = release.year ? `${release.year} • ${rLabel}` : rLabel;
              return (
                <AlbumCard
                  key={release.id}
                  artworkUrl={release.artworkUrl}
                  title={release.title}
                  subtitle={sub}
                  onClick={() => onOpenAlbum?.(release)}
                />
              );
            })}
          </div>
        </section>
      )}

      <SelectionBar
        selection={selection}
        onAddToQueue={(selected) => {
          playerController.addTracksToQueue(selected);
          selection.clear();
        }}
        onAddToPlaylist={(selected) => {
          openPlaylistPicker(selected[0], selected);
          selection.clear();
        }}
        onDownload={(selected) => {
          queueDownloads(selected);
          selection.clear();
        }}
      />

    </div>
  );
}
