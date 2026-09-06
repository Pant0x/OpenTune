/**
 * Self-check for `removeAccountOutcome`, the one piece of the multi-account switch/remove flow
 * that lives on the TypeScript side rather than in Rust's `YoutubeAccountStore` (see its own
 * tests in src-tauri/src/lib.rs). It decides what `LibraryController.removeGoogleAccount` shows
 * the user: nothing, a fallback account's library, or signed-out.
 */
export {};

import { removeAccountOutcome, cleanSongTitle, cleanArtistName } from "./YouTubeMusicDataSource";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

// Removing an account that was not active must not disturb the current session at all.
check(
  removeAccountOutcome("cookie-a", "cookie-a") === "unchanged",
  "same cookie before and after means the removed account was not the active one",
);

// Removing the active account with another stored one falls back to it.
check(
  removeAccountOutcome("cookie-a", "cookie-b") === "switched",
  "a different, non-null cookie afterward means another stored account took over",
);

// Removing the last account leaves nothing active.
check(
  removeAccountOutcome("cookie-a", null) === "signed-out",
  "no cookie afterward means that was the last stored account",
);

// Removing the only account while never having been signed in is still a no-op, not a crash.
check(
  removeAccountOutcome(null, null) === "unchanged",
  "null before and after must not be read as switching to 'no one'",
);

// Clean song title stripping music video tags and clip markers
check(
  cleanSongTitle("Not Like Us (Official Music Video)") === "Not Like Us",
  "strips (Official Music Video)",
);
check(
  cleanSongTitle("Hello [Official Video]") === "Hello",
  "strips [Official Video]",
);
check(
  cleanSongTitle("Shape of You (Official Lyric Video)") === "Shape of You",
  "strips (Official Lyric Video)",
);
check(
  cleanSongTitle("Kendrick Lamar - Not Like Us (Video Clip)") === "Not Like Us",
  "strips artist prefix and video clip marker",
);
check(
  cleanSongTitle("In The End (Official HD Video)") === "In The End",
  "strips (Official HD Video)",
);

// Clean artist name stripping topic and vevo tags
check(
  cleanArtistName("Kendrick Lamar - Topic") === "Kendrick Lamar",
  "strips - Topic from artist name",
);
check(
  cleanArtistName("TaylorSwiftVEVO") === "TaylorSwift",
  "strips VEVO from artist name",
);
check(
  cleanArtistName("Eminem feat. Rihanna") === "Eminem",
  "strips feat from artist name",
);

console.log("YouTubeMusicDataSource.removeAccountOutcome: ok");
