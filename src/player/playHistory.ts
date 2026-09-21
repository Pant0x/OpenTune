import { useSyncExternalStore } from "react";
import type { Track } from "../datasource/types";
import { logInternalWarn } from "../internal/logging";
import { getAppSetting, setAppSetting } from "../internal/appSettings";

const STORAGE_KEY = "amber.play-history.v1";

/** 30 days in ms — history keeps all tracks played within a month and prunes older entries */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

export interface PlayHistoryEntry {
  track: Track;
  /** Epoch ms. */
  playedAt: number;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: PlayHistoryEntry[] = [];

function normalize(parsed: unknown): PlayHistoryEntry[] | null {
  if (!Array.isArray(parsed)) return null;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const valid = parsed.filter((entry): entry is PlayHistoryEntry =>
    Boolean(entry)
    && typeof entry === "object"
    && typeof (entry as PlayHistoryEntry).playedAt === "number"
    && (entry as PlayHistoryEntry).playedAt >= cutoff
    && Boolean((entry as PlayHistoryEntry).track?.id),
  );
  // Deduplicate by track.id, keeping only the most recent entry
  const seen = new Set<string>();
  const deduplicated: PlayHistoryEntry[] = [];
  for (const entry of valid) {
    if (!seen.has(entry.track.id)) {
      seen.add(entry.track.id);
      deduplicated.push(entry);
    }
  }
  return deduplicated;
}

function read(): PlayHistoryEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cached;

  cachedRaw = raw;
  cached = [];
  if (!raw) return cached;

  try {
    cached = normalize(JSON.parse(raw)) ?? [];
  } catch (error) {
    logInternalWarn("playHistory.read failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return cached;
}

/**
 * Restores the history from durable storage, which local storage is not.
 *
 * What you listened to cannot be recovered from anywhere else — YouTube's own history is a
 * different list, and this one is the only record of it. That makes it worth a second copy
 * outside the webview, where a cleared profile cannot reach it.
 */
export async function hydratePlayHistory(): Promise<void> {
  const stored = normalize(await getAppSetting<unknown>(STORAGE_KEY));
  if (stored && stored.length > 0) {
    // Through write(), so the mirror is refreshed and anything already rendered is told.
    write(stored);
    return;
  }

  const local = read();
  if (local.length > 0) void setAppSetting(STORAGE_KEY, local);
}

function write(entries: PlayHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const trimmed = entries
    .filter((entry) => entry.playedAt >= cutoff)
    .slice(0, MAX_ENTRIES);
  cachedRaw = JSON.stringify(trimmed);
  cached = trimmed;
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch (error) {
    logInternalWarn("playHistory.write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  void setAppSetting(STORAGE_KEY, trimmed);
  for (const listener of listeners) listener();
}

/**
 * Records a play. Newest first, which is the order the page reads in.
 *
 * Kept separate from PlayerController's `history` array on purpose: that one has no
 * timestamps and is load-bearing for skip-back and for filtering recommendations, so
 * reshaping it to carry times would put a display feature in the path of playback.
 */
export function recordPlay(track: Track): void {
  const entries = read();
  const now = Date.now();
  // Filter out any existing entry for this track so each song appears only once
  const filtered = entries.filter((e) => e.track.id !== track.id);
  write([{ track, playedAt: now }, ...filtered]);
}

export function clearPlayHistory(): void {
  write([]);
}

export function removePlayHistoryEntry(playedAt: number): void {
  write(read().filter((entry) => entry.playedAt !== playedAt));
}

export function getPlayHistory(): PlayHistoryEntry[] {
  return read();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another window (the mini player) writes to the same key.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const EMPTY: PlayHistoryEntry[] = [];

export function usePlayHistory(): PlayHistoryEntry[] {
  return useSyncExternalStore(subscribe, getPlayHistory, () => EMPTY);
}
