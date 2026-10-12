import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Album, Artist, BrowseShelf, Playlist, Track } from "../../datasource/types";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import { type PlayerControllerActions, shallowEqual, usePlayerSelector } from "../../player/playerStore";
import type { SearchController } from "../../player/SearchController";
import { BrowseShelves } from "../components/BrowseShelves";
import type { HomeDestinationHandlers } from "../components/HomeDestinations";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { AlbumGridSkeleton } from "../components/Skeleton";
import { useAuthProfile } from "@/lib/authProfile";
import { requestAuthModal } from "../components/AuthModal";
import { PauseActiveIcon, PlayActiveIcon } from "@/ui/icons";
import { playerUIStore } from "../stores/playerUIStore";

export const MAKKAH_LIVE_TRACK: Track = {
  id: "wyR3geelZZ4",
  source: "youtube",
  title: "🔴 Makkah Live HD | بث مباشر مكة المكرمة",
  artist: "قناة القرآن الكريم السعودية",
  artworkUrl: "https://i.ytimg.com/vi/wyR3geelZZ4/hqdefault.jpg",
  album: "بث مباشر من المسجد الحرام",
  isVideo: true,
  isLive: true,
};

interface HomeMoodChip {
  id: string;
  label: string;
  query?: string;
}

const HOME_MOOD_CHIPS: HomeMoodChip[] = [
  { id: "all", label: "All" },
  { id: "spiritual", label: "Quran", query: "تلاوة قرآن كريم quran recitation" },
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
    matchPatterns: [/albums for you/i, /recommended albums/i, /popular albums/i, /albums & singles/i, /singles & eps/i, /^albums$/i],
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
    matchPatterns: [/fresh finds/i, /old favorites/i, /listen again/i, /forgotten favorites/i, /replay/i],
    fallbackQuery: "forgotten favorites nostalgic hits",
    fallbackType: "song",
  },
  {
    id: "new-releases",
    title: "New releases",
    matchPatterns: [/new releases/i, /new albums/i, /new singles/i, /latest releases/i],
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
    matchPatterns: [/pump it up/i, /workout/i, /energize/i, /energy/i, /gym motivation/i],
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
    matchPatterns: [/trending songs/i, /trending/i, /charts/i, /top songs/i, /today's hits/i],
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
          tracks: likedSongs.slice(0, 10),
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

    // 2b. Secondary match: if section is "albums-for-you" and no name matched, check for any unused shelf that contains primarily albums
    if (section.id === "albums-for-you") {
      for (let i = 0; i < ytShelves.length; i++) {
        if (usedYtIndices.has(i)) continue;
        const candidate = ytShelves[i];
        if (candidate.albums.length > 0 && candidate.tracks.length === 0) {
          result.push({ ...candidate, title: section.title });
          usedYtIndices.add(i);
          matchedIds.add(section.id);
          matchedFromYt = candidate;
          break;
        }
      }
      if (matchedFromYt) continue;

      if (libraryState.library?.albums && libraryState.library.albums.length > 0) {
        result.push({
          title: section.title,
          tracks: [],
          albums: libraryState.library.albums.slice(0, 16),
          playlists: [],
          artists: [],
          links: [],
        });
        matchedIds.add(section.id);
        continue;
      }
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

function MakkahLiveHeroCard({
  playerController,
  isLivePlaying,
}: {
  playerController: PlayerControllerActions;
  isLivePlaying: boolean;
}) {
  const togglePlayLive = () => {
    if (isLivePlaying) {
      playerController.pause();
    } else {
      playerController.playTrackById(MAKKAH_LIVE_TRACK.id, [MAKKAH_LIVE_TRACK], true);
    }
  };

  const watchVideoLive = () => {
    playerController.playTrackById(MAKKAH_LIVE_TRACK.id, [MAKKAH_LIVE_TRACK], true);
    playerUIStore.setLyricsMediaMode("video");
    playerUIStore.setNowPlayingFullscreen(true);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-r from-emerald-950/70 via-card/85 to-card/60 p-4 sm:p-6 backdrop-blur-md shadow-2xl transition-all">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-72 rounded-full bg-amber-500/10 blur-3xl" />

      <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        {/* Left: Thumbnail & Details */}
        <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
          <div
            className="relative size-20 sm:size-24 md:size-28 shrink-0 rounded-2xl overflow-hidden shadow-xl ring-1 ring-white/10 group cursor-pointer"
            onClick={togglePlayLive}
          >
            <img
              src={MAKKAH_LIVE_TRACK.artworkUrl}
              alt="Makkah Live"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="eager"
            />
            <div className="absolute inset-0 bg-black/35 group-hover:bg-black/55 transition-colors flex items-center justify-center">
              <div className="size-10 sm:size-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg group-hover:scale-110 active:scale-95 transition-transform">
                {isLivePlaying ? (
                  <PauseActiveIcon size={20} />
                ) : (
                  <PlayActiveIcon size={20} className="translate-x-0.5" />
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11px] font-bold text-red-400 border border-red-500/30 shadow-xs">
                <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
                LIVE • بث مباشر 24/7
              </span>
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                الحرم المكي الشريف
              </span>
            </div>

            <h2 className="text-base sm:text-xl font-bold text-foreground tracking-tight line-clamp-1">
              🔴 Makkah Live HD | بث مباشر مكة المكرمة
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-1">
              قناة القرآن الكريم السعودية • تلاوات خاشعة وطواف الكعبة المشرفة على مدار الساعة
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-end">
          <button
            type="button"
            onClick={togglePlayLive}
            className={cn(
              "flex-1 md:flex-initial flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs sm:text-sm font-semibold shadow-lg transition-all active:scale-95 cursor-pointer",
              isLivePlaying
                ? "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
                : "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105",
            )}
          >
            {isLivePlaying ? (
              <>
                <PauseActiveIcon size={16} />
                <span>Pause Live / إيقاف</span>
              </>
            ) : (
              <>
                <PlayActiveIcon size={16} />
                <span>Listen Live / استماع مباشر</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={watchVideoLive}
            className="flex items-center justify-center gap-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold px-4 py-2.5 text-xs sm:text-sm border border-white/15 transition-all shadow-md hover:scale-105 active:scale-95 cursor-pointer"
            title="Watch Live Video in Fullscreen"
          >
            <span>Watch Video</span>
          </button>
        </div>
      </div>
    </div>
  );
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

  const { currentTrackId, isPlaying } = usePlayerSelector(
    (p) => ({
      currentTrackId: p.currentTrack?.id,
      isPlaying: p.status === "playing",
    }),
    shallowEqual,
  );
  const isLivePlaying = currentTrackId === MAKKAH_LIVE_TRACK.id && isPlaying;

  const lastAccountRef = useRef<string | undefined>(libraryState.library?.account?.name);

  // Invalidate cached home shelves on account change or sign out
  if (lastAccountRef.current !== libraryState.library?.account?.name) {
    cachedRealHomeShelves = null;
    cachedFallbackShelves.clear();
    lastAccountRef.current = libraryState.library?.account?.name;
  }

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

        // Asynchronously fetch any missing pinned sections so all appear in order
        const missingSections = PINNED_SECTIONS.filter(
          (sec) => !matchedIds.has(sec.id) && !cachedFallbackShelves.has(sec.id),
        );

        if (missingSections.length > 0) {
          const topArtist =
            libraryState.library?.likedSongs?.[0]?.artist ||
            libraryState.library?.recentlyPlayed?.[0]?.artist;

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

                let query = sec.fallbackQuery;
                if (topArtist) {
                  if (sec.id === "albums-for-you") query = `${topArtist} album`;
                  else if (sec.id === "quick-picks") query = `${topArtist} songs`;
                  else if (sec.id === "fresh-finds-old-favorites") query = `${topArtist} songs favorites`;
                }

                const searchRes = await searchController
                  .searchCategory(query, sec.fallbackType)
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

    // Listen for live background updates from YouTubeMusicDataSource.refreshBrowsePage
    const unsubscribe = libraryController.onBrowsePageUpdated((surface, page) => {
      const isHome =
        surface === "home" ||
        (typeof surface === "object" && surface.browseId === "FEmusic_home" && !surface.params);
      if (!isHome || !active || !page?.shelves?.length) return;

      const updatedYtShelves = splitMixedShelves(page.shelves).filter((s) => {
        const lower = s.title.toLowerCase();
        return (
          !lower.includes("music video") &&
          !lower.includes("recommended music video") &&
          lower !== "videos"
        );
      });

      const { shelves: completePinned } = buildPinnedShelves(
        updatedYtShelves,
        libraryState,
        cachedFallbackShelves,
      );

      if (completePinned.length > 0) {
        cachedRealHomeShelves = completePinned;
        setHomeShelves(completePinned);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    libraryController,
    searchController,
    libraryState.status,
    libraryState.library?.account?.name,
    libraryState.library?.recentlyPlayed,
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

    if (chip.id === "spiritual") {
      setIsLoadingMood(true);
      try {
        const [tracksRes, albumsRes, playlistsRes] = await Promise.all([
          searchController.searchCategory("تلاوة قرآن كريم quran recitation", "song").catch(() => null),
          searchController.searchCategory("المصحف المرتل quran full album", "album").catch(() => null),
          searchController.searchCategory("إذاعة القرآن الكريم quran playlist", "playlist").catch(() => null),
        ]);
        const shelves: BrowseShelf[] = [];
        const rawTracks = tracksRes?.tracks ?? [];
        const quranTracks: Track[] = [
          MAKKAH_LIVE_TRACK,
          ...rawTracks.filter((t) => t.id !== MAKKAH_LIVE_TRACK.id),
        ];

        if (quranTracks.length > 0) {
          shelves.push({
            title: "Quick picks — تلاوات مختارة",
            tracks: quranTracks.slice(0, 32),
            albums: [],
            playlists: [],
            artists: [],
            links: [],
          });
        }
        if (albumsRes && albumsRes.albums.length > 0) {
          shelves.push({
            title: "Recitations & Surahs — المصحف المرتل",
            tracks: [],
            albums: albumsRes.albums.slice(0, 24),
            playlists: [],
            artists: [],
            links: [],
          });
        }
        if (playlistsRes && playlistsRes.playlists.length > 0) {
          shelves.push({
            title: "Playlists & Radios — إذاعات وقوائم تشغيل",
            tracks: [],
            albums: [],
            playlists: playlistsRes.playlists.slice(0, 24),
            artists: [],
            links: [],
          });
        }
        cachedMoodShelves.set(chip.id, shelves);
        setMoodShelves(shelves);
      } catch {
        // Fallback gracefully
      } finally {
        setIsLoadingMood(false);
      }
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

      {activeMood === "spiritual" && (
        <MakkahLiveHeroCard
          playerController={playerController}
          isLivePlaying={isLivePlaying}
        />
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
