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

interface PinnedSectionSpec {
  id: string;
  title: string;
  matchPatterns: RegExp[];
  browseTarget?: { browseId: string; title: string };
  fallbackQuery: string;
  fallbackType: "song" | "album" | "playlist";
}

const RECAP_PLAYLISTS: Playlist[] = [
  {
    id: "recap-2025",
    title: "2025 Recap",
    owner: "YouTube Music",
    artworkUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80",
  },
  {
    id: "recap-2024",
    title: "2024 Recap",
    owner: "YouTube Music",
    artworkUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80",
  },
  {
    id: "recap-spring-23",
    title: "Spring Recap '23",
    owner: "YouTube Music",
    artworkUrl: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80",
  },
];

/**
 * Pinned immutable order of the 15 Home Page sections.
 * This exact order is hardcoded and preserved across all loads.
 */
const PINNED_SECTIONS: PinnedSectionSpec[] = [
  {
    id: "quick-picks",
    title: "Quick picks",
    matchPatterns: [/^quick picks/i, /start radio/i],
    fallbackQuery: "trending top songs hits",
    fallbackType: "song",
  },
  {
    id: "albums-for-you",
    title: "Albums for you",
    matchPatterns: [/albums for you/i, /recommended albums/i, /popular albums/i],
    fallbackQuery: "popular recommended albums",
    fallbackType: "album",
  },
  {
    id: "from-your-library",
    title: "From your library",
    matchPatterns: [/from your library/i, /your library/i, /^library$/i],
    browseTarget: { browseId: "FEmusic_library", title: "From your library" },
    fallbackQuery: "favorite playlists hits",
    fallbackType: "playlist",
  },
  {
    id: "fresh-finds-old-favorites",
    title: "Fresh finds, old favorites",
    matchPatterns: [/fresh finds/i, /old favorites/i, /listen again/i, /forgotten favorites/i],
    fallbackQuery: "forgotten favorites nostalgic hits",
    fallbackType: "song",
  },
  {
    id: "new-releases",
    title: "New releases",
    matchPatterns: [/new releases/i, /new albums/i, /new singles/i],
    browseTarget: { browseId: "FEmusic_new_releases_albums", title: "New releases" },
    fallbackQuery: "new releases albums songs",
    fallbackType: "album",
  },
  {
    id: "from-the-community",
    title: "From the community",
    matchPatterns: [/from the community/i, /community/i],
    fallbackQuery: "community playlists viral fanmade",
    fallbackType: "playlist",
  },
  {
    id: "featured-playlists-for-you",
    title: "Featured playlists for you",
    matchPatterns: [/featured playlists/i, /moods & genres/i, /playlists for you/i],
    browseTarget: { browseId: "FEmusic_moods_and_genres", title: "Featured playlists for you" },
    fallbackQuery: "featured playlists today hits",
    fallbackType: "playlist",
  },
  {
    id: "recaps",
    title: "Recaps",
    matchPatterns: [/recap/i, /your recap/i],
    browseTarget: { browseId: "UCWLjkgkthzEjTmEpGg0xoDw", title: "Recaps" },
    fallbackQuery: "YouTube Music Recap playlist",
    fallbackType: "playlist",
  },
  {
    id: "pump-it-up",
    title: "Pump it up",
    matchPatterns: [/pump it up/i, /workout/i, /energize/i, /gym motivation/i],
    fallbackQuery: "pump it up workout gym motivation",
    fallbackType: "song",
  },
  {
    id: "mixed-for-you",
    title: "Mixed for you",
    matchPatterns: [/mixed for you/i, /my mix/i, /supermix/i, /mixes for you/i],
    browseTarget: { browseId: "FEmusic_mixed_for_you", title: "Mixed for you" },
    fallbackQuery: "My Mix Supermix Chill Mix Energy Mix playlist",
    fallbackType: "playlist",
  },
  {
    id: "covers-and-remixes",
    title: "Covers and remixes",
    matchPatterns: [/covers and remixes/i, /covers & remixes/i, /covers/i, /remixes/i],
    fallbackQuery: "acoustic cover remix slowed reverb",
    fallbackType: "song",
  },
  {
    id: "your-daily-discover",
    title: "Your daily discover",
    matchPatterns: [/daily discover/i, /discover mix/i, /discover/i],
    fallbackQuery: "discover weekly daily mix songs",
    fallbackType: "song",
  },
  {
    id: "trending-songs-for-you",
    title: "Trending songs for you",
    matchPatterns: [/trending songs/i, /trending/i, /charts/i],
    fallbackQuery: "trending songs top global hits",
    fallbackType: "song",
  },
  {
    id: "heard-in-shorts",
    title: "Heard in shorts",
    matchPatterns: [/heard in shorts/i, /shorts/i, /youtube shorts/i],
    fallbackQuery: "popular songs used in YouTube shorts trending remix",
    fallbackType: "song",
  },
  {
    id: "long-listens",
    title: "Long listens",
    matchPatterns: [/long listens/i, /extended/i, /deep focus/i],
    fallbackQuery: "extended mix lofi live dj set long listen",
    fallbackType: "song",
  },
  {
    id: "music-videos",
    title: "Music videos",
    matchPatterns: [/music videos/i, /videos/i, /top music videos/i],
    fallbackQuery: "top official music videos trending",
    fallbackType: "song",
  },
  {
    id: "podcasts",
    title: "Podcasts & Shows",
    matchPatterns: [/podcasts/i, /podcast/i, /episodes/i, /shows/i],
    fallbackQuery: "popular podcast episodes full show talk",
    fallbackType: "song",
  },
];

