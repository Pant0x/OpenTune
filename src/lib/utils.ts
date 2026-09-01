import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * `m:ss` for a whole-second duration. Callers round `seconds` themselves (floor for elapsed
 * position, ceil for a countdown) — this only formats what it's given.
 */
export function formatMinutesSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Formats numbers into compact notation (e.g. 1.2K, 15K, 125K, 1M, 1.2M, 1.5B).
 */
export function formatCompactNumber(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return "";
  let num: number;
  if (typeof value === "number") {
    num = value;
  } else {
    const str = value.toString().trim();
    if (!str) return "";
    let cleaned = str.replace(/\s*(?:views?|plays?|subscribers?)\b\.?/gi, "").trim();
    if (/^[\d.]+\s*[KMB]$/i.test(cleaned)) {
      return cleaned.replace(/\s+/g, "").toUpperCase();
    }
    // Remove all commas and periods if formatted as thousands (e.g. "1,800,000" or "1.800.000")
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(cleaned)) {
      cleaned = cleaned.replace(/[.,]/g, "");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
    num = parseFloat(cleaned);
    if (isNaN(num)) return str;
  }
  if (!Number.isFinite(num) || num < 0) return "";
  if (num < 1000) return num.toString();
  if (num < 1_000_000) {
    const k = num / 1_000;
    const formatted = (Math.round(k * 10) / 10).toString().replace(/\.0$/, "");
    return `${formatted}K`;
  }
  if (num < 1_000_000_000) {
    const m = num / 1_000_000;
    const formatted = (Math.round(m * 10) / 10).toString().replace(/\.0$/, "");
    return `${formatted}M`;
  }
  const b = num / 1_000_000_000;
  const formatted = (Math.round(b * 10) / 10).toString().replace(/\.0$/, "");
  return `${formatted}B`;
}

/**
 * Formats play/view counts (e.g. "1.2M plays", "15K plays").
 */
export function formatPlayCount(value: number | string | undefined | null): string {
  const compact = formatCompactNumber(value);
  return compact ? `${compact} plays` : "";
}

/**
 * Formats duration from seconds into human-readable format like "42 min" or "1 hr 15 min".
 */
export function formatTotalDuration(totalSec: number): string {
  if (!totalSec || totalSec <= 0) return "";
  const totalMinutes = Math.round(totalSec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }
  return `${minutes} min`;
}

