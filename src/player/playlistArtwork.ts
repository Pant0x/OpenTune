import { setAppSetting } from "../internal/appSettings";
import { forgetArtworkSource } from "../internal/artworkCache";
import type { Track } from "../datasource/types";
import {
  LOCAL_IMAGE_PREFIX,
  setLocalPlaylistArtwork,
  readLocalPlaylists,
  readLocalPlaylistTracks,
  writeLocalPlaylistTracks,
} from "./localPlaylists";

const PLAYLIST_ARTWORK_PREFIX = "opentune:playlist-artwork:";
const PLAYLIST_TRACKS_ARTWORK_PREFIX = "opentune:playlist-tracks-artwork:";
export const PLAYLIST_ARTWORK_CHANGED_EVENT = "opentune:playlist-artwork-changed";

export interface PlaylistArtworkChangeDetail {
  playlistId: string;
  artworkUrl: string | null;
  applyToTracks: boolean;
}

export function getCustomPlaylistArtwork(playlistId: string): string | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(`${PLAYLIST_ARTWORK_PREFIX}${playlistId}`);
  if (stored) return stored;

  if (playlistId.startsWith("local-playlist:")) {
    const local = readLocalPlaylists().find((p) => p.id === playlistId);
    if (local?.artworkPath) {
      return `${LOCAL_IMAGE_PREFIX}${local.artworkPath}`;
    }
  }

  return null;
}

export function getCustomPlaylistTracksArtwork(playlistId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`) || null;
}

export async function setCustomPlaylistArtwork(
  playlistId: string,
  filePathOrUrl: string | null,
  options: { applyToTracks?: boolean; tracks?: Track[] } = {}
): Promise<void> {
  const { applyToTracks = false } = options;
  const currentCustom = getCustomPlaylistArtwork(playlistId);
  if (currentCustom) {
    forgetArtworkSource(currentCustom);
  }

  if (!filePathOrUrl) {
    try {
      localStorage.removeItem(`${PLAYLIST_ARTWORK_PREFIX}${playlistId}`);
      localStorage.removeItem(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`);
      void setAppSetting(`${PLAYLIST_ARTWORK_PREFIX}${playlistId}`, null);
      void setAppSetting(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`, null);
    } catch {}

    if (playlistId.startsWith("local-playlist:")) {
      setLocalPlaylistArtwork(playlistId, null);
    }

    window.dispatchEvent(
      new CustomEvent<PlaylistArtworkChangeDetail>(PLAYLIST_ARTWORK_CHANGED_EVENT, {
        detail: { playlistId, artworkUrl: null, applyToTracks: false },
      })
    );
    return;
  }

  const artworkUrl = filePathOrUrl.startsWith("http://") ||
    filePathOrUrl.startsWith("https://") ||
    filePathOrUrl.startsWith(LOCAL_IMAGE_PREFIX)
      ? filePathOrUrl
      : `${LOCAL_IMAGE_PREFIX}${filePathOrUrl}`;

  forgetArtworkSource(artworkUrl);

  try {
    localStorage.setItem(`${PLAYLIST_ARTWORK_PREFIX}${playlistId}`, artworkUrl);
    void setAppSetting(`${PLAYLIST_ARTWORK_PREFIX}${playlistId}`, artworkUrl);
    if (applyToTracks) {
      localStorage.setItem(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`, artworkUrl);
      void setAppSetting(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`, artworkUrl);
    } else {
      localStorage.removeItem(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`);
      void setAppSetting(`${PLAYLIST_TRACKS_ARTWORK_PREFIX}${playlistId}`, null);
    }
  } catch {}

  if (playlistId.startsWith("local-playlist:")) {
    const rawPath = filePathOrUrl.startsWith(LOCAL_IMAGE_PREFIX)
      ? filePathOrUrl.slice(LOCAL_IMAGE_PREFIX.length)
      : filePathOrUrl;
    setLocalPlaylistArtwork(playlistId, rawPath);

    if (applyToTracks) {
      const allTracks = readLocalPlaylistTracks();
      const current = allTracks[playlistId] ?? [];
      const updated = current.map((t) => ({ ...t, artworkUrl }));
      allTracks[playlistId] = updated;
      writeLocalPlaylistTracks(allTracks);
    }
  }

  window.dispatchEvent(
    new CustomEvent<PlaylistArtworkChangeDetail>(PLAYLIST_ARTWORK_CHANGED_EVENT, {
      detail: { playlistId, artworkUrl, applyToTracks },
    })
  );
}
