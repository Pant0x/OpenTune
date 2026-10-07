import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MusicVisualizer, SpinnerSteps } from "@/components/motion/loader";
import { PauseIcon, PlayActiveIcon, PlayIcon, SearchIcon } from "@/ui/icons";
import type {
  Album,
  Artist,
  Playlist,
  SearchCategory,
  SearchResults,
  Track,
} from "../../datasource/types";
import { libraryController, searchController, type PlayerControllerActions } from "../../player/playerStore";
import { AlbumCard } from "../components/AlbumCard";
import { ArtistLinks } from "../components/ArtistLinks";
import { TrackArtwork } from "../components/TrackArtwork";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { getVideoArtworkFallback } from "../../datasource/youtube/artwork";
import { recordSearchSelection } from "../../player/searchAffinity";
import { deduplicateArtists, normSimp, normTranslit } from "../../datasource/searchNormalize";
import { SpotifyService, type SpotifyArtistOverview } from "../../services/SpotifyService";
import { useNowPlaying } from "../hooks/useNowPlaying";

function normalizeSearchKey(value: string): string {
  return normTranslit(value);
}

type SelectableItem =
  | { kind: "artist"; artist: Artist }
  | { kind: "track"; track: Track }
  | { kind: "album"; album: Album }
  | { kind: "playlist"; playlist: Playlist };

type SearchScope = "all" | "songs" | "videos" | "podcasts" | "artists" | "albums" | "playlists";

const SCOPES: Array<{ label: string; value: SearchScope; category?: SearchCategory }> = [
  { label: "All", value: "all" },
  { label: "Songs", value: "songs", category: "song" },
  { label: "Videos", value: "videos", category: "video" },
  { label: "Podcasts", value: "podcasts" },
  { label: "Artists", value: "artists", category: "artist" },
  { label: "Albums", value: "albums", category: "album" },
  { label: "Playlists", value: "playlists", category: "playlist" },
];

const REMIX_OR_VIDEO_REGEX = /\b(remix|remixes|mix|live|acoustic|cover|instrumental|edit|bootleg|flip|vip|slowed|reverb|official video|music video|lyric video|visualizer|video)\b/i;

function SearchLoadingSpinner() {
  return (
    <div className="grid place-items-center py-20" role="status" aria-label="Loading search results">
      <SpinnerSteps size={28} color="currentColor" />
    </div>
  );
}

const EMPTY_RESULTS: SearchResults = { artists: [], tracks: [], albums: [], playlists: [] };

function buildFlatItems(results: SearchResults, songsFirst: boolean): SelectableItem[] {
  const artists = results.artists.map((artist) => ({ kind: "artist" as const, artist }));
  const tracks = results.tracks.map((track) => ({ kind: "track" as const, track }));
  const albums = results.albums.map((album) => ({ kind: "album" as const, album }));
  const playlists = results.playlists.map((playlist) => ({ kind: "playlist" as const, playlist }));

  return songsFirst
    ? [...tracks, ...artists, ...albums, ...playlists]
    : [...artists, ...tracks, ...albums, ...playlists];
}

