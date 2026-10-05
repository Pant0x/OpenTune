/**
 * Port of sigma67/spotify_to_ytmusic matching engine:
 * https://github.com/sigma67/spotify_to_ytmusic
 *
 * Employs difflib-style SequenceMatcher, duration delta penalties,
 * title/artist cleanup, album comparison, and song-over-video prioritization
 * to match Spotify playlist tracks accurately to official YouTube Music tracks.
 */

import type { Track } from "../datasource/types";
import type { LibraryController } from "../player/LibraryController";
import { logInternalInfo, logInternalWarn } from "../internal/logging";

export interface SpotifyTrackInput {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  artworkUrl?: string;
  id?: string;
}

export interface MatchProgressCallback {
  (current: number, total: number, matchedCount: number, currentTrackTitle: string): void;
}

const LOOKUP_CACHE_STORAGE_KEY = "opentune_spotify_yt_lookup_v1";
const lookupMemoryCache = new Map<string, Track>();

/**
 * Initializes cache from localStorage if available.
 */
function loadLookupCache(): void {
  if (typeof localStorage === "undefined" || lookupMemoryCache.size > 0) return;
  try {
    const raw = localStorage.getItem(LOOKUP_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Track>;
    for (const [key, track] of Object.entries(parsed)) {
      if (track && track.id) {
        lookupMemoryCache.set(key, track);
      }
    }
  } catch {
    // Ignore corrupt storage
  }
}

function saveLookupCacheEntry(queryKey: string, track: Track): void {
  lookupMemoryCache.set(queryKey, track);
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LOOKUP_CACHE_STORAGE_KEY);
    const data: Record<string, Track> = raw ? JSON.parse(raw) : {};
    data[queryKey] = track;
    // Cap stored entries to 1000 to keep localStorage light
    const keys = Object.keys(data);
    if (keys.length > 1000) {
      delete data[keys[0]];
    }
    localStorage.setItem(LOOKUP_CACHE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Cleans track title for YouTube Music search queries (sigma67 behavior):
 * Removes "(feat. ...)", "[feat. ...]", " - feat. ...", and " &".
 */
export function cleanSpotifyTrackTitle(title: string): string {
  let clean = title
    .replace(/\s*\((?:feat|ft)\.?\s+[^)]+\)/gi, "")
    .replace(/\s*\[(?:feat|ft)\.?\s+[^\]]+\]/gi, "")
    .replace(/\s*-\s*(?:feat|ft)\.?\s+.+$/gi, "")
    .replace(/\s*-\s*bonus track/gi, "")
    .replace(/\s*-\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?/gi, "")
    .replace(/\s*\((?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\)/gi, "")
    .replace(/\s*-\s*live(?:\s+at\s+.+)?/gi, "");

  clean = clean.replace(/\s+&(?=\s|$)/g, " ").replace(/\s+/g, " ");
  return clean.trim();
}

/**
 * Gestalt pattern matching (equivalent to Python difflib.SequenceMatcher(a, b).ratio()).
 * Returns similarity in [0, 1].
 */
export function sequenceMatcherRatio(a: string, b: string): number {
  const s1 = (a || "").toLowerCase().trim();
  const s2 = (b || "").toLowerCase().trim();
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  function findLongestMatch(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): [number, number, number] {
    let bestI = alo;
    let bestJ = blo;
    let bestSize = 0;

    for (let i = alo; i < ahi; i++) {
      for (let j = blo; j < bhi; j++) {
        let k = 0;
        while (i + k < ahi && j + k < bhi && s1[i + k] === s2[j + k]) {
          k++;
        }
        if (k > bestSize) {
          bestI = i;
          bestJ = j;
          bestSize = k;
        }
      }
    }
    return [bestI, bestJ, bestSize];
  }

  function getMatchingBlocks(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): number {
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k === 0) return 0;
    let total = k;
    if (alo < i && blo < j) {
      total += getMatchingBlocks(alo, i, blo, j);
    }
    if (i + k < ahi && j + k < bhi) {
      total += getMatchingBlocks(i + k, ahi, j + k, bhi);
    }
    return total;
  }

  const matchingChars = getMatchingBlocks(0, s1.length, 0, s2.length);
  return (2 * matchingChars) / (s1.length + s2.length);
}

/**
 * Finds the best match for a Spotify track in a list of candidate YouTube Music tracks,
 * directly porting sigma67/spotify_to_ytmusic/utils/match.py get_best_fit_song_id.
 */