const cachedMoodShelves = new Map<string, BrowseShelf[]>();
let cachedRealHomeShelves: BrowseShelf[] | null = null;
const cachedFallbackShelves = new Map<string, BrowseShelf>();

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

function buildPinnedShelves(
  ytShelves: BrowseShelf[],
  libraryState: LibraryState,
  fallbackMap: Map<string, BrowseShelf>,
): { shelves: BrowseShelf[]; matchedIds: Set<string> } {
  const result: BrowseShelf[] = [];
  const matchedIds = new Set<string>();
  const usedYtIndices = new Set<number>();

  for (const section of PINNED_SECTIONS) {
    // 1. Account Library
    if (section.id === "from-your-library") {
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

      if (combinedPlaylists.length > 0 || userAlbums.length > 0 || likedSongs.length > 0) {
        result.push({
          title: section.title,
          tracks: [],
          albums: userAlbums.slice(0, 10),
          playlists: combinedPlaylists.slice(0, 16),
          artists: [],
          links: [],
        });
        matchedIds.add(section.id);
        continue;
      }
    }

    // 2. Match from YouTube Music Home browse feed (from Innertube continuations)
    let matchedFromYt: BrowseShelf | null = null;
    for (let i = 0; i < ytShelves.length; i++) {
      if (usedYtIndices.has(i)) continue;
      const candidate = ytShelves[i];
      if (section.matchPatterns.some((p) => p.test(candidate.title))) {
        matchedFromYt = { ...candidate, title: section.title };
        usedYtIndices.add(i);
        break;
      }
    }

    if (matchedFromYt) {
      result.push(matchedFromYt);
      matchedIds.add(section.id);
      continue;
    }

    // 3. Recaps fallback if not in ytShelves
    if (section.id === "recaps") {
      result.push({
        title: section.title,
        tracks: [],
        albums: [],
        playlists: RECAP_PLAYLISTS,
        artists: [],
        links: [],
      });
      matchedIds.add(section.id);
      continue;
    }

    // 4. Cached or dynamically fetched fallback shelf
    const fallbackShelf = fallbackMap.get(section.id);
    if (fallbackShelf) {
      result.push({ ...fallbackShelf, title: section.title });
      matchedIds.add(section.id);
    }
  }

  return { shelves: result, matchedIds };
}

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
  onOpenReleases,
}: HomePageProps) {
  useTrackContextMenu();
  const [activeMood, setActiveMood] = useState<string>("all");
  const [moodShelves, setMoodShelves] = useState<BrowseShelf[] | null>(null);
  const [isLoadingMood, setIsLoadingMood] = useState(false);
  const [homeShelves, setHomeShelves] = useState<BrowseShelf[]>(() => cachedRealHomeShelves ?? []);
  const [isLoadingHomeShelves, setIsLoadingHomeShelves] = useState(
    () => !cachedRealHomeShelves || cachedRealHomeShelves.length === 0,
  );

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

        // Assemble primary pinned shelves
        const { shelves: initialPinned, matchedIds } = buildPinnedShelves(
          ytShelves,
          libraryState,
          cachedFallbackShelves,
        );

        if (initialPinned.length > 0) {
          cachedRealHomeShelves = initialPinned;
          setHomeShelves(initialPinned);
        }

        // Asynchronously fetch any missing pinned sections so all 16 appear in order
        const missingSections = PINNED_SECTIONS.filter(
          (sec) => !matchedIds.has(sec.id) && !cachedFallbackShelves.has(sec.id),
        );

        if (missingSections.length > 0) {
          void Promise.all(
            missingSections.map(async (sec) => {
              try {
                if (sec.browseTarget) {
                  const browseRes = await libraryController
                    .getBrowsePage(sec.browseTarget)
                    .catch(() => null);
                  if (browseRes && browseRes.shelves.length > 0) {
                    const firstShelf = browseRes.shelves[0];
                    if (
                      firstShelf.tracks.length > 0 ||
                      firstShelf.albums.length > 0 ||
                      firstShelf.playlists.length > 0
                    ) {
                      return { sec, shelf: { ...firstShelf, title: sec.title } };
                    }
                  }
                }

                const searchRes = await searchController
                  .searchCategory(sec.fallbackQuery, sec.fallbackType)
                  .catch(() => null);

                if (!searchRes) return null;

                const fallbackShelf: BrowseShelf = {
                  title: sec.title,
                  tracks: sec.fallbackType === "song" ? searchRes.tracks.slice(0, 24) : [],
                  albums: sec.fallbackType === "album" ? searchRes.albums.slice(0, 16) : [],
                  playlists: sec.fallbackType === "playlist" ? searchRes.playlists.slice(0, 16) : [],
                  artists: [],
                  links: [],
                };

                if (
                  fallbackShelf.tracks.length > 0 ||
                  fallbackShelf.albums.length > 0 ||
                  fallbackShelf.playlists.length > 0
                ) {
                  return { sec, shelf: fallbackShelf };
                }
              } catch {
                return null;
              }
              return null;
            }),
          ).then((results) => {
            if (!active) return;
            let updatedAny = false;
            for (const item of results) {
              if (item) {
                cachedFallbackShelves.set(item.sec.id, item.shelf);
                updatedAny = true;
              }
            }
            if (updatedAny) {
              const { shelves: completePinned } = buildPinnedShelves(
                ytShelves,
                libraryState,
                cachedFallbackShelves,
              );
              if (completePinned.length > 0) {
                cachedRealHomeShelves = completePinned;
                setHomeShelves(completePinned);
              }
            }
          });
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
    libraryState.library?.recentlyPlayed,
    libraryState.library?.playlists,
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