export function SearchResultsPage({
  query,
  results,
  isLoading,
  playerController,
  onSearch,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
}: {
  query: string;
  results: SearchResults;
  isLoading: boolean;
  playerController: PlayerControllerActions;
  onSearch?: (query: string) => void;
  onPlayTrack?: (track: Track) => Promise<void> | void;
  onOpenArtist: (artist: Artist) => void;
  onOpenAlbum: (album: Album) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const { openTrackMenu } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();
  const [scope, setScope] = useState<SearchScope>("all");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => setScope("all"), [query]);

  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    void searchController.getSearchSuggestions(query)
      .then((items) => {
        if (!active) return;
        const normQ = query.trim().toLowerCase();
        const filtered = items.filter((item) => item.toLowerCase() !== normQ).slice(0, 6);
        setSuggestions(filtered);
      })
      .catch(() => {
        if (active) setSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [query]);

  const [deepResults, setDeepResults] = useState<SearchResults | null>(null);
  const [isDeepLoading, setIsDeepLoading] = useState(false);

  useEffect(() => {
    if (scope === "podcasts") {
      let active = true;
      setDeepResults(null);
      setIsDeepLoading(true);
      void libraryController.searchCategory(`${query} podcast`, "song")
        .then((fetched) => {
          if (active) setDeepResults(fetched);
        })
        .catch(() => {
          if (active) setDeepResults(null);
        })
        .finally(() => {
          if (active) setIsDeepLoading(false);
        });
      return () => {
        active = false;
      };
    }

    const category = SCOPES.find((item) => item.value === scope)?.category;
    if (!category) {
      setDeepResults(null);
      setIsDeepLoading(false);
      return;
    }

    let active = true;
    setDeepResults(null);
    setIsDeepLoading(true);
    void libraryController.searchCategory(query, category)
      .then((fetched) => {
        if (active) setDeepResults(fetched);
      })
      .catch(() => {
        if (active) setDeepResults(null);
      })
      .finally(() => {
        if (active) setIsDeepLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query, scope]);

  const scopedResults = useMemo<SearchResults>(() => {
    const raw = scope === "all" ? results : (deepResults ?? results);
    const dedupedArtists = deduplicateArtists(raw.artists || []);
    const source: SearchResults = {
      ...raw,
      artists: dedupedArtists,
    };

    if (scope === "all") return source;

    const narrowed: SearchResults = {
      artists: scope === "artists" ? source.artists : [],
      tracks: (scope === "songs" || scope === "videos" || scope === "podcasts") ? source.tracks : [],
      albums: scope === "albums" ? source.albums : [],
      playlists: scope === "playlists" ? source.playlists : [],
    };
    const total = narrowed.artists.length + narrowed.tracks.length
      + narrowed.albums.length + narrowed.playlists.length;
    return total > 0 || !deepResults ? narrowed : {
      ...EMPTY_RESULTS,
      artists: scope === "artists" ? source.artists : [],
      tracks: (scope === "songs" || scope === "videos" || scope === "podcasts") ? source.tracks : [],
      albums: scope === "albums" ? source.albums : [],
      playlists: scope === "playlists" ? source.playlists : [],
    };
  }, [deepResults, results, scope]);

  const hasResults = scopedResults.artists.length
    + scopedResults.tracks.length
    + scopedResults.albums.length
    + scopedResults.playlists.length > 0;
  const normalizedQuery = normalizeSearchKey(query);
  const hasExactArtist = scopedResults.artists.some(
    (artist) => normalizeSearchKey(artist.name) === normalizedQuery,
  );
  const hasExactTrack = scopedResults.tracks.some(
    (track) => normalizeSearchKey(track.title) === normalizedQuery,
  );
  const songsFirst = hasExactTrack && !hasExactArtist;

  const handleOpenArtist = useCallback((artist: Artist) => {
    recordSearchSelection(query, { id: artist.id, name: artist.name });
    onOpenArtist(artist);
  }, [onOpenArtist, query]);

  const handleOpenAlbum = useCallback((album: Album) => {
    recordSearchSelection(query, { id: album.id, title: album.title, artist: album.artist });
    onOpenAlbum(album);
  }, [onOpenAlbum, query]);

  const handleOpenPlaylist = useCallback((playlist: Playlist) => {
    recordSearchSelection(query, { id: playlist.id, title: playlist.title });
    onOpenPlaylist(playlist);
  }, [onOpenPlaylist, query]);

  const { currentTrack, currentTrackId, isPlaying } = useNowPlaying();
  const [isPlayingArtist, setIsPlayingArtist] = useState(false);

  const playTrack = useCallback((track: Track) => {
    recordSearchSelection(query, { id: track.id, title: track.title, artist: track.artist });
    if (onPlayTrack) void onPlayTrack(track);
    else void playerController.playTrackById(track.id, scopedResults.tracks, true);
  }, [onPlayTrack, playerController, query, scopedResults.tracks]);

  const handlePlayArtist = useCallback(async (artist: Artist) => {
    recordSearchSelection(query, { id: artist.id, name: artist.name });
    const artistName = artist.name.toLowerCase().trim();
    const trackArtist = (currentTrack?.artist || "").toLowerCase().trim();
    const matchesArtist = trackArtist === artistName ||
      trackArtist.includes(artistName) ||
      (currentTrack?.artists || []).some((a) => a.name.toLowerCase().trim() === artistName);

    if (matchesArtist) {
      playerController.togglePlayPause();
      return;
    }

    setIsPlayingArtist(true);
    try {
      const page = await libraryController.getArtist(artist.id).catch(() => null);
      const matchingTracks = scopedResults.tracks.filter((t) =>
        t.artist?.toLowerCase().includes(artistName) ||
        t.artists?.some((a) => a.name.toLowerCase().includes(artistName))
      );

      const tracksToPlay = (page?.popularSongs && page.popularSongs.length > 0)
        ? page.popularSongs
        : (page?.allSongs && page.allSongs.length > 0)
        ? page.allSongs
        : matchingTracks;

      if (tracksToPlay.length > 0) {
        await playerController.playTrackById(tracksToPlay[0].id, tracksToPlay, true);
      } else {
        const searchRes = await libraryController.searchCategory(artist.name, "song").catch(() => null);
        if (searchRes?.tracks?.[0]) {
          await playerController.playTrackById(searchRes.tracks[0].id, searchRes.tracks, true);
        }
      }
    } finally {
      setIsPlayingArtist(false);
    }
  }, [currentTrack?.artist, currentTrack?.artists, libraryController, playerController, query, scopedResults.tracks]);

  const playVideoTrack = useCallback((track: Track) => {
    playTrack(track);
  }, [playTrack]);

  const flatItems = useMemo(
    () => buildFlatItems(scopedResults, songsFirst),
    [scopedResults, songsFirst],
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);

  useEffect(() => {
    setSelectedIndex(0);
    setIsKeyboardNav(false);
  }, [results, scope]);

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;

  useEffect(() => {
    if (isLoading || !hasResults) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIsKeyboardNav(true);
        setSelectedIndex((prev) => Math.min(prev + 1, flatItemsRef.current.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIsKeyboardNav(true);
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        const item = flatItemsRef.current[selectedIndexRef.current];
        if (!item) return;
        event.preventDefault();
        switch (item.kind) {
          case "artist": handleOpenArtist(item.artist); break;
          case "track": playTrack(item.track); break;
          case "album": handleOpenAlbum(item.album); break;
          case "playlist": handleOpenPlaylist(item.playlist); break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading, hasResults, playTrack, onOpenArtist, onOpenAlbum, onOpenPlaylist]);

  const selected = (index: number) =>
    isKeyboardNav && selectedIndex === index
      ? "bg-card ring-2 ring-inset ring-ring"
      : "";

  const selectedAlbumCard = (index: number) =>
    isKeyboardNav && selectedIndex === index
      ? "ring-2 ring-inset ring-ring rounded-xl"
      : "";

  const handleMouseEnter = (index: number) => {
    setIsKeyboardNav(false);
    setSelectedIndex(index);
  };

  const enterStyle = (index: number): CSSProperties => ({
    animationDelay: `${Math.min(index * 25, 250)}ms`,
  });

  const topResult = useMemo(() => {
    if (scope !== "all") return null;
    const topArtist = scopedResults.artists[0];
    const topTrack = scopedResults.tracks[0];
    const topAlbum = scopedResults.albums[0];

    const normQ = normalizeSearchKey(query);
    if (topArtist && normalizeSearchKey(topArtist.name) === normQ) {
      return { kind: "artist" as const, item: topArtist };
    }
    if (topTrack && normalizeSearchKey(topTrack.title) === normQ) {
      return { kind: "track" as const, item: topTrack };
    }
    if (topAlbum && normalizeSearchKey(topAlbum.title) === normQ) {
      return { kind: "album" as const, item: topAlbum };
    }

    if (songsFirst && topTrack) {
      return { kind: "track" as const, item: topTrack };
    }
    if (topArtist) {
      return { kind: "artist" as const, item: topArtist };
    }
    if (topTrack) {
      return { kind: "track" as const, item: topTrack };
    }
    if (topAlbum) {
      return { kind: "album" as const, item: topAlbum };
    }
    return null;
  }, [scopedResults, scope, query, songsFirst]);

  const [artistOverview, setArtistOverview] = useState<SpotifyArtistOverview | null>(null);

  useEffect(() => {
    if (topResult?.kind !== "artist" || !topResult.item.name) {
      setArtistOverview(null);
      return;
    }
    let active = true;
    void SpotifyService.getArtistOverview(topResult.item.name)
      .then((overview) => {
        if (active) setArtistOverview(overview);
      })
      .catch(() => {
        if (active) setArtistOverview(null);
      });
    return () => {
      active = false;
    };
  }, [topResult?.kind, topResult?.kind === "artist" ? topResult.item.name : null]);

  const isTopArtistPlaying = useMemo(() => {
    if (topResult?.kind !== "artist" || !currentTrack) return false;
    const artistName = topResult.item.name.toLowerCase().trim();
    const trackArtist = (currentTrack.artist || "").toLowerCase().trim();
    return (trackArtist === artistName ||
      trackArtist.includes(artistName) ||
      (currentTrack.artists || []).some((a) => a.name.toLowerCase().trim() === artistName)) && isPlaying;
  }, [topResult, currentTrack, isPlaying]);

  const displayedArtists = useMemo(() => {
    if (scope !== "all") return scopedResults.artists;
    const topArtist = topResult?.kind === "artist" ? topResult.item : null;
    return scopedResults.artists.filter((artist) => {
      if (!topArtist) return true;
      if (artist.id && topArtist.id && artist.id === topArtist.id) return false;
      if (normSimp(artist.name) === normSimp(topArtist.name)) return false;
      if (normTranslit(artist.name) === normTranslit(topArtist.name)) return false;
      return true;
    }).slice(0, 5);
  }, [scopedResults.artists, scope, topResult]);

  const videoAndRemixTracks = useMemo(() => {
    return scopedResults.tracks.filter((track) => {
      return REMIX_OR_VIDEO_REGEX.test(track.title) || (track as any).isVideo;
    }).slice(0, 6);
  }, [scopedResults.tracks]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                scope === item.value
                  ? "bg-foreground text-background shadow-md"
                  : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground",
              )}
              onClick={() => setScope(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {suggestions.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground/70 shrink-0 uppercase tracking-wider pl-1">
              Related:
            </span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSearch?.(suggestion)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/5 hover:border-white/10 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-white transition-all duration-150 cursor-pointer shrink-0"
              >
                <SearchIcon size={12} className="opacity-60" />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading || (isDeepLoading && !hasResults) ? (
        <SearchLoadingSpinner />
      ) : !hasResults ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">No results found.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {scope === "all" && (topResult || scopedResults.tracks.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.9fr] gap-6 items-start">
              {topResult && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-xl font-bold tracking-tight text-foreground">Top result</h2>
                  <div
                    className={cn(
                      "group relative flex flex-col justify-between rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 transition-all duration-300 cursor-pointer",
                      topResult.kind === "track" ? "p-4 sm:p-4.5 min-h-[175px]" : "p-5 min-h-[210px]"
                    )}
                    onClick={() => {
                      if (topResult.kind === "artist") handleOpenArtist(topResult.item);
                      else if (topResult.kind === "track") playTrack(topResult.item);
                      else if (topResult.kind === "album") handleOpenAlbum(topResult.item);
                    }}
                  >
                    <div className="flex flex-col gap-3.5">
                      <TrackArtwork
                        className={cn(
                          "shadow-2xl object-cover transition-transform duration-300 group-hover:scale-[1.02]",
                          topResult.kind === "track"
                            ? "size-20 rounded-xl"
                            : topResult.kind === "artist"
                            ? "size-24 rounded-full"
                            : "size-24 rounded-xl"
                        )}
                        size={400}
                        preferProxy
                        artworkUrl={
                          topResult.item.artworkUrl ||
                          (topResult.kind === "track" && topResult.item.id ? getVideoArtworkFallback(topResult.item.id) : undefined)
                        }
                        iconSize={topResult.kind === "track" ? 34 : 40}
                        variant={topResult.kind}
                      />
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <span className={cn(
                          "text-white tracking-tight truncate line-clamp-1",
                          topResult.kind === "artist" ? "text-2xl font-black" : "text-xl font-bold"
                        )}>
                          {topResult.kind === "artist" ? topResult.item.name : topResult.item.title}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                          {topResult.kind === "track" && (
                            <>
                              <ArtistLinks artists={topResult.item.artists} fallback={topResult.item.artist} />
                              <span>•</span>
                            </>
                          )}
                          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                            {topResult.kind === "artist" ? (topResult.item.isCreator ? "Channel" : "Artist") : topResult.kind === "track" ? "Song" : "Album"}
                          </span>
                          {topResult.kind === "artist" && (
                            <>
                              {artistOverview?.monthlyListeners ? (
                                <>
                                  <span>•</span>
                                  <span className="text-white/80 font-medium">
                                    {artistOverview.monthlyListeners.toLocaleString()} monthly listeners
                                  </span>
                                </>
                              ) : topResult.item.subscriberCount ? (
                                <>
                                  <span>•</span>
                                  <span className="text-white/80 font-medium">
                                    {topResult.item.subscriberCount}
                                  </span>
                                </>
                              ) : null}
                              {artistOverview?.worldRank && (
                                <>
                                  <span>•</span>
                                  <span className="text-primary font-bold">
                                    #{artistOverview.worldRank} in the world
                                  </span>
                                </>
                              )}
                            </>
                          )}
                        </div>
                        {topResult.kind === "artist" && (artistOverview?.cleanBio || artistOverview?.bio) && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1 max-w-lg leading-relaxed">
                            {artistOverview.cleanBio || artistOverview.bio}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className={cn(
                        "absolute flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/40 opacity-0 group-hover:opacity-100 group-hover:scale-105 transition-all duration-200 cursor-pointer z-10",
                        topResult.kind === "track" ? "bottom-4 right-4 size-11" : "bottom-5 right-5 size-12"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (topResult.kind === "artist") void handlePlayArtist(topResult.item);
                        else if (topResult.kind === "track") playTrack(topResult.item);
                        else if (topResult.kind === "album") handleOpenAlbum(topResult.item);
                      }}
                      aria-label={isTopArtistPlaying ? "Pause" : "Play"}
                    >
                      {isPlayingArtist ? (
                        <SpinnerSteps size={20} color="currentColor" />
                      ) : isTopArtistPlaying ? (
                        <PauseIcon size={22} fill="currentColor" />
                      ) : (
                        <PlayIcon size={topResult.kind === "track" ? 20 : 22} fill="currentColor" className="ml-0.5" />
                      )}
                    </button>
                  </div>
                </section>
              )}

              {scopedResults.tracks.length > 0 && (
                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold tracking-tight text-foreground">Songs</h2>
                    {scopedResults.tracks.length > 10 && (
                      <button
                        type="button"
                        onClick={() => setScope("songs")}
                        className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors cursor-pointer"
                      >
                        See all ({scopedResults.tracks.length})
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {scopedResults.tracks.slice(0, 10).map((track, displayIndex) => {
                      const index = flatItems.findIndex(
                        (item) => item.kind === "track" && item.track.id === track.id,
                      );
                      const art = track.artworkUrl || (track.id ? getVideoArtworkFallback(track.id) : undefined);
                      const isTrackCurrent = currentTrackId === track.id;
                      const isTrackPlaying = isTrackCurrent && isPlaying;
                      return (
                        <button
                          key={track.id}
                          type="button"
                          data-selectable-index={index}
                          className={cn(
                            "group/row flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring cursor-pointer",
                            isTrackCurrent && "bg-white/[0.08]",
                            selected(index)
                          )}
                          style={enterStyle(index)}
                          onContextMenu={(event) => openTrackMenu(event, track)}
                          onClick={() => playTrack(track)}
                          onMouseEnter={() => handleMouseEnter(index)}
                        >
                          <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground flex items-center justify-end">
                            {isTrackCurrent ? (
                              isTrackPlaying ? (
                                <MusicVisualizer
                                  bars={4}
                                  className="[--music-gap:2px] [--music-height:13px] [--music-width:17px]"
                                />
                              ) : (
                                <PlayActiveIcon size={14} className="text-primary" />
                              )
                            ) : (
                              <span>{displayIndex + 1}</span>
                            )}
                          </span>
                          <TrackArtwork
                            className="size-10 shrink-0 rounded-lg object-cover"
                            size={40}
                            preferProxy
                            artworkUrl={art}
                            iconSize={20}
                          />
                          <span className="flex min-w-0 flex-1 flex-col [&_span]:truncate [&_span]:text-xs [&_span]:text-muted-foreground [&_strong]:truncate [&_strong]:text-sm [&_strong]:font-medium">
                            <strong className={cn(
                              "transition-colors",
                              isTrackCurrent ? "text-primary" : "text-white group-hover/row:text-primary"
                            )}>
                              {track.title}
                            </strong>
                            <ArtistLinks artists={track.artists} fallback={track.artist} />
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground pr-2">
                            {track.duration || ""}
                          </span>
                          <PlayActiveIcon size={16} className={cn(
                            "transition-colors",
                            isTrackCurrent ? "text-primary" : "text-muted-foreground group-hover/row:text-white"
                          )} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {scope === "songs" && scopedResults.tracks.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Songs</h2>
              <div className="flex flex-col gap-1">
                {scopedResults.tracks.map((track, displayIndex) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "track" && item.track.id === track.id,
                  );
                  const art = track.artworkUrl || (track.id ? getVideoArtworkFallback(track.id) : undefined);
                  const isTrackCurrent = currentTrackId === track.id;
                  const isTrackPlaying = isTrackCurrent && isPlaying;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      data-selectable-index={index}
                      className={cn(
                        "group/row flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring cursor-pointer",
                        isTrackCurrent && "bg-white/[0.08]",
                        selected(index)
                      )}
                      style={enterStyle(index)}
                      onContextMenu={(event) => openTrackMenu(event, track)}
                      onClick={() => playTrack(track)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground flex items-center justify-end">
                        {isTrackCurrent ? (
                          isTrackPlaying ? (
                            <MusicVisualizer
                              bars={4}
                              className="[--music-gap:2px] [--music-height:13px] [--music-width:17px]"
                            />
                          ) : (
                            <PlayActiveIcon size={14} className="text-primary" />
                          )
                        ) : (
                          <span>{displayIndex + 1}</span>
                        )}
                      </span>
                      <TrackArtwork
                        className="size-11 shrink-0 rounded-lg object-cover"
                        size={44}
                        preferProxy
                        artworkUrl={art}
                        iconSize={24}
                      />
                      <span className="flex min-w-0 flex-1 flex-col [&_span]:truncate [&_span]:text-xs [&_span]:text-muted-foreground [&_strong]:truncate [&_strong]:text-sm [&_strong]:font-medium">
                        <strong className={cn(
                          "transition-colors",
                          isTrackCurrent ? "text-primary" : "text-white group-hover/row:text-primary"
                        )}>
                          {track.title}
                        </strong>
                        <ArtistLinks artists={track.artists} fallback={track.artist} />
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground pr-2">
                        {track.duration || ""}
                      </span>
                      <PlayActiveIcon size={18} className={cn(
                        "transition-colors",
                        isTrackCurrent ? "text-primary" : "text-muted-foreground group-hover/row:text-white"
                      )} />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {scope === "videos" && scopedResults.tracks.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Videos & Remixes</h2>
              <div className="flex flex-col gap-1">
                {scopedResults.tracks.map((track, displayIndex) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "track" && item.track.id === track.id,
                  );
                  const art = track.artworkUrl || (track.id ? getVideoArtworkFallback(track.id) : undefined);
                  const isTrackCurrent = currentTrackId === track.id;
                  const isTrackPlaying = isTrackCurrent && isPlaying;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      data-selectable-index={index}
                      className={cn(
                        "group/row flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring cursor-pointer",
                        isTrackCurrent && "bg-white/[0.08]",
                        selected(index)
                      )}
                      style={enterStyle(index)}
                      onContextMenu={(event) => openTrackMenu(event, track)}
                      onClick={() => playVideoTrack(track)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground flex items-center justify-end">
                        {isTrackCurrent ? (
                          isTrackPlaying ? (
                            <MusicVisualizer
                              bars={4}
                              className="[--music-gap:2px] [--music-height:13px] [--music-width:17px]"
                            />
                          ) : (
                            <PlayActiveIcon size={14} className="text-primary" />
                          )
                        ) : (
                          <span>{displayIndex + 1}</span>
                        )}
                      </span>
                      <TrackArtwork
                        className="size-11 shrink-0 rounded-lg object-cover"
                        size={44}
                        preferProxy
                        artworkUrl={art}
                        iconSize={24}
                      />
                      <span className="flex min-w-0 flex-1 flex-col [&_span]:truncate [&_span]:text-xs [&_span]:text-muted-foreground [&_strong]:truncate [&_strong]:text-sm [&_strong]:font-medium">
                        <strong className={cn(
                          "transition-colors",
                          isTrackCurrent ? "text-primary" : "text-white group-hover/row:text-primary"
                        )}>
                          {track.title}
                        </strong>
                        <ArtistLinks artists={track.artists} fallback={track.artist} />
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground pr-2">
                        {track.duration || ""}
                      </span>
                      <PlayActiveIcon size={18} className={cn(
                        "transition-colors",
                        isTrackCurrent ? "text-primary" : "text-muted-foreground group-hover/row:text-white"
                      )} />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {scope === "podcasts" && scopedResults.tracks.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Podcasts & Shows</h2>
              <div className="flex flex-col gap-1">
                {scopedResults.tracks.map((track, displayIndex) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "track" && item.track.id === track.id,
                  );
                  const art = track.artworkUrl || (track.id ? getVideoArtworkFallback(track.id) : undefined);
                  return (
                    <button
                      key={track.id}
                      type="button"
                      data-selectable-index={index}
                      className={cn(
                        "group/row flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring cursor-pointer",
                        selected(index)
                      )}
                      style={enterStyle(index)}
                      onContextMenu={(event) => openTrackMenu(event, track)}
                      onClick={() => playTrack(track)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{displayIndex + 1}</span>
                      <TrackArtwork
                        className="size-11 shrink-0 rounded-lg object-cover"
                        size={44}
                        preferProxy
                        artworkUrl={art}
                        iconSize={24}
                      />
                      <span className="flex min-w-0 flex-1 flex-col [&_span]:truncate [&_span]:text-xs [&_span]:text-muted-foreground [&_strong]:truncate [&_strong]:text-sm [&_strong]:font-medium">
                        <strong className="text-white group-hover/row:text-primary transition-colors">{track.title}</strong>
                        <ArtistLinks artists={track.artists} fallback={track.artist} />
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground pr-2">
                        {track.duration || ""}
                      </span>
                      <PlayActiveIcon size={18} className="text-muted-foreground group-hover/row:text-white transition-colors" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {displayedArtists.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight text-foreground">Artists</h2>
                {scopedResults.artists.length > 5 && scope === "all" && (
                  <button
                    type="button"
                    onClick={() => setScope("artists")}
                    className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors cursor-pointer"
                  >
                    See all
                  </button>
                )}
              </div>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {displayedArtists.map((artist) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "artist" && item.artist.id === artist.id,
                  );
                  return (
                    <button
                      key={artist.id}
                      type="button"
                      data-selectable-index={index}
                      className={cn(
                        "group flex flex-col items-center gap-3 rounded-2xl p-4 transition-all duration-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring cursor-pointer text-center",
                        selected(index)
                      )}
                      style={enterStyle(index)}
                      onClick={() => handleOpenArtist(artist)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <TrackArtwork
                        className="size-28 rounded-full shadow-lg object-cover transition-transform duration-300 group-hover:scale-105"
                        size={112}
                        preferProxy
                        artworkUrl={artist.artworkUrl}
                        iconSize={48}
                        variant="artist"
                      />
                      <div className="flex flex-col items-center gap-0.5 min-w-0 w-full">
                        <strong className="text-sm font-bold text-white group-hover/row:text-primary transition-colors truncate max-w-full">{artist.name}</strong>
                        <span className="text-xs text-muted-foreground">
                          {artist.isCreator
                            ? artist.subscriberCount ? `${artist.subscriberCount} • Channel` : "Channel"
                            : artist.subscriberCount ? `${artist.subscriberCount} • Artist` : "Artist"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {scopedResults.albums.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight text-foreground">Releases & Albums</h2>
                {scopedResults.albums.length > 6 && scope === "all" && (
                  <button
                    type="button"
                    onClick={() => setScope("albums")}
                    className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors cursor-pointer"
                  >
                    See all
                  </button>
                )}
              </div>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {(scope === "all" ? scopedResults.albums.slice(0, 6) : scopedResults.albums).map((album) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "album" && item.album.id === album.id,
                  );
                  return (
                    <div
                      key={album.id}
                      data-selectable-index={index}
                      className={cn("animate-in fade-in", selectedAlbumCard(index))}
                      style={enterStyle(index)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <AlbumCard
                        artworkUrl={album.artworkUrl}
                        title={album.title}
                        subtitleContent={(
                          <ArtistLinks artists={album.artists} fallback={album.artist} />
                        )}
                        onClick={() => handleOpenAlbum(album)}
                        onContextMenu={(event) => openAlbumMenu(event, album)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {scope === "all" && videoAndRemixTracks.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight text-foreground">Videos & Remixes</h2>
                <button
                  type="button"
                  onClick={() => setScope("videos")}
                  className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors cursor-pointer"
                >
                  See all
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {videoAndRemixTracks.map((track) => {
                  const art = track.artworkUrl || (track.id ? getVideoArtworkFallback(track.id) : undefined);
                  return (
                    <div
                      key={track.id}
                      className="group/video relative flex items-center gap-3 rounded-xl p-2.5 bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-white/10 transition-all duration-200 cursor-pointer"
                      onClick={() => playTrack(track)}
                      onContextMenu={(e) => openTrackMenu(e, track)}
                    >
                      <div className="relative size-14 shrink-0 rounded-lg overflow-hidden bg-black/40">
                        <TrackArtwork
                          className="size-full object-cover"
                          size={56}
                          preferProxy
                          artworkUrl={art}
                          iconSize={24}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/video:opacity-100 transition-opacity flex items-center justify-center">
                          <PlayIcon size={20} fill="currentColor" className="text-white ml-0.5" />
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <strong className="text-sm font-semibold text-white group-hover/video:text-primary transition-colors truncate">
                          {track.title}
                        </strong>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                          <span className="truncate">{track.artist}</span>
                          {track.duration && (
                            <>
                              <span>•</span>
                              <span className="tabular-nums">{track.duration}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {scopedResults.playlists.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Playlists</h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {scopedResults.playlists.map((playlist) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "playlist" && item.playlist.id === playlist.id,
                  );
                  return (
                    <div
                      key={playlist.id}
                      data-selectable-index={index}
                      className={cn("animate-in fade-in", selectedAlbumCard(index))}
                      style={enterStyle(index)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <AlbumCard
                        artworkUrl={playlist.artworkUrl}
                        title={playlist.title}
                        subtitle={playlist.owner}
                        onClick={() => handleOpenPlaylist(playlist)}
                        onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
