import type { Artist } from "./types";

const ARABIC_WORD_ALIASES: Record<string, string> = {
  "عمرو": "amr",
  "محمد": "mohamed",
  "احمد": "ahmed",
  "عبد": "abd",
  "الله": "allah",
  "ام": "om",
};

const ARABIC_CHAR_MAP: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "e", "آ": "a", "ء": "", "ئ": "e", "ؤ": "o",
  "ب": "b", "ت": "t", "ة": "a", "ث": "th",
  "ج": "g", "ح": "h", "خ": "kh",
  "د": "d", "ذ": "z", "ر": "r", "ز": "z",
  "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
  "ع": "a", "غ": "gh", "ف": "f", "ق": "k", "ك": "k",
  "ل": "l", "م": "m", "ن": "n", "ه": "h",
  "و": "u", "ى": "a", "ي": "y",
  "ـ": "", "ً": "", "ٌ": "", "ٍ": "", "َ": "", "ُ": "", "ِ": "", "ّ": "", "ْ": "",
};

/**
 * Normalizes text to lowercase alphanumeric characters.
 */
export function normSimp(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF]/gi, "")
    .trim();
}

/**
 * Normalizes text phonetically with support for English & Arabic transliterations:
 * Handles variations like 'sherein' <-> 'sherine' <-> 'شيرين', 'fayrouz' <-> 'fairouz' <-> 'فيروز'.
 */
export function normTranslit(str: string): string {
  if (!str) return "";

  let s = str.toLowerCase();

  // 1. Substitute common Arabic words before character-by-character translation
  for (const [ar, en] of Object.entries(ARABIC_WORD_ALIASES)) {
    s = s.replace(new RegExp(ar, "g"), en);
  }

  // 2. Convert remaining Arabic characters to phonetic Latin
  s = s.replace(/[\u0600-\u06FF]/g, (char) => ARABIC_CHAR_MAP[char] ?? char);

  // 2. Strip diacritics / accents
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // 3. Strip trailing silent 'e' (e.g. 'sherine' -> 'sherin', 'drake' -> 'drak')
  s = s.replace(/e+$/, "");

  // 4. Multi-character vowel/consonant substitutions
  s = s
    .replace(/ph/g, "f")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/sh/g, "s")
    .replace(/ch/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/ou/g, "u")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/ei/g, "i")
    .replace(/ie/g, "i")
    .replace(/ey/g, "i")
    .replace(/ay/g, "i")
    .replace(/ai/g, "i")
    .replace(/y/g, "i")
    .replace(/w(?=[aeiou]|$)/g, "u")
    .replace(/z/g, "s")
    // Inter-consonant 'e' vs 'i' equivalence in Arabic/English transliteration
    .replace(/e/g, "i");

  // 5. Strip non-alphanumerics
  s = s.replace(/[^a-z0-9]/g, "");

  // 6. Collapse repeated characters (e.g. "tt" -> "t", "rr" -> "r", "ii" -> "i")
  s = s.replace(/(.)\1+/g, "$1");

  return s.trim();
}

/**
 * Extracts a canonical artwork key by stripping dynamic image size and format parameters.
 * Allows matching identical Google/YouTube/Spotify avatars across different dimensions.
 */
export function getArtworkKey(url?: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^(?:lh|yt)\d+\./i, "cdn.");
    const pathname = u.pathname
      .replace(/=[swh]\d+.*$/i, "")
      .replace(/=s\d+.*$/i, "");
    return `${hostname}${pathname}`;
  } catch {
    return url
      .replace(/^(?:https?:\/\/)?(?:lh|yt)\d+\./i, "cdn.")
      .replace(/=[swh]\d+.*$/i, "")
      .replace(/=s\d+.*$/i, "")
      .split("?")[0];
  }
}

/**
 * Parses subscriber or monthly listener counts from strings like '6.46M subscribers', '2.2M monthly listeners', '12K'.
 */
export function parseSubscriberCount(text?: string): number {
  if (!text) return 0;
  const clean = text.toLowerCase().replace(/subscribers?|monthly listeners?/g, "").trim();
  if (clean.endsWith("b")) return (parseFloat(clean) || 0) * 1e9;
  if (clean.endsWith("m")) return (parseFloat(clean) || 0) * 1e6;
  if (clean.endsWith("k")) return (parseFloat(clean) || 0) * 1e3;
  const num = parseFloat(clean.replace(/,/g, ""));
  return isNaN(num) ? 0 : num;
}

