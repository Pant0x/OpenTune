/**
 * Main-window side of the mini player bridge.
 *
 * The audio engine lives here and only here. This module broadcasts lightweight playback
 * snapshots to the mini window (on every controller change plus a 1s heartbeat while music
 * plays) and executes the transport commands the mini window sends back. Lyrics ride along
 * as a separate snapshot on track change so the mini window never needs the datasource or
 * the engine — importing either there would boot a second player.
 */

import { emit, listen } from "@tauri-apps/api/event";
import { playerController } from "./playerStore";
import { isSyncedLyrics } from "../ui/pages/lyricsTiming";
import {
  LYRICS_SNAPSHOT_EVENT,
  MINI_COMMAND_EVENT,
  MINI_READY_EVENT,
  PLAYBACK_SNAPSHOT_EVENT,
} from "../mini/protocol";
import type {
  MiniCommand,
  MiniLyricsSnapshot,
  MiniPlaybackSnapshot,
} from "../mini/protocol";

/** The mini window closes itself through this, so the player layer never imports UI stores. */
export const MINI_CLOSE_REQUEST_EVENT = "amber-mini-close-requested";

function buildSnapshot(): MiniPlaybackSnapshot {
  const state = playerController.getState();
  const track = state.currentTrack;
  return {
    status: state.status,
    track: track
      ? {
        id: track.id,
        title: track.title,
        artist: track.artist,
        artworkUrl: track.artworkUrl ?? null,
        durationSec: track.durationSec ?? 0,
      }
      : null,
    positionSec: playerController.getCurrentTime(),
    volume: state.volume,
    muted: state.muted,
    shuffleEnabled: state.shuffleEnabled,
    playbackOrderMode: state.playbackOrderMode,
    sentAt: Date.now(),
  };
}

async function pushSnapshot(): Promise<void> {
  try {
    await emit(PLAYBACK_SNAPSHOT_EVENT, buildSnapshot());
  } catch {
    // Nobody listening (mini closed) — the next heartbeat retries for free.
  }
}

async function pushLyrics(trackId: string): Promise<void> {
  const track = playerController.getState().currentTrack;
  if (!track || track.id !== trackId) return;
  try {
    const lyrics = await playerController.getLyrics(track);
    if (!lyrics?.lines?.length) return;
    // Still the same track after the fetch, otherwise the snapshot is stale on arrival.
    if (playerController.getState().currentTrack?.id !== trackId) return;
    const snapshot: MiniLyricsSnapshot = {
      trackId,
      synced: isSyncedLyrics(lyrics),
      lines: lyrics.lines.map((line) => ({
        text: line.text,
        startTimeSec: line.startTimeSec,
        endTimeSec: line.endTimeSec,
      })),
    };
    await emit(LYRICS_SNAPSHOT_EVENT, snapshot);
  } catch {
    // Lyrics are best-effort in the mini window; the transport keeps working without them.
  }
}

async function handleCommand(command: MiniCommand): Promise<void> {
  try {
    switch (command.type) {
      case "toggle":
        await playerController.togglePlayPause();
        break;
      case "play":
        await playerController.play();
        break;
      case "pause":
        await playerController.pause();
        break;
      case "next":
        await playerController.skipToNext();
        break;
      case "prev":
        await playerController.skipToPrevious();
        break;
      case "seek":
        await playerController.seekTo(Math.max(0, command.positionSec));
        break;
      case "volume":
        await playerController.setVolume(Math.min(1, Math.max(0, command.value)));
        break;
      case "mute":
        await playerController.toggleMute();
        break;
      case "shuffle":
        playerController.toggleShuffle();
        break;
      case "repeat":
        playerController.cyclePlaybackOrderMode();
        break;
      case "close":
        window.dispatchEvent(new Event(MINI_CLOSE_REQUEST_EVENT));
        break;
      default:
        break;
    }
  } catch {
    // A failed remote command must never take the main window down with it.
  }
  // Whatever the command did, the controller notifies and the snapshot below follows.
  await pushSnapshot();
}

let started = false;

export function startMiniBridge(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  let lastTrackId: string | null = null;
  const onControllerChange = () => {
    void pushSnapshot();
    const trackId = playerController.getState().currentTrack?.id ?? null;
    if (trackId !== lastTrackId) {
      lastTrackId = trackId;
      if (trackId) void pushLyrics(trackId);
    }
  };

  playerController.subscribe(onControllerChange);

  window.setInterval(() => {
    if (playerController.getState().status === "playing") void pushSnapshot();
  }, 1000);

  void listen(MINI_READY_EVENT, () => {
    lastTrackId = null;
    onControllerChange();
  }).catch(() => {});

  void listen<MiniCommand>(MINI_COMMAND_EVENT, (event) => {
    void handleCommand(event.payload);
  }).catch(() => {});
}
