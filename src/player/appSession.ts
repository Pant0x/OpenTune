import type { AppViewState } from "../ui/types/tab";
import type { PlayerSession } from "./PlayerController";
import { getAppSetting, setAppSetting } from "../internal/appSettings";

import type { Track } from "../datasource/types";
import { getVideoArtworkFallback } from "../datasource/youtube/artwork";

const STORAGE_KEY_V2 = "amber.app-session.v2";
const STORAGE_KEY_V1 = "amber.app-session.v1";
export const SETTING_KEY_V2 = "amber.app-session.v2";
export const LAST_PLAYED_TRACK_STORAGE_KEY = "amber.last-played-track";

export interface AppSession {
  version: 2;
  view: AppViewState;
  history?: AppViewState[];
  forwardHistory?: AppViewState[];
  player: PlayerSession;
}

function restoreWithoutAutoplay(session: AppSession): AppSession {
  const currentTrack = session.player.currentTrack;
  const artworkUrl = currentTrack?.artworkUrl || (currentTrack?.id ? getVideoArtworkFallback(currentTrack.id) : undefined);
  const trackWithArt = currentTrack ? { ...currentTrack, artworkUrl } : null;

  return {
    ...session,
    view: { view: "home" },
    player: {
      ...session.player,
      status: session.player.status === "playing" ? "paused" : session.player.status,
      positionSec: 0,
      currentTrack: trackWithArt,
    },
  };
}

export function saveLastPlayedTrack(track: Track): void {
  try {
    const artworkUrl = track.artworkUrl || getVideoArtworkFallback(track.id);
    const trackWithArt = { ...track, artworkUrl };
    const payload = JSON.stringify(trackWithArt);
    localStorage.setItem(LAST_PLAYED_TRACK_STORAGE_KEY, payload);
    void setAppSetting(LAST_PLAYED_TRACK_STORAGE_KEY, trackWithArt);
  } catch {}
}

export function loadLastPlayedTrack(): Track | null {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_TRACK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id && parsed?.title) return parsed as Track;
    }
  } catch {}
  return null;
}

export async function hydrateLastPlayedTrackAsync(): Promise<Track | null> {
  try {
    const fromDisk = await getAppSetting<Track>(LAST_PLAYED_TRACK_STORAGE_KEY);
    if (fromDisk?.id && fromDisk?.title) {
      try {
        localStorage.setItem(LAST_PLAYED_TRACK_STORAGE_KEY, JSON.stringify(fromDisk));
      } catch {}
      return fromDisk;
    }
  } catch {}
  return null;
}

export function loadAppSession(): AppSession | null {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as AppSession | null;
      if (parsed?.version === 2 && parsed.view && parsed.player) {
        return restoreWithoutAutoplay(parsed);
      }
    }

    // Migration fallback from v1
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1);
      if (v1?.version === 1 && Array.isArray(v1.tabs) && v1.tabs.length > 0 && v1.player) {
        const activeTab = v1.tabs.find((t: { id?: string }) => t.id === v1.activeTabId) ?? v1.tabs[0];
        const playerOwnerId = v1.player.playbackOwnerId ?? v1.player.activeId ?? v1.activeTabId;
        const playerSession = (v1.player.players?.[playerOwnerId]
          ?? Object.values(v1.player.players ?? {})[0]) as PlayerSession | undefined;
        if (playerSession) {
          const migrated: AppSession = {
            version: 2,
            view: {
              view: activeTab.view ?? "home",
              title: activeTab.title,
              album: activeTab.album,
              song: activeTab.song,
              artist: activeTab.artist,
              releases: activeTab.releases,
              playlist: activeTab.playlist,
              relatedTrack: activeTab.relatedTrack,
              searchQuery: activeTab.searchQuery,
              searchResults: activeTab.searchResults,
              mixedSearchResults: activeTab.mixedSearchResults,
              browseTab: activeTab.browseTab,
            },
            player: playerSession,
          };
          saveAppSession(migrated);
          return restoreWithoutAutoplay(migrated);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Asynchronously checks disk setting for session when localStorage was empty or cold-started.
 */
export async function hydrateAppSessionAsync(): Promise<AppSession | null> {
  try {
    const fromDisk = await getAppSetting<AppSession>(SETTING_KEY_V2);
    if (fromDisk?.version === 2 && fromDisk.view && fromDisk.player?.currentTrack) {
      const restored = restoreWithoutAutoplay(fromDisk);
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(restored));
      } catch {}
      return restored;
    }
    return null;
  } catch {
    return null;
  }
}

let lastWrittenSession: string | null = null;

export function saveAppSession(session: AppSession): void {
  try {
    if (session.player?.currentTrack) {
      saveLastPlayedTrack(session.player.currentTrack);
    } else {
      const existing = loadAppSession();
      if (existing?.player?.currentTrack) {
        return;
      }
    }

    const payload = JSON.stringify(session);
    if (payload === lastWrittenSession) return;
    localStorage.setItem(STORAGE_KEY_V2, payload);
    lastWrittenSession = payload;
    void setAppSetting(SETTING_KEY_V2, session);
  } catch {
    // Persistence failure should not interrupt playback.
  }
}

export function clearAppSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_V2);
    localStorage.removeItem(STORAGE_KEY_V1);
    lastWrittenSession = null;
    void setAppSetting(SETTING_KEY_V2, null);
  } catch {
    // Persistence failure should not interrupt a full reset.
  }
}
