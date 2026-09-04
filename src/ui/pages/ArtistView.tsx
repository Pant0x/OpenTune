import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SpinnerSteps } from "@/components/motion/loader";
import {
  AlbumIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  FacebookIcon,
  GlobeIcon,
  InstagramIcon,
  ListIcon,
  MenuDotsIcon,
  MusicNoteIcon,
  PlayActiveIcon,
  RadioIcon,
  ShareIcon,
  TwitterIcon,
  UserPlusIcon,
  WikipediaIcon,
} from "@/ui/icons";
import type {
  Album,
  Artist,
  ArtistPage,
  Playlist,
  Track,
} from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import { searchController, type PlayerControllerActions } from "../../player/playerStore";
import { shuffleTracks } from "../../player/shuffleTracks";
import { AlbumCard } from "../components/AlbumCard";
import { MediaHeader } from "../components/MediaHeader";
import { AlbumGridSkeleton, TrackListSkeleton } from "../components/Skeleton";
import { TrackArtwork } from "../components/TrackArtwork";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { cn, formatCompactNumber } from "@/lib/utils";
import {
  SpotifyService,
  getSpotifyShareUrl,
  sanitizeSpotifyBio,
  type SpotifyArtistOverview,
  type SpotifyPlaylist,
  type SpotifyRelease,
} from "../../services/SpotifyService";
import { logInternalError } from "../../internal/logging";

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

function getSocialIcon(name: string) {
  const n = name.toUpperCase();
  if (n.includes("INSTAGRAM")) return <InstagramIcon size={16} className="text-white shrink-0" />;
  if (n.includes("TWITTER") || n === "X") return <TwitterIcon size={15} className="text-white shrink-0" />;
  if (n.includes("FACEBOOK")) return <FacebookIcon size={16} className="text-white shrink-0" />;
  if (n.includes("WIKIPEDIA")) return <WikipediaIcon size={16} className="text-white shrink-0" />;
  return <GlobeIcon size={16} className="text-white shrink-0" />;
}

