import type { Playlist, Track } from "../datasource/types";
import {
  addTracksToLocalPlaylist,
  createLocalPlaylist,
  isLocalPlaylist,
  localPlaylistToPlaylist,
  readLocalPlaylistTracks,
  setLocalPlaylistArtwork,
} from "./localPlaylists";

export interface SharedTrackItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  artworkUrl?: string;
  source?: Track["source"];
  isLocal?: boolean;
}

export interface SharedPlaylistPayload {
  v: 1;
  name: string;
  description?: string;
  artworkUrl?: string;
  covers?: string[];
  tracks: SharedTrackItem[];
}

export type ParsedSharePayload =
  | { type: "data"; data: SharedPlaylistPayload }
  | { type: "youtube"; playlistId: string; name?: string }
  | { type: "spotify"; playlistId: string };

const sharedPlaylistsRegistry = new Map<string, { playlist: Playlist; tracks: Track[] }>();

function utf8ToBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } catch {
    return "";
  }
}

function base64ToUtf8(str: string): string {
  try {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return "";
  }
}

/**
 * Generates a universal, shareable deep-link for any playlist.
 * Works seamlessly whether the playlist is local, created from scratch,
 * converted from Spotify, or sourced from YouTube Music.
 */
export function generatePlaylistShareLink(playlist: Playlist, tracks?: Track[]): string {
  // If it's a native YouTube Music playlist and has no custom local tracks
  const isPureYouTube = (playlist.id.startsWith("VL") || playlist.id.startsWith("PL"))
    && !isLocalPlaylist(playlist);

  if (isPureYouTube) {
    const cleanYtId = playlist.id.replace(/^VL/, "");
    return `opentune://playlist?yt=${encodeURIComponent(cleanYtId)}&name=${encodeURIComponent(playlist.title)}`;
  }

  // Otherwise, package the metadata into a high-efficiency URL-safe data payload
  const resolvedTracks = tracks
    ?? (isLocalPlaylist(playlist) ? (readLocalPlaylistTracks()[playlist.id] ?? []) : []);

  const covers = resolvedTracks
    .map((t) => t.artworkUrl)
    .filter((url): url is string => Boolean(url && !url.startsWith("local-")))
    .slice(0, 4);

  const payload: SharedPlaylistPayload = {
    v: 1,
    name: playlist.title,
    description: playlist.description,
    artworkUrl: playlist.artworkUrl && !playlist.artworkUrl.startsWith("local-") ? playlist.artworkUrl : undefined,
    covers: covers.length > 0 ? covers : undefined,
    tracks: resolvedTracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || "Unknown artist",
      album: t.album,
      durationSec: t.durationSec,
      artworkUrl: t.artworkUrl && !t.artworkUrl.startsWith("local-") ? t.artworkUrl : undefined,
      source: t.source || (t.localPath ? "local" : "youtube"),
      isLocal: Boolean(t.localPath || t.source === "local"),
    })),
  };

  const encoded = utf8ToBase64(JSON.stringify(payload));
  return `opentune://playlist?data=${encoded}`;
}

/**
 * Parses any incoming share link (opentune://, YouTube, Spotify, or raw data).
 */
export function parsePlaylistShareLink(rawInput: string): ParsedSharePayload | null {
  if (!rawInput || typeof rawInput !== "string") return null;
  const input = rawInput.trim();

  // 1. YouTube URLs (music.youtube.com or www.youtube.com)
  const ytMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (ytMatch?.[1]) {
    return { type: "youtube", playlistId: ytMatch[1] };
  }

  // 2. Spotify URLs
  const spotifyMatch = input.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (spotifyMatch?.[1]) {
    return { type: "spotify", playlistId: spotifyMatch[1] };
  }

  // 3. opentune:// links or URLs with query parameters
  if (input.startsWith("opentune://") || input.includes("opentune.app/playlist")) {
    try {
      const urlPart = input.replace(/^opentune:\/\/[^?]*\?/, "").replace(/^https?:\/\/[^?#]*[?#]/, "");
      const params = new URLSearchParams(urlPart);

      const ytParam = params.get("yt");
      if (ytParam) {
        return {
          type: "youtube",
          playlistId: ytParam,
          name: params.get("name") || undefined,
        };
      }

      const spotifyParam = params.get("spotify");
      if (spotifyParam) {
        return { type: "spotify", playlistId: spotifyParam };
      }

      const dataParam = params.get("data");
      if (dataParam) {
        const decodedJson = base64ToUtf8(dataParam);
        if (decodedJson) {
          const parsed = JSON.parse(decodedJson) as SharedPlaylistPayload;
          if (parsed && parsed.v === 1 && Array.isArray(parsed.tracks)) {
            return { type: "data", data: parsed };
          }
        }
      }
    } catch {
      // Fall through to raw attempt
    }
  }

  // 4. Raw base64 data fallback
  try {
    const decodedJson = base64ToUtf8(input);
    if (decodedJson) {
      const parsed = JSON.parse(decodedJson) as SharedPlaylistPayload;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.tracks)) {
        return { type: "data", data: parsed };
      }
    }
  } catch {
    // Not valid payload
  }

  return null;
}

/**
 * Registers an in-memory shared playlist so it can be viewed and played instantly
 * without having been saved yet to the recipient's local library.
 */
export function registerSharedPlaylist(payload: SharedPlaylistPayload): Playlist {
  const id = `shared-playlist:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tracks: Track[] = payload.tracks.map((t, idx) => ({
    id: t.id,
    title: t.title,
    artist: t.artist || "Unknown artist",
    album: t.album,
    durationSec: t.durationSec,
    artworkUrl: t.artworkUrl,
    source: (t.source as Track["source"]) ?? (t.isLocal ? "local" : "youtube"),
    playlistItemId: `${id}:${idx}`,
  }));

  const playlist: Playlist = {
    id,
    title: payload.name,
    description: payload.description,
    artworkUrl: payload.artworkUrl ?? payload.covers?.[0],
    owner: "Shared with you",
    isEditable: false,
    kind: "playlist",
  };

  sharedPlaylistsRegistry.set(id, { playlist, tracks });
  return playlist;
}

export function getSharedPlaylist(id: string): { playlist: Playlist; tracks: Track[] } | null {
  return sharedPlaylistsRegistry.get(id) ?? null;
}

/**
 * Saves a shared playlist into the recipient's personal OpenTune library.
 */
export async function saveSharedPlaylistToLibrary(
  playlist: Playlist,
  tracks: Track[],
): Promise<Playlist> {
  const local = createLocalPlaylist(playlist.title);
  if (tracks.length > 0) {
    addTracksToLocalPlaylist(tracks, local);
  }
  if (playlist.artworkUrl && !playlist.artworkUrl.startsWith("local-")) {
    setLocalPlaylistArtwork(local.id, playlist.artworkUrl);
  }
  return localPlaylistToPlaylist(local);
}
