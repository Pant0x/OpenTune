/**
 * Manages the user's saved/bookmarked YouTube videos separately from regular music playlists.
 *
 * Two-tier persistence: every write goes to localStorage *and* the durable Rust store, and
 * `hydrateSavedVideos` backfills localStorage from the durable copy at boot. localStorage alone
 * dies with a cold or cleared WebView data directory — a save that survives a restart is the
 * whole point of the feature.
 */

import type { Track } from "../datasource/types";
import { getAppSetting, setAppSetting } from "../internal/appSettings";

const STORAGE_KEY = "amber:saved-videos";

export interface SavedVideo {
  id: string;
  title: string;
  artist: string;
  duration?: string;
  artworkUrl?: string;
  savedAt: number;
}

const EMPTY_VIDEOS: SavedVideo[] = [];
let cachedVideos: SavedVideo[] | null = null;
const listeners = new Set<() => void>();

function loadVideos(): SavedVideo[] {
  if (cachedVideos !== null) return cachedVideos;
  if (typeof window === "undefined" || !window.localStorage) {
    cachedVideos = EMPTY_VIDEOS;
    return cachedVideos;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedVideos = EMPTY_VIDEOS;
      return cachedVideos;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cachedVideos = parsed.filter(
        (item): item is SavedVideo =>
          Boolean(item) &&
          typeof item.id === "string" &&
          typeof item.title === "string",
      );
      return cachedVideos;
    }
  } catch {
    // fallback on error
  }

  cachedVideos = EMPTY_VIDEOS;
  return cachedVideos;
}

function isSavedVideoArray(value: unknown): value is SavedVideo[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item): item is SavedVideo =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as SavedVideo).id === "string" &&
        typeof (item as SavedVideo).title === "string",
    )
  );
}

function persistVideos(videos: SavedVideo[]) {
  cachedVideos = videos;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
    } catch {
      // Durable app settings still get the write below.
    }
  }
  void setAppSetting(STORAGE_KEY, videos);
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export function getSavedVideos(): SavedVideo[] {
  return loadVideos();
}

export function isSavedVideo(id: string): boolean {
  if (!id) return false;
  return loadVideos().some((v) => v.id === id);
}

export function saveVideo(track: Track): boolean {
  if (!track?.id) return false;
  const current = loadVideos();
  if (current.some((v) => v.id === track.id)) return false;

  const item: SavedVideo = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    artworkUrl: track.artworkUrl,
    savedAt: Date.now(),
  };

  persistVideos([item, ...current]);
  return true;
}

export function removeSavedVideo(id: string): boolean {
  if (!id) return false;
  const current = loadVideos();
  const next = current.filter((v) => v.id !== id);
  if (next.length === current.length) return false;

  persistVideos(next);
  return true;
}

export function toggleSaveVideo(track: Track): boolean {
  if (!track?.id) return false;
  if (isSavedVideo(track.id)) {
    removeSavedVideo(track.id);
    return false;
  } else {
    saveVideo(track);
    return true;
  }
}

export function subscribeToSavedVideos(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cachedVideos = null;
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
    listeners.delete(listener);
  };
}

/**
 * Boot-time reconciliation of the two tiers. Durable wins when it holds a valid list (and
 * backfills localStorage); otherwise a localStorage list is pushed to the durable store. Read
 * synchronously from localStorage by every UI path, so the localStorage backfill is what takes
 * effect for a machine whose WebView data directory was cleared.
 */
export async function hydrateSavedVideos(): Promise<void> {
  const stored = await getAppSetting<unknown>(STORAGE_KEY);
  if (isSavedVideoArray(stored)) {
    cachedVideos = stored;
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // A later explicit save will retry durable persistence.
      }
    }
  } else {
    const local = loadVideos();
    cachedVideos = local;
    if (local.length > 0) {
      void setAppSetting(STORAGE_KEY, local);
    }
  }

  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export function clearSavedVideosForTesting() {
  cachedVideos = null;
}

