import { removeAppSetting } from "../../internal/appSettings";

const STORAGE_KEY = "spicetify_enabled_snippets";
const CUSTOM_SNIPPETS_KEY = "spicetify_custom_snippets";

/**
 * Removes all injected Spicetify snippet style elements from <head>
 * and clears snippet configuration from storage.
 */
export function purgeAllSnippets(): void {
  if (typeof document !== "undefined") {
    const existing = document.querySelectorAll("style[id^='spicetify-snippet-'], style[data-spicetify-snippet]");
    existing.forEach((el) => el.remove());
  }

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CUSTOM_SNIPPETS_KEY);
    } catch {}
  }

  void removeAppSetting(STORAGE_KEY);
  void removeAppSetting(CUSTOM_SNIPPETS_KEY);
}

export function getStoredEnabledIds(): Set<string> {
  return new Set();
}
