/**
 * Self-check for lyrics profanity decensoring, censorship detection, and title/artist matching.
 */
export {};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const {
  unmaskProfanity,
  hasProfanityCensorship,
  isLyricsTitleMatch,
  isLyricsArtistMatch,
  stripSectionHeaderPrefix,
  cleanAdlibBrackets,
} = await import("./lyricsCensor");

// 1. Unmasking tests
equal(
  unmaskProfanity("I don't give a **** 'cause that's all that matters"),
  "I don't give a fuck 'cause that's all that matters",
  "standalone 4-star mask unmasks to fuck",
);
equal(unmaskProfanity("What the f***"), "What the fuck", "f*** unmasks to fuck");
equal(unmaskProfanity("What the f**k"), "What the fuck", "f**k unmasks to fuck");
equal(unmaskProfanity("What the f*ck"), "What the fuck", "f*ck unmasks to fuck");
equal(unmaskProfanity("What the f---"), "What the fuck", "f--- unmasks to fuck");
equal(unmaskProfanity("What the f..."), "What the fuck", "f... unmasks to fuck");

equal(unmaskProfanity("She's a bad b***h"), "She's a bad bitch", "b***h unmasks to bitch");
equal(unmaskProfanity("She is a bad b*tch"), "She is a bad bitch", "b*tch unmasks to bitch");
equal(unmaskProfanity("All these b****es"), "All these bitches", "b****es unmasks to bitches");

equal(unmaskProfanity("These n****s don't know"), "These niggas don't know", "n****s unmasks to niggas");
equal(unmaskProfanity("These n***as don't know"), "These niggas don't know", "n***as unmasks to niggas");
equal(unmaskProfanity("He is my n***a"), "He is my nigga", "n***a unmasks to nigga");

equal(unmaskProfanity("Holy sh*t"), "Holy shit", "sh*t unmasks to shit");
equal(unmaskProfanity("Holy s***"), "Holy shit", "s*** unmasks to shit");
equal(unmaskProfanity("Holy ***"), "Holy shit", "Holy *** unmasks to Holy shit");
equal(unmaskProfanity("Holy ****"), "Holy shit", "Holy **** unmasks to Holy shit");
equal(unmaskProfanity("Piece of ****"), "Piece of shit", "Piece of **** unmasks to Piece of shit");

equal(unmaskProfanity("Get off your a**"), "Get off your ass", "a** unmasks to ass");
equal(unmaskProfanity("He is an a**hole"), "He is an asshole", "a**hole unmasks to asshole");

equal(unmaskProfanity("Suck my d*ck"), "Suck my dick", "d*ck unmasks to dick");
equal(unmaskProfanity("Suck my d***"), "Suck my dick", "d*** unmasks to dick");

equal(unmaskProfanity("You little c*nt"), "You little cunt", "c*nt unmasks to cunt");
equal(unmaskProfanity("This f***ing track"), "This fucking track", "f***ing unmasks to fucking");
equal(unmaskProfanity("This f***in' beat"), "This fuckin' beat", "f***in' unmasks to fuckin'");

equal(unmaskProfanity("He is a motherf***er"), "He is a motherfucker", "motherf***er unmasks to motherfucker");
equal(unmaskProfanity("What a mothaf***a"), "What a mothafucka", "mothaf***a unmasks to mothafucka");

equal(unmaskProfanity("WHAT THE F***"), "WHAT THE FUCK", "preserves uppercase");
equal(unmaskProfanity("F***ing crazy"), "Fucking crazy", "preserves capitalized case");

// 2. Censorship detection tests
check(hasProfanityCensorship("I don't give a **** 'cause"), "detects standalone 4-star");
check(hasProfanityCensorship("What the f***"), "detects f***");
check(hasProfanityCensorship("She is a bad b*tch"), "detects b*tch");
check(hasProfanityCensorship("He is an a**hole"), "detects a**hole");
check(hasProfanityCensorship("What the f---"), "detects dashed f---");

// Clean lyrics should not trigger false positives
check(!hasProfanityCensorship("Hello world this is clean"), "clean text is not censored");
check(!hasProfanityCensorship("Rock-and-roll music"), "hyphenated English words are not censored");
check(!hasProfanityCensorship("Track 1 - Intro"), "dashes in titles are not censored");
check(!hasProfanityCensorship("2 + 2 = 4"), "numbers and math are not censored");

// 3. Title and artist matching
check(isLyricsTitleMatch("MAKA", "MAKA"), "exact title matches");
check(isLyricsTitleMatch("MAKA (Official Video)", "MAKA"), "title with video metadata matches");
check(isLyricsArtistMatch(["Central Cee"], "Central Cee"), "artist matches");
check(isLyricsArtistMatch(["Central Cee", "A2ANTI"], "Central Cee feat. A2ANTI"), "multi-artist matches");

// 4. Header and adlib cleaning
equal(stripSectionHeaderPrefix("[Intro] Yeah"), "Yeah", "strips section prefix");
equal(cleanAdlibBrackets("(Yeah yeah)"), "Yeah yeah", "cleans adlib parentheses");

console.log("lyricsCensor self-check passed");
