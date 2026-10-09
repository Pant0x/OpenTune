import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../../internal/appSettings";

export type RightPanelTab = "nowplaying" | "queue" | "related" | "recent";

export interface PlayerUIState {
  isSeeking: boolean;
  isDraggingVolume: boolean;
  showAlbumArt: boolean;
  isLyricsOpen: boolean;
  isLyricsFullscreen: boolean;
  isNowPlayingFullscreen: boolean;
  isQueueOpen: boolean;
  isListeningActivityOpen: boolean;
  rightPanelTab: RightPanelTab;
  returnToLyricsOnFullscreenClose: boolean;
  isWaveMiniPlayerOpen: boolean;
  initialMediaMode?: "song" | "video";
  lyricsMediaMode: "song" | "video";
}

type Listener = () => void;

const QUEUE_OPEN_KEY = "opentune:sidebar_panel_open";
const SIDEBAR_TAB_KEY = "opentune:sidebar_panel_tab";

function readStoredQueueOpen(): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(QUEUE_OPEN_KEY);
      if (stored !== null) return stored === "true";
    }
  } catch {}
  return false;
}

function readStoredRightPanelTab(): RightPanelTab {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(SIDEBAR_TAB_KEY);
      if (stored === "nowplaying" || stored === "queue" || stored === "related" || stored === "recent") {
        return stored;
      }
    }
  } catch {}
  return "nowplaying";
}

class PlayerUIStore {
  private state: PlayerUIState = {
    isSeeking: false,
    isDraggingVolume: false,
    showAlbumArt: true,
    isLyricsOpen: false,
    isLyricsFullscreen: false,
    isNowPlayingFullscreen: false,
    isQueueOpen: readStoredQueueOpen(),
    isListeningActivityOpen: false,
    rightPanelTab: readStoredRightPanelTab(),
    returnToLyricsOnFullscreenClose: false,
    isWaveMiniPlayerOpen: false,
    initialMediaMode: undefined,
    lyricsMediaMode: "song",
  };
  private wasLyricsOpenBeforeFullscreen = false;
  private wasQueueOpenBeforeFullscreen: boolean | null = null;
  private wasQueueOpenBeforeNowPlayingFullscreen: boolean | null = null;
  private listeners = new Set<Listener>();

  getState(): PlayerUIState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<PlayerUIState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  setSeeking(isSeeking: boolean) {
    this.setState({ isSeeking });
  }

  setDraggingVolume(isDraggingVolume: boolean) {
    this.setState({ isDraggingVolume });
  }

  setShowAlbumArt(showAlbumArt: boolean) {
    this.setState({ showAlbumArt });
  }

  setLyricsOpen(isLyricsOpen: boolean) {
    if (isLyricsOpen) {
      this.setState({ isLyricsOpen });
    } else {
      const restoreQueue =
        this.state.isLyricsFullscreen && this.wasQueueOpenBeforeFullscreen !== null
          ? this.wasQueueOpenBeforeFullscreen
          : this.state.isQueueOpen;
      this.wasLyricsOpenBeforeFullscreen = false;
      this.wasQueueOpenBeforeFullscreen = null;
      this.setState({
        isLyricsOpen: false,
        isLyricsFullscreen: false,
        isQueueOpen: restoreQueue,
      });
    }
  }

  toggleLyrics() {
    this.setLyricsOpen(!this.state.isLyricsOpen);
  }

  setLyricsFullscreen(isLyricsFullscreen: boolean) {
    if (isLyricsFullscreen) {
      if (!this.state.isLyricsFullscreen) {
        this.wasLyricsOpenBeforeFullscreen = this.state.isLyricsOpen;
        this.wasQueueOpenBeforeFullscreen = this.state.isQueueOpen;
      }
      this.setState({
        isLyricsFullscreen: true,
        isLyricsOpen: true,
        isQueueOpen: false,
      });
    } else {
      const restoreLyrics = this.wasLyricsOpenBeforeFullscreen;
      const restoreQueue =
        this.wasQueueOpenBeforeFullscreen !== null
          ? this.wasQueueOpenBeforeFullscreen
          : readStoredQueueOpen();
      this.wasLyricsOpenBeforeFullscreen = false;
      this.wasQueueOpenBeforeFullscreen = null;
      this.setState({
        isLyricsFullscreen: false,
        isLyricsOpen: restoreLyrics,
        isQueueOpen: restoreQueue,
      });
    }
  }

