import { useSyncExternalStore } from "react";

export type RightPanelTab = "nowplaying" | "queue" | "recent";

export interface PlayerUIState {
  isSeeking: boolean;
  isDraggingVolume: boolean;
  showAlbumArt: boolean;
  isLyricsOpen: boolean;
  isLyricsFullscreen: boolean;
  isNowPlayingFullscreen: boolean;
  isQueueOpen: boolean;
  rightPanelTab: RightPanelTab;
  returnToLyricsOnFullscreenClose: boolean;
  isWaveMiniPlayerOpen: boolean;
  initialMediaMode?: "song" | "video";
}

type Listener = () => void;

class PlayerUIStore {
  private state: PlayerUIState = {
    isSeeking: false,
    isDraggingVolume: false,
    showAlbumArt: true,
    isLyricsOpen: false,
    isLyricsFullscreen: false,
    isNowPlayingFullscreen: false,
    isQueueOpen: false,
    rightPanelTab: "nowplaying",
    returnToLyricsOnFullscreenClose: false,
    isWaveMiniPlayerOpen: false,
    initialMediaMode: undefined,
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
    this.setState({ isLyricsFullscreen });
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
    this.setState({ isNowPlayingFullscreen });
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
      isNowPlayingFullscreen: true,
      initialMediaMode: "video",
    });
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
    this.setState({ isQueueOpen });
  }

  toggleQueue() {
    this.setState({ isQueueOpen: !this.state.isQueueOpen });
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
