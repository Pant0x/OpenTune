import type { AppViewState } from "../ui/types/tab";
import type { PlayerSession } from "./PlayerController";
import { setAppSetting } from "../internal/appSettings";

const STORAGE_KEY_V2 = "amber.app-session.v2";
const STORAGE_KEY_V1 = "amber.app-session.v1";
const SETTING_KEY_V2 = "amber.app-session.v2";

export interface AppSession {
  version: 2;
  view: AppViewState;
  history?: AppViewState[];
  forwardHistory?: AppViewState[];
  player: PlayerSession;
}

function restoreWithoutAutoplay(session: AppSession): AppSession {
  return {
    ...session,
    player: {
      ...session.player,
      status: session.player.status === "playing" ? "paused" : session.player.status,
    },
  };
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

let lastWrittenSession: string | null = null;

export function saveAppSession(session: AppSession): void {
  try {
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
