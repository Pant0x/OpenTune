import { useSyncExternalStore } from "react";

const DUET_STORAGE_KEY = "amber_lyrics_duet_mode";
const ADLIB_STORAGE_KEY = "amber_lyrics_adlibs_mode";
const EVENT_NAME = "amber-lyrics-enhancements-changed";

function readDuetSetting(): boolean {
  try {
    return localStorage.getItem(DUET_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function readAdlibSetting(): boolean {
  try {
    return localStorage.getItem(ADLIB_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setLyricsDuetMode(enabled: boolean): void {
  try {
    localStorage.setItem(DUET_STORAGE_KEY, String(enabled));
  } catch {}
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function setLyricsAdlibsMode(enabled: boolean): void {
  try {
    localStorage.setItem(ADLIB_STORAGE_KEY, String(enabled));
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

export function useLyricsDuetMode(): boolean {
  return useSyncExternalStore(subscribe, readDuetSetting, () => true);
}

export function useLyricsAdlibsMode(): boolean {
  return useSyncExternalStore(subscribe, readAdlibSetting, () => true);
}