/**
 * Merges two artist records for the same artist, picking the official artist over creator channels,
 * the highest subscriber count, highest-resolution artwork, and canonical YouTube ID.
 */
export function mergeArtists(a: Artist, b: Artist): Artist {
  const subsA = parseSubscriberCount(a.subscriberCount);
  const subsB = parseSubscriberCount(b.subscriberCount);

  // Preference order: official artist > creator channel, then higher subscriber count
  const aIsOfficial = !a.isCreator;
  const bIsOfficial = !b.isCreator;

  let primary: Artist;
  let secondary: Artist;

  if (aIsOfficial && !bIsOfficial) {
    primary = a;
    secondary = b;
  } else if (!aIsOfficial && bIsOfficial) {
    primary = b;
    secondary = a;
  } else if (subsB > subsA) {
    primary = b;
    secondary = a;
  } else {
    primary = a;
    secondary = b;
  }

  // Preserve native YouTube channel ID (UC...) or browse ID if secondary has it and primary has a spotify: or temporary ID
  let id = primary.id;
  if (id.startsWith("spotify:") && (secondary.id.startsWith("UC") || secondary.id.startsWith("FEmusic"))) {
    id = secondary.id;
  }

  // Pick highest quality artwork (prefer Spotify or larger dimension image)
  const artworkUrl = primary.artworkUrl || secondary.artworkUrl;

  // Pick best subscriber count text
  const subscriberCount = (subsA >= subsB ? a.subscriberCount : b.subscriberCount)
    || primary.subscriberCount
    || secondary.subscriberCount;

  return {
    ...primary,
    id,
    artworkUrl,
    subscriberCount,
    isCreator: !aIsOfficial && !bIsOfficial,
  };
}

/**
 * Deduplicates a list of artists by merging duplicate cards that share the same artwork key,
 * the same canonical ID, or the same phonetic transliteration.
 */
export function deduplicateArtists(artists: Artist[]): Artist[] {
  if (!artists || artists.length === 0) return [];

  const list: Artist[] = [];
  const idToIndex = new Map<string, number>();
  const artKeyToIndex = new Map<string, number>();
  const simpToIndex = new Map<string, number>();
  const translitToIndex = new Map<string, number>();

  for (const artist of artists) {
    if (!artist.name && !artist.id) continue;

    const id = artist.id;
    const artKey = getArtworkKey(artist.artworkUrl);
    const simp = normSimp(artist.name);
    const translit = normTranslit(artist.name);

    // Check if this artist has already been seen under any identifier
    let existingIndex: number | undefined;
    if (id && idToIndex.has(id)) {
      existingIndex = idToIndex.get(id);
    } else if (artKey && artKeyToIndex.has(artKey)) {
      existingIndex = artKeyToIndex.get(artKey);
    } else if (simp && simpToIndex.has(simp)) {
      existingIndex = simpToIndex.get(simp);
    } else if (translit && translitToIndex.has(translit)) {
      existingIndex = translitToIndex.get(translit);
    }

    if (existingIndex !== undefined) {
      // Merge with existing artist
      const merged = mergeArtists(list[existingIndex], artist);
      list[existingIndex] = merged;

      // Update index pointers
      if (merged.id) idToIndex.set(merged.id, existingIndex);
      const newArtKey = getArtworkKey(merged.artworkUrl);
      if (newArtKey) artKeyToIndex.set(newArtKey, existingIndex);
      const newSimp = normSimp(merged.name);
      if (newSimp) simpToIndex.set(newSimp, existingIndex);
      const newTranslit = normTranslit(merged.name);
      if (newTranslit) translitToIndex.set(newTranslit, existingIndex);
    } else {
      // New artist entry
      const index = list.length;
      list.push(artist);

      if (id) idToIndex.set(id, index);
      if (artKey) artKeyToIndex.set(artKey, index);
      if (simp) simpToIndex.set(simp, index);
      if (translit) translitToIndex.set(translit, index);
    }
  }

  return list;
}
