import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Album, Artist, BrowseShelf, Playlist } from "../../datasource/types";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { SearchController } from "../../player/SearchController";
import { BrowseShelves } from "../components/BrowseShelves";
import type { HomeDestinationHandlers } from "../components/HomeDestinations";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { AlbumGridSkeleton } from "../components/Skeleton";

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

const cachedMoodShelves = new Map<string, BrowseShelf[]>();
let cachedRealHomeShelves: BrowseShelf[] | null = null;

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



interface HomeSectionConfig {
  key: string;
  title: string;
  query: string;
  type: "song" | "album" | "playlist";
}

const FEATURED_HOME_SECTIONS: HomeSectionConfig[] = [
  { key: "quick-picks", title: "Quick picks", query: "trending top songs hits", type: "song" },
  { key: "trending-songs", title: "Trending songs for you", query: "trending top songs hits", type: "song" },
  { key: "new-releases", title: "New releases", query: "new releases albums", type: "album" },
  { key: "featured-playlists", title: "Featured playlists for you", query: "featured playlists today hits", type: "playlist" },
  { key: "mixed-for-you", title: "Mixed for you", query: "My Mix Supermix Chill Mix Energy Mix playlist", type: "playlist" },
  { key: "albums-for-you", title: "Albums for you", query: "popular recommended albums", type: "album" },
  { key: "daily-discover", title: "Your daily discover", query: "discover weekly daily mix songs", type: "song" },
  { key: "forgotten-favorites", title: "Forgotten favorites", query: "forgotten favorites nostalgic hits", type: "song" },
  { key: "from-community", title: "From community", query: "community playlists trending fan", type: "playlist" },
  { key: "covers-remixes", title: "Covers and remixes", query: "acoustic cover remix slowed reverb", type: "song" },
  { key: "long-listens", title: "Long listens", query: "extended mix lofi live dj set", type: "song" },
];

export function HomePage({
  tabId: _tabId,
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
  const [isLoadingHomeShelves, setIsLoadingHomeShelves] = useState(() => !cachedRealHomeShelves || cachedRealHomeShelves.length === 0);

  useEffect(() => {
    let active = true;

    async function loadHomeFeed() {
      if (!cachedRealHomeShelves || cachedRealHomeShelves.length === 0) {
        setIsLoadingHomeShelves(true);
      }

      try {
        const homePage = await libraryController.getBrowsePage("home").catch(() => null);

        if (!active) return;

        const ytShelves = (homePage ? splitMixedShelves(homePage.shelves) : []).filter((s) => {
          const lower = s.title.toLowerCase();
          return (
            !lower.includes("music video") &&
            !lower.includes("recommended music video") &&
            lower !== "videos"
          );
        });

        let finalShelves: BrowseShelf[] = ytShelves.filter(
          (s) => s.tracks.length > 0 || s.albums.length > 0 || s.playlists.length > 0 || s.artists.length > 0,
        );

        // Only if YouTube returned no shelves at all (e.g., cold offline start), fetch minimal fallbacks
        if (finalShelves.length === 0) {
          const fallbackConfigs = FEATURED_HOME_SECTIONS.slice(0, 3);
          const searchResults = await Promise.all(
            fallbackConfigs.map((sec) => searchController.searchCategory(sec.query, sec.type).catch(() => null)),
          );

          if (!active) return;

          for (let i = 0; i < fallbackConfigs.length; i++) {
            const sec = fallbackConfigs[i];
            const searchRes = searchResults[i];
            if (!searchRes) continue;

            if (sec.type === "song" && searchRes.tracks.length > 0) {
              finalShelves.push({
                title: sec.title,
                tracks: searchRes.tracks.slice(0, 24),
                albums: [],
                playlists: [],
                artists: [],
                links: [],
              });
            } else if (sec.type === "album" && searchRes.albums.length > 0) {
              finalShelves.push({
                title: sec.title,
                tracks: [],
                albums: searchRes.albums.slice(0, 16),
                playlists: [],
                artists: [],
                links: [],
              });
            } else if (sec.type === "playlist" && searchRes.playlists.length > 0) {
              finalShelves.push({
                title: sec.title,
                tracks: [],
                albums: [],
                playlists: searchRes.playlists.slice(0, 16),
                artists: [],
                links: [],
              });
            }
          }
        }

        if (finalShelves.length > 0) {
          cachedRealHomeShelves = finalShelves;
          setHomeShelves(finalShelves);
        }
      } catch {
        // Retain existing cached shelves
      } finally {
        if (active) setIsLoadingHomeShelves(false);
      }
    }

    void loadHomeFeed();

    return () => {
      active = false;
    };
  }, [
    libraryController,
    searchController,
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
        const [tracksRes, albumsRes, playlistsRes] = await Promise.all([
          searchController.searchCategory(chip.query, "song").catch(() => null),
          searchController.searchCategory(chip.query, "album").catch(() => null),
          searchController.searchCategory(chip.query, "playlist").catch(() => null),
        ]);
        const shelves: BrowseShelf[] = [];
        if (tracksRes && tracksRes.tracks.length > 0) {
          shelves.push({
            title: `${chip.label} — Top Songs`,
            tracks: tracksRes.tracks.slice(0, 32),
            albums: [],
            playlists: [],
            artists: [],
            links: [],
          });
        }
        if (albumsRes && albumsRes.albums.length > 0) {
          shelves.push({
            title: `${chip.label} — Albums`,
            tracks: [],
            albums: albumsRes.albums.slice(0, 24),
            playlists: [],
            artists: [],
            links: [],
          });
        }
        if (playlistsRes && playlistsRes.playlists.length > 0) {
          shelves.push({
            title: `${chip.label} — Playlists`,
            tracks: [],
            albums: [],
            playlists: playlistsRes.playlists.slice(0, 24),
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
