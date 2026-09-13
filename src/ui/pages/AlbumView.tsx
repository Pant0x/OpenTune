import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn, formatCompactNumber } from "@/lib/utils";
import { ClockIcon, CloseIcon, HeartActiveIcon, MenuDotsIcon, SearchIcon, ShareIcon } from "@/ui/icons";
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
import { formatCollectionMeta, MediaHeader, parseTrackDurationToSeconds } from "../components/MediaHeader";
import { useKeyboardShortcuts } from "../settings/keyboardShortcuts";
import { shouldStartPageSearch } from "./pageSearchKeyboard";
import { AlbumCard } from "../components/AlbumCard";
import { TrackArtwork } from "../components/TrackArtwork";
import { SpotifyService, type SpotifyAlbumMetadata, useSpotifyArtistAvatar } from "../../services/SpotifyService";

function formatDuration(totalSec?: number, fallbackDuration?: string): string {
  if (typeof totalSec === "number" && !isNaN(totalSec) && totalSec > 0) {
    const minutes = Math.floor(totalSec / 60);
    const seconds = Math.floor(totalSec % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  if (fallbackDuration && typeof fallbackDuration === "string" && fallbackDuration.trim()) {
    return fallbackDuration.trim();
  }
  return "";
}

const SEARCH_FIELD =
  "group/search flex min-h-8 items-center gap-1.5 overflow-hidden rounded-full bg-white/[0.04] px-2.5 " +
  "text-muted-foreground transition-[width,background-color] duration-200 cursor-text " +
  "hover:bg-white/[0.08] focus-within:bg-white/[0.08] focus-within:text-foreground " +
  "[&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-sm " +
  "[&_input]:text-foreground [&_input]:outline-none [&_input]:placeholder:text-muted-foreground";
const SEARCH_FIELD_COLLAPSED = "w-9 hover:w-56 focus-within:w-56";

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
    currentTrack,
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
  const [spotifyAlbumMeta, setSpotifyAlbumMeta] = useState<SpotifyAlbumMetadata | null>(null);
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

  const artistProfileAvatar = useSpotifyArtistAvatar(displayArtistName, artistDetails?.artworkUrl);

  const enrichedAlbumIdRef = useRef<string | null>(null);

  // Reset album state when navigating between albums
  useEffect(() => {
    setArtistDetails(null);
    setMoreReleases([]);
    setTracks([]);
    setSpotifyAlbumMeta(null);
    setIsLoading(true);
    setError(null);
    setAlbumSearchQuery("");
    enrichedAlbumIdRef.current = null;
  }, [album?.id]);

  useEffect(() => {
    if (!album) return;
    let active = true;
    const fetchSpotifyData = async () => {
      try {
        let spId = album.id.startsWith("spotify:") ? album.id : "";
        if (!spId) {
          const sampleTrack = tracks[0]?.title;
          const spUrl = await SpotifyService.searchAlbumUrl(
            album.title,
            resolvedArtistName || album.artist || "",
            sampleTrack,
          );
          if (spUrl) {
            const m = spUrl.match(/\/album\/([a-zA-Z0-9]+)/);
            if (m) spId = m[1];
          }
        }
        if (spId) {
          const meta = await SpotifyService.getAlbumMetadata(spId);
          if (active && meta) {
            setSpotifyAlbumMeta(meta);
          }
        }
      } catch {}
    };
    void fetchSpotifyData();
    return () => {
      active = false;
    };
  }, [album?.id, album?.title, resolvedArtistName, album?.artist, tracks[0]?.title]);

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
      .catch(async () => {
        if (!active || showedTracks) return;
        // Fallback search for single release or unmatched album
        try {
          const query = [album.title, resolvedArtistName || album.artist].filter(Boolean).join(" ");
          const searchRes = await searchController.search(query);
          if (!active) return;
          if (searchRes.tracks?.length) {
            const matched = searchRes.tracks.find(
              (t) => t.title.toLowerCase() === album.title.toLowerCase()
            ) || searchRes.tracks[0];
            if (matched) {
              setTracks(applyAlbumMeta([matched]));
              setIsLoading(false);
              return;
            }
          }
        } catch {}
        if (active && !showedTracks) {
          // If it's a single release or was routed as a single track, render as 1-track album
          if (album.releaseType === "single" || !album.id.startsWith("MPRE")) {
            const singleTrack: Track = {
              id: album.id,
              title: album.title,
              artist: album.artist,
              artists: album.artists,
              album: album.title,
              albumId: album.id,
              artworkUrl: album.artworkUrl,
              releaseType: "single",
              year: album.year,
              releaseDate: album.releaseDate,
              source: "youtube",
            };
            setTracks(applyAlbumMeta([singleTrack]));
            setError(null);
            return;
          }
          setError("Unable to load this album.");
        }
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
    if (!album?.id || tracks.length === 0) return;
    if (enrichedAlbumIdRef.current === album.id) return;
    const targets = tracks.filter((t) => !t.viewCount && !t.viewCountText);
    if (targets.length === 0) {
      enrichedAlbumIdRef.current = album.id;
      return;
    }
    enrichedAlbumIdRef.current = album.id;
    let active = true;

    const enrichPlayCounts = async () => {
      try {
        const updated: Track[] = [];
        const chunkSize = 3;
        for (let i = 0; i < targets.length; i += chunkSize) {
          if (!active) return;
          const chunk = targets.slice(i, i + chunkSize);
          const chunkResults = await Promise.all(
            chunk.map(async (track) => {
              try {
                const res = await searchController.search(`${track.title} ${track.artist || ""}`);
                const cleanTrack = track.title.toLowerCase().replace(/[^a-z0-9]/g, "");
                const match = res.tracks?.find((t) => {
                  if (t.id === track.id) return true;
                  const candClean = t.title.toLowerCase().replace(/[^a-z0-9]/g, "");
                  return candClean === cleanTrack || candClean.includes(cleanTrack) || cleanTrack.includes(candClean);
                });
                if (match?.viewCount || match?.viewCountText) {
                  return {
                    ...track,
                    viewCount: match.viewCount ?? track.viewCount,
                    viewCountText: match.viewCountText ?? track.viewCountText,
                  };
                }
              } catch {}
              return track;
            }),
          );
          updated.push(...chunkResults);
        }

        if (active && updated.some((t) => t.viewCount || t.viewCountText)) {
          setTracks((prev) =>
            prev.map((t) => {
              const u = updated.find((up) => up.id === t.id);
              return u?.viewCount || u?.viewCountText
                ? { ...t, viewCount: u.viewCount ?? t.viewCount, viewCountText: u.viewCountText ?? t.viewCountText }
                : t;
            }),
          );
        }
      } catch {}
    };

    void enrichPlayCounts();
    return () => {
      active = false;
    };
  }, [album?.id, tracks.length > 0]);

  const formattedMonthYear = useMemo(() => {
    const trackWithDate = tracks.find((t) => t.releaseDate || t.year);
    const rawDate =
      (typeof album?.releaseDate === "string" && album.releaseDate)
        ? album.releaseDate
        : (typeof spotifyAlbumMeta?.releaseDate === "string" && spotifyAlbumMeta.releaseDate)
          ? spotifyAlbumMeta.releaseDate
          : (spotifyAlbumMeta?.releaseDate as any)?.isoString
            || (spotifyAlbumMeta?.releaseDate as any)?.text
            || trackWithDate?.releaseDate;
    if (typeof rawDate === "string" && rawDate.length > 0) {
      try {
        const parts = rawDate.split("T")[0].split("-");
        if (parts.length >= 2) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const d = new Date(Date.UTC(y, m, 1));
          return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
        }
      } catch {}
    }
    const spRaw = typeof spotifyAlbumMeta?.releaseDate === "string"
      ? spotifyAlbumMeta.releaseDate
      : (spotifyAlbumMeta?.releaseDate as any)?.isoString;
    const spYear = typeof spRaw === "string" ? spRaw.match(/^\d{4}/)?.[0] : undefined;
    const y = album?.year || spYear || trackWithDate?.year;
    return y ? String(y) : null;
  }, [album?.releaseDate, spotifyAlbumMeta?.releaseDate, album?.year, tracks]);

  const formattedReleaseDate = useMemo(() => {
    if (spotifyAlbumMeta?.formattedReleaseDate) return spotifyAlbumMeta.formattedReleaseDate;
    const rawDate =
      typeof spotifyAlbumMeta?.releaseDate === "string"
        ? spotifyAlbumMeta.releaseDate
        : (spotifyAlbumMeta?.releaseDate as any)?.isoString || (spotifyAlbumMeta?.releaseDate as any)?.text
        || (typeof album?.releaseDate === "string" ? album.releaseDate : undefined);
    if (typeof rawDate === "string" && rawDate.length > 0) {
      try {
        const parts = rawDate.split("T")[0].split("-");
        if (parts.length >= 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const d = parseInt(parts[2], 10);
          const dateObj = new Date(Date.UTC(y, m, d));
          return dateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
        } else if (parts.length === 2) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const dateObj = new Date(Date.UTC(y, m, 1));
          return dateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
        } else if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
          return parts[0];
        }
      } catch {}
    }
    return formattedMonthYear || (album?.year ? String(album.year) : null);
  }, [spotifyAlbumMeta?.formattedReleaseDate, spotifyAlbumMeta?.releaseDate, album?.releaseDate, album?.year, formattedMonthYear]);

  const cleanedCopyrights = useMemo(() => {
    return (spotifyAlbumMeta?.copyrights ?? []).filter((c) => {
      if (!c || typeof c !== "string") return false;
      const trimmed = c.trim();
      if (trimmed.length < 3 || trimmed.length > 250) return false;
      if (!/^[©℗]/.test(trimmed)) return false;
      if (/ey[\w.-]{4,}|oy[\w.-]{4,}|[{}<>;_\\\/]{2,}/i.test(trimmed)) return false;
      if (!/\s/.test(trimmed)) return false;
      return true;
    });
  }, [spotifyAlbumMeta?.copyrights]);

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
    const normalize = (str?: string) => str?.trim().toLowerCase().replace(/\s+/g, " ") || "";
    const targetTitle = normalize(album.title);
    const targetArtist = normalize(resolvedArtistName || album.artist);

    const sameAlbum = (item: Album) => {
      if (item.id === album.id) return true;
      if (album.playlistId && (item.playlistId === album.playlistId || item.id === album.playlistId)) return true;
      if (item.playlistId && (item.playlistId === album.id || item.id === album.id)) return true;
      if (targetTitle && normalize(item.title) === targetTitle) {
        const itemArtist = normalize(item.artist);
        if (!targetArtist || !itemArtist || itemArtist === targetArtist || itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist)) {
          return true;
        }
      }
      return false;
    };
    return libraryState.library.albums.some(sameAlbum);
  }, [album, libraryState.library, resolvedArtistName]);
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
  const [isAlbumMenuOpen, setIsAlbumMenuOpen] = useState(false);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (albumMenuRef.current && !albumMenuRef.current.contains(e.target as Node)) {
        setIsAlbumMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const copyAlbumShareLink = async () => {
    if (!album) return;
    try {
      let shareUrl: string | null = null;
      if (album.id.startsWith("spotify:album:")) {
        shareUrl = `https://open.spotify.com/album/${album.id.replace("spotify:album:", "")}`;
      } else if (album.id.startsWith("spotify:")) {
        shareUrl = `https://open.spotify.com/album/${album.id.replace("spotify:", "")}`;
      }
      if (!shareUrl && album.artist && album.title) {
        shareUrl = await SpotifyService.searchAlbumUrl(album.title, album.artist).catch(() => null);
      }
      if (!shareUrl) {
        const id = album.playlistId || album.id;
        if (id.startsWith("MPREb_") || id.startsWith("FEmusic_library_album_")) {
          shareUrl = `https://music.youtube.com/browse/${encodeURIComponent(id)}`;
        } else {
          shareUrl = `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`;
        }
      }
      await navigator.clipboard.writeText(shareUrl);
      setToast("Album link copied to clipboard");
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
    } catch {
      // ignore
    }
  };


  return (
    <div className="flex flex-col gap-8 pb-16">
      <MediaHeader
        eyebrow={formatCollectionMeta(tracks) || undefined}
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
        meta={formattedMonthYear || (album.year ? String(album.year) : undefined)}
        artworkUrl={album.artworkUrl || tracks[0]?.artworkUrl}
        artworkVariant="album"
        actionsDisabled={tracks.length === 0}
        actions={
          <div className="flex items-center gap-2.5">
            <Tooltip content={isSaved ? "Remove from library" : "Save to library"}>
              <button
                type="button"
                onClick={() => void toggleSaveAlbum()}
                disabled={isSaving}
                aria-label={isSaved ? "Remove album from library" : "Save album to library"}
                className={cn(
                  "flex size-11 items-center justify-center rounded-full bg-card transition-all hover:bg-muted border border-border/40 active:scale-95",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                )}
              >
                <HeartActiveIcon
                  size={20}
                  className={cn(
                    "transition-transform active:scale-90",
                    isSaved ? "text-red-500 fill-red-500" : "text-white/60 hover:text-white/90",
                  )}
                />
              </button>
            </Tooltip>

            <div className="relative" ref={albumMenuRef}>
              <button
                type="button"
                onClick={() => setIsAlbumMenuOpen((prev) => !prev)}
                className="flex size-11 items-center justify-center rounded-full bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/40 focus-visible:outline-none cursor-pointer"
                aria-label="More album options"
              >
                <MenuDotsIcon size={18} />
              </button>

              {isAlbumMenuOpen && (
                <div className="absolute left-0 top-full mt-2 z-50 w-52 rounded-xl bg-zinc-900/95 border border-white/10 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAlbumMenuOpen(false);
                      void copyAlbumShareLink();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <ShareIcon size={16} className="text-zinc-300" />
                    <span>Share album</span>
                  </button>
                </div>
              )}
            </div>
          </div>
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
          {/* Table Header */}
          <div className="grid grid-cols-[1fr_auto] items-center px-4 py-2 border-b border-border/30 text-xs font-semibold tracking-wider text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="w-8 text-center">#</span>
              <span>Title</span>
            </div>
            <div className="flex items-center gap-8 pr-4">
              <span className="w-20 text-right">Plays</span>
              <span className="w-12 flex justify-end">
                <ClockIcon size={15} aria-label="Duration" />
              </span>
            </div>
          </div>

          {isLoading ? (
            <TrackListSkeleton label="Loading songs" />
          ) : visibleTracks.length === 0 && albumSearchQuery.trim() ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">No songs match this search.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {visibleTracks.map((track, index) => {
                const cleanT = (s: string) =>
                  s
                    .replace(/\s*(?:\(|\[)(?:feat\.?|ft\.?|with|prod\.?|explicit|clean|remix|version)[^()\[\]]*(?:\)|\])/gi, "")
                    .replace(/[^a-z0-9]/gi, "")
                    .toLowerCase()
                    .trim();

                const isCurrent = Boolean(
                  (currentTrackId !== null && (track.id === currentTrackId || track.originalId === currentTrackId)) ||
                  (currentTrack?.id && (track.id === currentTrack.id || track.id === currentTrack.originalId || (track.originalId && track.originalId === currentTrack.id))) ||
                  (currentTrack?.title && (
                    track.title.trim().toLowerCase() === currentTrack.title.trim().toLowerCase() ||
                    (cleanT(track.title).length > 2 && cleanT(track.title) === cleanT(currentTrack.title))
                  ) && (
                    !track.artist || !currentTrack.artist ||
                    track.artist.trim().toLowerCase() === currentTrack.artist.trim().toLowerCase() ||
                    cleanT(track.artist).includes(cleanT(currentTrack.artist)) ||
                    cleanT(currentTrack.artist).includes(cleanT(track.artist))
                  )) ||
                  (currentTrack?.albumId && album?.id && currentTrack.albumId === album.id && cleanT(track.title) === cleanT(currentTrack.title || ""))
                );
                const viewFormatted = formatCompactNumber(track.viewCount ?? track.viewCountText)
                  || (typeof track.viewCountText === "string" ? track.viewCountText.replace(/\s*plays?/i, "").trim() : "");
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
                      <div className="flex items-center gap-8 shrink-0 text-xs tabular-nums text-muted-foreground pr-2">
                        <span className="w-20 text-right">
                          {viewFormatted || "—"}
                        </span>
                        <span className="w-12 text-right">
                          {formatDuration(track.durationSec || parseTrackDurationToSeconds(track), track.duration)}
                        </span>
                      </div>
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

      {/* Authentic release date and ℗ / © copyrights (Spotify-style) */}
      <div className="text-xs text-muted-foreground pt-4 pb-1 flex flex-col gap-1 select-text">
        {formattedReleaseDate ? (
          <p className="text-xs text-white/90 font-medium">{formattedReleaseDate}</p>
        ) : null}

        {cleanedCopyrights.length > 0 ? (
          cleanedCopyrights.map((c, i) => (
            <p key={i} className="text-[11px] text-muted-foreground opacity-75 leading-tight">{c}</p>
          ))
        ) : (album?.year || displayArtistName) ? (
          <p className="text-[11px] text-muted-foreground opacity-75 leading-tight">
            © {album?.year ? `${album.year} ` : ""}{displayArtistName || ""}
          </p>
        ) : null}
      </div>

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
            artworkUrl={artistProfileAvatar}
            variant="artist"
            size={400}
            preferProxy
            className="size-16 rounded-full shadow-md object-cover transition-transform group-hover:scale-105"
          />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Artist</span>
            <span className="text-base font-bold text-foreground group-hover:text-white group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all truncate">{displayArtistName}</span>
            {artistDetails?.subscriberCount && (
              <span className="text-xs text-muted-foreground">
                {(() => {
                  const c = formatCompactNumber(artistDetails.subscriberCount);
                  if (c) return `${c} subscribers`;
                  return artistDetails.subscriberCount.toLowerCase().includes("subscriber")
                    ? artistDetails.subscriberCount
                    : `${artistDetails.subscriberCount} subscribers`;
                })()}
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
                className="text-xs font-semibold text-muted-foreground hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all focus-visible:outline-none cursor-pointer"
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

      {toast &&
        createPortal(
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-full bg-foreground text-background px-4 py-2 text-xs font-medium shadow-lg animate-in fade-in zoom-in duration-200">
            {toast}
          </div>,
          document.body,
        )}
    </div>
  );
}
