import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlbumIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  FacebookIcon,
  InstagramIcon,
  ListIcon,
  MenuDotsIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  PlayActiveIcon,
  RadioIcon,
  ShareIcon,
  ShuffleIcon,
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
import { AlbumGridSkeleton, TrackListSkeleton } from "../components/Skeleton";
import { TrackArtwork } from "../components/TrackArtwork";
import { ArtworkLightboxModal } from "../components/ArtworkLightboxModal";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { cn, formatCompactNumber } from "@/lib/utils";
import {
  SpotifyService,
  getSpotifyShareUrl,
  sanitizeSpotifyBio,
  type SpotifyArtistOverview,
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
  return null;
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
  const { currentTrackId, isPlaying } = useNowPlaying();

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
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Extra playlists for Featuring and Discovered on fallback
  const [extraFeaturingPlaylists, setExtraFeaturingPlaylists] = useState<Playlist[]>([]);
  const [extraDiscoveredOnPlaylists, setExtraDiscoveredOnPlaylists] = useState<Playlist[]>([]);
  const [fansSpotifyAvatars, setFansSpotifyAvatars] = useState<Record<string, string>>({});

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

    // Search for official playlists and community playlists
    searchController.search(`Featuring ${artistName}`).then((res) => {
      if (active && res.playlists?.length) {
        setExtraFeaturingPlaylists((prev) => [...prev, ...res.playlists]);
      }
    }).catch(() => {});

    searchController.search(`Presenting ${artistName}`).then((res) => {
      if (active && res.playlists?.length) {
        setExtraFeaturingPlaylists((prev) => [...prev, ...res.playlists]);
      }
    }).catch(() => {});

    searchController.search(`${artistName} Hits`).then((res) => {
      if (active && res.playlists?.length) {
        setExtraFeaturingPlaylists((prev) => [...prev, ...res.playlists]);
      }
    }).catch(() => {});

    searchController.search(`${artistName} playlist`).then((res) => {
      if (active && res.playlists?.length) {
        setExtraDiscoveredOnPlaylists((prev) => [...prev, ...res.playlists]);
      }
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [artist, libraryController]);

  // Pre-fetch Spotify avatars for "Fans also like" artists
  useEffect(() => {
    if (!page?.fansAlsoLike?.length) return;
    let active = true;
    for (const similar of page.fansAlsoLike) {
      void SpotifyService.getArtistAvatar(similar.name).then((avatar) => {
        if (active && avatar) {
          setFansSpotifyAvatars((prev) => ({ ...prev, [similar.id]: avatar }));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [page?.fansAlsoLike]);

  const displayedArtist = page?.artist ?? artist;

  // Consistent Spotify-first picture with YouTube fallback
  const artistAvatar =
    spotifyOverview?.avatarUrl ||
    (displayedArtist?.id ? fansSpotifyAvatars[displayedArtist.id] : undefined) ||
    displayedArtist?.artworkUrl;
  const artistHeaderBg =
    spotifyOverview?.headerUrl ||
    spotifyOverview?.galleryUrls?.[0] ||
    artistAvatar;

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

  const copyArtistShareLink = async () => {
    if (!displayedArtist) return;
    let shareUrl = spotifyOverview?.spotifyId
      ? getSpotifyShareUrl("artist", spotifyOverview.spotifyId)
      : null;
    if (!shareUrl) {
      shareUrl = await SpotifyService.searchArtistUrl(displayedArtist.name).catch(() => null);
    }
    if (!shareUrl) {
      shareUrl = `https://music.youtube.com/channel/${displayedArtist.id}`;
    }
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
    const list = [...(page?.playlists ?? []), ...extraFeaturingPlaylists];
    const artistNameLower = (displayedArtist?.name || "").toLowerCase();
    const seen = new Set<string>();
    const officialMatches: Playlist[] = [];

    for (const p of list) {
      if (seen.has(p.id)) continue;
      const lower = p.title.toLowerCase();
      const ownerLower = (p.owner || "").toLowerCase();
      const isOfficial =
        ownerLower.includes("youtube") ||
        lower.startsWith("featuring") ||
        lower.startsWith("presenting") ||
        lower.startsWith("this is") ||
        lower.includes("hits") ||
        lower.includes("best of") ||
        lower.includes("essential");
      
      const containsArtist = lower.includes(artistNameLower) || (p.owner && p.owner.toLowerCase().includes(artistNameLower));
      if (isOfficial && containsArtist) {
        seen.add(p.id);
        officialMatches.push(p);
      }
    }

    if (officialMatches.length > 0) return officialMatches;
    return extraFeaturingPlaylists;
  }, [page?.playlists, displayedArtist?.name, extraFeaturingPlaylists]);

  const discoveredOnPlaylists = useMemo(() => {
    const featSet = new Set(featuringPlaylists.map((p) => p.id));
    const pool = [...(page?.discoveredOn ?? []), ...extraDiscoveredOnPlaylists, ...(page?.playlists ?? [])];
    const seen = new Set<string>();
    const result: Playlist[] = [];

    for (const p of pool) {
      if (featSet.has(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      result.push(p);
    }
    return result;
  }, [page?.discoveredOn, page?.playlists, featuringPlaylists, extraDiscoveredOnPlaylists]);

  // Popular song items based on authentic YouTube Music tracks, enriched with Spotify plays
  const popularItems: PopularSongItem[] = useMemo(() => {
    const allSongs = page?.allSongs ?? [];
    const sourceSongs =
      page?.popularSongs && page.popularSongs.length > 0
        ? page.popularSongs
        : allSongs;

    return sourceSongs.map((yt) => {
      // Fuzzy-match with Spotify top tracks to grab authentic playcount and cover art
      const matchedSpotify = spotifyOverview?.topTracks?.find((st) => {
        const c1 = yt.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        const c2 = st.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return c1.includes(c2) || c2.includes(c1);
      });

      return {
        id: yt.id,
        spotifyTrackId: matchedSpotify?.id,
        name: yt.title,
        artist: yt.artist || displayedArtist?.name || "",
        isExplicit: Boolean(yt.isExplicit || matchedSpotify?.isExplicit),
        plays: matchedSpotify?.playcount || (yt.viewCount ? Number(yt.viewCount).toLocaleString() : compactViews(yt)),
        duration: yt.durationSec ? formatDuration(yt.durationSec) : (yt.duration || ""),
        coverUrl: yt.artworkUrl || matchedSpotify?.coverUrl,
        rawTrack: yt,
        albumName: yt.album,
        albumId: yt.albumId,
      };
    });
  }, [page?.popularSongs, page?.allSongs, spotifyOverview?.topTracks, displayedArtist?.name]);

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
    const trackId = item.rawTrack ? item.rawTrack.id : item.id;
    const queue = page?.allSongs ?? (item.rawTrack ? [item.rawTrack] : []);
    void playerController.playTrackById(trackId, queue);
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
    <div className="relative flex flex-col gap-10 pb-20">
      {/* Ambient Blurred Background Glow */}
      <div className="pointer-events-none absolute -top-8 -left-6 -right-6 h-[650px] overflow-hidden -z-10 opacity-35 blur-[90px] saturate-200">
        <img
          src={artistHeaderBg}
          alt=""
          className="w-full h-full object-cover scale-110"
        />
      </div>

      {/* Spotify Panoramic Hero Header */}
      <div className="relative -mx-6 md:-mx-8 -mt-6 md:-mt-8 min-h-[360px] md:min-h-[400px] flex flex-col justify-end overflow-hidden p-6 md:p-10 rounded-b-2xl">
        {/* Hero Background Image with Gradient Overlay */}
        <div className="absolute inset-0 -z-10 bg-zinc-900">
          <img
            src={artistHeaderBg}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center sm:object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-black/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
        </div>

        {/* Hero Content with Circular PFP beside Name */}
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-end gap-6 max-w-5xl">
          {/* Circular PFP that opens Lightbox on click */}
          <button
            type="button"
            onClick={() => setIsLightboxOpen(true)}
            className="group relative size-36 sm:size-44 md:size-48 shrink-0 rounded-full overflow-hidden shadow-2xl ring-2 ring-white/20 transition-transform duration-300 hover:scale-105 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Click to view artist photo"
          >
            <TrackArtwork
              className="size-full object-cover"
              artworkUrl={artistAvatar}
              iconSize={72}
              loading="eager"
              variant="artist"
            />
          </button>

          {/* Artist Name and Listeners */}
          <div className="flex flex-col gap-2.5 min-w-0 flex-1 pb-1">
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-white drop-shadow-xl select-text line-clamp-2">
              {displayedArtist.name}
            </h1>

            {/* Monthly Listeners / Subscribers */}
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold text-white/90 drop-shadow-md">
              {spotifyOverview?.monthlyListeners ? (
                <span>
                  {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
                </span>
              ) : formattedSubCount ? (
                <span>{formattedSubCount}</span>
              ) : null}
              {spotifyOverview?.monthlyListeners && formattedSubCount && (
                <>
                  <span className="opacity-60">•</span>
                  <span className="opacity-80 font-normal">{formattedSubCount}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Hero Action Controls Row */}
      <div className="flex items-center gap-6 pt-2">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={togglePlayCollection}
          disabled={isLoading || Boolean(error) || !page?.allSongs.length}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer"
          aria-label={isCurrentCollection && isPlaying ? "Pause" : "Play"}
        >
          {isCurrentCollection && isPlaying ? (
            <PauseIcon size={26} fill="currentColor" />
          ) : (
            <PlayIcon size={26} fill="currentColor" className="ml-1" />
          )}
        </button>

        {/* Shuffle Button */}
        <button
          type="button"
          onClick={() => void playShuffled()}
          disabled={isLoading || Boolean(error) || !page?.allSongs.length}
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-white transition-colors cursor-pointer"
          aria-label="Shuffle play"
        >
          <ShuffleIcon size={22} />
        </button>

        {/* Follow / Following Button */}
        <button
          type="button"
          onClick={() => void toggleArtistSubscription()}
          disabled={isLoading || Boolean(error) || isSubscribing}
          className={cn(
            "rounded-full px-5 py-2 text-xs md:text-sm font-bold tracking-wider uppercase border transition-all duration-200 cursor-pointer",
            isSubscribed
              ? "border-white/30 text-white hover:border-white/60 hover:bg-white/10"
              : "border-white/30 bg-transparent text-white hover:border-white hover:scale-105",
          )}
        >
          {isSubscribing
            ? isSubscribed ? "Unfollowing..." : "Following..."
            : isSubscribed ? "Following" : "Follow"}
        </button>

        {/* 3-dots Dropdown Menu */}
        <div className="relative" ref={headerMenuRef}>
          <button
            type="button"
            onClick={() => setIsHeaderMenuOpen((prev) => !prev)}
            className="flex size-10 items-center justify-center rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="More artist options"
          >
            <MenuDotsIcon size={20} />
          </button>

          {isHeaderMenuOpen && (
            <div className="absolute left-0 top-full mt-2 z-50 w-56 rounded-xl bg-zinc-900/95 border border-white/10 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
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

              <div className="my-1 h-px bg-white/10" />

              <button
                type="button"
                onClick={() => {
                  setIsHeaderMenuOpen(false);
                  void copyArtistShareLink();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <ShareIcon size={16} />
                <span>Share artist link</span>
              </button>
            </div>
          )}
        </div>
      </div>

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
                  const subtitle = release.year
                    ? `${release.year} • ${releaseTypeLabel}`
                    : releaseTypeLabel;

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
              className="group relative h-[380px] md:h-[440px] w-full max-w-4xl cursor-pointer overflow-hidden rounded-2xl bg-card transition-all duration-300 hover:shadow-2xl hover:ring-1 hover:ring-white/20"
            >
              <img
                src={artistHeaderBg}
                alt={displayedArtist.name}
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

              {/* Top-Right Spotify World Rank Badge (Matches Image 5) */}
              {spotifyOverview?.worldRank ? (
                <div className="absolute top-5 right-5 sm:top-6 sm:right-6 z-10 flex size-16 sm:size-20 shrink-0 flex-col items-center justify-center rounded-full bg-[#0D72EC] text-white shadow-xl shadow-[#0D72EC]/40 select-none">
                  <span className="text-xl sm:text-2xl font-black tracking-tight leading-none">#{spotifyOverview.worldRank}</span>
                  <span className="text-[10px] sm:text-[11px] font-bold tracking-tight text-white/95 leading-tight mt-0.5">in the world</span>
                </div>
              ) : null}

              <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 flex flex-col gap-2">
                {spotifyOverview?.monthlyListeners ? (
                  <span className="text-base md:text-lg font-bold text-white/95">
                    {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
                  </span>
                ) : null}
                {spotifyOverview?.cleanBio || spotifyOverview?.bio ? (
                  <p className="line-clamp-3 text-sm md:text-base text-white/80 leading-relaxed max-w-2xl">
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

          {/* 7. Fans also like (Similar artists) */}
          {page?.fansAlsoLike && page.fansAlsoLike.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Fans also like</h2>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {page.fansAlsoLike.map((similarArtist) => {
                  const avatarUrl = fansSpotifyAvatars[similarArtist.id] || similarArtist.artworkUrl;
                  return (
                    <div
                      key={similarArtist.id}
                      onClick={() => onOpenArtist?.(similarArtist)}
                      className="group flex flex-col items-center gap-3 cursor-pointer text-center"
                    >
                      <div className="relative size-32 md:size-36 rounded-full overflow-hidden shadow-xl ring-1 ring-white/10 group-hover:scale-105 transition-transform duration-300">
                        <TrackArtwork
                          className="size-full rounded-full object-cover"
                          size={256}
                          artworkUrl={avatarUrl}
                          iconSize={48}
                          variant="artist"
                        />
                      </div>
                      <div className="flex flex-col w-full min-w-0 mt-0.5">
                        <span className="truncate w-full text-sm font-semibold text-white group-hover:underline">
                          {similarArtist.name}
                        </span>
                        <span className="text-xs text-muted-foreground truncate w-full mt-0.5">
                          Artist
                        </span>
                      </div>
                    </div>
                  );
                })}
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
                    <div className="flex items-center gap-3.5 my-1">
                      <div className="flex size-14 md:size-16 shrink-0 items-center justify-center rounded-full bg-[#0D72EC] text-white shadow-lg shadow-[#0D72EC]/40">
                        <span className="text-xl md:text-2xl font-black tracking-tight">#{spotifyOverview.worldRank}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm md:text-base font-bold text-white tracking-wide">in the world</span>
                        <span className="text-xs text-muted-foreground">Spotify Global Rank</span>
                      </div>
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
                            <ArrowUpRightIcon size={12} className="text-white/70 shrink-0" />
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
                          <ArrowUpRightIcon size={12} className="text-white/70 shrink-0" />
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

      <ArtworkLightboxModal
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        artworkUrl={artistAvatar}
        title={displayedArtist.name}
      />
    </div>
  );
}
