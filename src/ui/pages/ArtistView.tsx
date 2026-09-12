import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlbumIcon,
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
  SettingsIcon,
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
import { searchController, useLibraryState, type PlayerControllerActions } from "../../player/playerStore";
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
const artistOverviewMemory = new Map<string, SpotifyArtistOverview>();

const FOLLOWED_ARTISTS_STORAGE_KEY = "amber_followed_artists";

function getFollowedArtistIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLLOWED_ARTISTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {}
  return new Set();
}

function saveFollowedArtistIds(ids: Set<string>) {
  try {
    localStorage.setItem(FOLLOWED_ARTISTS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {}
}

export function ArtistView({
  artist,
  playerController,
  libraryController,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenArtist,
  onOpenDiscography,
  onOpenSettings,
}: {
  artist?: Artist;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenAlbum: (album: Album) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onOpenArtist?: (artist: Artist) => void;
  onOpenSong?: (song: Track) => void;
  onOpenDiscography?: (artist: Artist, releases?: Album[]) => void;
  onOpenSettings?: () => void;
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
  const [extraAppearsOn, setExtraAppearsOn] = useState<Album[]>([]);
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
    const rememberedOverview = artistOverviewMemory.get(artist.name.toLowerCase()) ?? null;
    setPage(remembered);
    setSpotifyOverview(rememberedOverview);
    setSpotifyReleases([]);
    setIsLoading(!remembered);
    setError(null);
    setFilter("all");
    setShowAllSongs(false);
    setShowAllReleases(false);
    setExtraFeaturingPlaylists([]);
    setExtraDiscoveredOnPlaylists([]);
    setExtraAppearsOn([]);

    // Fetch YouTube Music artist page
    void libraryController.getArtist(artist.id, (updated) => {
      if (!active) return;
      setPage(updated);
      artistPageMemory.set(artist.id, updated);
      if (updated?.isCreator) {
        setSpotifyOverview(null);
        setSpotifyReleases([]);
      }
    })
      .then((result) => {
        if (!active) return;
        setPage(result);
        artistPageMemory.set(artist.id, result);
        if (result?.isCreator) {
          setSpotifyOverview(null);
          setSpotifyReleases([]);
        }
      })
      .catch(() => {
        if (active && !remembered) setError("Unable to load this artist.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    // Only fetch Spotify Overview, Discography & Playlists for official music artists (not creator channels)
    const isChannel = Boolean(artist.isCreator);
    if (!isChannel) {
      const artistName = artist.name;
      void SpotifyService.getArtistOverview(artistName)
        .then((overview) => {
          if (active && overview) {
            setSpotifyOverview(overview);
            artistOverviewMemory.set(artistName.toLowerCase(), overview);
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

    searchController.search(`feat. ${artistName}`).then((res) => {
      if (active && res.albums?.length) {
        setExtraAppearsOn((prev) => {
          const ids = new Set(prev.map((a) => a.id));
          const additions = res.albums.filter((a) => !ids.has(a.id));
          return [...prev, ...additions];
        });
      }
    }).catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [artist, libraryController]);

  // Pre-fetch Spotify avatars for "Fans also like" artists. Each avatar is a full artist
  // overview (search + overview, two requests), so the first shelf only — the grid shows
  // eight cards before scrolling anyway, and the rest hydrate from cache on later visits.
  useEffect(() => {
    if (!page?.fansAlsoLike?.length) return;
    let active = true;
    for (const similar of page.fansAlsoLike.slice(0, 8)) {
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
  const isCreatorChannel = Boolean(displayedArtist?.isCreator || page?.isCreator);

  // Consistent Spotify-first picture with YouTube fallback
  const artistAvatar =
    (!isCreatorChannel ? spotifyOverview?.avatarUrl : undefined) ||
    (displayedArtist?.id ? fansSpotifyAvatars[displayedArtist.id] : undefined) ||
    displayedArtist?.artworkUrl;
  /*
   * The hero banner is Spotify's when it publishes one, else the artist page's own landscape
   * header, else nothing at all — a square photo stretched across the hero is not a banner,
   * so with neither source the hero stays plain background.
   */
  const heroBanner = (!isCreatorChannel ? spotifyOverview?.headerUrl : undefined) || displayedArtist?.bannerUrl;
  const heroBackgroundUrl = heroBanner || displayedArtist?.artworkUrl || artistAvatar;
  const aboutCardImage =
    (!isCreatorChannel ? (spotifyOverview?.galleryUrls?.[0] || spotifyOverview?.avatarUrl) : undefined) ||
    displayedArtist?.bannerUrl ||
    displayedArtist?.artworkUrl ||
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

  // Merge YouTube Music releases with Spotify discography, prioritizing Spotify for instant newest drops & accurate dates
  const mergedReleases = useMemo(() => {
    const ytReleases = page?.releases ?? [];
    const seenTitles = new Set<string>();
    const combined: Album[] = [];

    // 1. Add Spotify releases first (already sorted by release date descending)
    for (const sr of spotifyReleases) {
      const clean = sr.name.toLowerCase().trim();
      if (!seenTitles.has(clean)) {
        seenTitles.add(clean);
        combined.push({
          id: `spotify:${sr.id}`,
          title: sr.name,
          artist: displayedArtist?.name || "",
          artworkUrl: sr.coverUrl,
          year: sr.year ? String(sr.year) : undefined,
          releaseDate: sr.date,
          releaseType: sr.type,
        });
      }
    }

    // 2. Add YouTube Music releases if not already present
    for (const yr of ytReleases) {
      const clean = yr.title.toLowerCase().trim();
      if (!seenTitles.has(clean)) {
        seenTitles.add(clean);
        combined.push(yr);
      }
    }

    // 3. For YouTube creators, beatmakers, and remixers: include their channel playlists
    for (const p of page?.playlists ?? []) {
      if (!p || !p.title) continue;
      const clean = p.title.toLowerCase().trim();
      const ownerLower = (p.owner || "").toLowerCase().trim();
      // Exclude official YouTube Music compilations
      const isOfficial =
        ownerLower.includes("youtube") ||
        ownerLower.includes("yt") ||
        clean.startsWith("featuring") ||
        clean.startsWith("presenting") ||
        clean.startsWith("this is") ||
        clean.includes("hits") ||
        clean.includes("best of") ||
        clean.includes("essential");
      if (isOfficial) continue;

      if (!seenTitles.has(clean)) {
        seenTitles.add(clean);
        combined.push({
          id: p.id,
          title: p.title,
          artist: displayedArtist?.name || p.owner || "",
          artworkUrl: p.artworkUrl,
          releaseType: "album",
        });
      }
    }

    // 4. If an artist has few or no album releases (e.g. YT users dropping singles/freetype beats),
    // include their video/song uploads as singles so their discography is fully populated
    if (combined.length < 5 && (page?.allSongs?.length || page?.popularSongs?.length)) {
      const songs = page?.allSongs && page.allSongs.length > 0 ? page.allSongs : (page?.popularSongs ?? []);
      for (const s of songs) {
        if (!s || !s.title) continue;
        const clean = s.title.toLowerCase().trim();
        if (!seenTitles.has(clean)) {
          seenTitles.add(clean);
          combined.push({
            id: s.albumId || s.id,
            title: s.title,
            artist: s.artist || displayedArtist?.name || "",
            artworkUrl: s.artworkUrl,
            releaseType: "single",
          });
        }
      }
    }

    return combined;
  }, [page?.releases, page?.playlists, page?.allSongs, page?.popularSongs, spotifyReleases, displayedArtist?.name]);

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
  const compactSubCount = useMemo(() => {
    if (!subCount) return undefined;
    return formatCompactNumber(subCount);
  }, [subCount]);
  const formattedSubCount = useMemo(() => {
    if (!subCount) return undefined;
    const compact = formatCompactNumber(subCount);
    if (compact) return `${compact} subscribers`;
    const cleaned = subCount.trim();
    return cleaned.toLowerCase().includes("subscriber") ? cleaned : `${cleaned} subscribers`;
  }, [subCount]);

  const libraryState = useLibraryState();
  const account = libraryState.library?.account;
  const isOwnChannel = useMemo(() => {
    if (!account?.name || !displayedArtist?.name) return false;
    const cleanAccountName = account.name.trim().toLowerCase();
    const cleanArtistName = displayedArtist.name.trim().toLowerCase();
    return cleanAccountName === cleanArtistName;
  }, [account?.name, displayedArtist?.name]);

  const librarySongs = useMemo(() => {
    if (!libraryState.library || !displayedArtist?.name) return [];
    const nameLower = displayedArtist.name.toLowerCase().trim();
    const pool = [
      ...(libraryState.library.likedSongs ?? []),
      ...(libraryState.library.librarySongs ?? []),
    ];
    const seen = new Set<string>();
    const matches: Track[] = [];
    for (const t of pool) {
      if (!t || !t.id || seen.has(t.id)) continue;
      const artistMatches =
        t.artist?.toLowerCase().includes(nameLower) ||
        t.artists?.some((a) => a.name.toLowerCase().includes(nameLower));
      if (artistMatches) {
        seen.add(t.id);
        matches.push(t);
      }
    }
    return matches;
  }, [libraryState.library, displayedArtist?.name]);

  const libraryAlbums = useMemo(() => {
    if (!libraryState.library || !displayedArtist?.name) return [];
    const nameLower = displayedArtist.name.toLowerCase().trim();
    const albums = libraryState.library.albums ?? [];
    return albums.filter((a) => a.artist?.toLowerCase().includes(nameLower));
  }, [libraryState.library, displayedArtist?.name]);

  // Separate Featuring playlists (Official YT curated) and Discovered On playlists (community / fanmade)
  const featuringPlaylists = useMemo(() => {
    const list = [...(page?.featuredOn ?? []), ...(page?.playlists ?? []), ...extraFeaturingPlaylists];
    const artistNameLower = (displayedArtist?.name || "").toLowerCase().trim();
    const seen = new Set<string>();
    const officialMatches: Playlist[] = [];

    for (const p of list) {
      if (!p || !p.title || seen.has(p.id) || p.id.startsWith("spotify:")) continue;
      const lower = p.title.toLowerCase().trim();
      if (lower.includes("unknown")) continue;
      const ownerLower = (p.owner || "").toLowerCase().trim();
      const isOfficial = ownerLower.includes("youtube") || ownerLower.includes("yt");

      const containsArtist = lower.includes(artistNameLower) || ownerLower.includes(artistNameLower);
      if (isOfficial || (containsArtist && (lower.startsWith("featuring") || lower.startsWith("presenting") || lower.startsWith("this is")))) {
        seen.add(p.id);
        officialMatches.push({
          ...p,
          owner: p.owner || "YouTube Music",
        });
      }
    }

    return officialMatches;
  }, [page?.featuredOn, page?.playlists, displayedArtist?.name, extraFeaturingPlaylists]);

  const discoveredOnPlaylists = useMemo(() => {
    const featSet = new Set(featuringPlaylists.map((p) => p.id));
    const releaseTitles = new Set(mergedReleases.map((r) => r.title.toLowerCase().trim()));
    const releaseIds = new Set(mergedReleases.map((r) => r.id));
    const artistNameLower = (displayedArtist?.name || "").toLowerCase().trim();
    const pool = [...(page?.discoveredOn ?? []), ...extraDiscoveredOnPlaylists, ...(page?.playlists ?? [])];
    const seen = new Set<string>();
    const result: Playlist[] = [];

    for (const p of pool) {
      if (!p || !p.title || featSet.has(p.id) || seen.has(p.id) || p.id.startsWith("spotify:")) continue;
      const lower = p.title.toLowerCase().trim();
      const ownerLower = (p.owner || "").toLowerCase().trim();
      if (lower.includes("unknown")) continue;

      // Filter out artist's own albums or releases
      if (releaseTitles.has(lower) || releaseIds.has(p.id)) continue;

      // Filter out if owner is the artist (an album release or official upload)
      if (ownerLower === artistNameLower) continue;

      // Exclude official YouTube Music playlists (those belong exclusively in "Featured on")
      const isOfficial = ownerLower.includes("youtube") || ownerLower.includes("yt");
      if (isOfficial) continue;

      seen.add(p.id);
      result.push(p);
    }
    return result;
  }, [page?.discoveredOn, page?.playlists, featuringPlaylists, extraDiscoveredOnPlaylists, mergedReleases, displayedArtist?.name]);

  const artistPlaylists = useMemo(() => {
    const artistLower = (displayedArtist?.name || "").toLowerCase().trim();
    const pool = [...(page?.playlists ?? []), ...extraDiscoveredOnPlaylists];
    const seen = new Set<string>();
    const result: Playlist[] = [];

    for (const p of pool) {
      if (!p || !p.title || seen.has(p.id) || p.id.startsWith("spotify:")) continue;
      const lower = p.title.toLowerCase().trim();
      const ownerLower = (p.owner || "").toLowerCase().trim();
      if (lower.includes("unknown")) continue;

      const isByArtist =
        ownerLower.includes(artistLower) ||
        lower.startsWith(artistLower) ||
        lower.includes(`by ${artistLower}`);
      if (isByArtist) {
        seen.add(p.id);
        result.push(p);
      }
    }
    return result;
  }, [page?.playlists, extraDiscoveredOnPlaylists, displayedArtist?.name]);

  const combinedAppearsOn = useMemo(() => {
    const list = [...(page?.appearsOn ?? []), ...extraAppearsOn];
    const seen = new Set<string>();
    const result: Album[] = [];
    for (const item of list) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
    return result;
  }, [page?.appearsOn, extraAppearsOn]);

  const isCreator = Boolean(
    displayedArtist?.isCreator ||
    page?.isCreator ||
    (!spotifyOverview && !page?.releases?.length && (page?.allSongs?.length || page?.popularSongs?.length))
  );

  // Popular song items based on authentic YouTube Music tracks, enriched with Spotify plays
  const popularItems: PopularSongItem[] = useMemo(() => {
    const allSongs = page?.allSongs ?? [];
    const sourceSongs =
      page?.popularSongs && page.popularSongs.length > 0
        ? page.popularSongs
        : allSongs;

    const items = sourceSongs.map((yt) => {
      // Fuzzy-match with Spotify top tracks to grab authentic playcount and cover art
      const matchedSpotify = spotifyOverview?.topTracks?.find((st) => {
        const c1 = yt.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        const c2 = st.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return c1.includes(c2) || c2.includes(c1);
      });

      let durationStr = "";
      if (yt.durationSec && yt.durationSec > 0) {
        durationStr = formatDuration(yt.durationSec);
      } else if (matchedSpotify?.durationMs && matchedSpotify.durationMs > 0) {
        durationStr = formatDuration(Math.round(matchedSpotify.durationMs / 1000));
      } else if (yt.duration && yt.duration.trim().length > 0 && yt.duration.trim() !== "0:00") {
        durationStr = yt.duration;
      } else {
        durationStr = "3:18";
      }

      return {
        id: yt.id,
        spotifyTrackId: matchedSpotify?.id,
        name: yt.title,
        artist: yt.artist || displayedArtist?.name || "",
        isExplicit: Boolean(yt.isExplicit || matchedSpotify?.isExplicit),
        plays: matchedSpotify?.playcount || (yt.viewCount ? Number(yt.viewCount).toLocaleString() : compactViews(yt)),
        duration: durationStr,
        coverUrl: yt.artworkUrl || matchedSpotify?.coverUrl,
        rawTrack: yt,
        albumName: yt.album,
        albumId: yt.albumId,
      };
    });

    const parsePlaysNumber = (item: { plays: string; rawTrack?: Track }): number => {
      if (item.rawTrack?.viewCount) {
        const v = Number(item.rawTrack.viewCount);
        if (!isNaN(v) && v > 0) return v;
      }
      if (item.plays) {
        const cleaned = item.plays.replace(/,/g, "").trim();
        const num = Number(cleaned);
        if (!isNaN(num) && num > 0) return num;
      }
      if (item.rawTrack?.viewCountText) {
        const txt = item.rawTrack.viewCountText.toLowerCase().replace(/views?/g, "").trim();
        if (txt.endsWith("b")) return parseFloat(txt) * 1e9;
        if (txt.endsWith("m")) return parseFloat(txt) * 1e6;
        if (txt.endsWith("k")) return parseFloat(txt) * 1e3;
        const num = parseFloat(txt.replace(/,/g, ""));
        if (!isNaN(num) && num > 0) return num;
      }
      return 0;
    };

    items.sort((a, b) => parsePlaysNumber(b) - parsePlaysNumber(a));
    return items;
  }, [page?.popularSongs, page?.allSongs, spotifyOverview?.topTracks, displayedArtist?.name]);

  const displayedPopularItems = showAllSongs ? popularItems : popularItems.slice(0, 10);

  useEffect(() => {
    const followedSet = getFollowedArtistIds();
    const isFollowedLocally = (artist?.id && followedSet.has(artist.id)) ||
      (displayedArtist?.id && followedSet.has(displayedArtist.id)) ||
      (displayedArtist?.name && followedSet.has(displayedArtist.name.toLowerCase()));
    setIsSubscribed(page?.subscribed || Boolean(isFollowedLocally));
  }, [page?.subscribed, artist?.id, displayedArtist?.id, displayedArtist?.name]);

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
    // If clicking current track, toggle play/pause immediately
    if (item.rawTrack?.id === currentTrackId || item.id === currentTrackId) {
      if (!isPlaying) {
        void playerController.play();
      } else {
        playerController.togglePlayPause();
      }
      return;
    }

    const popularTracks = popularItems.map((p) => p.rawTrack).filter((t): t is Track => Boolean(t));
    const allTracks = page?.allSongs ?? [];
    let queue = popularTracks;
    if (!queue.some((t) => t.id === item.id)) {
      queue = allTracks;
    }
    if (item.rawTrack && !queue.some((t) => t.id === item.rawTrack!.id)) {
      queue = [item.rawTrack, ...queue];
    }

    const trackId = item.rawTrack ? item.rawTrack.id : item.id;
    await playerController.playTrackById(trackId, queue);
    void playerController.play();
  };

  const toggleArtistSubscription = async () => {
    if (isSubscribing) return;
    const nextSubscribed = !isSubscribed;
    setIsSubscribing(true);
    setIsSubscribed(nextSubscribed);

    // Persist locally
    const followedSet = getFollowedArtistIds();
    const artistKey = displayedArtist.id || artist.id;
    if (nextSubscribed) {
      if (artistKey) followedSet.add(artistKey);
      if (displayedArtist.name) followedSet.add(displayedArtist.name.toLowerCase());
    } else {
      if (artistKey) followedSet.delete(artistKey);
      if (displayedArtist.name) followedSet.delete(displayedArtist.name.toLowerCase());
    }
    saveFollowedArtistIds(followedSet);

    try {
      await libraryController.setArtistSubscribed(displayedArtist, nextSubscribed);
      showToast(
        isCreator
          ? nextSubscribed ? "Subscribed to channel" : "Unsubscribed from channel"
          : nextSubscribed ? "Following artist" : "Unfollowed artist"
      );
    } catch {
      showToast(
        isCreator
          ? nextSubscribed ? "Subscribed (saved locally)" : "Unsubscribed"
          : nextSubscribed ? "Following artist (saved locally)" : "Unfollowed artist"
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <div className="relative flex flex-col gap-10 pb-20">
      {/* Ambient Gaussian Glow Background */}
      <div className="pointer-events-none absolute -top-12 -left-8 -right-8 h-[550px] overflow-hidden -z-10 opacity-35 blur-[60px] saturate-150">
        <img
          src={heroBackgroundUrl}
          alt=""
          className="w-full h-full object-cover scale-110"
        />
      </div>

      {/* Modern Panoramic Hero Header */}
      <div className="relative isolate -mx-6 md:-mx-8 -mt-6 md:-mt-8 min-h-[380px] md:min-h-[440px] flex flex-col justify-end overflow-hidden p-6 md:p-10 rounded-b-2xl">
        {/* Hero Background — real banner (Spotify, else the artist page's landscape header),
            or nothing: no blurred PFP substitute, just the gradients over plain background. */}
        <div className="absolute inset-0 z-0 overflow-hidden bg-zinc-950">
          {heroBanner ? (
            <img
              src={heroBanner}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover object-[center_25%] opacity-90 transition-transform duration-700"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-background/80" />
        </div>

        {/* Hero Content with Circular PFP beside Name and Inline Controls */}
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

          {/* Artist Name, Stats, Bio, and Action Controls */}
          <div className="flex flex-col gap-3 min-w-0 flex-1 pb-1">
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-white drop-shadow-xl select-text leading-[1.15] pb-2 break-words">
              {displayedArtist.name}
            </h1>

            {/* Monthly Listeners / Subscribers */}
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold text-white/90 drop-shadow-md">
              {!isCreator && spotifyOverview?.monthlyListeners ? (
                <span>
                  {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
                </span>
              ) : formattedSubCount ? (
                <span>{formattedSubCount}</span>
              ) : null}
              {!isCreator && spotifyOverview?.monthlyListeners && formattedSubCount && (
                <>
                  <span className="opacity-60">•</span>
                  <span className="opacity-80 font-normal">{formattedSubCount}</span>
                </>
              )}
            </div>

            {/* Short Bio Snippet (Official Artists Only) */}
            {!isCreator && (spotifyOverview?.cleanBio || spotifyOverview?.bio) && (
              <p className="line-clamp-2 text-xs md:text-sm text-white/70 max-w-xl">
                {spotifyOverview?.cleanBio || sanitizeSpotifyBio(spotifyOverview?.bio || "")}
                <button
                  type="button"
                  onClick={() => setIsAboutModalOpen(true)}
                  className="ml-1.5 font-bold text-white underline hover:text-white/80 cursor-pointer"
                >
                  MORE
                </button>
              </p>
            )}

            {/* Hero Action Controls Inline Under Listeners */}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              {/* Play/Pause Button */}
              <button
                type="button"
                onClick={togglePlayCollection}
                disabled={isLoading || Boolean(error) || !page?.allSongs.length}
                className="flex size-12 sm:size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer"
                aria-label={isCurrentCollection && isPlaying ? "Pause" : "Play"}
              >
                {isCurrentCollection && isPlaying ? (
                  <PauseIcon size={24} fill="currentColor" />
                ) : (
                  <PlayIcon size={24} fill="currentColor" className="ml-1" />
                )}
              </button>

              {/* Shuffle Button */}
              <button
                type="button"
                onClick={() => void playShuffled()}
                disabled={isLoading || Boolean(error) || !page?.allSongs.length}
                className="flex size-10 items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Shuffle play"
              >
                <ShuffleIcon size={22} />
              </button>

              {/* Follow / Subscribe / Settings Button */}
              {isOwnChannel ? (
                <button
                  type="button"
                  onClick={() => onOpenSettings?.()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 px-5 py-2 text-xs md:text-sm font-bold tracking-wider uppercase text-white shadow-lg backdrop-blur-md transition-all duration-200 cursor-pointer select-none active:scale-95"
                >
                  <SettingsIcon size={16} />
                  <span>Settings</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void toggleArtistSubscription()}
                  disabled={isLoading || Boolean(error) || isSubscribing}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs md:text-sm font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none",
                    isSubscribed
                      ? "bg-white hover:bg-white/90 text-black shadow-lg active:scale-95"
                      : "border border-white/40 bg-black/30 text-white hover:border-white hover:bg-white/10 active:scale-95",
                  )}
                >
                  <span>
                    {isCreator
                      ? isSubscribed
                        ? "Subscribed"
                        : compactSubCount ? `Subscribe ${compactSubCount}` : "Subscribe"
                      : isSubscribed
                        ? compactSubCount ? `Following • ${compactSubCount}` : "Following"
                        : compactSubCount ? `Follow • ${compactSubCount}` : "Follow"}
                  </span>
                </button>
              )}

              {/* Share button */}
              <button
                type="button"
                onClick={() => void copyArtistShareLink()}
                className="flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-xs md:text-sm font-semibold text-white hover:border-white/40 hover:bg-white/10 transition-colors cursor-pointer"
                title="Share artist link"
              >
                <ShareIcon size={15} />
                <span>Share</span>
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
                    {isOwnChannel ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsHeaderMenuOpen(false);
                          onOpenSettings?.();
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <SettingsIcon size={16} />
                        <span>Channel settings</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsHeaderMenuOpen(false);
                          void toggleArtistSubscription();
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        {isSubscribed ? <CheckIcon size={16} className="text-emerald-400" /> : <UserPlusIcon size={16} />}
                        <span>{isCreator ? (isSubscribed ? "Unsubscribe" : "Subscribe") : (isSubscribed ? "Unfollow" : "Follow")}</span>
                      </button>
                    )}

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
          </div>
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

      {!isLoading && !error && isCreator && (
        <div className="flex flex-col gap-10">
          {/* Videos Section (16:9 Widescreen Cards) */}
          {((page?.allSongs?.length ?? 0) > 0 || (page?.popularSongs?.length ?? 0) > 0) && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Videos</h2>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
                {(page?.allSongs && page.allSongs.length > 0 ? page.allSongs : (page?.popularSongs ?? [])).map((song) => {
                  const isSongPlaying = isPlaying && currentTrackId === song.id;
                  return (
                    <div
                      key={song.id}
                      onClick={() => void playerController.playTrackById(song.id, page?.allSongs ?? [song])}
                      className="group flex flex-col gap-2.5 cursor-pointer rounded-xl p-2 transition-colors hover:bg-white/[0.06]"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-card shadow-lg">
                        <TrackArtwork
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                          artworkUrl={song.artworkUrl}
                          size={400}
                          iconSize={48}
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl">
                            {isSongPlaying ? <PauseIcon size={20} fill="currentColor" /> : <PlayIcon size={20} fill="currentColor" className="ml-0.5" />}
                          </div>
                        </div>
                        {song.duration && (
                          <div className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            {song.duration}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-sm text-foreground group-hover:text-white line-clamp-2">
                          {song.title}
                        </span>
                        <span className="text-xs text-muted-foreground truncate mt-0.5">
                          {displayedArtist.name} {song.viewCountText ? `• ${song.viewCountText}` : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Playlists Section */}
          {page?.playlists && page.playlists.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Playlists</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {page.playlists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.artworkUrl}
                    title={playlist.title}
                    subtitle={playlist.owner || displayedArtist.name}
                    onClick={() => onOpenPlaylist(playlist)}
                    onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!isLoading && !error && !isCreator && (
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
                            className="truncate text-xs text-muted-foreground hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] cursor-pointer inline-block mt-0.5 w-fit transition-all"
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
                                    const raw = page?.popularSongs?.find((s) => s.id === item.id) || page?.allSongs?.find((s) => s.id === item.id);
                                    onOpenAlbum({
                                      id: item.albumId!,
                                      title: item.albumName || "Album",
                                      artist: item.artist,
                                      year: raw?.year,
                                      releaseDate: raw?.releaseDate,
                                    });
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

                {popularItems.length > 10 && (
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

          {/* From your library Section */}
          {(librarySongs.length > 0 || libraryAlbums.length > 0) && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">From your library</h2>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
                {librarySongs.map((libTrack) => (
                  <div
                    key={`lib-track-${libTrack.id}`}
                    onClick={() => {
                      void playerController.playTrackById(libTrack.id, [libTrack, ...librarySongs]);
                    }}
                    className="group relative flex flex-col p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
                  >
                    <div className="relative aspect-square w-full rounded-lg overflow-hidden shadow-lg bg-zinc-800">
                      <TrackArtwork
                        artworkUrl={libTrack.artworkUrl}
                        className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
                        iconSize={48}
                        loading="lazy"
                      />
                      {/* Hover Play Button */}
                      <div className="absolute right-2.5 bottom-2.5 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200 shadow-xl">
                        <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 active:scale-95 shadow-lg">
                          <PlayIcon size={20} fill="currentColor" className="ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col mt-2.5 min-w-0">
                      <span className="truncate text-sm font-semibold text-white group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all">
                        {libTrack.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground mt-0.5">
                        Song • {displayedArtist.name}
                      </span>
                    </div>
                  </div>
                ))}
                {libraryAlbums.map((libAlbum) => (
                  <div
                    key={`lib-album-${libAlbum.id}`}
                    onClick={() => {
                      onOpenAlbum(libAlbum);
                    }}
                    className="group relative flex flex-col p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
                  >
                    <div className="relative aspect-square w-full rounded-lg overflow-hidden shadow-lg bg-zinc-800">
                      <TrackArtwork
                        artworkUrl={libAlbum.artworkUrl}
                        className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
                        iconSize={48}
                        loading="lazy"
                      />
                      {/* Hover Play Button */}
                      <div
                        className="absolute right-2.5 bottom-2.5 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200 shadow-xl"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenAlbum(libAlbum);
                        }}
                      >
                        <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground hover:scale-105 active:scale-95 shadow-lg">
                          <PlayIcon size={20} fill="currentColor" className="ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col mt-2.5 min-w-0">
                      <span className="truncate text-sm font-semibold text-white group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all">
                        {libAlbum.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground mt-0.5">
                        Album • {libAlbum.year || displayedArtist.name}
                      </span>
                    </div>
                  </div>
                ))}
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
                  className="group/discog flex items-center gap-1.5 text-left focus-visible:outline-none cursor-pointer"
                  title={`View full ${displayedArtist.name} discography`}
                >
                  <h2 className="text-xl font-bold tracking-tight text-foreground group-hover/discog:text-white group-hover/discog:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all">
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

          {/* 3. Featured on (YouTube-made official playlists) */}
          {featuringPlaylists.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Featured on
              </h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {featuringPlaylists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.artworkUrl}
                    title={playlist.title}
                    subtitle={playlist.owner || "YouTube Music"}
                    isOfficialYouTube={true}
                    onClick={() => onOpenPlaylist(playlist)}
                    onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Playlists by {artist} */}
          {artistPlaylists.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                Playlists by {displayedArtist.name}
              </h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {artistPlaylists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.artworkUrl}
                    title={playlist.title}
                    subtitle={playlist.owner || displayedArtist.name}
                    onClick={() => onOpenPlaylist(playlist)}
                    onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 4. About Section (Card + Modal with Spotify Stats & Full Photo) */}
          {(spotifyOverview?.monthlyListeners || spotifyOverview?.bio || spotifyOverview?.cleanBio || subCount) && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">About</h2>
              <div
                onClick={() => setIsAboutModalOpen(true)}
                className="group relative h-[340px] md:h-[380px] w-full max-w-2xl cursor-pointer overflow-hidden rounded-2xl bg-black/40 border border-white/10 transition-all duration-300 hover:shadow-2xl hover:border-white/30 flex items-center justify-center"
              >
                {/* Full Bleed Spotify Artist Photo / Channel Banner */}
                <img
                  src={aboutCardImage}
                  alt={displayedArtist.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover object-center z-0 transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none z-10" />

                {/* Spotify About layout: listeners + bio bottom-left, world-rank circle bottom-right */}
                <div className="absolute bottom-0 left-0 right-0 p-6 md:p-7 z-10 flex items-end justify-between gap-6">
                  <div className="flex flex-col gap-2 min-w-0">
                    {!isCreator && spotifyOverview?.monthlyListeners ? (
                      <span className="text-base md:text-lg font-bold text-white/95">
                        {spotifyOverview.monthlyListeners.toLocaleString()} monthly listeners
                      </span>
                    ) : formattedSubCount ? (
                      <span className="text-base md:text-lg font-bold text-white/95">
                        {formattedSubCount}
                      </span>
                    ) : null}
                    {!isCreator && (spotifyOverview?.cleanBio || spotifyOverview?.bio) ? (
                      <p className="line-clamp-3 md:line-clamp-4 text-sm text-white/80 leading-relaxed max-w-xl">
                        {spotifyOverview?.cleanBio || sanitizeSpotifyBio(spotifyOverview?.bio || "")}
                      </p>
                    ) : null}
                  </div>
                  {!isCreator && spotifyOverview?.worldRank ? (
                    <div className="flex size-16 sm:size-18 shrink-0 flex-col items-center justify-center rounded-full bg-[#0D72EC] text-white shadow-xl shadow-[#0D72EC]/40 select-none">
                      <span className="text-xl sm:text-2xl font-black tracking-tight leading-none">#{spotifyOverview.worldRank}</span>
                      <span className="text-[10px] font-bold tracking-tight text-white/95 leading-tight mt-0.5">in the world</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          )}

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
                        <span className="truncate w-full text-sm font-semibold text-white group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all">
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
          {combinedAppearsOn.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Appears on</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {combinedAppearsOn.map((album) => (
                  <AlbumCard
                    key={album.id}
                    artworkUrl={album.artworkUrl}
                    title={album.title}
                    subtitle={
                      album.artist && album.artist !== "Unknown artist"
                        ? album.artist
                        : album.artists?.[0]?.name && album.artists[0].name !== "Unknown artist"
                          ? album.artists[0].name
                          : (displayedArtist?.name || "Featured release")
                    }
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
              <CloseIcon size={16} />
            </button>

            {/* Hero Image: Full uncropped image with natural black bars for 16:9 and 9:16 */}
            <div className="relative w-full h-[360px] sm:h-[440px] md:h-[500px] shrink-0 bg-black flex items-center justify-center overflow-hidden">
              <img
                src={spotifyOverview?.galleryUrls?.[0] || spotifyOverview?.headerUrl || displayedArtist?.bannerUrl || displayedArtist?.artworkUrl || artistAvatar}
                alt={displayedArtist.name}
                className="max-h-full max-w-full w-auto h-auto object-contain object-center select-none"
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
                      {spotifyOverview?.monthlyListeners ? "Monthly Listeners" : "Subscribers"}
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
                          <button
                            key={link.url}
                            type="button"
                            onClick={() => void openUrl(link.url)}
                            className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.18] active:scale-95 px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer shadow-sm"
                          >
                            {getSocialIcon(link.name)}
                            <span>{formatSocialName(link.name)}</span>
                          </button>
                        ))
                      ) : spotifyOverview?.instagramUrl ? (
                        <button
                          type="button"
                          onClick={() => void openUrl(spotifyOverview.instagramUrl!)}
                          className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.18] active:scale-95 px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer shadow-sm"
                        >
                          <InstagramIcon size={16} className="text-white shrink-0" />
                          <span>Instagram</span>
                        </button>
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
      />
    </div>
  );
}
