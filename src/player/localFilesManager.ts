import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { Track } from "../datasource/types";
import {
  readLocalPlaylists,
  writeLocalPlaylists,
  writeLocalPlaylistTracks,
  readLocalPlaylistTracks,
  type LocalPlaylist,
  LOCAL_ARTWORK_PREFIX,
} from "./localPlaylists";

const LOCAL_FOLDER_STORAGE_KEY = "amber-local-music-folder-v1";
const LOCAL_FOLDER_CHANGE_EVENT = "amber-local-folder-changed";

interface LocalAudioFile {
  path: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  hasArtwork: boolean;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function getLocalMusicFolder(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LOCAL_FOLDER_STORAGE_KEY) || null;
}

export function setLocalMusicFolder(folderPath: string | null): void {
  if (typeof window === "undefined") return;
  if (folderPath) {
    localStorage.setItem(LOCAL_FOLDER_STORAGE_KEY, folderPath);
  } else {
    localStorage.removeItem(LOCAL_FOLDER_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(LOCAL_FOLDER_CHANGE_EVENT));
  notify();
}

function subscribeFolder(callback: () => void) {
  listeners.add(callback);
  window.addEventListener(LOCAL_FOLDER_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener(LOCAL_FOLDER_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useLocalMusicFolder(): string | null {
  return useSyncExternalStore(subscribeFolder, getLocalMusicFolder, () => null);
}

export function localAudioFileToTrack(file: LocalAudioFile): Track {
  const filename = file.path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") || "Unknown title";
  return {
    id: `local:${btoa(unescape(encodeURIComponent(file.path)))}`,
    source: "local",
    title: file.title?.trim() || filename,
    artist: file.artist?.trim() || "Unknown artist",
    album: file.album?.trim() || undefined,
    durationSec: file.durationSec,
    artworkUrl: file.hasArtwork ? `${LOCAL_ARTWORK_PREFIX}${file.path}` : undefined,
    playlistItemId: file.path,
    localPath: file.path,
  };
}

let cachedScannedTracks: Track[] = [];
let cachedScannedFolder: string | null = null;
let scanPromise: Promise<Track[]> | null = null;

export async function scanLocalMusicFolder(folderPath?: string | null): Promise<Track[]> {
  const targetFolder = folderPath ?? getLocalMusicFolder();
  if (!targetFolder) {
    cachedScannedTracks = [];
    cachedScannedFolder = null;
    return [];
  }

  if (cachedScannedFolder === targetFolder && cachedScannedTracks.length > 0 && !scanPromise) {
    return cachedScannedTracks;
  }

  if (scanPromise) return scanPromise;

  scanPromise = (async () => {
    try {
      const files = await invoke<LocalAudioFile[]>("local_audio_scan", { paths: [targetFolder] });
      const tracks = files.map(localAudioFileToTrack);
      cachedScannedTracks = tracks;
      cachedScannedFolder = targetFolder;
      notify();
      return tracks;
    } catch (err) {
      console.error("Failed to scan local music folder:", err);
      return [];
    } finally {
      scanPromise = null;
    }
  })();

  return scanPromise;
}

export function getCachedLocalTracks(): Track[] {
  return cachedScannedTracks;
}

/**
 * Set custom artwork for a local playlist.
 */
export function setLocalPlaylistArtwork(playlistId: string, artworkPathOrUrl: string): void {
  const playlists = readLocalPlaylists();
  const updated = playlists.map((p: LocalPlaylist) => (p.id === playlistId ? { ...p, artworkPath: artworkPathOrUrl } : p));
  writeLocalPlaylists(updated);
}

/**
 * Syncs the playlist's cover artwork to all tracks in that playlist.
 */
export function syncPlaylistArtworkToTracks(playlistId: string, artworkUrl: string): void {
  setLocalPlaylistArtwork(playlistId, artworkUrl);
  const allTracks = readLocalPlaylistTracks();
  const currentTracks = allTracks[playlistId] ?? [];
  const updatedTracks = currentTracks.map((t: Track) => ({
    ...t,
    artworkUrl: artworkUrl,
  }));
  allTracks[playlistId] = updatedTracks;
  writeLocalPlaylistTracks(allTracks);
}