function formatSocialName(name: string): string {
  const n = name.toLowerCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

interface PopularSongItem {
  id: string;
  spotifyTrackId?: string;
  name: string;
  artist: string;
  isExplicit: boolean;
  plays: string;
  duration: string;
  coverUrl?: string;
  rawTrack?: Track;
  albumName?: string;
  albumId?: string;
}

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
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Menus
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [activeSongMenuId, setActiveSongMenuId] = useState<string | null>(null);
  const songMenuRef = useRef<HTMLDivElement>(null);

  // Blocked artists (Don't play this artist)
  const [blockedArtists, setBlockedArtists] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("amber_blocked_artists");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Spotify data
  const [spotifyOverview, setSpotifyOverview] = useState<SpotifyArtistOverview | null>(null);
  const [spotifyReleases, setSpotifyReleases] = useState<SpotifyRelease[]>([]);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  // Extra playlists for Featuring and Discovered on fallback
  const [extraFeaturingPlaylists, setExtraFeaturingPlaylists] = useState<Playlist[]>([]);
  const [extraDiscoveredOnPlaylists, setExtraDiscoveredOnPlaylists] = useState<Playlist[]>([]);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setIsHeaderMenuOpen(false);
      }
      if (songMenuRef.current && !songMenuRef.current.contains(e.target as Node)) {
        setActiveSongMenuId(null);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    setExtraFeaturingPlaylists([]);
    setExtraDiscoveredOnPlaylists([]);
    setSpotifyPlaylists([]);

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

    // Fetch Spotify Overview, Discography & Playlists in parallel
    const artistName = artist.name;
    void SpotifyService.getArtistOverview(artistName)
      .then((overview) => {
        if (active && overview) {
          setSpotifyOverview(overview);
        }
      })
      .catch((err) => {
        logInternalError("Spotify overview fetch failed", err);
      });

    void SpotifyService.getArtistDiscography(artistName)
      .then((releases) => {
        if (active && releases.length > 0) {
          setSpotifyReleases(releases);
        }
      })
      .catch((err) => {
        logInternalError("Spotify discography fetch failed", err);
      });

    void SpotifyService.getArtistPlaylists(artistName)
      .then((playlists) => {
        if (active && playlists.length > 0) {
          setSpotifyPlaylists(playlists);
        }
      })
      .catch((err) => {
        logInternalError("Spotify artist playlists fetch failed", err);
      });

    // Fallback search for Featuring and Discovered on playlists
    searchController.search(`Featuring ${artistName}`).then((res) => {
      if (active && res.playlists?.length) {
        setExtraFeaturingPlaylists(res.playlists.slice(0, 10));
      }
    }).catch(() => {});

    searchController.search(`${artistName} playlist`).then((res) => {
      if (active && res.playlists?.length) {
        setExtraDiscoveredOnPlaylists(res.playlists.slice(0, 10));
      }
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [artist, libraryController]);

  const displayedArtist = page?.artist ?? artist;

  // Consistent Spotify-first picture
  const artistAvatar = spotifyOverview?.avatarUrl || displayedArtist?.artworkUrl;
  const artistHeaderBg =
    spotifyOverview?.headerUrl || spotifyOverview?.galleryUrls?.[0] || artistAvatar;

  const isBlockedArtist = displayedArtist?.name
    ? blockedArtists.includes(displayedArtist.name.toLowerCase())
    : false;

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  };

  const toggleBlockArtist = () => {
    if (!displayedArtist?.name) return;
    const key = displayedArtist.name.toLowerCase();
    let next: string[];
    if (isBlockedArtist) {
      next = blockedArtists.filter((name) => name !== key);
      showToast(`Amber will play songs by ${displayedArtist.name}`);
    } else {
      next = [...blockedArtists, key];
      showToast(`Amber won't play songs by ${displayedArtist.name}`);
    }
    setBlockedArtists(next);
    try {
      localStorage.setItem("amber_blocked_artists", JSON.stringify(next));
    } catch {}
  };

  const startArtistRadio = () => {
    if (!displayedArtist) return;
    const firstSong = page?.allSongs?.[0];
    if (firstSong) {
      void playerController.playTrackById(firstSong.id, [firstSong], true);
      showToast(`Starting ${displayedArtist.name} radio`);
    } else if (popularItems[0]) {
      void handlePlaySongItem(popularItems[0]);
      showToast(`Starting ${displayedArtist.name} radio`);
    } else {
      showToast("No songs available to start radio.");
    }
  };

  const copyArtistShareLink = async () => {
    if (!displayedArtist) return;
    const spotifyId = spotifyOverview?.spotifyId;
    const shareUrl = getSpotifyShareUrl("artist", spotifyId || displayedArtist.name);
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Artist link copied to clipboard");
    } catch {
      showToast("Unable to copy link.");
    }
  };

  const copySongShareLink = async (item: PopularSongItem) => {
    let trackId = item.spotifyTrackId;
    if (!trackId && item.id.startsWith("spotify:")) {
      trackId = item.id.replace("spotify:", "");
    }
    const shareUrl = getSpotifyShareUrl("track", trackId || `${item.name} ${item.artist}`);
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Song link copied to clipboard");
    } catch {
      showToast("Unable to copy link.");
    }
  };

  const handleStartSongRadio = async (item: PopularSongItem) => {
    if (!displayedArtist) return;
    if (item.rawTrack) {
      void playerController.playTrackById(item.rawTrack.id, [item.rawTrack], true);
      showToast(`Starting song radio for "${item.name}"`);
      return;
    }
    try {
      const searchRes = await searchController.search(`${item.name} ${displayedArtist.name}`);
      const song = searchRes.tracks?.[0];
      if (song) {
        void playerController.playTrackById(song.id, [song], true);
        showToast(`Starting song radio for "${item.name}"`);
      } else {
        showToast("Unable to find song on YouTube Music.");
      }
    } catch (err) {
      logInternalError("Failed to start song radio", err);
    }
  };

  const handleAddToQueue = (item: PopularSongItem) => {
    if (!displayedArtist) return;
    if (item.rawTrack) {
      playerController.addTracksToQueue([item.rawTrack]);
      showToast(`Added "${item.name}" to queue`);
    } else {
      searchController.search(`${item.name} ${displayedArtist.name}`).then((res) => {
        if (res.tracks?.[0]) {
          playerController.addTracksToQueue([res.tracks[0]]);
          showToast(`Added "${item.name}" to queue`);
        }
      }).catch(() => {});
    }
  };

  const handleOpenSpotifyPlaylist = async (pl: SpotifyPlaylist) => {
    if (!displayedArtist) return;
    try {
      const res = await searchController.search(`${pl.name} ${displayedArtist.name}`);
      if (res.playlists && res.playlists.length > 0) {
        onOpenPlaylist(res.playlists[0]);
        return;
      }
    } catch {}
    onOpenPlaylist({
      id: `spotify:${pl.id}`,
      title: pl.name,
      artworkUrl: pl.coverUrl,
      owner: pl.ownerName || "Spotify",
    });
  };

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

  // Separate Featuring playlists and Discovered On playlists
  const featuringPlaylists = useMemo(() => {
    const list = page?.playlists ?? [];
    const artistNameLower = (displayedArtist?.name || "").toLowerCase();
    const matches = list.filter((p) => {
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
    if (matches.length > 0) return matches;
    return extraFeaturingPlaylists;
  }, [page?.playlists, displayedArtist?.name, extraFeaturingPlaylists]);

  const discoveredOnPlaylists = useMemo(() => {
    const base = page?.discoveredOn ?? [];
    if (base.length > 0) return base;
    const list = page?.playlists ?? [];
    const featSet = new Set(featuringPlaylists.map((p) => p.id));
    const remaining = list.filter((p) => !featSet.has(p.id));
    if (remaining.length > 0) return remaining;
    return extraDiscoveredOnPlaylists;
  }, [page?.discoveredOn, page?.playlists, featuringPlaylists, extraDiscoveredOnPlaylists]);

  // Popular song items structured for Spotify-style table with cover art
  const popularItems: PopularSongItem[] = useMemo(() => {
    if (spotifyOverview?.topTracks && spotifyOverview.topTracks.length > 0) {
      return spotifyOverview.topTracks.map((st) => {
        const matched = page?.allSongs.find((yt) => {
          const c1 = yt.title.toLowerCase().replace(/[^a-z0-9]/g, "");
          const c2 = st.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          return c1.includes(c2) || c2.includes(c1);
        });
        const minutes = Math.floor(st.durationMs / 60000);
        const seconds = Math.floor((st.durationMs % 60000) / 1000);
        const durStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
        return {
          id: matched?.id || `spotify:${st.id}`,
          spotifyTrackId: st.id,
          name: st.name,
          artist: st.artists.join(", ") || displayedArtist?.name || "",
          isExplicit: st.isExplicit,
          plays: st.playcount,
          duration: durStr,
          coverUrl: st.coverUrl || matched?.artworkUrl,
          rawTrack: matched,
          albumName: matched?.album,
          albumId: matched?.albumId,
        };
      });
    }

    const allSongs = page?.allSongs ?? [];
    const sourceSongs = page?.popularSongs && page.popularSongs.length > 0 ? page.popularSongs : allSongs;
    return sourceSongs.map((yt) => ({
      id: yt.id,
      spotifyTrackId: undefined,
      name: yt.title,
      artist: yt.artist || displayedArtist?.name || "",
      isExplicit: Boolean(yt.isExplicit),
      plays: yt.viewCount ? Number(yt.viewCount).toLocaleString() : compactViews(yt),
      duration: yt.durationSec ? formatDuration(yt.durationSec) : (yt.duration || ""),
      coverUrl: yt.artworkUrl,
      rawTrack: yt,
      albumName: yt.album,
      albumId: yt.albumId,
    }));
  }, [spotifyOverview?.topTracks, page?.allSongs, page?.popularSongs, displayedArtist?.name]);

  const displayedPopularItems = showAllSongs ? popularItems : popularItems.slice(0, 5);

  useEffect(() => {
    setIsSubscribed(page?.subscribed ?? false);
  }, [page?.subscribed]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  if (!artist || !displayedArtist) return null;

  const trackIds = new Set((page?.allSongs ?? []).map((track) => track.id));
  const isCurrentCollection = currentTrackId !== null && trackIds.has(currentTrackId);

  const togglePlayCollection = () => {
    if (isCurrentCollection) {
      playerController.togglePlayPause();
      return;
    }
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

  const handlePlaySongItem = async (item: PopularSongItem) => {
    if (item.rawTrack) {
      void playerController.playTrackById(item.rawTrack.id, page?.allSongs ?? [item.rawTrack]);
      return;
    }
    // Search YouTube Music for this track and play
    try {
      const searchRes = await searchController.search(`${item.name} ${displayedArtist.name}`);
      const song = searchRes.tracks?.[0];
      if (song) {
        void playerController.playTrackById(song.id, [song]);
      }
    } catch (err) {
      logInternalError("Failed to play song item", err);
    }
  };

  const toggleArtistSubscription = async () => {
    if (isSubscribing) return;
    const nextSubscribed = !isSubscribed;
    setIsSubscribing(true);
    try {
      await libraryController.setArtistSubscribed(displayedArtist, nextSubscribed);
      setIsSubscribed(nextSubscribed);
      showToast(nextSubscribed ? "Following artist" : "Unfollowed artist");
    } catch (subscriptionError) {
      showToast(
        subscriptionError instanceof Error
          ? subscriptionError.message
          : "Unable to update following status.",
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <div className="flex flex-col gap-10 pb-20">
      {/* Header Section */}
      <MediaHeader
        eyebrow={undefined}
        title={
          <button
            type="button"
            className="group/title flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
            onClick={() => void copyArtistShareLink()}
            aria-label={`Copy ${displayedArtist.name} link`}
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
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mt-1">
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
        artworkUrl={artistAvatar}
        artworkSlot={
          <TrackArtwork
            className="size-44 shrink-0 rounded-full bg-card shadow-2xl ring-1 ring-white/10"
            size={544}
            artworkUrl={artistAvatar}
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
        actions={
          <div className="flex items-center gap-2.5">
            {/* Themed Follow button: Follow / Following */}
            <button
              className={cn(
                "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                isSubscribed
                  ? "border border-white/20 bg-transparent text-white hover:border-white/40 hover:bg-white/10"
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
                  ? isSubscribed ? "Unfollowing..." : "Following..."
                  : isSubscribed ? "Following" : "Follow"}
              </span>
            </button>

            {/* Header 3-dots dropdown */}
            <div className="relative" ref={headerMenuRef}>
              <button
                type="button"
                onClick={() => setIsHeaderMenuOpen((prev) => !prev)}
                className="flex size-9 items-center justify-center rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/10 transition-colors focus-visible:outline-none cursor-pointer"
                aria-label="More artist options"
              >
                <MenuDotsIcon size={18} />
              </button>

              {isHeaderMenuOpen && (
                <div
                  className="absolute left-0 top-full mt-2 z-50 w-56 rounded-xl bg-zinc-900/95 border border-white/10 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      void toggleArtistSubscription();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    {isSubscribed ? <CheckIcon size={16} className="text-emerald-400" /> : <UserPlusIcon size={16} />}
                    <span>{isSubscribed ? "Unfollow" : "Follow"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      toggleBlockArtist();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <CloseIcon size={16} className="text-red-400" />
                    <span>{isBlockedArtist ? "Allow playing this artist" : "Don't play this artist"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      startArtistRadio();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <RadioIcon size={16} className="text-sky-400" />
                    <span>Go to artist radio</span>
                  </button>

                  <div className="my-1 h-px bg-white/10" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      void copyArtistShareLink();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <ShareIcon size={16} className="text-zinc-300" />
                    <span>Share</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      />

      {isLoading && (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Popular</h2>
            <TrackListSkeleton count={5} label="Loading top songs" />
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
          {/* 1. Popular Tracks Table (Matches user image with Thumbnail, Title, Plays middle right, 3-dots, Duration) */}
          {popularItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl font-bold tracking-tight text-foreground mb-1">Popular</h2>

              <div className="flex flex-col">
                {/* Table Header */}
                <div className="flex items-center h-9 px-3 text-xs font-semibold text-muted-foreground border-b border-white/[0.08] mb-1 select-none">
                  <span className="w-10 text-center shrink-0">#</span>
                  <span className="size-10 mx-2 shrink-0" />
                  <span className="flex-1 min-w-0 pl-1">Title</span>
                  <span className="w-36 text-right hidden sm:inline-block pr-6 shrink-0">Plays</span>
                  <span className="w-8 shrink-0" />
                  <div className="w-12 flex justify-end pr-2 shrink-0">
                    <ClockIcon size={14} aria-hidden="true" />
                  </div>
                </div>

                {/* Table Rows */}
                <div className="flex flex-col gap-0.5">
                  {displayedPopularItems.map((item, index) => {
                    const isItemPlaying = isPlaying && (
                      (item.rawTrack && item.rawTrack.id === currentTrackId) ||
                      item.id === currentTrackId
                    );
                    const isItemCurrent = (item.rawTrack && item.rawTrack.id === currentTrackId) || item.id === currentTrackId;

                    return (
                      <div
                        key={item.id + index}
                        onClick={() => void handlePlaySongItem(item)}
                        className={cn(
                          "group flex items-center h-14 px-3 rounded-lg transition-colors cursor-pointer select-none",
                          isItemCurrent ? "bg-white/[0.12]" : "hover:bg-white/[0.07]",
                        )}
                      >
                        {/* Index or Play Icon */}
                        <div className="w-10 flex items-center justify-center shrink-0">
                          {isItemPlaying ? (
                            <PlayActiveIcon size={16} className="text-primary animate-pulse" />
                          ) : (
                            <>
                              <span className={cn(
                                "text-sm font-medium tabular-nums group-hover:hidden",
                                isItemCurrent ? "text-primary" : "text-muted-foreground",
                              )}>
                                {index + 1}
                              </span>
                              <PlayActiveIcon
                                size={14}
                                className="hidden group-hover:inline-block text-foreground"
                              />
                            </>
                          )}
                        </div>

                        {/* Thumbnail Artwork (40x40) */}
                        <div className="size-10 shrink-0 mx-2 overflow-hidden rounded-md bg-zinc-800 shadow-sm">
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt={item.name}
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="size-full flex items-center justify-center bg-zinc-800 text-zinc-600">
                              <MusicNoteIcon size={18} />
                            </div>
                          )}
                        </div>

                        {/* Title and Clickable Artist */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center pl-1 pr-4">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn(
                              "truncate text-sm font-semibold",
                              isItemCurrent ? "text-primary" : "text-foreground",
                            )}>
                              {item.name}
                            </span>
                            {item.isExplicit && (
                              <span className="shrink-0 rounded bg-white/20 px-1 py-0.5 text-[10px] font-bold uppercase leading-none text-muted-foreground">
                                E
                              </span>
                            )}
                          </div>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenArtist?.({ id: "", name: item.artist });
                            }}
                            className="truncate text-xs text-muted-foreground hover:underline hover:text-foreground cursor-pointer inline-block mt-0.5 w-fit"
                          >
                            {item.artist}
                          </span>
                        </div>

                        {/* Plays count in middle right */}
                        <span className="w-36 text-right hidden sm:inline-block pr-6 text-sm text-muted-foreground tabular-nums shrink-0">
                          {item.plays || "—"}
                        </span>

                        {/* 3-dots button + Dropdown */}
                        <div className="relative w-8 flex justify-center shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setActiveSongMenuId(activeSongMenuId === item.id ? null : item.id)}
                            className="flex size-7 items-center justify-center rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10 transition-all focus-visible:opacity-100 cursor-pointer"
                            aria-label="Track options"
                          >
                            <MenuDotsIcon size={16} />
                          </button>
                          {activeSongMenuId === item.id && (
                            <div
                              ref={songMenuRef}
                              className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl bg-zinc-900/95 border border-white/10 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSongMenuId(null);
                                  handleAddToQueue(item);
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <ListIcon size={14} />
                                <span>Add to queue</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSongMenuId(null);
                                  void handleStartSongRadio(item);
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <RadioIcon size={14} className="text-sky-400" />
                                <span>Go to song radio</span>
                              </button>
                              {item.albumId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveSongMenuId(null);
                                    onOpenAlbum({ id: item.albumId!, title: item.albumName || "Album", artist: item.artist });
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                                >
                                  <AlbumIcon size={14} />
                                  <span>Go to album</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSongMenuId(null);
                                  onOpenArtist?.({ id: "", name: item.artist });
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <UserPlusIcon size={14} />
                                <span>Go to artist</span>
                              </button>
                              <div className="my-1 h-px bg-white/10" />
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSongMenuId(null);
                                  void copySongShareLink(item);
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <CopyIcon size={14} />
                                <span>Share</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Duration on far right */}
                        <span className="w-12 text-right pr-2 text-sm text-muted-foreground tabular-nums shrink-0">
                          {item.duration || "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {popularItems.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllSongs((current) => !current)}
                    aria-expanded={showAllSongs}
                    className="self-start mt-3 rounded-full bg-white/[0.04] px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                  >
                    {showAllSongs ? "Show less" : "See more"}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* 2. Discography (YouTube Music + Spotify releases merged) */}
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
                  const releaseTypeLabel =
                    release.releaseType === "album"
                      ? "Album"
                      : release.releaseType === "ep"
                        ? "EP"
                        : release.releaseType === "single"
                          ? "Single"
                          : "Album";
                  const subtitle = `${releaseTypeLabel} • ${release.artist || displayedArtist.name}`;

                  return (
                    <AlbumCard
                      key={release.id}
                      artworkUrl={release.artworkUrl}
                      title={release.title}
                      subtitle={subtitle}
                      onClick={() => onOpenAlbum(release)}
                      onContextMenu={(event) => openAlbumMenu(event, release)}
                    />
                  );
                })}
              </div>

              {filteredReleases.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAllReleases((current) => !current)}
                  aria-expanded={showAllReleases}
                  className="self-start rounded-full bg-white/[0.04] px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                >
                  {showAllReleases ? "Show less releases" : `Show all ${filteredReleases.length} releases`}
                </button>
              )}
            </section>
          )}

          {/* 3. Featuring "Artist Name" (YouTube-made playlists) */}
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

          {/* 4. About Section (Card + Modal with Spotify Stats & Full Photo) */}
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold tracking-tight text-foreground">About</h2>
            <div
              onClick={() => setIsAboutModalOpen(true)}
              className="group relative h-80 w-full max-w-2xl cursor-pointer overflow-hidden rounded-2xl bg-card transition-all duration-300 hover:shadow-2xl hover:ring-1 hover:ring-white/20"
            >
              <img
                src={artistHeaderBg}
                alt={displayedArtist.name}
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

              <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-2">
                {spotifyOverview?.monthlyListeners ? (
                  <span className="text-base font-bold text-white/95">
                    {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
                  </span>
                ) : null}
                {spotifyOverview?.cleanBio || spotifyOverview?.bio ? (
                  <p className="line-clamp-3 text-sm text-white/80 leading-relaxed max-w-xl">
                    {spotifyOverview?.cleanBio || sanitizeSpotifyBio(spotifyOverview?.bio || "")}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {/* 5. Discovered on (Mix of fanmade + YT music playlists) */}
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

          {/* 6. Artist Playlists (Curated Spotify Playlists - directly above Fans also like) */}
          {spotifyPlaylists.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Artist Playlists
              </h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {spotifyPlaylists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.coverUrl}
                    title={playlist.name}
                    subtitle={playlist.ownerName || `By ${displayedArtist.name}`}
                    onClick={() => void handleOpenSpotifyPlaylist(playlist)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 7. Fans also like (Similar artists) */}
          {page?.fansAlsoLike && page.fansAlsoLike.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Fans also like</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {page.fansAlsoLike.map((similarArtist) => (
                  <div
                    key={similarArtist.id}
                    onClick={() => onOpenArtist?.(similarArtist)}
                    className="group flex flex-col items-center gap-3 p-3 rounded-xl bg-card hover:bg-white/[0.08] transition-colors cursor-pointer text-center"
                  >
                    <TrackArtwork
                      className="size-28 rounded-full shadow-md transition-transform group-hover:scale-105"
                      size={224}
                      artworkUrl={similarArtist.artworkUrl}
                      iconSize={40}
                      variant="artist"
                    />
                    <div className="flex flex-col w-full min-w-0">
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

          {/* 8. Appears on (Features with other artists) */}
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

            {/* Hero Image (Uncropped / Full aspect container) */}
            <div className="relative w-full max-h-[440px] shrink-0 overflow-hidden bg-zinc-950 flex items-center justify-center">
              <img
                src={artistHeaderBg}
                alt={displayedArtist.name}
                className="max-h-[440px] w-full object-contain sm:object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent pointer-events-none" />
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

                  {/* Social Links with Brand SVG Icons */}
                  <div className="flex flex-col gap-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Socials & Links
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {spotifyOverview?.externalLinks && spotifyOverview.externalLinks.length > 0 ? (
                        spotifyOverview.externalLinks.map((link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.16] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer"
                          >
                            {getSocialIcon(link.name)}
                            <span>{formatSocialName(link.name)}</span>
                            <span className="text-[10px] text-muted-foreground">↗</span>
                          </a>
                        ))
                      ) : spotifyOverview?.instagramUrl ? (
                        <a
                          href={spotifyOverview.instagramUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.16] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer"
                        >
                          <InstagramIcon size={16} className="text-white shrink-0" />
                          <span>Instagram</span>
                          <span className="text-[10px] text-muted-foreground">↗</span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">No external links</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Bio (Sanitized, no raw code!) & Posted By Avatar */}
                <div className="md:col-span-3 flex flex-col justify-between gap-6">
                  <div className="space-y-4">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                      {spotifyOverview?.cleanBio || (spotifyOverview?.bio ? sanitizeSpotifyBio(spotifyOverview.bio) : "No biography available for this artist.")}
                    </p>
                  </div>

                  {/* "Posted by [Artist Name]" */}
                  <div className="flex items-center gap-3 pt-4 border-t border-white/10">
                    <img
                      src={artistAvatar}
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
          {toast.toLowerCase().includes("copied") && (
            <CheckIcon size={18} aria-hidden="true" />
          )}
          <span>{toast}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
