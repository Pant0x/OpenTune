import { mergeArtistReleases, normalizeReleaseTitle } from "./mergedReleases";
import type { Album } from "../../datasource/types";
import type { SpotifyRelease } from "../../services/SpotifyService";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// 1. Test normalizeReleaseTitle
assert(normalizeReleaseTitle("AftërLyfe") === "afterlyfe", "normalize diacritics ë -> e");
assert(normalizeReleaseTitle("2 Alivë (Geëk Pack)") === "2 alive geek pack", "normalize complex title");
assert(normalizeReleaseTitle("LYFESTYLE") === "lyfestyle", "normalize lowercase");
assert(normalizeReleaseTitle("  2093 (P3)  ") === "2093 p3", "normalize trim and parentheses");
assert(normalizeReleaseTitle("Up 2 Më") === "up 2 me", "normalize umlauts");

// 2. Test live YouTube Music artwork priority over stale Spotify cover
const ytReleases: Album[] = [
  {
    id: "MPREb_2093_yt",
    title: "2093",
    artist: "Yeat",
    artworkUrl: "https://lh3.googleusercontent.com/new_thermal_negative_2093.jpg",
    year: "2024",
    releaseType: "album",
  },
  {
    id: "MPREb_lyfestyle_yt",
    title: "LYFESTYLE",
    artist: "Yeat",
    artworkUrl: "https://lh3.googleusercontent.com/new_thermal_negative_lyfestyle.jpg",
    year: "2024",
    releaseType: "album",
  },
  {
    id: "MPREb_afterlyfe_yt",
    title: "AftërLyfe",
    artist: "Yeat",
    artworkUrl: "https://lh3.googleusercontent.com/new_thermal_negative_afterlyfe.jpg",
    year: "2023",
    releaseType: "album",
  },
];

const spotifyReleases: SpotifyRelease[] = [
  {
    id: "sp_lyfestyle",
    name: "LYFESTYLE",
    type: "album",
    year: 2024,
    date: "2024-10-18",
    coverUrl: "https://i.scdn.co/old_orange_cover.jpg",
    trackCount: 22,
    uri: "spotify:album:sp_lyfestyle",
  },
  {
    id: "sp_2093",
    name: "2093",
    type: "album",
    year: 2024,
    date: "2024-02-16",
    coverUrl: "https://i.scdn.co/old_green_cover.jpg",
    trackCount: 24,
    uri: "spotify:album:sp_2093",
  },
  {
    id: "sp_afterlyfe",
    name: "Afterlyfe", // slightly different spelling without ë
    type: "album",
    year: 2023,
    date: "2023-02-24",
    coverUrl: "https://i.scdn.co/old_bw_cover.jpg",
    trackCount: 22,
    uri: "spotify:album:sp_afterlyfe",
  },
  {
    id: "sp_exclusive",
    name: "Different Creature",
    type: "ep",
    year: 2019,
    date: "2019-07-15",
    coverUrl: "https://i.scdn.co/different_creature.jpg",
    trackCount: 3,
    uri: "spotify:album:sp_exclusive",
  },
];

const merged = mergeArtistReleases({
  ytReleases,
  spotifyReleases,
  artistName: "Yeat",
});

// Should have 4 releases (3 from YouTube enriched + 1 Spotify exclusive)
assert(merged.length === 4, `Expected 4 merged releases, got ${merged.length}`);

// 2093 check
const album2093 = merged.find((r) => r.title === "2093");
assert(Boolean(album2093), "2093 exists in merged releases");
assert(album2093?.id === "MPREb_2093_yt", "2093 retains native YouTube Music album ID");
assert(
  album2093?.artworkUrl === "https://lh3.googleusercontent.com/new_thermal_negative_2093.jpg",
  "2093 uses live YouTube Music thermal negative artwork, NOT stale Spotify cover"
);
assert(album2093?.releaseDate === "2024-02-16", "2093 enriched with Spotify release date");

// LYFESTYLE check
const lyfestyle = merged.find((r) => r.title === "LYFESTYLE");
assert(Boolean(lyfestyle), "LYFESTYLE exists in merged releases");
assert(lyfestyle?.id === "MPREb_lyfestyle_yt", "LYFESTYLE retains native YouTube Music album ID");
assert(
  lyfestyle?.artworkUrl === "https://lh3.googleusercontent.com/new_thermal_negative_lyfestyle.jpg",
  "LYFESTYLE uses live YouTube Music thermal negative artwork, NOT stale Spotify cover"
);
assert(lyfestyle?.releaseDate === "2024-10-18", "LYFESTYLE enriched with Spotify release date");

// AftërLyfe check (diacritic match)
const afterlyfe = merged.find((r) => r.title === "AftërLyfe");
assert(Boolean(afterlyfe), "AftërLyfe matched with Spotify's Afterlyfe");
assert(
  afterlyfe?.artworkUrl === "https://lh3.googleusercontent.com/new_thermal_negative_afterlyfe.jpg",
  "AftërLyfe uses live YouTube Music thermal negative artwork"
);
assert(afterlyfe?.releaseDate === "2023-02-24", "AftërLyfe enriched with Spotify release date");

// Spotify-only release check
const exclusive = merged.find((r) => r.id === "spotify:sp_exclusive");
assert(Boolean(exclusive), "Spotify-only release is preserved");
assert(exclusive?.artworkUrl === "https://i.scdn.co/different_creature.jpg", "Spotify-only release has its cover");

// Chronological sorting check (newest first: LYFESTYLE (Oct 2024) -> 2093 (Feb 2024) -> AftërLyfe (2023) -> Different Creature (2019))
assert(merged[0]?.title === "LYFESTYLE", "LYFESTYLE (2024-10-18) is first");
assert(merged[1]?.title === "2093", "2093 (2024-02-16) is second");
assert(merged[2]?.title === "AftërLyfe", "AftërLyfe (2023-02-24) is third");
assert(merged[3]?.title === "Different Creature", "Different Creature (2019) is last");

console.log("All mergedReleases checks passed!");
