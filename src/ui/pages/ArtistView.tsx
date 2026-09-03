import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SpinnerSteps } from "@/components/motion/loader";
import { CheckIcon, CopyIcon, UserPlusIcon } from "@/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import type {
  Album,
  Artist,
  ArtistNotificationLevel,
  ArtistPage,
  Playlist,
  Track,
} from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import { searchController, type PlayerControllerActions } from "../../player/playerStore";
import { shuffleTracks } from "../../player/shuffleTracks";
import { AlbumCard } from "../components/AlbumCard";
import { ArtistLinks } from "../components/ArtistLinks";
import { MediaHeader } from "../components/MediaHeader";
import { AlbumGridSkeleton, TrackListSkeleton } from "../components/Skeleton";
import { TrackArtwork } from "../components/TrackArtwork";
import { TrackRow } from "../components/TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { cn, formatCompactNumber } from "@/lib/utils";
import { SpotifyService, type SpotifyArtistOverview, type SpotifyRelease } from "../../services/SpotifyService";

type ReleaseFilter = "all" | "album" | "singles_eps";

export function compactViews(track: Track): string {
  return formatCompactNumber(track.viewCount ?? track.viewCountText);
}

function formatDuration(totalSec?: number): string {
  if (!totalSec || totalSec <= 0) return "";
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getArtistUrl(artist: Artist): string {
  if (artist.id.startsWith("UC")) {
    return `https://music.youtube.com/channel/${encodeURIComponent(artist.id)}`;
  }
  if (artist.id) {
    return `https://music.youtube.com/browse/${encodeURIComponent(artist.id)}`;
  }
  return `https://music.youtube.com/search?q=${encodeURIComponent(artist.name)}`;
}

/** How many of the artist's songs the Popular shelf shows before it is expanded. */
const POPULAR_PREVIEW_COUNT = 10;

const artistPageMemory = new Map<string, ArtistPage>();

export function ArtistView({
  artist,
  playerController,
  libraryController,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenArtist,
  onOpenDiscography,
}: {
  artist?: Artist;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenAlbum: (album: Album) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onOpenArtist?: (artist: Artist) => void;
  onOpenSong?: (song: Track) => void;
  onOpenDiscography?: (artist: Artist, releases?: Album[]) => void;
}) {
  const { openPlaylistPicker, openTrackMenu } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();
  const { currentTrackId, isPlaying, isLoading: isPlayerLoading } = useNowPlaying();

  const [page, setPage] = useState<ArtistPage | null>(
    () => (artist ? artistPageMemory.get(artist.id) ?? null : null),
  );
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [isLoading, setIsLoading] = useState(
    () => !(artist && artistPageMemory.has(artist.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReleaseFilter>("all");
  const [showAllReleases, setShowAllReleases] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [notificationLevel, setNotificationLevel] =
    useState<ArtistNotificationLevel>("personalized");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Spotify data
  const [spotifyOverview, setSpotifyOverview] = useState<SpotifyArtistOverview | null>(null);
  const [spotifyReleases, setSpotifyReleases] = useState<SpotifyRelease[]>([]);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  useEffect(() => {
    if (!artist) return;
    let active = true;

    const remembered = artistPageMemory.get(artist.id) ?? null;
    setPage(remembered);
    setIsLoading(!remembered);
    setError(null);
    setFilter("all");
    setShowAllSongs(false);
    setShowAllReleases(false);

    // Fetch YouTube Music artist page
    void libraryController.getArtist(artist.id, (updated) => {
      if (!active) return;
      setPage(updated);
      artistPageMemory.set(artist.id, updated);
    })
      .then((result) => {
        if (!active) return;
        setPage(result);
        artistPageMemory.set(artist.id, result);
      })
      .catch(() => {
        if (active && !remembered) setError("Unable to load this artist.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    // Fetch Spotify Overview & Discography in parallel (non-blocking)
    const artistName = artist.name;
    void SpotifyService.getArtistOverview(artistName)
      .then((overview) => {
        if (active && overview) {
          setSpotifyOverview(overview);
        }
      })
      .catch(() => {});

    void SpotifyService.getArtistDiscography(artistName)
      .then((releases) => {
        if (active && releases.length > 0) {
          setSpotifyReleases(releases);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [artist, libraryController]);

  const displayedArtist = page?.artist ?? artist;

  // Merge YouTube Music releases with Spotify discography
  const mergedReleases = useMemo(() => {
    const ytReleases = page?.releases ?? [];
    const existingTitles = new Set(ytReleases.map((r) => r.title.toLowerCase().trim()));

    const extraSpotify: Album[] = [];
    for (const sr of spotifyReleases) {
      const clean = sr.name.toLowerCase().trim();
      if (!existingTitles.has(clean)) {
        existingTitles.add(clean);
        extraSpotify.push({
          id: `spotify:${sr.id}`,
          title: sr.name,
          artist: displayedArtist?.name || "",
          artworkUrl: sr.coverUrl,
          year: sr.year ? String(sr.year) : undefined,
          releaseType: sr.type,
        });
      }
    }

    return [...ytReleases, ...extraSpotify];
  }, [page?.releases, spotifyReleases, displayedArtist?.name]);

  const releaseFilters = useMemo(
    () => [
      { id: "all" as const, label: "Popular releases" },
      { id: "album" as const, label: "Albums" },
      { id: "singles_eps" as const, label: "Singles and EPs" },
    ],
    [],
  );

  const filteredReleases = useMemo(() => {
    if (filter === "album") {
      return mergedReleases.filter((r) => r.releaseType === "album");
    }
    if (filter === "singles_eps") {
      return mergedReleases.filter((r) => r.releaseType === "single" || r.releaseType === "ep");
    }
    return mergedReleases;
  }, [mergedReleases, filter]);

  const visibleReleases = useMemo(() => {
    return showAllReleases ? filteredReleases : filteredReleases.slice(0, 10);
  }, [filteredReleases, showAllReleases]);

  const subCount = displayedArtist?.subscriberCount || page?.artist.subscriberCount;
  const formattedSubCount = useMemo(() => {
    if (!subCount) return undefined;
    const compact = formatCompactNumber(subCount);
    if (compact) return `${compact} subscribers`;
    const cleaned = subCount.trim();
    return cleaned.toLowerCase().includes("subscriber") ? cleaned : `${cleaned} subscribers`;
  }, [subCount]);

  const allSongs = page?.allSongs ?? [];
  const popularSongs = showAllSongs
    ? allSongs
    : (page?.popularSongs && page.popularSongs.length > 0
      ? page.popularSongs.slice(0, POPULAR_PREVIEW_COUNT)
      : allSongs.slice(0, POPULAR_PREVIEW_COUNT));
  const hiddenSongCount = allSongs.length - popularSongs.length;

  // Separate Featuring playlists and Discovered On playlists
  const featuringPlaylists = useMemo(() => {
    const list = page?.playlists ?? [];
    const artistNameLower = (displayedArtist?.name || "").toLowerCase();
    return list.filter((p) => {
      const lower = p.title.toLowerCase();
      const ownerLower = (p.owner || "").toLowerCase();
      return (
        lower.includes("featuring") ||
        lower.includes("this is") ||
        lower.includes("best of") ||
        lower.includes(artistNameLower) ||
        ownerLower.includes("youtube")
      );
    });
  }, [page?.playlists, displayedArtist?.name]);

  const discoveredOnPlaylists = useMemo(() => {
    const base = page?.discoveredOn ?? [];
    if (base.length > 0) return base;
    const list = page?.playlists ?? [];
    const featSet = new Set(featuringPlaylists.map((p) => p.id));
    return list.filter((p) => !featSet.has(p.id));
  }, [page?.discoveredOn, page?.playlists, featuringPlaylists]);

  useEffect(() => {
    setIsSubscribed(page?.subscribed ?? false);
  }, [page?.subscribed]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  if (!artist || !displayedArtist) return null;

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  };

  const trackIds = useMemo(
    () => new Set((page?.allSongs ?? []).map((track) => track.id)),
    [page],
  );
  const isCurrentCollection = currentTrackId !== null && trackIds.has(currentTrackId);

  const togglePlayCollection = () => {
    if (isCurrentCollection) {
      playerController.togglePlayPause();
      return;
    }
    playInOrder();
  };

  const playInOrder = () => {
    const songs = page?.allSongs ?? [];
    if (songs[0]) void playerController.playTrackById(songs[0].id, songs);
  };

  const playShuffled = async () => {
    const songs = page?.allSongs ?? [];
    const firstTrack = shuffleTracks(songs)[0];
    if (!firstTrack) return;
    const started = await playerController.playTrackById(firstTrack.id, songs, false, true);
    if (!started) return;
    playerController.setShuffleEnabled(true);
  };

  const changeNotificationLevel = async (level: ArtistNotificationLevel) => {
    const previous = notificationLevel;
    setNotificationLevel(level);
    try {
      await libraryController.setArtistNotificationLevel(displayedArtist, level);
      showToast(
        level === "all"
          ? "Notifying you about every release"
          : level === "none" ? "Notifications off" : "Notifications set to personalized",
      );
    } catch (notificationError) {
      setNotificationLevel(previous);
      showToast(
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to change notifications.",
      );
    }
  };

  const toggleArtistSubscription = async () => {
    if (isSubscribing) return;
    const nextSubscribed = !isSubscribed;
    setIsSubscribing(true);
    try {
      await libraryController.setArtistSubscribed(displayedArtist, nextSubscribed);
      setIsSubscribed(nextSubscribed);
      if (!nextSubscribed) setNotificationLevel("personalized");
    } catch (subscribeError) {
      showToast(
        subscribeError instanceof Error
          ? subscribeError.message
          : "Unable to update this subscription.",
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  const copyArtistUrl = async () => {
    try {
      await navigator.clipboard.writeText(getArtistUrl(displayedArtist));
      showToast("Url copied to clipboard");
    } catch {
      showToast("Unable to copy the link.");
    }
  };

  return (
    <div className="flex flex-col gap-10 pb-16">
      {/* Header Section */}
      <MediaHeader
        eyebrow={displayedArtist.isCreator || page?.isCreator ? "CREATOR" : "ARTIST"}
        title={
          <button
            type="button"
            className="group/title flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void copyArtistUrl()}
            aria-label={`Copy ${displayedArtist.name} URL`}
          >
            <span>{displayedArtist.name}</span>
            <CopyIcon
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100"
              size={22}
              aria-hidden="true"
            />
          </button>
        }
        meta={
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {spotifyOverview?.monthlyListeners ? (
              <span className="text-foreground/90 font-medium">
                {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
              </span>
            ) : formattedSubCount ? (
              <span>{formattedSubCount}</span>
            ) : null}
            {spotifyOverview?.monthlyListeners && formattedSubCount && (
              <>
                <span>•</span>
                <span>{formattedSubCount}</span>
              </>
            )}
          </div>
        }
        circularArtwork
        artworkUrl={displayedArtist.artworkUrl || spotifyOverview?.avatarUrl}
        artworkSlot={
          <TrackArtwork
            className="size-44 shrink-0 rounded-full bg-card shadow-2xl ring-1 ring-white/10"
            size={544}
            artworkUrl={displayedArtist.artworkUrl || spotifyOverview?.avatarUrl}
            iconSize={72}
            variant="artist"
            loading="eager"
            preferProxy
          />
        }
        actionsDisabled={isLoading || Boolean(error) || !page?.allSongs.length}
        playback={{
          onToggle: togglePlayCollection,
          isPlaying: isCurrentCollection && isPlaying,
          isLoading: isCurrentCollection && isPlayerLoading,
        }}
        onShuffle={() => void playShuffled()}
        onAddToQueue={() => playerController.addTracksToQueue(page?.allSongs ?? [])}
        onAddToPlaylist={() => {
          const songs = page?.allSongs ?? [];
          if (songs.length > 0) openPlaylistPicker(songs[0], songs);
        }}
        actions={
          <div className="flex items-center gap-2.5">
            {/* Themed Subscribe button: Red before sub, Neutral when subbed */}
            <button
              className={cn(
                "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                isSubscribed
                  ? "bg-card text-foreground hover:bg-muted"
                  : "bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30 active:scale-95",
              )}
              type="button"
              disabled={isLoading || Boolean(error) || isSubscribing}
              onClick={() => void toggleArtistSubscription()}
            >
              {isSubscribing ? (
                <SpinnerSteps size={18} color="currentColor" />
              ) : isSubscribed ? (
                <CheckIcon size={18} />
              ) : (
                <UserPlusIcon size={18} />
              )}
              <span>
                {isSubscribing
                  ? isSubscribed ? "Unsubscribing..." : "Subscribing..."
                  : isSubscribed ? "Subscribed" : "Subscribe"}
              </span>
            </button>

            {isSubscribed && (
              <Select
                className="w-44"
                value={notificationLevel}
                onValueChange={(value) =>
                  void changeNotificationLevel(value as ArtistNotificationLevel)}
              >
                <SelectTrigger aria-label={`Notifications for ${displayedArtist.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All new releases</SelectItem>
                  <SelectItem value="personalized">Personalized</SelectItem>
                  <SelectItem value="none">No notifications</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        }
      />

      {isLoading && (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Popular</h2>
            <TrackListSkeleton count={POPULAR_PREVIEW_COUNT} label="Loading top songs" />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Discography</h2>
            <AlbumGridSkeleton label="Loading releases" />
          </section>
        </div>
      )}

      {error && <p className="px-2 py-10 text-center text-sm text-muted-foreground">{error}</p>}

      {!isLoading && !error && (
        <>
          {/* 100-Song Head / Popular Tracks */}
          {popularSongs.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Popular</h2>
              <div className="flex flex-col gap-0.5">
                {popularSongs.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    showIndex
                    showArtwork
                    showAlbum
                    isCurrent={currentTrackId !== null && track.id === currentTrackId}
                    isPlaying={isPlaying && track.id === currentTrackId}
                    suppressArtistId={displayedArtist.id}
                    trailing={
                      <div className="flex items-center gap-6 shrink-0 text-xs tabular-nums text-muted-foreground ml-auto pr-2">
                        <span className="w-24 text-right hidden sm:inline-block">
                          {track.viewCount ? Number(track.viewCount).toLocaleString() : compactViews(track)}
                        </span>
                        <span className="w-12 text-right">
                          {track.durationSec ? formatDuration(track.durationSec) : ""}
                        </span>
                      </div>
                    }
                    onSelect={() => void playerController.playTrackById(track.id, page?.allSongs ?? popularSongs)}
                    showDownload
                    showRating
                    onQuickAddToQueue={() => playerController.addToQueue(track)}
                    onQuickAdd={() => openPlaylistPicker(track)}
                    onContextMenu={(event) => openTrackMenu(event, track)}
                  />
                ))}
              </div>

              {(hiddenSongCount > 0 || showAllSongs) && (
                <button
                  type="button"
                  onClick={() => setShowAllSongs((current) => !current)}
                  aria-expanded={showAllSongs}
                  className="self-start rounded-full bg-white/[0.04] px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer mt-1"
                >
                  {showAllSongs ? "Show less" : `Show all ${allSongs.length} songs`}
                </button>
              )}
            </section>
          )}

          {/* 1. Discography (YouTube Music + Spotify releases) */}
          {mergedReleases.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpenDiscography?.(displayedArtist, mergedReleases)}
                  className="group/discog flex items-center gap-1.5 text-left focus-visible:outline-none hover:underline cursor-pointer"
                  title={`View full ${displayedArtist.name} discography`}
                >
                  <h2 className="text-xl font-bold tracking-tight text-foreground group-hover/discog:text-foreground">
                    Discography
                  </h2>
                  <span className="text-muted-foreground text-sm transition-transform group-hover/discog:translate-x-0.5">
                    ›
                  </span>
                </button>

                <div
                  className="flex flex-wrap items-center gap-1.5 self-start [&>button]:flex [&>button]:min-h-8 [&>button]:min-w-0 [&>button]:items-center [&>button]:justify-center [&>button]:gap-1.5 [&>button]:rounded-full [&>button]:bg-white/[0.04] [&>button]:px-3 [&>button]:text-sm [&>button]:font-medium [&>button]:text-muted-foreground [&>button]:transition-colors hover:[&>button]:bg-white/[0.08] hover:[&>button]:text-foreground focus-visible:[&>button]:outline-none focus-visible:[&>button]:ring-2 focus-visible:[&>button]:ring-ring cursor-pointer"
                  role="group"
                  aria-label="Release type"
                >
                  {releaseFilters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={filter === f.id ? "bg-white/[0.14] text-foreground font-semibold" : ""}
                      aria-pressed={filter === f.id}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div key={filter} className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {visibleReleases.map((release) => {
                  const hasLinkedArtists = Boolean(release.artists?.length);
                  const releaseTypeLabel =
                    release.releaseType === "ep"
                      ? "EP"
                      : release.releaseType === "single"
                        ? "Single"
                        : "Album";
                  const subtitleText = release.year
                    ? `${release.year} • ${releaseTypeLabel}`
                    : (release.releaseType ? releaseTypeLabel : release.artist);

                  return (
                    <div key={release.id}>
                      <AlbumCard
                        artworkUrl={release.artworkUrl}
                        title={release.title}
                        subtitle={hasLinkedArtists ? undefined : subtitleText}
                        subtitleContent={
                          hasLinkedArtists ? (
                            <span className="truncate">
                              {release.year ? `${release.year} • ` : ""}
                              <ArtistLinks
                                artists={release.artists}
                                fallback={release.artist}
                                suppressArtistId={displayedArtist.id}
                              />
                            </span>
                          ) : undefined
                        }
                        onClick={() => {
                          if (release.id.startsWith("spotify:")) {
                            // Search or open title on YT music
                            void searchController.search(release.title).then((res) => {
                              if (res.albums[0]) onOpenAlbum(res.albums[0]);
                            });
                          } else {
                            onOpenAlbum(release);
                          }
                        }}
                        onContextMenu={(event) => openAlbumMenu(event, release)}
                      />
                    </div>
                  );
                })}
              </div>

              {filteredReleases.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAllReleases((current) => !current)}
                  className="self-start rounded-full bg-white/[0.04] px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground cursor-pointer"
                >
                  {showAllReleases ? "Show less releases" : `Show all ${filteredReleases.length} releases`}
                </button>
              )}
            </section>
          )}

          {/* 2. Featuring "Artist Name" (YouTube-made playlists) */}
          {featuringPlaylists.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Featuring {displayedArtist.name}
              </h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {featuringPlaylists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.artworkUrl}
                    title={playlist.title}
                    subtitle={playlist.owner || "YouTube Music"}
                    onClick={() => onOpenPlaylist(playlist)}
                    onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 3. About Section (Card + Modal with Spotify Stats) */}
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold tracking-tight text-foreground">About</h2>
            <div
              onClick={() => setIsAboutModalOpen(true)}
              className="group relative h-80 w-full max-w-2xl cursor-pointer overflow-hidden rounded-2xl bg-card transition-all duration-300 hover:shadow-2xl hover:ring-1 hover:ring-white/20"
            >
              <img
                src={
                  spotifyOverview?.headerUrl ||
                  spotifyOverview?.galleryUrls?.[0] ||
                  spotifyOverview?.avatarUrl ||
                  displayedArtist.artworkUrl
                }
                alt={displayedArtist.name}
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

              <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-2">
                {spotifyOverview?.monthlyListeners && (
                  <span className="text-base font-bold text-white/95">
                    {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
                  </span>
                )}
                {spotifyOverview?.bio && (
                  <p className="line-clamp-3 text-sm text-white/80 leading-relaxed max-w-xl">
                    {spotifyOverview.bio}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* 4. Discovered on (Mix of fanmade + YT music playlists) */}
          {discoveredOnPlaylists.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Discovered on</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {discoveredOnPlaylists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.artworkUrl}
                    title={playlist.title}
                    subtitle={playlist.owner || "Playlist"}
                    onClick={() => onOpenPlaylist(playlist)}
                    onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 5. Fans also like */}
          {page?.fansAlsoLike && page.fansAlsoLike.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Fans also like</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {page.fansAlsoLike.map((similarArtist) => (
                  <div
                    key={similarArtist.id}
                    className="group flex flex-col items-center gap-2.5 rounded-xl p-3 text-center transition-colors hover:bg-card cursor-pointer"
                    onClick={() => onOpenArtist?.(similarArtist)}
                  >
                    <TrackArtwork
                      artworkUrl={similarArtist.artworkUrl}
                      variant="artist"
                      size={400}
                      preferProxy
                      className="size-28 rounded-full shadow-md transition-transform duration-200 group-hover:scale-105"
                    />
                    <div className="flex flex-col items-center min-w-0 w-full">
                      <span className="truncate w-full text-sm font-medium text-foreground group-hover:underline">
                        {similarArtist.name}
                      </span>
                      <span className="text-xs text-muted-foreground truncate w-full">
                        {similarArtist.subscriberCount || "Artist"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 6. Appears on (Features with other artists) */}
          {page?.appearsOn && page.appearsOn.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Appears on</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {page.appearsOn.map((album) => (
                  <AlbumCard
                    key={album.id}
                    artworkUrl={album.artworkUrl}
                    title={album.title}
                    subtitle={album.artist || "Featured release"}
                    onClick={() => onOpenAlbum(album)}
                    onContextMenu={(event) => openAlbumMenu(event, album)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* About Modal */}
      {isAboutModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setIsAboutModalOpen(false)}
        >
          <div
            className="relative flex flex-col max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Close Button */}
            <button
              onClick={() => setIsAboutModalOpen(false)}
              className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-black/90 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              ✕
            </button>

            {/* Hero Image */}
            <div className="relative h-64 w-full shrink-0 overflow-hidden bg-zinc-950">
              <img
                src={
                  spotifyOverview?.headerUrl ||
                  spotifyOverview?.galleryUrls?.[0] ||
                  spotifyOverview?.avatarUrl ||
                  displayedArtist.artworkUrl
                }
                alt={displayedArtist.name}
                className="h-full w-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent" />
            </div>

            {/* Scrollable Content Body */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
                {/* Left Column: Stats & Cities & Socials */}
                <div className="md:col-span-2 flex flex-col gap-6">
                  {/* Monthly Listeners */}
                  <div>
                    <div className="text-3xl font-extrabold text-white tracking-tight">
                      {spotifyOverview?.monthlyListeners
                        ? spotifyOverview.monthlyListeners.toLocaleString()
                        : subCount || "—"}
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                      Monthly Listeners
                    </div>
                  </div>

                  {/* Followers */}
                  {spotifyOverview?.followers ? (
                    <div>
                      <div className="text-2xl font-bold text-white/90">
                        {spotifyOverview.followers.toLocaleString()}
                      </div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                        Followers
                      </div>
                    </div>
                  ) : null}

                  {/* World Rank */}
                  {spotifyOverview?.worldRank ? (
                    <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                      #{spotifyOverview.worldRank} in the world
                    </div>
                  ) : null}

                  {/* Top Cities */}
                  {spotifyOverview?.topCities && spotifyOverview.topCities.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Top Cities
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {spotifyOverview.topCities.map((city, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="font-medium text-white/90">
                              {city.city}, {city.country}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {city.numberOfListeners.toLocaleString()} listeners
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Instagram Social Link */}
                  {spotifyOverview?.instagramUrl && (
                    <a
                      href={spotifyOverview.instagramUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 self-start text-xs font-semibold text-muted-foreground hover:text-white transition-colors"
                    >
                      <span>Instagram</span>
                      <span className="text-xs">↗</span>
                    </a>
                  )}
                </div>

                {/* Right Column: Bio & Posted By Avatar */}
                <div className="md:col-span-3 flex flex-col justify-between gap-6">
                  <div className="space-y-4">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                      {spotifyOverview?.bio || "No biography available for this artist."}
                    </p>
                  </div>

                  {/* "Posted by [Artist Name]" */}
                  <div className="flex items-center gap-3 pt-4 border-t border-white/10">
                    <img
                      src={spotifyOverview?.avatarUrl || displayedArtist.artworkUrl}
                      alt={displayedArtist.name}
                      className="size-10 rounded-full object-cover ring-1 ring-white/20"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Posted By</span>
                      <span className="text-sm font-semibold text-white">{displayedArtist.name}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {toast && createPortal(
        <div
          className="fixed bottom-28 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-popover/95 px-4 py-2 text-sm text-foreground shadow-2xl backdrop-blur"
          role="status"
        >
          {toast === "Url copied to clipboard" && (
            <CheckIcon size={18} aria-hidden="true" />
          )}
          <span>{toast}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
