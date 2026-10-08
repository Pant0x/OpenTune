import { useSyncExternalStore } from "react";

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

function readStoredQueueOpen(): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(QUEUE_OPEN_KEY) === "true";
    }
  } catch {}
  return false;
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
    rightPanelTab: "nowplaying",
    returnToLyricsOnFullscreenClose: false,
    isWaveMiniPlayerOpen: false,
    initialMediaMode: undefined,
    lyricsMediaMode: "song",
  };
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
    // Leaving the lyrics view leaves fullscreen with it — there is nothing left to be
    // fullscreen about, and the window would otherwise get stuck edge-to-edge.
    this.setState(isLyricsOpen ? { isLyricsOpen } : { isLyricsOpen, isLyricsFullscreen: false });
  }

  toggleLyrics() {
    this.setLyricsOpen(!this.state.isLyricsOpen);
  }

  setLyricsFullscreen(isLyricsFullscreen: boolean) {
    if (isLyricsFullscreen) {
      this.setState({ isLyricsFullscreen, isQueueOpen: false });
    } else {
      this.setState({ isLyricsFullscreen, isQueueOpen: readStoredQueueOpen() });
    }
  }

  setNowPlayingFullscreen(isNowPlayingFullscreen: boolean) {
    if (!isNowPlayingFullscreen && this.state.returnToLyricsOnFullscreenClose) {
      this.setState({
        isNowPlayingFullscreen: false,
        returnToLyricsOnFullscreenClose: false,
        isLyricsOpen: true,
      });
      return;
    }
    if (isNowPlayingFullscreen) {
      this.setState({ isNowPlayingFullscreen, isQueueOpen: false });
    } else {
      this.setState({ isNowPlayingFullscreen, isQueueOpen: readStoredQueueOpen() });
    }
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
    this.setState({ rightPanelTab, isQueueOpen: true });
  }

  openNowPlaying() {
    this.setState({ rightPanelTab: "nowplaying", isQueueOpen: true });
  }

  setWaveMiniPlayerOpen(isWaveMiniPlayerOpen: boolean) {
    this.setState({ isWaveMiniPlayerOpen });
  }

  toggleWaveMiniPlayer() {
    this.setState({ isWaveMiniPlayerOpen: !this.state.isWaveMiniPlayerOpen });
  }
}

export const playerUIStore = new PlayerUIStore();

export function usePlayerUIState() {
  return useSyncExternalStore(
    (listener) => playerUIStore.subscribe(listener),
    () => playerUIStore.getState(),
    () => playerUIStore.getState(),
  );
}
