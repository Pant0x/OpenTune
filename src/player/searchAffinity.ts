import type { SearchResults } from "../datasource/types";
import {
  deduplicateArtists,
  normTranslit,
  parseSubscriberCount,
} from "../datasource/searchNormalize";
import { playerController } from "./playerStore";

const SEARCH_SELECTIONS_KEY = "amber_search_selections_v1";
const ARTIST_AFFINITY_KEY = "amber_artist_search_affinities_v1";
const FOLLOWED_ARTISTS_KEY = "amber_followed_artists";

/**
 * Normalizes text for lenient matching: removes hyphens, underscores,
 * punctuation, extra spaces, and accents.
 * e.g. "Lege-Cy" -> "legecy", "legecy" -> "legecy", "Lil' Wayne" -> "lilwayne"
 */
export function simplifyText(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF]/gi, "")
    .trim();
}

/**
 * Loads user search selections: maps normalized query -> map of entity ID/name to click counts.
 */
function loadSearchSelections(): Record<string, Record<string, number>> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(SEARCH_SELECTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Records that a user picked a specific artist/track/album for a search query.
 */
export function recordSearchSelection(
  query: string,
  item: { id: string; name?: string; title?: string; artist?: string },
): void {
  if (typeof localStorage === "undefined") return;
  const cleanQuery = simplifyText(query);
  if (!cleanQuery) return;

  try {
    const selections = loadSearchSelections();
    if (!selections[cleanQuery]) {
      selections[cleanQuery] = {};
    }

    const key = item.id || simplifyText(item.name || item.title || "");
    if (key) {
      selections[cleanQuery][key] = (selections[cleanQuery][key] || 0) + 1;
      localStorage.setItem(SEARCH_SELECTIONS_KEY, JSON.stringify(selections));
    }

    // Also track artist preference count globally
    const artistName = item.artist || item.name;
    if (artistName) {
      const artistKey = simplifyText(artistName);
      const affinities: Record<string, number> = JSON.parse(
        localStorage.getItem(ARTIST_AFFINITY_KEY) || "{}",
      );
      affinities[artistKey] = (affinities[artistKey] || 0) + 1;
      localStorage.setItem(ARTIST_AFFINITY_KEY, JSON.stringify(affinities));
    }
  } catch {}
}

/**
 * Retrieves the set of followed artist IDs / simplified names.
 */
function getFollowedArtists(): Set<string> {
  const set = new Set<string>();
  if (typeof localStorage === "undefined") return set;
  try {
    const raw = localStorage.getItem(FOLLOWED_ARTISTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "string") {
            set.add(item);
            set.add(simplifyText(item));
            set.add(normTranslit(item));
          } else if (item?.id) {
            set.add(item.id);
            if (item.name) {
              set.add(simplifyText(item.name));
              set.add(normTranslit(item.name));
            }
          }
        }
      }
    }
  } catch {}
  return set;
}

/**
 * Retrieves recently played artist frequencies from playerController history.
 */
function getRecentlyPlayedArtistCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    const history = playerController.getState().history || [];
    for (const track of history) {
      if (track.artist) {
        const key = simplifyText(track.artist);
        counts.set(key, (counts.get(key) || 0) + 1);
        const tKey = normTranslit(track.artist);
        if (tKey) counts.set(tKey, (counts.get(tKey) || 0) + 1);
      }
      if (Array.isArray(track.artists)) {
        for (const a of track.artists) {
          if (a.name) {
            const aKey = simplifyText(a.name);
            counts.set(aKey, (counts.get(aKey) || 0) + 1);
            const aTKey = normTranslit(a.name);
            if (aTKey) counts.set(aTKey, (counts.get(aTKey) || 0) + 1);
          }
        }
      }
    }
  } catch {}
  return counts;
}

export interface AffinityContext {
  followedSet?: Set<string>;
  playedCounts?: Map<string, number>;
  selections?: Record<string, Record<string, number>>;
  globalAffinities?: Record<string, number>;
  suggestions?: string[];
  artistTrackCounts?: Map<string, number>;
}

/**
 * Calculates a dynamic affinity score for an artist based on user preferences,
 * search suggestions, and track correlation.
 */
