import { useCallback, useRef, useSyncExternalStore } from "react";
import { YouTubeMusicDataSource } from "../datasource/youtube/YouTubeMusicDataSource";
import { LibraryController } from "./LibraryController";
import { PlayerController, type PlayerSession, type PlayerState } from "./PlayerController";
import { SearchController } from "./SearchController";
import { loadAppSession, loadLastPlayedTrack } from "./appSession";
import type { Track } from "../datasource/types";
import type { AudioQuality } from "../internal/audioQuality";
import { readSessionRestoreEnabled } from "../ui/settings/sessionRestore";
import {
  hydrateOfflineStore,
  setOfflineStreamResolver,
  startOfflineProgressFeed,
} from "./offlineStore";

export const dataSource = new YouTubeMusicDataSource();

export const libraryController = new LibraryController(dataSource);
export const searchController = new SearchController(dataSource);
/*
 * The offline queue needs a stream URL but must not depend on any particular data source, so
 * the source is injected here where both are already in scope.
 */
const offlineResolver = async (track: Track, quality: AudioQuality) => {
  const resolver = (dataSource as unknown as {
    resolveDownloadUrl?: (
      t: typeof track,
      q: typeof quality,
    ) => Promise<{ url: string; mimeType: string; cookie?: string }>;
  }).resolveDownloadUrl;
  if (!resolver) throw new Error("Downloads are unavailable for this source.");
  return resolver.call(dataSource, track, quality);
};
setOfflineStreamResolver(offlineResolver);
void hydrateOfflineStore();
startOfflineProgressFeed();

export const playerController = new PlayerController(dataSource);

export const restoredSession = readSessionRestoreEnabled() ? loadAppSession() : null;
if (restoredSession) {
  playerController.restoreSession(restoredSession.player);
} else if (readSessionRestoreEnabled()) {
  const lastTrack = loadLastPlayedTrack();
  if (lastTrack) {
    playerController.restoreSession({
      currentTrack: lastTrack,
      history: [],
      queue: [lastTrack],
      queueIndex: 0,
      status: "paused",
      positionSec: 0,
      volume: 1,
      muted: false,
      autoplayEnabled: true,
      playbackOrderMode: "in-order",
      shuffleEnabled: false,
      isPlaylistMode: false,
    });
  }
}

export type PlayerControllerActions = PlayerController;

let cachedPlayerSession: PlayerSession | null = null;
playerController.subscribe(() => {
  cachedPlayerSession = null;
});

const getPlayerSession = (): PlayerSession => {
  if (cachedPlayerSession === null) {
    cachedPlayerSession = playerController.exportSession();
  }
  return cachedPlayerSession;
};

export const tabManager = {
  applyPlaybackSettings: (settings: Parameters<PlayerController["applyPlaybackSettings"]>[0]) =>
    playerController.applyPlaybackSettings(settings),
  exportSession: () => ({ activeId: "1", playbackOwnerId: "1", players: { "1": getPlayerSession() } }),
  getActiveId: () => "1",
  getActivePlayerId: () => "1",
  getActivePlayer: () => playerController,
  claimFocusedPlayer: async () => playerController,
  subscribe: (listener: () => void) => playerController.subscribe(listener),
  getActiveState: () => playerController.getState(),
  getActiveSession: () => getPlayerSession(),
  isOnlyTab: () => true,
  reset: () => {},
  createTab: () => ({ player: playerController }),
  setActive: async () => {},
  removeTab: () => {},
  getPlaybackOwnerId: () => "1",
};

/*
 * Hoisted, not inline.
 *
 * `useSyncExternalStore` treats a new `subscribe` identity as a new subscription: it tears
 * the old one down and re-establishes it in a layout effect. Written inline these were a
 * fresh closure on every render, so every consumer re-subscribed on every render for the
 * life of the app.
 */
const subscribeToPlayer = (listener: () => void) => playerController.subscribe(listener);
const subscribeToLibrary = (listener: () => void) => libraryController.subscribe(listener);
const getPlayerState = () => playerController.getState();
const getLibraryState = () => libraryController.getState();

/** Re-exported so selector call sites need one import, not two. */
export { shallowEqual } from "../internal/shallowEqual";

/**
 * Subscribes to a slice of a store instead of the whole thing.
 *
 * The player state is one object, so subscribing to the whole thing re-renders on any change
 * to any field — dragging the volume slider used to re-render the entire application,
 * because the root subscribed to the same object as the volume control did.
 *
 * The cache is what makes an object-returning selector legal here: `useSyncExternalStore`
 * compares snapshots with `Object.is` and calls `getSnapshot` more than once per render, so
 * a selector building a fresh object every call would loop forever and warn. Holding the
 * previous value when the comparison says nothing changed is what keeps it stable.
 */
function useStoreSelector<S, T>(
  subscribe: (listener: () => void) => () => void,
  getState: () => S,
  select: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  /* Both are read through refs because callers pass inline arrows: as dependencies they
     would change identity every render and defeat the memoisation they exist to provide. */
  const selectRef = useRef(select);
  selectRef.current = select;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;
  const cacheRef = useRef<{ state: S; value: T } | null>(null);

  const getSnapshot = useCallback(() => {
    const state = getState();
    const cached = cacheRef.current;
    if (cached && Object.is(cached.state, state)) return cached.value;

    const next = selectRef.current(state);
    if (cached && isEqualRef.current(cached.value, next)) {
      // Same selection, new state object: keep the old reference so React sees no change.
      cacheRef.current = { state, value: cached.value };
      return cached.value;
    }
    cacheRef.current = { state, value: next };
    return next;
  }, [getState]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Prefer this over subscribing to the whole player state in anything that reads one or two
 * fields.
 *
 * Pass `shallowEqual` when the selector returns an object; the default `Object.is` is right
 * for the common case of selecting a single field or a derived boolean.
 */
export function usePlayerSelector<T>(
  select: (state: PlayerState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  return useStoreSelector(subscribeToPlayer, getPlayerState, select, isEqual);
}

export function usePlayerSession() {
  return useSyncExternalStore(subscribeToPlayer, getPlayerSession, getPlayerSession);
}

/**
 * A slice of the session, cached the same way `usePlayerSelector` caches player state.
 *
 * `exportSession()` rebuilds the queue window with `.slice()` on every export — a fresh array
 * even when the tracks in it have not changed — and every player emit triggers one, including
 * ones with nothing to do with the queue (a volume drag fires dozens per gesture). Plain
 * `usePlayerSession` has no caching, so a component reading `.queue` off it recomputes and
 * re-renders on all of those. Route queue-only reads through here instead.
 */
export function usePlayerSessionSelector<T>(
  select: (session: PlayerSession | null) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  return useStoreSelector(subscribeToPlayer, getPlayerSession, select, isEqual);
}

export function useLibraryState() {
  return useSyncExternalStore(subscribeToLibrary, getLibraryState, getLibraryState);
}
