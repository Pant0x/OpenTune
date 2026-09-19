import type { Album, Playlist, Track } from "../../datasource/types";
import type { SpotifyRelease } from "../../services/SpotifyService";

/**
 * Normalizes release titles for accurate matching between YouTube Music and Spotify.
 * Strips diacritics (e.g. ë -> e, AftërLyfe -> Afterlyfe), punctuation, and extra whitespace.
 */
export function normalizeReleaseTitle(str?: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MergeArtistReleasesParams {
  ytReleases: Album[];
  spotifyReleases: SpotifyRelease[];
  channelPlaylists?: Playlist[];
  allSongs?: Track[];
  popularSongs?: Track[];
  artistName?: string;
}

/**
 * Merges YouTube Music releases with Spotify discography, prioritizing YouTube Music
 * for authentic live covers & native album IDs, while enriching with Spotify for
 * accurate release dates, missing singles, and newest drops.
 */
export function mergeArtistReleases({
  ytReleases,
  spotifyReleases,
  channelPlaylists = [],
  allSongs = [],
  popularSongs = [],
  artistName = "",
}: MergeArtistReleasesParams): Album[] {
  const combined: Album[] = [];
  const seenKeys = new Set<string>();
  const matchedSpotifyIds = new Set<string>();

  // 1. Index Spotify releases by normalized title for instant metadata matching
  const spotifyMap = new Map<string, SpotifyRelease>();
  for (const sr of spotifyReleases) {
    const norm = normalizeReleaseTitle(sr.name);
    if (norm && !spotifyMap.has(norm)) {
      spotifyMap.set(norm, sr);
    }
  }

  // 2. Add YouTube Music releases first (authentic live cover arts & native album IDs)
  for (const yr of ytReleases) {
    const norm = normalizeReleaseTitle(yr.title);
    if (!norm || seenKeys.has(norm)) continue;
    seenKeys.add(norm);

    const matchedSpotify = spotifyMap.get(norm);
    if (matchedSpotify) {
      matchedSpotifyIds.add(matchedSpotify.id);
    }

    combined.push({
      ...yr,
      id: yr.id, // Keep the native YouTube Music album ID so clicking it opens instantly
      title: yr.title,
      artist: yr.artist || artistName,
      // YouTube Music live artwork takes top priority. Fallback to Spotify only if YouTube artwork is missing:
      artworkUrl: yr.artworkUrl || matchedSpotify?.coverUrl,
      year: yr.year || (matchedSpotify?.year ? String(matchedSpotify.year) : undefined),
      releaseDate: matchedSpotify?.date || yr.releaseDate,
      releaseType: yr.releaseType || matchedSpotify?.type || "album",
    });
  }

  // 3. Add Spotify-only releases (newest drops or exclusives not yet on YouTube Music's artist shelf)
  for (const sr of spotifyReleases) {
    const norm = normalizeReleaseTitle(sr.name);
    if (matchedSpotifyIds.has(sr.id) || (norm && seenKeys.has(norm))) continue;
    if (norm) seenKeys.add(norm);

    combined.push({
      id: `spotify:${sr.id}`,
      title: sr.name,
      artist: artistName,
      artworkUrl: sr.coverUrl,
      year: sr.year ? String(sr.year) : undefined,
      releaseDate: sr.date,
      releaseType: sr.type,
    });
  }

  // 4. For YouTube creators, beatmakers, and remixers: include their channel playlists
  for (const p of channelPlaylists) {
    if (!p || !p.title) continue;
    const clean = p.title.toLowerCase().trim();
    const norm = normalizeReleaseTitle(p.title);
    const ownerLower = (p.owner || "").toLowerCase().trim();
    // Exclude official YouTube Music compilations
    const isOfficial =
      ownerLower.includes("youtube") ||
      ownerLower.includes("yt") ||
      clean.startsWith("featuring") ||
      clean.startsWith("presenting") ||
      clean.startsWith("this is") ||
      clean.includes("hits") ||
      clean.includes("best of") ||
      clean.includes("essential");
    if (isOfficial) continue;

    if (!seenKeys.has(norm)) {
      seenKeys.add(norm);
      combined.push({
        id: p.id,
        title: p.title,
        artist: artistName || p.owner || "",
        artworkUrl: p.artworkUrl,
        releaseType: "album",
      });
    }
  }

  // 5. If an artist has few or no album releases (e.g. YT users dropping singles/freetype beats),
  // include their video/song uploads as singles so their discography is fully populated
  if (combined.length < 5 && (allSongs.length > 0 || popularSongs.length > 0)) {
    const songs = allSongs.length > 0 ? allSongs : popularSongs;
    for (const s of songs) {
      if (!s || !s.title) continue;
      const norm = normalizeReleaseTitle(s.title);
      if (!seenKeys.has(norm)) {
        seenKeys.add(norm);
        combined.push({
          id: s.albumId || s.id,
          title: s.title,
          artist: s.artist || artistName,
          artworkUrl: s.artworkUrl,
          releaseType: "single",
        });
      }
    }
  }

  // Sort by latest release date descending so newest drops appear first
  combined.sort((a, b) => {
    const da = a.releaseDate || (a.year ? `${a.year}-01-01` : "");
    const db = b.releaseDate || (b.year ? `${b.year}-01-01` : "");
    if (da && db && da !== db) {
      return db.localeCompare(da);
    }
    const yearA = parseInt(a.year || "0", 10);
    const yearB = parseInt(b.year || "0", 10);
    if (yearA !== yearB) return yearB - yearA;
    return a.title.localeCompare(b.title);
  });

  return combined;
}