export function calculateArtistAffinity(
  artistName: string,
  artistId: string | undefined,
  query: string,
  options?: AffinityContext,
): number {
  const simplifiedQuery = simplifyText(query);
  const simplifiedName = simplifyText(artistName);
  const translitQuery = normTranslit(query);
  const translitName = normTranslit(artistName);
  if (!simplifiedName) return 0;

  let score = 0;

  // 1. Text Similarity & Transliteration
  const rawTokens = artistName.toLowerCase().split(/[\s\-_\/.]+/).filter(Boolean);
  const firstTokenSimp = simplifyText(rawTokens[0] || "");
  const isFirstTokenExact = firstTokenSimp && firstTokenSimp === simplifiedQuery;

  if (simplifiedName === simplifiedQuery) {
    score += 100;
  } else if (translitQuery && translitName && translitQuery === translitName) {
    // Exact transliteration / phonetic match (e.g. 'sherein' <-> 'Sherine', 'fayrouz' <-> 'Fairouz')
    score += 98;
  } else if (isFirstTokenExact) {
    // Stem / first-token match (e.g. "Lege" in "Lege-Cy" or "Lil" in "Lil Wayne")
    score += 95;
  } else if (simplifiedName.startsWith(simplifiedQuery) || simplifiedQuery.startsWith(simplifiedName)) {
    score += 65;
  } else if (translitQuery && (translitName.startsWith(translitQuery) || translitQuery.startsWith(translitName))) {
    score += 60;
  } else if (simplifiedName.includes(simplifiedQuery) || simplifiedQuery.includes(simplifiedName)) {
    score += 40;
  }

  // 2. Search Suggestions Correlation (Up to +150)
  // When users search, YouTube's search suggestions reflect real-world query intent.
  const suggestions = options?.suggestions ?? [];
  if (suggestions.length > 0) {
    for (const sugg of suggestions) {
      const simpSugg = simplifyText(sugg);
      const translitSugg = normTranslit(sugg);
      if (!simpSugg) continue;
      if (simpSugg === simplifiedName || (translitSugg && translitSugg === translitName)) {
        score += 150;
        break;
      } else if (
        simpSugg.startsWith(simplifiedName) ||
        simplifiedName.startsWith(simpSugg) ||
        (translitSugg && (translitSugg.startsWith(translitName) || translitName.startsWith(translitSugg)))
      ) {
        score += 110;
        break;
      } else if (firstTokenSimp && simpSugg.startsWith(firstTokenSimp)) {
        score += 80;
        break;
      }
    }
  }

  // 3. Track Correlation in Current Search Results (Up to +160)
  // If the search results contain multiple songs by this artist, this artist is undeniably what was searched for.
  const trackCount = options?.artistTrackCounts?.get(simplifiedName)
    || (firstTokenSimp ? options?.artistTrackCounts?.get(firstTokenSimp) : 0)
    || (translitName ? options?.artistTrackCounts?.get(translitName) : 0)
    || 0;
  if (trackCount > 0) {
    score += Math.min(trackCount * 30, 160);
  }

  const followed = options?.followedSet ?? getFollowedArtists();
  const played = options?.playedCounts ?? getRecentlyPlayedArtistCounts();
  const selections = options?.selections ?? loadSearchSelections();

  // 4. User Followed Status (+250) - Dominates random matches
  if (
    (artistId && followed.has(artistId)) ||
    followed.has(simplifiedName) ||
    (translitName && followed.has(translitName))
  ) {
    score += 250;
  }

  // 5. User Listening History (Up to +200)
  const listenCount =
    played.get(simplifiedName) ||
    (firstTokenSimp ? played.get(firstTokenSimp) : 0) ||
    (translitName ? played.get(translitName) : 0) ||
    0;
  if (listenCount > 0) {
    score += Math.min(listenCount * 40, 200);
  }

  // 6. Past Search Selection for this Query (+160)
  const queryClicks = selections[simplifiedQuery];
  if (queryClicks) {
    const clicks = (artistId && queryClicks[artistId]) || queryClicks[simplifiedName] || 0;
    if (clicks > 0) {
      score += Math.min(clicks * 40, 160);
    }
  }

  // 7. Global Search Clicks / Affinities
  try {
    const globalAffinities = options?.globalAffinities ?? JSON.parse(
      (typeof localStorage !== "undefined" && localStorage.getItem(ARTIST_AFFINITY_KEY)) || "{}",
    );
    const totalClicks = globalAffinities[simplifiedName] || (firstTokenSimp ? globalAffinities[firstTokenSimp] : 0) || 0;
    if (totalClicks > 0) {
      score += Math.min(totalClicks * 15, 60);
    }
  } catch {}

  return score;
}

/**
 * Re-ranks search results dynamically based on user listening history,
 * followed artists, past search selections, search suggestions, and track correlation.
 */
