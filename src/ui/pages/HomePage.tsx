import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Album, Artist, BrowseShelf, Playlist, Track } from "../../datasource/types";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { SearchController } from "../../player/SearchController";
import { BrowseShelves } from "../components/BrowseShelves";
import type { HomeDestinationHandlers } from "../components/HomeDestinations";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { usePlayHistory } from "../../player/playHistory";
import { AlbumGridSkeleton } from "../components/Skeleton";

const FALLBACK_QUERIES = [
  "new music",
  "popular songs",
  "indie mix",
  "electronic mix",
  "late night music",
  "discover weekly",
];

interface HomeMoodChip {
  id: string;
  label: string;
  query?: string;
}

const HOME_MOOD_CHIPS: HomeMoodChip[] = [
  { id: "all", label: "All" },
  { id: "relax", label: "Relax", query: "relax chill music" },
  { id: "workout", label: "Workout", query: "workout pump up gym" },
  { id: "energize", label: "Energize", query: "energy booster hype" },
  { id: "commute", label: "Commute", query: "road trip drive music" },
  { id: "focus", label: "Focus", query: "focus ambient study beats" },
  { id: "podcasts", label: "Podcasts", query: "podcasts audio talks" },
];

const suggestionCache = new Map<string, Track[]>();
const suggestionLoads = new Map<string, Promise<Track[]>>();
const cachedMoodShelves = new Map<string, BrowseShelf[]>();
const EMPTY_TRACKS: Track[] = [];
let cachedGlobalHomeShelves: BrowseShelf[] | null = null;

const MAX_SUGGESTION_ENTRIES = 20;

function readSuggestionCache(key: string): Track[] | undefined {
  const hit = suggestionCache.get(key);
  if (hit === undefined) return undefined;
  suggestionCache.delete(key);
  suggestionCache.set(key, hit);
  return hit;
}

function writeSuggestionCache(key: string, tracks: Track[]): void {
  suggestionCache.delete(key);
  suggestionCache.set(key, tracks);

  for (const coldest of [...suggestionCache.keys()]) {
    if (suggestionCache.size <= MAX_SUGGESTION_ENTRIES) break;
    suggestionCache.delete(coldest);
  }
}

