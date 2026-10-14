/**
 * Lyrics profanity unmasking, artist & title matching, and adlib/header cleaning utilities.
 *
 * Provides decensoring for lyrics sources that embed asterisks/censored profanity,
 * validates candidate songs so unrelated search results (e.g. same title, different artist)
 * are rejected, cleans out non-vocal bracketed section headers (e.g. [Intro: ...], [Chorus]),
 * and removes brackets from adlibs for rumble letter animation.
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

const MASK = `[*#@%$!]`;

// Helper for lookaround word boundaries that handle symbols/punctuation safely
const LB = `(?<![\\p{L}\\p{N}_])`;
const RB = `(?![\\p{L}\\p{N}_])`;

const UNMASK_RULES: Array<[RegExp, (match: string, ...args: string[]) => string]> = [
  // 1. Motherfucker / mothafucka / motherfucking variations
  [new RegExp(`${LB}m(?:other|otha|othaf|otherf|f)${MASK}{1,8}(?:er|ers|a|as|in['’]|ing)?${RB}`, "giu"), (m) => {
    if (/in['’]$/i.test(m)) return preserveCase(m, "motherfuckin'");
    if (/ing$/i.test(m)) return preserveCase(m, "motherfucking");
    if (/as?$/i.test(m) || /motha/i.test(m)) return preserveCase(m, /s$/i.test(m) ? "mothafuckas" : "mothafucka");
    return preserveCase(m, /s$/i.test(m) ? "motherfuckers" : "motherfucker");
  }],

  // 2. Fucking / fuckin' / fucked / fucker / fuckers
  [new RegExp(`${LB}(?:f${MASK}{1,4}|${MASK}{4})(?:ck)?in['’]${RB}`, "giu"), (m) => preserveCase(m, "fuckin'")],
  [new RegExp(`${LB}(?:f${MASK}{1,4}|${MASK}{4})(?:ck)?ing${RB}`, "giu"), (m) => preserveCase(m, "fucking")],
  [new RegExp(`${LB}(?:f${MASK}{1,4}|${MASK}{4})(?:ck)?ed${RB}`, "giu"), (m) => preserveCase(m, "fucked")],
  [new RegExp(`${LB}(?:f${MASK}{1,4}|${MASK}{4})(?:ck)?ers${RB}`, "giu"), (m) => preserveCase(m, "fuckers")],
  [new RegExp(`${LB}(?:f${MASK}{1,4}|${MASK}{4})(?:ck)?er${RB}`, "giu"), (m) => preserveCase(m, "fucker")],

  // 3. Bullshit / shitty / shit
  [new RegExp(`${LB}bull(?:s${MASK}{1,4}|${MASK}{4})(?:h)?(?:i)?(?:t)?${RB}`, "giu"), (m) => preserveCase(m, "bullshit")],
  [new RegExp(`${LB}(?:sh?|s)${MASK}{1,4}(?:t)?ty${RB}`, "giu"), (m) => preserveCase(m, "shitty")],
  [new RegExp(`${LB}(?:sh${MASK}{1,3}t?|s${MASK}{1,3}t|s${MASK}{2,4})${RB}`, "giu"), (m) => preserveCase(m, "shit")],

  // 4. Bitches / bitch
  [new RegExp(`${LB}b${MASK}{1,5}(?:tch|ch|h)?es${RB}`, "giu"), (m) => preserveCase(m, "bitches")],
  [new RegExp(`${LB}b${MASK}{1,5}s${RB}`, "giu"), (m) => preserveCase(m, "bitches")],
  [new RegExp(`${LB}b${MASK}{1,5}(?:tch|ch|h)?${RB}`, "giu"), (m) => preserveCase(m, "bitch")],

  // 5. Niggas / nigga / niggers / nigger
  [new RegExp(`${LB}n${MASK}{1,4}(?:gers|ers)${RB}`, "giu"), (m) => preserveCase(m, "niggers")],
  [new RegExp(`${LB}n${MASK}{1,4}(?:ger|er)${RB}`, "giu"), (m) => preserveCase(m, "nigger")],
  [new RegExp(`${LB}n${MASK}{1,4}(?:gas|as|s)${RB}`, "giu"), (m) => preserveCase(m, "niggas")],
  [new RegExp(`${LB}n${MASK}{1,4}(?:ga|a)?${RB}`, "giu"), (m) => preserveCase(m, "nigga")],

  // 6. Asshole / assholes / ass
  [new RegExp(`${LB}(?:a${MASK}{1,5}|${MASK}{3,4})holes${RB}`, "giu"), (m) => preserveCase(m, "assholes")],
  [new RegExp(`${LB}(?:a${MASK}{1,5}|${MASK}{3,4})hole${RB}`, "giu"), (m) => preserveCase(m, "asshole")],
  [new RegExp(`${LB}a${MASK}{1,2}${RB}`, "giu"), (m) => preserveCase(m, "ass")],

  // 7. Pussy / pussies
  [new RegExp(`${LB}p${MASK}{1,5}(?:ss)?ies${RB}`, "giu"), (m) => preserveCase(m, "pussies")],
  [new RegExp(`${LB}p${MASK}{1,5}(?:ss)?y${RB}`, "giu"), (m) => preserveCase(m, "pussy")],
  [new RegExp(`${LB}p${MASK}{3,4}${RB}`, "giu"), (m) => preserveCase(m, "pussy")],

  // 8. Dick / dicks
  [new RegExp(`${LB}d${MASK}{1,4}(?:ck|k)?s${RB}`, "giu"), (m) => preserveCase(m, "dicks")],
  [new RegExp(`${LB}d${MASK}{1,4}(?:ck|k)?${RB}`, "giu"), (m) => preserveCase(m, "dick")],

  // 9. Cunt / cunts
  [new RegExp(`${LB}c${MASK}{1,3}(?:nt|t)?s${RB}`, "giu"), (m) => preserveCase(m, "cunts")],
  [new RegExp(`${LB}c${MASK}{1,3}(?:nt|t)?${RB}`, "giu"), (m) => preserveCase(m, "cunt")],

  // 10. Fuck (f***, f**k, f*ck, f---, f...)
  [new RegExp(`${LB}f(?:${MASK}{1,4}|-{2,}|\\.{2,})(?:ck|k)?${RB}`, "giu"), (m) => preserveCase(m, "fuck")],

  // 11. Damn / goddamn
  [new RegExp(`${LB}god[\\s-]?d${MASK}{1,4}n?${RB}`, "giu"), (m) => preserveCase(m, "goddamn")],
  [new RegExp(`${LB}d${MASK}{1,3}n${RB}`, "giu"), (m) => preserveCase(m, "damn")],

  // 12. Whore / slut
  [new RegExp(`${LB}(?:wh${MASK}{1,3}e|w${MASK}{2,4}e?)s?${RB}`, "giu"), (m) => preserveCase(m, /s$/i.test(m) ? "whores" : "whore")],
  [new RegExp(`${LB}sl${MASK}{1,2}ts?${RB}`, "giu"), (m) => preserveCase(m, /s$/i.test(m) ? "sluts" : "slut")],

  // 13. Common idiomatic multi-word censorship with **** / ***
  [new RegExp(`\\b(holy|piece of|full of|talk that|talk your|no|some real|on some)\\s+${MASK}{3,4}${RB}`, "giu"), (_m, p1) => `${p1} shit`],
  [new RegExp(`\\b(give a|gives a|gave a|what the|who the|where the|why the|how the|shut the|get the|as)\\s+${MASK}{4}${RB}`, "giu"), (_m, p1) => `${p1} fuck`],

  // 14. Fallback standalone masks
  [new RegExp(`${LB}${MASK}{5}${RB}`, "gu"), () => "bitch"],
  [new RegExp(`${LB}${MASK}{4}${RB}`, "gu"), () => "fuck"],
  [new RegExp(`${LB}${MASK}{3}${RB}`, "gu"), () => "shit"],
];

/**
 * Replaces asterisk-masked and censored profanities with genuine explicit terms.
 */