export function reRankSearchResults(
  query: string,
  results: SearchResults,
  options?: { suggestions?: string[] },
): SearchResults {
  const cleanQuery = query.trim();
  if (!cleanQuery) return results;

  const followedSet = getFollowedArtists();
  const playedCounts = getRecentlyPlayedArtistCounts();
  const selections = loadSearchSelections();
  let globalAffinities: Record<string, number> = {};
  try {
    if (typeof localStorage !== "undefined") {
      globalAffinities = JSON.parse(localStorage.getItem(ARTIST_AFFINITY_KEY) || "{}");
    }
  } catch {}

  // Count tracks per artist in current results
  const artistTrackCounts = new Map<string, number>();
  for (const t of results.tracks || []) {
    if (t.artist) {
      const aSimp = simplifyText(t.artist);
      artistTrackCounts.set(aSimp, (artistTrackCounts.get(aSimp) || 0) + 1);
      const aTranslit = normTranslit(t.artist);
      if (aTranslit) artistTrackCounts.set(aTranslit, (artistTrackCounts.get(aTranslit) || 0) + 1);
    }
    if (Array.isArray(t.artists)) {
      for (const a of t.artists) {
        if (a.name) {
          const aSimp = simplifyText(a.name);
          artistTrackCounts.set(aSimp, (artistTrackCounts.get(aSimp) || 0) + 1);
          const aTranslit = normTranslit(a.name);
          if (aTranslit) artistTrackCounts.set(aTranslit, (artistTrackCounts.get(aTranslit) || 0) + 1);
        }
      }
    }
  }

  const ctx: AffinityContext = {
    followedSet,
    playedCounts,
    selections,
    globalAffinities,
    suggestions: options?.suggestions,
    artistTrackCounts,
  };

  // Deduplicate artists so no identical avatars or names duplicate in the result set
  const dedupedArtists = deduplicateArtists(results.artists || []);

  // 1. Re-rank Artists
  const scoredArtists = dedupedArtists.map((artist, originalIndex) => {
    const affinity = calculateArtistAffinity(artist.name, artist.id, cleanQuery, ctx);
    let score = affinity * 100 - originalIndex; // Maintain original stability for ties

    // Official music artists take priority over YouTuber/creator channels
    if (!artist.isCreator) {
      score += 2500;
    }

    // High subscriber / monthly listener count weight: ensures superstars outrank 10-sub channels
    const subs = parseSubscriberCount(artist.subscriberCount);
    if (subs >= 10_000_000) score += 9000;
    else if (subs >= 5_000_000) score += 7500;
    else if (subs >= 1_000_000) score += 6000;
    else if (subs >= 500_000) score += 4000;
    else if (subs >= 100_000) score += 2500;
    else if (subs >= 10_000) score += 1200;
    else if (subs >= 1_000) score += 400;

    return {
      artist,
      score,
    };
  });
  scoredArtists.sort((a, b) => b.score - a.score);
  const reRankedArtists = scoredArtists.map((item) => item.artist);

  // Top preferred artist for track and album prioritization
  const topPreferredArtistName = reRankedArtists[0]?.name ? simplifyText(reRankedArtists[0].name) : "";

  // 2. Re-rank Tracks (boost tracks by preferred artist or listened artist)
  const scoredTracks = results.tracks.map((track, originalIndex) => {
    let trackScore = 1000 - originalIndex;
    const trackArtistSimplified = simplifyText(track.artist || "");

    if (topPreferredArtistName && trackArtistSimplified === topPreferredArtistName) {
      trackScore += 500;
    } else if (topPreferredArtistName && trackArtistSimplified.includes(topPreferredArtistName)) {
      trackScore += 300;
    }

    if (followedSet.has(trackArtistSimplified)) {
      trackScore += 200;
    }
    if (playedCounts.has(trackArtistSimplified)) {
      trackScore += (playedCounts.get(trackArtistSimplified) || 0) * 20;
    }

    return { track, score: trackScore };
  });
  scoredTracks.sort((a, b) => b.score - a.score);
  const reRankedTracks = scoredTracks.map((item) => item.track);

  // 3. Re-rank Albums
  const scoredAlbums = results.albums.map((album, originalIndex) => {
    let albumScore = 1000 - originalIndex;
    const albumArtistSimplified = simplifyText(album.artist || "");

    if (topPreferredArtistName && albumArtistSimplified === topPreferredArtistName) {
      albumScore += 500;
    } else if (followedSet.has(albumArtistSimplified)) {
      albumScore += 200;
    }

    return { album, score: albumScore };
  });
  scoredAlbums.sort((a, b) => b.score - a.score);
  const reRankedAlbums = scoredAlbums.map((item) => item.album);

  return {
    artists: reRankedArtists,
    tracks: reRankedTracks,
    albums: reRankedAlbums,
    playlists: results.playlists,
  };
}
