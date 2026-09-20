import type { LyricLine, Lyrics } from "../../datasource/types";

/**
 * Whether a set of lines can drive a karaoke highlight.
 *
 * Derived from the lines themselves rather than trusting `timing`: providers disagree about
 * the field (LRCLIB says "synced", a TTML parse may leave gaps), and a single line without a
 * start time is enough to make the highlight jump backwards.
 */
export function isSyncedLyrics(lyrics: Lyrics | null): boolean {
  const lines = lyrics?.lines;
  if (!lines?.length) return false;
  if (lyrics?.timing === "none") return false;
  const textLines = lines.filter((line) => line.text.trim().length > 0);
  if (textLines.length === 0) return false;
  return textLines.every((line) => typeof line.startTimeSec === "number");
}

/**
 * Index of the line that should be lit at `timeSec`, or -1 before the first one starts.
 *
 * A plain forward scan: lyric line counts are in the low hundreds and this runs once per
 * animation frame, so a binary search would buy nothing but an off-by-one to debug at 3am.
 */
/** Assumed length of a line with nothing after it to bound it. */
const FALLBACK_LINE_SEC = 4;

/**
 * How far playback is through line `index`, 0 to 1.
 *
 * Drives the sweep across the active line. The end is taken from whatever the provider
 * actually gave us, in descending order of trust: an explicit end, the next line's start,
 * the track duration for the final line, and only then a flat guess — the last line of a
 * song is routinely the one that has to hold for thirty seconds of outro.
 */
export function getLineProgress(
  lines: LyricLine[],
  index: number,
  timeSec: number,
  trackDurationSec?: number,
): number {
  const line = lines[index];
  const start = line?.startTimeSec;
  if (start === undefined) return 0;

  const isLast = index === lines.length - 1;
  const end = line.endTimeSec
    ?? lines[index + 1]?.startTimeSec
    ?? (isLast ? trackDurationSec : undefined)
    ?? start + FALLBACK_LINE_SEC;

  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (timeSec - start) / (end - start)));
}

export function findActiveLineIndex(lines: LyricLine[], timeSec: number): number {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index]?.startTimeSec;
    if (start === undefined) continue;
    if (timeSec < start) break;
    active = index;
  }
  return active;
}

/**
 * Detects if a string contains RTL scripts (Arabic, Hebrew, Persian, Urdu, etc.)
 */
export function isRtlText(text: string): boolean {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
}

export interface LyricToken {
  type: "main" | "adlib";
  text: string;
}

/**
 * Tokenizes a line into main lyrics and parenthetical ad-libs (e.g. `(yeah)`, `(ooh)`).
 */
export function parseLyricTokens(text: string): LyricToken[] {
  const source = typeof text === "string" ? text : String(text ?? "");
  if (!source) return [];
  const tokens: LyricToken[] = [];
  const regex = /\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const before = source.slice(lastIndex, match.index);
    if (before) {
      tokens.push({ type: "main", text: before });
    }
    tokens.push({ type: "adlib", text: `(${match[1]})` });
    lastIndex = regex.lastIndex;
  }

  const after = source.slice(lastIndex);
  if (after) {
    tokens.push({ type: "main", text: after });
  }

  return tokens.length > 0 ? tokens : [{ type: "main", text: source }];
}

/**
 * Bare vocalizations that carry no lyrical content on their own ("Woo", "Yeah", "Uh", …).
 * Spotify renders these dimmer and smaller than real lines — the same ad-lib treatment as
 * parenthetical asides get. Matching is deliberately conservative: only lines made *entirely*
 * of these tokens qualify, so a real line that merely contains one ("Yeah, I'm rich") is
 * untouched.
 */
const ADLIB_INTERJECTIONS = new Set([
  "woo",
  "yeah",
  "yea",
  "yee",
  "uh",
  "uhh",
  "ah",
  "ahh",
  "oh",
  "ohh",
  "ooh",
  "oohh",
  "ooh-ooh",
  "hmm",
  "mmm",
  "mm",
  "hm",
  "la",
  "na",
  "da",
  "ba",
  "hey",
  "heyy",
  "yay",
  "whoa",
  "woah",
  "ay",
  "aye",
  "ayy",
  "yo",
  "ha",
  "haha",
  "woohoo",
  "uh-huh",
  "uh-uh",
  "grr",
  "brr",
  "skrr",
  "skrt",
  "ye",
  "fah",
  "rah",
  "bah",
]);

/**
 * Whether a whole line is an ad-lib rather than a lyric: fully parenthesized (`(Woo, ah)`),
 * symbol-only (♪), or made entirely of bare vocalizations (`Woo`, `Yeah yeah`).
 */