export function unmaskProfanity(text: string): string {
  if (
    !text ||
    (!text.includes("*") &&
      !text.includes("#") &&
      !text.includes("@") &&
      !text.includes("%") &&
      !text.includes("$") &&
      !text.includes("!") &&
      !text.includes("-") &&
      !text.includes("."))
  ) {
    return text;
  }

  let result = text;
  for (const [pattern, replacer] of UNMASK_RULES) {
    result = result.replace(pattern, replacer);
  }

  return result;
}

const CENSOR_DETECTION_REGEX = new RegExp(
  `(?:` +
    `(?<![\\p{L}\\p{N}_])${MASK}{2,}(?![\\p{L}\\p{N}_])` + // standalone ** / *** / **** / #####
    `|(?<![\\p{L}\\p{N}_])[\\p{L}\\p{N}]{1,3}${MASK}{1,}` + // f***, sh**, b*
    `|${MASK}{1,}[\\p{L}\\p{N}]{1,3}(?![\\p{L}\\p{N}_])` + // ***ing, *tch
    `|[\\p{L}\\p{N}]${MASK}+[\\p{L}\\p{N}]` + // f*ck, b*tch, a**hole
    `|(?<![\\p{L}\\p{N}_])f-{2,}(?![\\p{L}\\p{N}_])` + // f---
    `|(?<![\\p{L}\\p{N}_])f\\.{2,}(?![\\p{L}\\p{N}_])` + // f...
  `)`,
  "u",
);

