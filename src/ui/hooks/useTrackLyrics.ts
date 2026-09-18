/**
 * One shared lyrics fetch per track for every in-app surface (side card, Now Playing screen).
 *
 * Before this, each surface fetched independently: two parallel requests per track change,
 * two loading states that could disagree, and no error state anywhere — a failed fetch left
 * a permanently blank card. Entries are keyed by track id (not object identity, which flips
 * on every store update), cached in-module with a small LRU cap, and pushed to subscribers
 * through `useSyncExternalStore`.
 *
 * The fullscreen LyricsView keeps its own richer fetch (source-attempt log UI) and the mini
 * window receives lyrics through snapshots — neither uses this hook.
 */

import { useCallback, useSyncExternalStore } from "react";
import { playerController } from "../../player/playerStore";
import { logInternalWarn } from "../../internal/logging";
import type { Lyrics, Track } from "../../datasource/types";

export type TrackLyricsStatus = "idle" | "loading" | "ready" | "error";

export interface TrackLyricsState {
  status: TrackLyricsStatus;
  lyrics: Lyrics | null;
  error: string | null;
  reload: () => void;
}

interface LyricsEntry {
  status: Exclude<TrackLyricsStatus, "idle">;
  lyrics: Lyrics | null;
  error: string | null;
  listeners: Set<() => void>;
  started: boolean;
  /**
   * The exact object handed to `useSyncExternalStore`: rebuilt on every mutation, never
   * inline in `getSnapshot` (a fresh literal per call would re-render forever).
   */
  snapshot: TrackLyricsState;
}

const MAX_ENTRIES = 12;
const entries = new Map<string, LyricsEntry>();
const lastTracks = new Map<string, Track>();

const IDLE_STATE: TrackLyricsState = {
  status: "idle",
  lyrics: null,
  error: null,
  reload: () => {},
};

function notify(entry: LyricsEntry) {
  for (const listener of entry.listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function refreshSnapshot(entry: LyricsEntry, trackId: string) {
  const known = lastTracks.get(trackId);
  entry.snapshot = {
    status: entry.status,
    lyrics: entry.lyrics,
    error: entry.error,
    reload: () => {
      if (known) reloadTrackLyrics(known);
    },
  };
}

function startFetch(trackId: string, track: Track) {
  const entry = entries.get(trackId);
  if (!entry || entry.started) return;
  entry.started = true;
  entry.status = "loading";
  entry.lyrics = null;
  entry.error = null;
  refreshSnapshot(entry, trackId);
  notify(entry);

  void playerController
    .getLyrics(track)
    .then((res) => {
      const current = entries.get(trackId);
      if (!current) return;
      current.status = "ready";
      current.lyrics = res;
      refreshSnapshot(current, trackId);
      notify(current);
    })
    .catch((error) => {
      const current = entries.get(trackId);
      if (!current) return;
      current.status = "error";
      current.error = error instanceof Error ? error.message : String(error);
      logInternalWarn("useTrackLyrics.fetch failed", { trackId });
      refreshSnapshot(current, trackId);
      notify(current);
    });
}

function ensureEntry(track: Track): LyricsEntry {
  lastTracks.set(track.id, track);
  let entry = entries.get(track.id);
  if (!entry) {
    if (entries.size >= MAX_ENTRIES) {
      for (const [key, candidate] of entries) {
        if (candidate.listeners.size === 0) {
          entries.delete(key);
          lastTracks.delete(key);
          break;
        }
      }
    }
    entry = {
      status: "loading",
      lyrics: null,
      error: null,
      listeners: new Set(),
      started: false,
      snapshot: IDLE_STATE,
    };
    entries.set(track.id, entry);
    refreshSnapshot(entry, track.id);
  }
  return entry;
}

export function reloadTrackLyrics(track: Track): void {
  const previous = entries.get(track.id);
  const entry: LyricsEntry = {
    status: "loading",
    lyrics: null,
    error: null,
    listeners: previous?.listeners ?? new Set(),
    started: false,
    snapshot: IDLE_STATE,
  };
  entries.set(track.id, entry);
  refreshSnapshot(entry, track.id);
  startFetch(track.id, track);
}

export function useTrackLyrics(track: Track | null | undefined): TrackLyricsState {
  const trackId = track?.id ?? null;

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!trackId || !track) return () => {};
      const entry = ensureEntry(track);
      entry.listeners.add(callback);
      startFetch(trackId, track);
      return () => {
        entry.listeners.delete(callback);
      };
    },
    // Keyed by id on purpose: the store hands out fresh track objects for the same song,
    // and refetching on each one is exactly the churn this hook exists to kill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackId],
  );

  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      if (!trackId) return IDLE_STATE;
      const entry = entries.get(trackId);
      return entry ? entry.snapshot : IDLE_STATE;
    },
    () => IDLE_STATE,
  );

  return snapshot;
}