  setNowPlayingFullscreen(isNowPlayingFullscreen: boolean) {
    if (isNowPlayingFullscreen) {
      if (!this.state.isNowPlayingFullscreen) {
        this.wasQueueOpenBeforeNowPlayingFullscreen = this.state.isQueueOpen;
      }
      this.setState({ isNowPlayingFullscreen: true, isQueueOpen: false });
      return;
    }

    const restoreQueue =
      this.wasQueueOpenBeforeNowPlayingFullscreen !== null
        ? this.wasQueueOpenBeforeNowPlayingFullscreen
        : readStoredQueueOpen();
    this.wasQueueOpenBeforeNowPlayingFullscreen = null;

    if (this.state.returnToLyricsOnFullscreenClose) {
      this.setState({
        isNowPlayingFullscreen: false,
        returnToLyricsOnFullscreenClose: false,
        isLyricsOpen: true,
        isQueueOpen: restoreQueue,
      });
      return;
    }

    this.setState({ isNowPlayingFullscreen: false, isQueueOpen: restoreQueue });
  }

  openNowPlayingFromLyrics() {
    this.setState({
      isNowPlayingFullscreen: true,
      returnToLyricsOnFullscreenClose: true,
    });
  }

  openVideoMode() {
    this.setState({
      isLyricsOpen: true,
      lyricsMediaMode: "video",
    });
  }

  setLyricsMediaMode(lyricsMediaMode: "song" | "video") {
    this.setState({ lyricsMediaMode });
  }

  clearInitialMediaMode() {
    this.setState({ initialMediaMode: undefined });
  }

  toggleNowPlayingFullscreen() {
    if (this.state.isNowPlayingFullscreen) {
      this.setNowPlayingFullscreen(false);
    } else {
      if (this.state.isLyricsOpen) {
        this.openNowPlayingFromLyrics();
      } else {
        this.setState({ isNowPlayingFullscreen: true });
      }
    }
  }

  setQueueOpen(isQueueOpen: boolean) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(QUEUE_OPEN_KEY, String(isQueueOpen));
      }
    } catch {}
    void setAppSetting(QUEUE_OPEN_KEY, isQueueOpen);
    if (isQueueOpen) {
      this.setState({ isQueueOpen, isListeningActivityOpen: false });
    } else {
      this.setState({ isQueueOpen });
    }
  }

  toggleQueue() {
    this.setQueueOpen(!this.state.isQueueOpen);
  }

  setListeningActivityOpen(isListeningActivityOpen: boolean) {
    this.setState({ isListeningActivityOpen });
  }

  toggleListeningActivity() {
    this.setListeningActivityOpen(!this.state.isListeningActivityOpen);
  }

  setRightPanelTab(rightPanelTab: RightPanelTab) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SIDEBAR_TAB_KEY, rightPanelTab);
      }
    } catch {}
    void setAppSetting(SIDEBAR_TAB_KEY, rightPanelTab);
    this.setState({ rightPanelTab, isQueueOpen: true });
  }

  openNowPlaying() {
    this.setRightPanelTab("nowplaying");
  }

  setWaveMiniPlayerOpen(isWaveMiniPlayerOpen: boolean) {
    this.setState({ isWaveMiniPlayerOpen });
  }

  toggleWaveMiniPlayer() {
    this.setState({ isWaveMiniPlayerOpen: !this.state.isWaveMiniPlayerOpen });
  }
}

export const playerUIStore = new PlayerUIStore();

export async function hydratePlayerUISettings(): Promise<void> {
  try {
    const storedQueueOpen = await getAppSetting<boolean>(QUEUE_OPEN_KEY);
    if (typeof storedQueueOpen === "boolean") {
      playerUIStore.setQueueOpen(storedQueueOpen);
    }
    const storedTab = await getAppSetting<RightPanelTab>(SIDEBAR_TAB_KEY);
    if (
      storedTab &&
      (storedTab === "nowplaying" ||
        storedTab === "queue" ||
        storedTab === "related" ||
        storedTab === "recent")
    ) {
      playerUIStore.setRightPanelTab(storedTab);
    }
  } catch {}
}

export function usePlayerUIState() {
  return useSyncExternalStore(
    (listener) => playerUIStore.subscribe(listener),
    () => playerUIStore.getState(),
    () => playerUIStore.getState(),
  );
}
