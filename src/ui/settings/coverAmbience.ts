import { useSyncExternalStore } from "react";

const STORAGE_KEY = "amber_cover_ambience";
const EVENT_NAME = "amber-cover-ambience-changed";

function readSetting(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val !== "false";
  } catch {
    return true;
  }
}

export function setCoverAmbienceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {}
  window.dispatchEvent(new Event(EVENT_NAME));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useCoverAmbienceEnabled(): boolean {
  return useSyncExternalStore(subscribe, readSetting, () => true);
}