/**
 * Checks whether text contains typical profanity censorship (masked characters).
 */
export function hasProfanityCensorship(text: string): boolean {
  if (!text) return false;
  return CENSOR_DETECTION_REGEX.test(text);
}

/**
 * Normalizes title for loose comparison by removing parenthetical metadata
 * and non-alphanumeric punctuation.
 */
export function normalizeLyricsTitle(title: string): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(
      /\s*[\[(](?:official|music|video|visualizer|audio|lyrics?|lyric|remaster|radio edit|single|album|live|feat|ft|with|prod|version)[^\])]*[\])]\s*/gi,
      " ",
    )
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

export function normalizeArtistForComparison(artist: string): string {
  if (!artist) return "";
  return artist
    .toLowerCase()
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verifies that the candidate lyric song belongs to one of the expected track artists.
 * Prevents songs with the same title by completely different artists from polluting playback.
 */
export function isLyricsArtistMatch(expectedArtists: string[], candidateArtist?: string): boolean {
  if (!candidateArtist?.trim()) return true;
  const candNorm = normalizeArtistForComparison(candidateArtist);
  if (!candNorm) return true;

  const candParts = candidateArtist
    .split(/,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+and\s+|•|\/|;/i)
    .map(normalizeArtistForComparison)
    .filter(Boolean);

  for (const exp of expectedArtists) {
    if (!exp) continue;
    const expNorm = normalizeArtistForComparison(exp);
    if (!expNorm) continue;

    if (candNorm === expNorm || candNorm.includes(expNorm) || expNorm.includes(candNorm)) {
      return true;
    }

    for (const cp of candParts) {
      if (cp === expNorm || cp.includes(expNorm) || expNorm.includes(cp)) {
        return true;
      }
    }
  }

  return false;
}

const SECTION_HEADER_REGEX =
  /^\s*\[(?:intro|verse|chorus|bridge|hook|outro|refrain|drop|instrumental|pre-chorus|post-chorus|solo|part|interlude|break|build|skit|spoken)[^\]]*\]\s*$/i;

const SECTION_HEADER_PREFIX_REGEX =
  /^\s*\[(?:intro|verse|chorus|bridge|hook|outro|refrain|drop|instrumental|pre-chorus|post-chorus|solo|part|interlude|break|build|skit|spoken)[^\]]*\]\s*/i;

/**
 * Returns true if a lyric line is purely an structural section tag (e.g. [Intro: AI Playboi Carti], [Chorus], [Verse 1]).
 */
export function isSectionHeaderLine(text: string): boolean {
  if (!text) return false;
  return SECTION_HEADER_REGEX.test(text);
}

/**
 * Strips bracketed section header prefix if present (e.g. "[Intro] Yeah yeah" -> "Yeah yeah").
 */
export function stripSectionHeaderPrefix(text: string): string {
  if (!text) return "";
  return text.replace(SECTION_HEADER_PREFIX_REGEX, "").trim();
}

/**
 * Strips outer brackets/parentheses from adlib text so no brackets are rendered.
 */
export function cleanAdlibBrackets(text: string): string {
  if (!text) return "";
  return text.replace(/^[(\[{<«"'\u201C\u2018]+|[)\]}>»"'\u201D\u2019]+$/gu, "");
}
