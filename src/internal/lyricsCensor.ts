/**
 * Lyrics profanity unmasking and title matching utilities.
 *
 * Provides decensoring for lyrics sources that embed asterisks/censored profanity
 * (e.g. from radio edits or clean uploads on LRCLIB / NetEase / transcripts),
 * and validates candidate songs so unrelated search results are never displayed.
 */

function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.toLowerCase() !== original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original.length > 0 && original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}

const PROFANITY_PATTERNS: Array<[RegExp, string]> = [
  // Motherfucker / mothafucka
  [/\bm(?:other)?f[\*#@]{2,4}(?:er|ers|a|as)?\b/gi, "motherfucker"],
  [/\bm[\*#@]{7,12}(?:er|ers|a|as)?\b/gi, "motherfucker"],
  [/\bmothaf[\*#@]{2,4}(?:a|as|er)?\b/gi, "mothafucka"],

  // Fucking / fuckin' / fucked / fucker / fuck
  [/\b(?:f[\*#@]{2,3}|[\*#@]{4})in['’]\b/gi, "fuckin'"],
  [/\b(?:f[\*#@]{2,3}|[\*#@]{4})ing\b/gi, "fucking"],
  [/\b(?:f[\*#@]{2,3}|[\*#@]{4})ed\b/gi, "fucked"],
  [/\b(?:f[\*#@]{2,3}|[\*#@]{4})ers?\b/gi, "fucker"],
  [/\bf[\*#@]{1,3}k\b/gi, "fuck"],
  [/\bf[\*#@]{2,4}\b/gi, "fuck"],

  // Bullshit / shit / shitty
  [/\bbull(?:s[\*#@]{2,3}|sh[\*#@]t)\b/gi, "bullshit"],
  [/\b(?:s[\*#@]{2,3}|sh[\*#@]t|s[\*#@]t)ty\b/gi, "shitty"],
  [/\b(?:s[\*#@]{2,3}|sh[\*#@]t|s[\*#@]t)\b/gi, "shit"],

  // Bitches / bitch
  [/\bb[\*#@]{1,3}(?:ch)?es\b/gi, "bitches"],
  [/\bb[\*#@]{1,3}h\b/gi, "bitch"],
  [/\bb[\*#@]{3,5}\b/gi, "bitch"],

  // Niggas / nigga / niggers / nigger
  [/\bn[\*#@]{1,3}g(?:a|as)\b/gi, "nigga"],
  [/\bn[\*#@]{2,4}(?:as|a)\b/gi, "nigga"],
  [/\bn[\*#@]{1,3}g(?:er|ers)\b/gi, "nigger"],
  [/\bn[\*#@]{2,4}(?:ers|er)\b/gi, "nigger"],

  // Asshole / ass
  [/\ba[\*#@]{1,2}hole\b/gi, "asshole"],
  [/\ba[\*#@]{5}e\b/gi, "asshole"],
  [/\ba[\*#@]{2}\b/gi, "ass"],

  // Pussy / pussies
  [/\bp[\*#@]{1,3}(?:ss)?(?:y|ies)\b/gi, "pussy"],
  [/\bp[\*#@]{3,4}\b/gi, "pussy"],

  // Dick
  [/\bd[\*#@]{1,2}k\b/gi, "dick"],
  [/\bd[\*#@]{2,3}\b/gi, "dick"],

  // Cunt
  [/\bc[\*#@]{1,2}t\b/gi, "cunt"],

  // Damn / goddamn
  [/\bgod[\s-]?d[\*#@]{2,3}\b/gi, "goddamn"],
  [/\bd[\*#@]{2,3}n\b/gi, "damn"],

  // Whore / slut
  [/\bw[\*#@]{2,3}e\b/gi, "whore"],
  [/\bsl[\*#@]t\b/gi, "slut"],
];

/**
 * Replaces asterisk-masked profanities with the genuine explicit terms.
 */
export function unmaskProfanity(text: string): string {
  if (!text || (!text.includes("*") && !text.includes("#") && !text.includes("@"))) {
    return text;
  }

  let result = text;

  for (const [pattern, replacement] of PROFANITY_PATTERNS) {
    result = result.replace(pattern, (match) => preserveCase(match, replacement));
  }

  // Handle standalone **** or *** (common in radio/clean edit lyrics)
  result = result.replace(/\b\*{4}\b/g, "fuck");
  result = result.replace(/\b\*{3}\b/g, "shit");

  return result;
}

/**
 * Checks whether text contains typical profanity censorship (masked characters).
 */
export function hasProfanityCensorship(text: string): boolean {
  if (!text) return false;
  return /\b[a-z0-9]?[\*#@]{2,}[a-z0-9]?\b/i.test(text) || /\b[a-z][\*#@][a-z]{1,2}\b/i.test(text);
}

/**
 * Normalizes title for loose comparison by removing parenthetical metadata
 * and non-alphanumeric punctuation.
 */
export function normalizeLyricsTitle(title: string): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/\s*[\[(](?:official|music|video|visualizer|audio|lyrics?|lyric|remaster|radio edit|single|album|live|feat|ft|with|prod|version)[^\])]*[\])]\s*/gi, " ")
    .replace(/\s+-\s+(?:official|music|video|visualizer|audio|lyrics?|lyric|remix).*$/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Determines whether a candidate lyric song matches the target song title.
 */
export function isLyricsTitleMatch(targetTitle: string, candidateTitle?: string): boolean {
  if (!candidateTitle) return false;
  const targetNorm = normalizeLyricsTitle(targetTitle);
  const candNorm = normalizeLyricsTitle(candidateTitle);
  if (!targetNorm || !candNorm) return false;

  if (targetNorm === candNorm) return true;
  if (targetNorm.includes(candNorm) || candNorm.includes(targetNorm)) return true;

  const targetWords = targetNorm.split(" ").filter((w) => w.length > 1);
  const candWords = candNorm.split(" ").filter((w) => w.length > 1);
  if (targetWords.length > 0 && candWords.length > 0) {
    const matchingWords = targetWords.filter((w) => candWords.includes(w));
    const ratio = matchingWords.length / Math.min(targetWords.length, candWords.length);
    if (ratio >= 0.5) return true;
  }

  return false;
}
