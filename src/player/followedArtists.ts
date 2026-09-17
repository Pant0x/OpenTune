/**
 * Central store for locally-followed artists ("Following" on artists, "Subscribe" on channels).
 *
 * Before this module the same localStorage key was written from three different components with
 * three copies of the same read/write code, every copy swallowed write failures, and none wrote
 * to the durable store — so follows died with a cold or cleared WebView data directory. Every
 * writer and reader now goes through here.
 *
 * Two-tier persistence: every write goes to localStorage *and* the durable Rust store, and
 * `hydrateFollowedArtists` backfills localStorage from the durable copy at boot. The storage
 * format (a JSON array of id/name strings under the legacy key) is unchanged, so older installs
 * and the direct readers in `searchAffinity.ts` and the datasource's personalization weights
 * keep working untouched.
 *
 * Every write also stamps `touched-at`. UI code uses `isFollowedOverrideFresh` to trust a
 * recent local toggle over a stale remote `page.subscribed`, which is what made the follow
 * button flip back on/off ("keeps on and off") while the remote value lagged behind the local
 * toggle.
 */

import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../internal/appSettings";

const STORAGE_KEY = "amber_followed_artists";
const TOUCHED_KEY = "amber:followed-artists-touched-at";

/**
 * How long a local toggle stays authoritative over the remote subscription state. Generous,
 * because the remote value lags behind the toggle (YouTube only reflects a subscribe on the
 * next page load), and every refresh in between used to flip the button back.
 */
const OVERRIDE_GRACE_MS = 120_000;

const EMPTY_KEYS: Set<string> = new Set();
let cachedKeys: Set<string> | null = null;
let cachedTouchedAt = 0;
const listeners = new Set<() => void>();

function loadKeys(): Set<string> {
  if (cachedKeys !== null) return cachedKeys;
  if (typeof window === "undefined" || !window.localStorage) {
    return EMPTY_KEYS;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cachedKeys = new Set(parsed.filter((item): item is string => typeof item === "string"));
        return cachedKeys;
      }
    }
  } catch {
    // fallback on error
  }
  return EMPTY_KEYS;
}

function loadTouchedAt(): number {
  if (cachedTouchedAt > 0) return cachedTouchedAt;
  try {
    const raw = localStorage.getItem(TOUCHED_KEY);
    const parsed = raw ? Number(raw) : 0;
    if (Number.isFinite(parsed) && parsed > 0) {
      cachedTouchedAt = parsed;
      return cachedTouchedAt;
    }
  } catch {
    // fallback on error
  }
  return 0;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function persist(keys: Set<string>) {
  cachedKeys = keys;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    } catch {
      // Durable app settings still get the write below.
    }
  }
  void setAppSetting(STORAGE_KEY, [...keys]);

  cachedTouchedAt = Date.now();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(TOUCHED_KEY, String(cachedTouchedAt));
    } catch {
      // Durable app settings still get the write below.
    }
  }
  void setAppSetting(TOUCHED_KEY, cachedTouchedAt);

  notify();
}

export function getFollowedArtistKeys(): Set<string> {
  return loadKeys();
}

/**
 * Whether any of the given candidate keys (channel id, lowercased name) is followed locally.
 */
export function isArtistFollowedLocally(
  ...candidates: Array<string | undefined | null>
): boolean {
  if (candidates.length === 0) return false;
  const keys = loadKeys();
  return candidates.some((candidate) => Boolean(candidate) && keys.has(candidate as string));
}

export function setArtistFollowedLocally(
  id: string | undefined | null,
  name: string | undefined | null,
  followed: boolean,
): void {
  const keys = new Set(loadKeys());
  let changed = false;
  if (id) {
    if (followed ? !keys.has(id) : keys.has(id)) {
      if (followed) keys.add(id);
      else keys.delete(id);
      changed = true;
    }
  }
  const lower = name ? name.toLowerCase() : "";
  if (lower) {
    if (followed ? !keys.has(lower) : keys.has(lower)) {
      if (followed) keys.add(lower);
      else keys.delete(lower);
      changed = true;
    }
  }
  if (changed) persist(keys);
}

/**
 * When the local follow state was last written. UI code compares this against when the remote
 * artist page was loaded: a remote value that disagrees with a toggle newer than the page is
 * a lagging remote, not the truth.
 */
export function getFollowedArtistsTouchedAt(): number {
  return loadTouchedAt();
}

/**
 * Whether a local toggle happened recently enough to stay authoritative over the remote
 * subscription state, whatever the remote currently claims.
 */
export function isFollowedOverrideFresh(): boolean {
  const touchedAt = loadTouchedAt();
  return touchedAt > 0 && Date.now() - touchedAt < OVERRIDE_GRACE_MS;
}

export function subscribeToFollowedArtists(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === TOUCHED_KEY) {
      cachedKeys = null;
      cachedTouchedAt = 0;
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
    listeners.delete(listener);
  };
}

/**
 * React binding: whether any of the candidate keys (channel id, lowercased name) is followed
 * locally, re-read on every write through the store.
 */
export function useFollowedArtistLocally(
  ...candidates: Array<string | undefined | null>
): boolean {
  return useSyncExternalStore(
    subscribeToFollowedArtists,
    () => {
      const keys = loadKeys();
      return candidates.some((candidate) => Boolean(candidate) && keys.has(candidate as string));
    },
    () => false,
  );
}

/**
 * Boot-time reconciliation of the two tiers. Durable wins when it holds a valid list (and
 * backfills localStorage); otherwise a localStorage list is pushed to the durable store.
 */
export async function hydrateFollowedArtists(): Promise<void> {
  const stored = await getAppSetting<unknown>(STORAGE_KEY);
  if (Array.isArray(stored)) {
    cachedKeys = new Set(stored.filter((item): item is string => typeof item === "string"));
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...cachedKeys]));
      } catch {
        // A later explicit write will retry durable persistence.
      }
    }
  } else {
    const local = loadKeys();
    cachedKeys = local;
    if (local.size > 0) {
      void setAppSetting(STORAGE_KEY, [...local]);
    }
  }

  const storedTouched = await getAppSetting<unknown>(TOUCHED_KEY);
  if (typeof storedTouched === "number" && Number.isFinite(storedTouched) && storedTouched > 0) {
    cachedTouchedAt = storedTouched;
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(TOUCHED_KEY, String(storedTouched));
      } catch {
        // A later explicit write will retry durable persistence.
      }
    }
  } else {
    const localTouched = loadTouchedAt();
    if (localTouched > 0) {
      void setAppSetting(TOUCHED_KEY, localTouched);
    }
  }

  notify();
}