export function isAdlibLine(text: string): boolean {
  const trimmed = (typeof text === "string" ? text : String(text ?? "")).trim();
  if (!trimmed) return false;
  if (/^\(.*\)$/.test(trimmed)) return true;

  const bare = trimmed
    .replace(/[()♪♫♬♩,“”"'.!?…,:;—–\-/+*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!bare) return true;

  const words = bare.split(" ");
  return words.length > 0 && words.every((word) => ADLIB_INTERJECTIONS.has(word));
}

export type DuetAlignment = "left" | "right" | "center";

export interface ProcessedDuetLine {
  displayText: string;
  alignment: DuetAlignment;
  singer?: string;
}

/**
 * Parses vocalist indicators (`[Singer]`, `Singer:`, `[Chorus]`, `[Both]`) and multi-artist tracks.
 * Maps Singer 1 / Lead to "left", Singer 2 / Feat to "right", and Chorus / Both to "center".
 */
export function processDuetLyrics(
  lines: LyricLine[],
  artists?: Array<{ name: string } | string>,
): ProcessedDuetLine[] {
  const detectedSingers: string[] = [];
  let currentSinger: string | undefined;

  const singerTagRegex = /^(?:\[|\()(?:Verse\s*\d*:\s*|Chorus:\s*)?([A-Za-z0-9_ -]+)(?:\]|\))/i;
  const colonTagRegex = /^([A-Za-z0-9_ -]+):\s*/i;

  const result: ProcessedDuetLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.text ?? "";
    const trimmed = raw.trim();

    if (!trimmed) {
      result.push({ displayText: "", alignment: "left" });
      continue;
    }

    let displayText = trimmed;
    let lineSinger: string | undefined;
    let isChorusOrBoth = false;

    const bracketMatch = singerTagRegex.exec(trimmed);
    if (bracketMatch) {
      const tagContent = bracketMatch[1].trim();
      const lower = tagContent.toLowerCase();
      if (lower === "both" || lower === "all" || lower === "together" || lower === "chorus") {
        isChorusOrBoth = true;
      } else {
        lineSinger = tagContent;
        if (!detectedSingers.includes(lineSinger)) {
          detectedSingers.push(lineSinger);
        }
        currentSinger = lineSinger;
      }
      displayText = trimmed.slice(bracketMatch[0].length).trim();
    } else {
      const colonMatch = colonTagRegex.exec(trimmed);
      if (colonMatch) {
        const tagContent = colonMatch[1].trim();
        const lower = tagContent.toLowerCase();
        if (lower === "both" || lower === "all" || lower === "together" || lower === "chorus") {
          isChorusOrBoth = true;
        } else {
          lineSinger = tagContent;
          if (!detectedSingers.includes(lineSinger)) {
            detectedSingers.push(lineSinger);
          }
          currentSinger = lineSinger;
        }
        displayText = trimmed.slice(colonMatch[0].length).trim();
      }
    }

    const activeSinger = lineSinger || currentSinger;

    let alignment: DuetAlignment = "left";
    if (isChorusOrBoth) {
      alignment = "center";
    } else if (activeSinger && detectedSingers.length > 1) {
      const singerIdx = detectedSingers.indexOf(activeSinger);
      alignment = singerIdx % 2 === 0 ? "left" : "right";
    }

    if (!displayText && bracketMatch) {
      displayText = raw;
    }

    result.push({
      displayText: displayText || raw,
      alignment,
      singer: activeSinger,
    });
  }

  const hasMultipleArtists = Boolean(artists && artists.length > 1);
  if (detectedSingers.length <= 1 && hasMultipleArtists) {
    let currentVocalistIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = lines[i - 1];
      if (prev && line?.startTimeSec && prev.startTimeSec && (line.startTimeSec - (prev.endTimeSec ?? prev.startTimeSec) >= 3.5)) {
        currentVocalistIndex = (currentVocalistIndex + 1) % 2;
      }
      if (result[i]) {
        result[i].alignment = currentVocalistIndex === 0 ? "left" : "right";
      }
    }
  }

  return result;
}

/**
 * Calculates a dynamic vocal sweep multiplier based on syllable / delivery speed and tempo.
 *
 * Fast flows (rap, high syllables/characters per second):
 * Vocals are delivered tightly in bursts, finishing earlier before the end of the line bar -> multiplier up to ~1.35x.
 *
 * Slow ballads (long vowels, sustained notes, low cps):
 * Singer holds notes across the line duration -> multiplier drops to ~1.06x so words don't finish before the artist does.
 *
 * Standard pop / rock:
 * Balances naturally around ~1.15x - 1.20x.
 */
export function getDynamicVocalMultiplier(
  line: LyricLine | undefined,
  nextLine?: LyricLine,
  trackDurationSec?: number,
): number {
  if (!line || !line.text) return 1.18;
  const text = line.text.trim();
  if (!text) return 1.18;

  const start = line.startTimeSec ?? 0;
  const end = line.endTimeSec
    ?? nextLine?.startTimeSec
    ?? (trackDurationSec ? Math.min(start + 6, trackDurationSec) : start + 4);
  const duration = Math.max(0.6, end - start);

  const charCount = text.replace(/\s+/g, "").length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Characters per second and words per second
  const cps = charCount / duration;
  const wps = wordCount / duration;

  // Rap / high tempo: cps >= 18 or wps >= 4.5
  // Slow / ballad: cps <= 8 or wps <= 2.0
  if (cps >= 22 || wps >= 5.0) {
    // Very fast delivery (e.g. Eminem, fast rap bars)
    return 1.35;
  }
  if (cps >= 16 || wps >= 3.8) {
    // Fast delivery
    return 1.28;
  }
  if (cps <= 7 || wps <= 1.8) {
    // Slow sustained vocal (ballad / slow song)
    return 1.06;
  }
  if (cps <= 10 || wps <= 2.4) {
    // Moderate slow
    return 1.12;
  }

  // Linear interpolation for intermediate speeds
  // Range from cps = 10 (multiplier 1.12) to cps = 16 (multiplier 1.28)
  const factor = (cps - 10) / (16 - 10);
  return Math.max(1.05, Math.min(1.35, 1.12 + factor * (1.28 - 1.12)));
}

