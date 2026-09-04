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
  { id: "sleep", label: "Sleep", query: "sleep relaxing calm music deep sleep" },
  { id: "relax", label: "Relax", query: "relax chill lofi acoustic" },
  { id: "sad", label: "Sad", query: "sad emotional songs acoustic" },
  { id: "romance", label: "Romance", query: "romance love songs slow" },
  { id: "energize", label: "Energize", query: "energy booster hype workout" },
  { id: "party", label: "Party", query: "party dance club hits" },
  { id: "commute", label: "Commute", query: "road trip drive commute music" },
  { id: "feel-good", label: "Feel good", query: "feel good happy vibes positive" },
  { id: "focus", label: "Focus", query: "focus ambient study beats deep focus" },
  { id: "workout", label: "Workout", query: "workout gym motivation pump up" },
];

const suggestionCache = new Map<string, Track[]>();
const suggestionLoads = new Map<string, Promise<Track[]>>();
const cachedMoodShelves = new Map<string, BrowseShelf[]>();
let cachedRealHomeShelves: BrowseShelf[] | null = null;
const EMPTY_TRACKS: Track[] = [];

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

interface StaticSectionDef {
  key: string;
  title: string;
  query: string;
  type: "tracks" | "albums" | "playlists";
}

const STATIC_HOME_SECTIONS: StaticSectionDef[] = [
  { key: "quick-picks", title: "Quick picks", query: "", type: "tracks" },
  { key: "mixed-for-you-1", title: "Mixed for you", query: "My Mix Supermix Chill Mix Energy Mix playlist", type: "playlists" },
  { key: "albums-for-you", title: "Albums for you", query: "popular recommended albums", type: "albums" },
  { key: "mixed-for-you-2", title: "Mixed for you", query: "Artist mix radio playlist", type: "playlists" },
  { key: "new-releases", title: "New releases", query: "new releases albums", type: "albums" },
  { key: "featured-playlists", title: "Featured playlists for you", query: "featured playlists today hits", type: "playlists" },
  { key: "trending-songs", title: "Trending songs for you", query: "trending top songs hits", type: "tracks" },
  { key: "daily-discover", title: "Your daily discover", query: "discover weekly daily mix songs", type: "tracks" },
  { key: "from-library", title: "From your library", query: "", type: "tracks" },
  { key: "covers-remixes", title: "Covers and remixes", query: "acoustic cover remix slowed reverb", type: "tracks" },
  { key: "heard-shorts", title: "Heard in Shorts", query: "viral shorts songs tiktok sounds", type: "tracks" },
  { key: "long-listens", title: "Long listens", query: "extended mix lofi live dj set", type: "tracks" },
  { key: "fresh-finds", title: "Fresh finds, old favorites", query: "fresh finds classics old favorites", type: "albums" },
  { key: "recaps", title: "Recaps", query: "recap 2024 2025 recap playlist", type: "playlists" },
  { key: "take-it-easy", title: "Take it easy", query: "take it easy chill acoustic relaxing", type: "playlists" },
  { key: "todays-hits", title: "Today's hits", query: "today hits global top 50", type: "playlists" },
];

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
  const [homeShelves, setHomeShelves] = useState<BrowseShelf[]>(() => cachedRealHomeShelves ?? []);
  const [isLoadingHomeShelves, setIsLoadingHomeShelves] = useState(() => !cachedRealHomeShelves);

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

  // Load and hydrate all 16 static sections
  useEffect(() => {
    let active = true;

    async function loadAllStaticHomeSections() {
      if (cachedRealHomeShelves && cachedRealHomeShelves.length > 0) {
        setHomeShelves(cachedRealHomeShelves);
        setIsLoadingHomeShelves(false);
      } else {
        setIsLoadingHomeShelves(true);
      }

      try {
        const homePage = await libraryController.getBrowsePage("home").catch(() => null);
        const ytShelves = homePage ? splitMixedShelves(homePage.shelves) : [];

        if (ytShelves.length > 0) {
          const quickPicksTracks = suggestions.length > 0 ? suggestions : recentPlays;
          const enhancedShelves = ytShelves.map((s) => {
            if (
              (s.title.toLowerCase().includes("quick pick") ||
                s.title.toLowerCase().includes("picks for you")) &&
              s.tracks.length < 4 &&
              quickPicksTracks.length > 0
            ) {
              return { ...s, tracks: quickPicksTracks.slice(0, 20) };
            }
            return s;
          });

          const hasQuickPicks = enhancedShelves.some(
            (s) =>
              s.title.toLowerCase().includes("quick pick") ||
              s.title.toLowerCase().includes("picks for you"),
          );
          const finalShelves = hasQuickPicks
            ? enhancedShelves
            : [
                {
                  title: "Quick picks",
                  tracks: quickPicksTracks.slice(0, 20),
                  albums: [],
                  playlists: [],
                  artists: [],
                  links: [],
                },
                ...enhancedShelves,
              ];

          cachedRealHomeShelves = finalShelves;
          if (active) {
            setHomeShelves(finalShelves);
            setIsLoadingHomeShelves(false);
          }
          return;
        }

        // If library is still restoring/authorizing, do not commit fallback searches yet
        if (libraryState.status === "restoring" || libraryState.status === "loading" || libraryState.status === "authorizing") {
          return;
        }

        // 1. First pass: immediate render of available YouTube shelves and quick-picks
        const initialShelves: BrowseShelf[] = [];
        const missingSections: StaticSectionDef[] = [];

        for (let i = 0; i < STATIC_HOME_SECTIONS.length; i++) {
          const sectionDef = STATIC_HOME_SECTIONS[i];

          if (sectionDef.key === "quick-picks") {
            const ytQuickPicks = ytShelves.find(
              (s) =>
                s.title.toLowerCase().includes("quick pick") ||
                s.title.toLowerCase().includes("picks for you"),
            );
            const tracks = ytQuickPicks && ytQuickPicks.tracks.length >= 4
              ? ytQuickPicks.tracks
              : suggestions.length > 0
                ? suggestions
                : recentPlays;

            initialShelves.push({
              title: sectionDef.title,
              tracks: tracks.slice(0, 20),
              albums: [],
              playlists: [],
              artists: [],
              links: [],
            });
            continue;
          }

          if (sectionDef.key === "from-library") {
            const libTracks = recentPlays.slice(0, 16);
            if (libTracks.length > 0) {
              initialShelves.push({
                title: sectionDef.title,
                tracks: libTracks,
                albums: [],
                playlists: [],
                artists: [],
                links: [],
              });
            }
            continue;
          }

          const lowerKey = sectionDef.title.toLowerCase();
          const existingYtShelf = ytShelves.find((s) => {
            const lowerTitle = s.title.toLowerCase();
            return (
              lowerTitle === lowerKey ||
              lowerTitle.includes(lowerKey) ||
              (lowerKey.includes("new release") && lowerTitle.includes("new release")) ||
              (lowerKey.includes("take it easy") && lowerTitle.includes("take it easy")) ||
              (lowerKey.includes("album") && s.albums.length > 0)
            );
          });

          if (existingYtShelf && (
            existingYtShelf.tracks.length > 0 ||
            existingYtShelf.albums.length > 0 ||
            existingYtShelf.playlists.length > 0
          )) {
            initialShelves.push({
              title: sectionDef.title,
              tracks: existingYtShelf.tracks,
              albums: existingYtShelf.albums,
              playlists: existingYtShelf.playlists,
              artists: existingYtShelf.artists,
              links: existingYtShelf.links,
            });
          } else if (sectionDef.query) {
            missingSections.push(sectionDef);
          }
        }

        if (!active) return;
        if (initialShelves.length > 0) {
          setHomeShelves(initialShelves);
          setIsLoadingHomeShelves(false);
        }

        // 2. Background pass: hydrate missing sections concurrently with limit
        if (missingSections.length > 0) {
          const fallbackResults = await Promise.allSettled(
            missingSections.slice(0, 6).map(async (sec) => {
              const res = await searchController.search(sec.query);
              if (sec.type === "albums" && res.albums.length > 0) {
                return {
                  title: sec.title,
                  tracks: [],
                  albums: res.albums,
                  playlists: [],
                  artists: [],
                  links: [],
                } as BrowseShelf;
              } else if (sec.type === "playlists" && res.playlists.length > 0) {
                return {
                  title: sec.title,
                  tracks: [],
                  albums: [],
                  playlists: res.playlists,
                  artists: [],
                  links: [],
                } as BrowseShelf;
              } else if (res.tracks.length > 0) {
                return {
                  title: sec.title,
                  tracks: res.tracks,
                  albums: [],
                  playlists: [],
                  artists: [],
                  links: [],
                } as BrowseShelf;
              }
              return null;
            })
          );

          if (!active) return;
          const extraShelves = fallbackResults
            .filter((r): r is PromiseFulfilledResult<BrowseShelf | null> => r.status === "fulfilled" && r.value !== null)
            .map((r) => r.value as BrowseShelf);

          if (extraShelves.length > 0) {
            setHomeShelves((prev) => [...prev, ...extraShelves]);
          }
        }
      } catch {
        // Fallback
      } finally {
        if (active) setIsLoadingHomeShelves(false);
      }
    }

    void loadAllStaticHomeSections();

    return () => {
      active = false;
    };
  }, [
    libraryController,
    searchController,
    suggestions,
    recentPlays,
    libraryState.status,
    libraryState.library?.account?.name,
  ]);

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

  const displayShelves = useMemo(() => {
    if (activeMood !== "all" && moodShelves) {
      return moodShelves;
    }

    return homeShelves;
  }, [activeMood, moodShelves, homeShelves]);

  return (
    <div className="flex flex-col gap-8">
      {/* Mood / Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HOME_MOOD_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => void handleSelectMood(chip)}
            className={cn(
              "shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
              activeMood === chip.id
                ? "bg-foreground text-background font-semibold shadow-sm"
                : "bg-card/70 text-foreground hover:bg-card border border-white/5",
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
