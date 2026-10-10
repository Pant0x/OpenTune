import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Album, Artist, BrowseShelf, Playlist } from "../../datasource/types";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { SearchController } from "../../player/SearchController";
import { BrowseShelves } from "../components/BrowseShelves";
import type { HomeDestinationHandlers } from "../components/HomeDestinations";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { AlbumGridSkeleton } from "../components/Skeleton";
import { useAuthProfile } from "@/lib/authProfile";
import { requestAuthModal } from "../components/AuthModal";

interface HomeMoodChip {
  id: string;
  label: string;
  query?: string;
}

const HOME_MOOD_CHIPS: HomeMoodChip[] = [
  { id: "all", label: "All" },
  { id: "podcasts", label: "Podcasts", query: "popular podcast episodes talk show" },
  { id: "videos", label: "Music Videos", query: "top official music videos trending" },
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
  onOpenReleases?: () => void;
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

function buildHomeShelves(
  ytShelves: BrowseShelf[],
  libraryState: LibraryState,
): BrowseShelf[] {
  const result: BrowseShelf[] = [];
  const seenTitles = new Set<string>();

  // 1. User's Personal Account Library Shelf ("From your library")
  const likedSongs = libraryState.library?.likedSongs ?? [];
  const userPlaylists = libraryState.library?.playlists ?? [];
  const userAlbums = libraryState.library?.albums ?? [];

  const likedPlaylist: Playlist | null = likedSongs.length > 0 ? {
    id: "LM",
    title: "Liked Music",
    owner: "Auto playlist",
    artworkUrl: likedSongs[0]?.artworkUrl,
    kind: "liked-songs",
  } : null;

  const combinedPlaylists: Playlist[] = likedPlaylist
    ? [likedPlaylist, ...userPlaylists.filter((p) => p.id !== "LM")]
    : userPlaylists;

  const libraryShelf: BrowseShelf | null =
    combinedPlaylists.length > 0 || userAlbums.length > 0 || likedSongs.length > 0
      ? {
          title: "From your library",
          tracks: likedSongs.slice(0, 10),
          albums: userAlbums.slice(0, 10),
          playlists: combinedPlaylists.slice(0, 16),
          artists: [],
          links: [],
        }
      : null;

  // 2. Locate "Quick picks" in YouTube Music shelves
  const quickPicksIndex = ytShelves.findIndex(
    (s) => /^quick picks/i.test(s.title) || /start radio/i.test(s.title),
  );

  if (quickPicksIndex >= 0) {
    const quickPicks = ytShelves[quickPicksIndex];
    result.push({ ...quickPicks, title: "Quick picks" });
    seenTitles.add("quick picks");
    seenTitles.add(quickPicks.title.toLowerCase().trim());

    // Place "From your library" right below Quick picks
    if (libraryShelf) {
      result.push(libraryShelf);
      seenTitles.add("from your library");
    }
  } else if (libraryShelf) {
    // If no Quick picks, place "From your library" first
    result.push(libraryShelf);
    seenTitles.add("from your library");
  }

  // 3. Append ALL real shelves returned by YouTube Music in their natural order!
  for (let i = 0; i < ytShelves.length; i++) {
    if (i === quickPicksIndex) continue;
    const shelf = ytShelves[i];
    const lower = shelf.title.trim().toLowerCase();
    if (seenTitles.has(lower)) continue;
    if (lower === "from your library" || lower === "your library" || lower === "library") {
      if (libraryShelf) continue;
    }
    seenTitles.add(lower);
    result.push(shelf);
  }

  return result;
}

export function HomePage({
  tabId: _tabId,
  playerController,
  libraryController,
  libraryState,
  searchController,
  onSignIn: _onSignIn,
  destinations: _destinations,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onOpenReleases,
}: HomePageProps) {
  useTrackContextMenu();
  const { profile: cloudProfile } = useAuthProfile();
  const [activeMood, setActiveMood] = useState<string>("all");
  const [moodShelves, setMoodShelves] = useState<BrowseShelf[] | null>(null);
  const [isLoadingMood, setIsLoadingMood] = useState(false);
  const [homeShelves, setHomeShelves] = useState<BrowseShelf[]>(() => cachedRealHomeShelves ?? []);
  const [isLoadingHomeShelves, setIsLoadingHomeShelves] = useState(
    () => !cachedRealHomeShelves || cachedRealHomeShelves.length === 0,
  );
  const lastAccountRef = useRef<string | undefined>(libraryState.library?.account?.name);

  useEffect(() => {
    let active = true;

    // Invalidate cached home shelves on account change or sign out
    if (lastAccountRef.current !== libraryState.library?.account?.name) {
      cachedRealHomeShelves = null;
      lastAccountRef.current = libraryState.library?.account?.name;
      setHomeShelves([]);
      setIsLoadingHomeShelves(true);
    } else if (!cachedRealHomeShelves || cachedRealHomeShelves.length === 0) {
      setIsLoadingHomeShelves(true);
    }

    async function loadHomeFeed() {
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

        const shelves = buildHomeShelves(ytShelves, libraryState);

        if (shelves.length > 0) {
          cachedRealHomeShelves = shelves;
          setHomeShelves(shelves);
        } else if (cachedRealHomeShelves && cachedRealHomeShelves.length > 0) {
          setHomeShelves(cachedRealHomeShelves);
        }
      } catch {
        // Retain existing cached shelves
      } finally {
        if (active) setIsLoadingHomeShelves(false);
      }
    }

    void loadHomeFeed();

    // Listen for background updates from YouTubeMusicDataSource.refreshBrowsePage
    const unsubscribe = libraryController.onBrowsePageUpdated((surface, page) => {
      const isHome = surface === "home" || (typeof surface === "object" && surface.browseId === "FEmusic_home" && !surface.params);
      if (!isHome || !active || !page?.shelves?.length) return;

      const ytShelves = splitMixedShelves(page.shelves).filter((s) => {
        const lower = s.title.toLowerCase();
        return (
          !lower.includes("music video") &&
          !lower.includes("recommended music video") &&
          lower !== "videos"
        );
      });

      const shelves = buildHomeShelves(ytShelves, libraryState);
      if (shelves.length > 0) {
        cachedRealHomeShelves = shelves;
        setHomeShelves(shelves);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    libraryController,
    libraryState.status,
    libraryState.library?.account?.name,
    libraryState.library?.playlists,
    libraryState.library?.likedSongs,
    libraryState.library?.albums,
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

      {libraryState.status === "signed-out" && !cloudProfile && (
        <section className="flex items-center justify-between gap-4 rounded-xl bg-card/60 px-4 py-3 text-sm text-muted-foreground">
          <div>
            <h1 className="text-base font-semibold text-foreground">You&apos;re not signed in</h1>
            <p>Sign in to sync your playlists, favorites, and preferences across devices.</p>
          </div>
          <button
            type="button"
            onClick={() => requestAuthModal()}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95 cursor-pointer"
          >
            Sign in
          </button>
        </section>
      )}

      {libraryState.status === "signed-out" && cloudProfile && (
        <section className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          <div>
            <h1 className="text-sm font-semibold text-foreground">
              Welcome back, {cloudProfile.username}
            </h1>
            <p className="text-xs">
              Connect YouTube Music to sync your YouTube listening history, liked songs, and playlists.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void libraryController.signIn()}
            className="rounded-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 cursor-pointer"
          >
            Connect YouTube
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
          onOpenReleases={onOpenReleases}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-foreground">Quick picks</h2>
            <AlbumGridSkeleton count={8} label="Loading recommendations" />
          </section>
          {isLoadingHomeShelves && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold text-foreground">albums for you</h2>
              <AlbumGridSkeleton count={8} label="Loading albums" />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
