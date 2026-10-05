import {
  cleanSpotifyTrackTitle,
  sequenceMatcherRatio,
  getBestFitSong,
} from "./SpotifyToYouTubeMatcher";
import type { Track } from "../datasource/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

// 1. Title Cleaning
assertEqual(
  cleanSpotifyTrackTitle("First Person Shooter (feat. J. Cole)"),
  "First Person Shooter",
  "Removes (feat. ...) from title",
);
assertEqual(
  cleanSpotifyTrackTitle("In The End - 2020 Remaster"),
  "In The End",
  "Removes remaster suffix",
);
assertEqual(
  cleanSpotifyTrackTitle("Song Name - Live at Wembley"),
  "Song Name",
  "Removes live suffix",
);
assertEqual(
  cleanSpotifyTrackTitle("Rock & Roll"),
  "Rock Roll",
  "Removes standalone ampersand",
);

// 2. SequenceMatcher Ratio
assertEqual(sequenceMatcherRatio("hello", "hello"), 1, "exact match ratio");
assertEqual(sequenceMatcherRatio("", "hello"), 0, "empty string ratio");
const simRatio = sequenceMatcherRatio("Blinding Lights", "blinding lights");
assertEqual(simRatio, 1, "case insensitive match ratio");
const partialRatio = sequenceMatcherRatio("Starboy", "Starboy (Official Video)");
assert(partialRatio > 0.4 && partialRatio < 1, "partial ratio in range");

// 3. Best Fit Song Selection (sigma67 behavior)
const spotifyTrack = {
  title: "Blinding Lights",
  artist: "The Weeknd",
  album: "After Hours",
  durationSec: 200,
};

const candidates: Track[] = [
  // 1. Long music video (duration penalty)
  {
    id: "yt_video_long",
    title: "The Weeknd - Blinding Lights (Official Music Video)",
    artist: "The Weeknd",
    durationSec: 270, // 70s longer!
    source: "youtube",
    isVideo: true,
  },
  // 2. Off-target cover/remix
  {
    id: "yt_cover",
    title: "Blinding Lights (Acoustic Cover)",
    artist: "Random Singer",
    durationSec: 200,
    source: "youtube",
    isVideo: false,
  },
  // 3. Official studio song (perfect duration, matching album)
  {
    id: "yt_official_song",
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    durationSec: 200,
    source: "youtube",
    isVideo: false,
  },
];

const best = getBestFitSong(candidates, spotifyTrack);
assert(best !== null, "Found match");
assertEqual(best?.id, "yt_official_song", "Selected official studio song over long video and cover");

// 4. Video fallback when no official song exists
const videoOnlyCandidates: Track[] = [
  {
    id: "yt_video_best",
    title: "Metro Boomin - Superhero (Official Video)",
    artist: "Metro Boomin",
    durationSec: 182,
    source: "youtube",
    isVideo: true,
  },
  {
    id: "yt_video_other",
    title: "Something Else Entirely",
    artist: "Unknown",
    durationSec: 180,
    source: "youtube",
    isVideo: true,
  },
];

const videoMatch = getBestFitSong(videoOnlyCandidates, {
  title: "Superhero",
  artist: "Metro Boomin",
  durationSec: 182,
});
assert(videoMatch !== null, "Found video fallback match");
assertEqual(videoMatch?.id, "yt_video_best", "Correctly matches video by artist and title after splitting hyphen");

console.log("SpotifyToYouTubeMatcher.check: ok");
