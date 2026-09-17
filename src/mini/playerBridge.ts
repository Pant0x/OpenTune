/**
 * Mini-window side of the bridge. The mini window owns no engine and no stores — it listens
 * for playback/lyrics snapshots pushed by the main window and sends transport commands back.
 * Position is interpolated locally between snapshots so the progress bar stays smooth on a 1s
 * heartbeat.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  LYRICS_SNAPSHOT_EVENT,
  MINI_COMMAND_EVENT,
  MINI_READY_EVENT,
  PLAYBACK_SNAPSHOT_EVENT,
} from "./protocol";
import type {
  MiniCommand,
  MiniLyricsSnapshot,
  MiniPlaybackSnapshot,
} from "./protocol";

let latestSnapshot: MiniPlaybackSnapshot | null = null;
let latestLyrics: MiniLyricsSnapshot | null = null;
const snapshotListeners = new Set<() => void>();
const lyricsListeners = new Set<() => void>();

function notify(set: Set<() => void>) {
  for (const listener of set) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function subscribeSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

function subscribeLyrics(listener: () => void): () => void {
  lyricsListeners.add(listener);
  return () => {
    lyricsListeners.delete(listener);
  };
}

let bridgeStarted = false;

export function startMiniPlayerBridge(): void {
  if (bridgeStarted || typeof window === "undefined") return;
  bridgeStarted = true;

  void listen<MiniPlaybackSnapshot>(PLAYBACK_SNAPSHOT_EVENT, (event) => {
    latestSnapshot = event.payload;
    notify(snapshotListeners);
  }).catch(() => {});

  void listen<MiniLyricsSnapshot>(LYRICS_SNAPSHOT_EVENT, (event) => {
    latestLyrics = event.payload;
    notify(lyricsListeners);
  }).catch(() => {});

  // Ask the main window for a full state push (track, position, lyrics included).
  void emit(MINI_READY_EVENT).catch(() => {});
}

export function useMiniPlayback(): MiniPlaybackSnapshot | null {
  return useSyncExternalStore(subscribeSnapshot, () => latestSnapshot, () => null);
}

export function useMiniLyrics(): MiniLyricsSnapshot | null {
  return useSyncExternalStore(subscribeLyrics, () => latestLyrics, () => null);
}

/**
 * Display position: the last reported position advanced by wall-clock while playing.
 * Re-evaluated on a 250ms tick so the seekbar and timers move even between heartbeats.
 */
export function useMiniPosition(snapshot: MiniPlaybackSnapshot | null): number {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (snapshot?.status !== "playing") return;
    const interval = window.setInterval(() => setTick((tick) => tick + 1), 250);
    return () => window.clearInterval(interval);
  }, [snapshot?.status, snapshot?.track?.id]);

  if (!snapshot) return 0;
  if (snapshot.status !== "playing") return snapshot.positionSec;
  const duration = snapshot.track?.durationSec ?? 0;
  const estimated = snapshot.positionSec + (Date.now() - snapshot.sentAt) / 1000;
  return duration > 0 ? Math.min(duration, Math.max(0, estimated)) : Math.max(0, estimated);
}

export function sendMiniCommand(command: MiniCommand): void {
  void emit(MINI_COMMAND_EVENT, command).catch(() => {});
}