interface HomePageProps {
  tabId: string;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  libraryState: LibraryState;
  searchController: SearchController;
  onSignIn: () => Promise<void>;
  destinations?: HomeDestinationHandlers;
  onOpenAlbum?: (album: Album) => void;
  onOpenArtist?: (artist: Artist) => void;
  onOpenPlaylist?: (playlist: Playlist) => void;
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function uniqueTracks(tracks: readonly Track[]): Track[] {
  return [...new Map(tracks.map((track) => [track.id, track])).values()];
}

function splitMixedShelves(rawShelves: BrowseShelf[]): BrowseShelf[] {
  const result: BrowseShelf[] = [];
  for (const s of rawShelves) {
    if (s.tracks.length > 0 && (s.albums.length > 0 || s.playlists.length > 0 || s.artists.length > 0)) {
      result.push({
        title: s.title,
        tracks: s.tracks,
        albums: [],
        playlists: [],
        artists: [],
        links: s.links,
      });
      if (s.albums.length > 0) {
        result.push({
          title: `${s.title} — Albums`,
          tracks: [],
          albums: s.albums,
          playlists: [],
          artists: [],
          links: [],
        });
      }
      if (s.playlists.length > 0) {
        result.push({
          title: `${s.title} — Playlists`,
          tracks: [],
          albums: [],
          playlists: s.playlists,
          artists: [],
          links: [],
        });
      }
      if (s.artists.length > 0) {
        result.push({
          title: `${s.title} — Artists`,
          tracks: [],
          albums: [],
          playlists: [],
          artists: s.artists,
          links: [],
        });
      }
    } else {
      result.push(s);
    }
  }
  return result;
}

export function HomePage({
  tabId,
  playerController,
  libraryController,
  libraryState,
  searchController,
  onSignIn,
  destinations: _destinations,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: HomePageProps) {
  useTrackContextMenu();
  const [activeMood, setActiveMood] = useState<string>("all");
  const [moodShelves, setMoodShelves] = useState<BrowseShelf[] | null>(null);
  const [isLoadingMood, setIsLoadingMood] = useState(false);
  const [homeShelves, setHomeShelves] = useState<BrowseShelf[]>(() => cachedGlobalHomeShelves ?? []);
  const [isLoadingHomeShelves, setIsLoadingHomeShelves] = useState(() => !cachedGlobalHomeShelves);

  useEffect(() => {
    let active = true;
    if (!cachedGlobalHomeShelves) {
      setIsLoadingHomeShelves(true);
    }
    void libraryController
      .getBrowsePage("home")
      .then((page) => {
        if (!active) return;
        cachedGlobalHomeShelves = page.shelves;
        setHomeShelves(page.shelves);
        setIsLoadingHomeShelves(false);
      })
      .catch(() => {
        if (!active) return;
        setIsLoadingHomeShelves(false);
      });

    return () => {
      active = false;
    };
  }, [libraryController, libraryState.sessionConfirmedAt, libraryState.status]);

  const handleSelectMood = async (chip: HomeMoodChip) => {
    setActiveMood(chip.id);
    if (chip.id === "all") {
      setMoodShelves(null);
      return;
    }

    if (cachedMoodShelves.has(chip.id)) {
      setMoodShelves(cachedMoodShelves.get(chip.id)!);
      return;
    }

    setIsLoadingMood(true);
    try {
      if (chip.query) {
        const results = await searchController.search(chip.query);
        const shelves: BrowseShelf[] = [];
        if (results.tracks.length > 0) {
          shelves.push({
            title: `${chip.label} — Top Songs`,
            tracks: results.tracks,
            albums: [],
            playlists: [],
            artists: [],
            links: [],
          });
        }
        if (results.albums.length > 0) {
          shelves.push({
            title: `${chip.label} — Albums`,
            tracks: [],
            albums: results.albums,
            playlists: [],
            artists: [],
            links: [],
          });
        }
        if (results.playlists.length > 0) {
          shelves.push({
            title: `${chip.label} — Playlists`,
            tracks: [],
            albums: [],
            playlists: results.playlists,
            artists: [],
            links: [],
          });
        }
        cachedMoodShelves.set(chip.id, shelves);
        setMoodShelves(shelves);
      }
    } catch {
      // Fallback gracefully
    } finally {
      setIsLoadingMood(false);
    }
  };

  const recentlyPlayed = useMemo(
    () => libraryState.library?.recentlyPlayed ?? EMPTY_TRACKS,
    [libraryState.library],
  );
  const recentTrackKey = recentlyPlayed.map((track) => track.id).join(":");
  const suggestionCacheKey = recentlyPlayed.length > 0
    ? `${tabId}:recent:${recentTrackKey}`
    : `${tabId}:${libraryState.status}:empty`;
  const [suggestions, setSuggestions] = useState<Track[]>(
    () => readSuggestionCache(suggestionCacheKey) ?? [],
  );
  const loadIdRef = useRef(0);

  const playHistory = usePlayHistory();
  const recentPlays = useMemo(
    () => uniqueTracks([...playHistory.map((entry) => entry.track), ...recentlyPlayed]),
    [playHistory, recentlyPlayed],
  );

  useEffect(() => {
    const loadId = ++loadIdRef.current;
    
    let loadPromise = suggestionLoads.get(suggestionCacheKey);
    if (!loadPromise) {
      loadPromise = (async () => {
        const likedSongs = libraryState.library?.likedSongs ?? [];
        const candidatePool = [...recentlyPlayed, ...likedSongs];
        const seeds = shuffle(candidatePool).slice(0, 4);
        let loaded: Track[] = [];

        if (seeds.length > 0) {
          const recommendationSets = await Promise.allSettled(
            seeds.map((seed) => libraryController.getRecommendations(seed)),
          );
          loaded = recommendationSets.flatMap((result) =>
            result.status === "fulfilled" ? result.value : []
          );
        }

        if (loaded.length < 12) {
          const query = FALLBACK_QUERIES[Math.floor(Math.random() * FALLBACK_QUERIES.length)];
          try {
            loaded.push(...await searchController.searchTracks(query));
          } catch {
            // Recent tracks fallback
          }
        }

        return shuffle(uniqueTracks([...loaded, ...recentlyPlayed])).slice(0, 36);
      })();
      suggestionLoads.set(suggestionCacheKey, loadPromise);
    }

    void loadPromise.then((loadedSuggestions) => {
      writeSuggestionCache(suggestionCacheKey, loadedSuggestions);
      suggestionLoads.delete(suggestionCacheKey);
      if (loadId !== loadIdRef.current) return;
      setSuggestions(loadedSuggestions);
    });
  }, [
    libraryController,
    recentlyPlayed,
    searchController,
    suggestionCacheKey,
    libraryState.library,
  ]);

  const displayShelves = useMemo(() => {
    if (activeMood !== "all" && moodShelves) {
      return moodShelves;
    }

    const cleanRaw = splitMixedShelves(homeShelves);

    const existingPicksShelf = cleanRaw.find(
      (s) =>
        s.title.toLowerCase().includes("quick pick") ||
        s.title.toLowerCase().includes("picks for you") ||
        s.title.toLowerCase().includes("quick picks"),
    );

    const pickTracks = (existingPicksShelf && existingPicksShelf.tracks.length >= 4)
      ? existingPicksShelf.tracks
      : suggestions.length > 0
        ? suggestions
        : recentPlays;

    const quickPicksShelf: BrowseShelf = {
      title: "Quick picks",
      tracks: pickTracks.slice(0, 20),
      albums: [],
      playlists: [],
      artists: [],
      links: [],
    };

    const remaining = cleanRaw.filter(
      (s) =>
        s !== existingPicksShelf &&
        !s.title.toLowerCase().includes("quick pick") &&
        !s.title.toLowerCase().includes("picks for you"),
    );

    if (quickPicksShelf.tracks.length > 0) {
      return [quickPicksShelf, ...remaining];
    }

    return remaining;
  }, [activeMood, moodShelves, homeShelves, suggestions, recentPlays]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HOME_MOOD_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => void handleSelectMood(chip)}
            className={cn(
              "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
              activeMood === chip.id
                ? "bg-foreground text-background shadow-sm"
                : "bg-card/80 text-foreground hover:bg-card border border-border/40",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {isLoadingMood && (
        <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">
          Loading {HOME_MOOD_CHIPS.find((c) => c.id === activeMood)?.label} mixes...
        </div>
      )}

      {libraryState.status === "signed-out" && (
        <section className="flex items-center justify-between gap-4 rounded-xl bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          <div>
            <h1 className="text-base font-semibold text-foreground">You&apos;re not signed in</h1>
            <p>Sign in to access your history, playlists, and albums.</p>
          </div>
          <button
            type="button"
            onClick={() => void onSignIn()}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95"
          >
            Sign in
          </button>
        </section>
      )}

      {displayShelves.length > 0 ? (
        <BrowseShelves
          shelves={displayShelves}
          playerController={playerController}
          onOpenAlbum={onOpenAlbum ?? (() => {})}
          onOpenArtist={onOpenArtist ?? (() => {})}
          onOpenPlaylist={onOpenPlaylist ?? (() => {})}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-foreground">Quick picks</h2>
            <AlbumGridSkeleton count={8} label="Loading recommendations" />
          </section>
          {isLoadingHomeShelves && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">Albums for you</h2>
              <AlbumGridSkeleton count={8} label="Loading albums" />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
