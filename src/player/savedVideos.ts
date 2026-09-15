/**
 * Manages the user's saved/bookmarked YouTube videos separately from regular music playlists.
 */

import type { Track } from "../datasource/types";

const STORAGE_KEY = "amber:saved-videos";

export interface SavedVideo {
  id: string;
  title: string;
  artist: string;
  duration?: string;
  artworkUrl?: string;
  savedAt: number;
}

let cachedVideos: SavedVideo[] | null = null;
const listeners = new Set<() => void>();

function loadVideos(): SavedVideo[] {
  if (cachedVideos !== null) return cachedVideos;
  if (typeof window === "undefined" || !window.localStorage) {
    cachedVideos = [];
    return cachedVideos;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedVideos = [];
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

  cachedVideos = [];
  return cachedVideos;
}

function persistVideos(videos: SavedVideo[]) {
  cachedVideos = videos;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
    } catch {
      // storage failures ignored
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

export function getSavedVideos(): SavedVideo[] {
  return [...loadVideos()];
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
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
