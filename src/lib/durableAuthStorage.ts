import { getAppSetting, setAppSetting, removeAppSetting } from "../internal/appSettings";

const memoryCache = new Map<string, string>();

/**
 * Robust, cross-restart storage adapter for Supabase client auth.
 * Stores tokens in-memory for synchronous access, in localStorage for web compatibility,
 * and durably in native `appSettings` (SQLite/JSON on disk) so sessions survive app restarts
 * and WebView2 cache flushes.
 */
export const durableAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    // 1. Check in-memory cache
    if (memoryCache.has(key)) {
      return memoryCache.get(key)!;
    }

    // 2. Check browser localStorage
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const localVal = window.localStorage.getItem(key);
        if (localVal) {
          memoryCache.set(key, localVal);
          return localVal;
        }
      }
    } catch {}

    // 3. Fall back to native appSettings on disk
    try {
      const persistedVal = await getAppSetting<string>(`supabase_auth_${key}`);
      if (persistedVal) {
        memoryCache.set(key, persistedVal);
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem(key, persistedVal);
          }
        } catch {}
        return persistedVal;
      }
    } catch {}

    return null;
  },

  async setItem(key: string, value: string): Promise<void> {
    memoryCache.set(key, value);

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {}

    try {
      await setAppSetting(`supabase_auth_${key}`, value);
    } catch (err) {
      console.warn("[durableAuthStorage] setAppSetting failed:", err);
    }
  },

  async removeItem(key: string): Promise<void> {
    memoryCache.delete(key);

    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {}

    try {
      await removeAppSetting(`supabase_auth_${key}`);
    } catch (err) {
      console.warn("[durableAuthStorage] removeAppSetting failed:", err);
    }
  },
};