export function getBestFitSong(
  candidates: Track[],
  spoti: SpotifyTrackInput,
): Track | null {
  if (candidates.length === 0) return null;

  let bestTrack: Track | null = null;
  let highestScore = -Infinity;

  for (const ytm of candidates) {
    if (!ytm.id || !ytm.title) continue;

    const isSong = !ytm.isVideo;

    // 1. Duration match score: 1 - abs(duration - spoti.duration) * 2 / spoti.duration
    let durationMatchScore: number | null = null;
    const ytmSec = ytm.durationSec;
    const spotiSec = spoti.durationSec;
    if (ytmSec && spotiSec && spotiSec > 0) {
      durationMatchScore = 1 - (Math.abs(ytmSec - spotiSec) * 2) / spotiSec;
    }

    // 2. Title matching (for videos, if title has '-' split by '-' and use the right side)
    let ytmTitle = ytm.title;
    if (ytm.isVideo) {
      const titleSplit = ytmTitle.split("-");
      if (titleSplit.length === 2) {
        ytmTitle = titleSplit[1].trim();
      }
    }

    const titleSim = sequenceMatcherRatio(ytmTitle, spoti.title);

    // 3. Artist matching
    const ytmArtists = ytm.artists?.map((a) => a.name).join(" ") || ytm.artist || "";
    const artistSim = sequenceMatcherRatio(ytmArtists, spoti.artist);

    const scores = [titleSim, artistSim];

    // Duration match score weighted by 5
    if (durationMatchScore !== null) {
      scores.push(durationMatchScore * 5);
    }

    // Album matching for songs only
    if (isSong && ytm.album && spoti.album) {
      scores.push(sequenceMatcherRatio(ytm.album, spoti.album));
    }

    // Average score boosted 2x for official songs vs user uploaded videos
    const avgScore = scores.reduce((sum, val) => sum + val, 0) / scores.length;
    const finalScore = avgScore * (isSong ? 2 : 1);

    if (finalScore > highestScore) {
      highestScore = finalScore;
      bestTrack = ytm;
    }
  }

  return bestTrack;
}

/**
 * Searches and matches a list of Spotify tracks to official YouTube Music tracks.
 * Employs caching, concurrent lookups, and progress reporting.
 */
export async function matchSpotifyTracksToYouTube(
  tracks: SpotifyTrackInput[],
  libraryController: LibraryController,
  onProgress?: MatchProgressCallback,
): Promise<{ matchedTracks: Track[]; failedTracks: SpotifyTrackInput[] }> {
  loadLookupCache();

  const matchedTracks: Track[] = [];
  const failedTracks: SpotifyTrackInput[] = [];
  const total = tracks.length;
  let processed = 0;

  // Process tracks with concurrency limit = 3 to prevent rate limits while remaining fast
  const CONCURRENCY = 3;
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tracks.length) {
      const currentIndex = index++;
      const spoti = tracks[currentIndex];
      const cleanTitle = cleanSpotifyTrackTitle(spoti.title);
      const queryArtist = spoti.artist.replace(/\s+&(?=\s|$)/g, " ").trim();
      const query = `${queryArtist} ${cleanTitle}`.trim();
      const cacheKey = `${queryArtist.toLowerCase()}:::${cleanTitle.toLowerCase()}`;

      let matched: Track | null = null;

      // 1. Check lookup cache
      if (lookupMemoryCache.has(cacheKey)) {
        matched = lookupMemoryCache.get(cacheKey)!;
      } else {
        try {
          // 2. Search YouTube Music for song candidates
          let candidates = await libraryController.searchTracks(query);
          if (candidates.length === 0) {
            // Fallback: search just the cleaned title if artist + title was too restrictive
            candidates = await libraryController.searchTracks(cleanTitle);
          }

          if (candidates.length > 0) {
            matched = getBestFitSong(candidates, spoti);
            if (matched) {
              saveLookupCacheEntry(cacheKey, matched);
            }
          }
        } catch (error) {
          logInternalWarn("matchSpotifyTracksToYouTube search failed for track", {
            track: spoti.title,
            artist: spoti.artist,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      processed++;
      if (matched) {
        matchedTracks.push(matched);
      } else {
        failedTracks.push(spoti);
      }

      onProgress?.(processed, total, matchedTracks.length, spoti.title);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, () => worker());
  await Promise.all(workers);

  logInternalInfo("matchSpotifyTracksToYouTube completed", {
    total,
    matchedCount: matchedTracks.length,
    failedCount: failedTracks.length,
  });

  return { matchedTracks, failedTracks };
}
