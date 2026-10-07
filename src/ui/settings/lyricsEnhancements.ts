import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

const DUET_STORAGE_KEY = "amber_lyrics_duet_mode";
const ADLIB_STORAGE_KEY = "amber_lyrics_adlibs_mode";
const EVENT_NAME = "amber-lyrics-enhancements-changed";

function readDuetSetting(): boolean {
  return readLocalBooleanSetting(DUET_STORAGE_KEY, true);
}

function readAdlibSetting(): boolean {
  return readLocalBooleanSetting(ADLIB_STORAGE_KEY, true);
}

export function setLyricsDuetMode(enabled: boolean): void {
  writeLocalBooleanSetting(DUET_STORAGE_KEY, enabled, EVENT_NAME);
}

export function setLyricsAdlibsMode(enabled: boolean): void {
  writeLocalBooleanSetting(ADLIB_STORAGE_KEY, enabled, EVENT_NAME);
}

export async function hydrateLyricsEnhancements(): Promise<void> {
  await Promise.all([
    hydrateLocalBooleanSetting(DUET_STORAGE_KEY, true, EVENT_NAME),
    hydrateLocalBooleanSetting(ADLIB_STORAGE_KEY, true, EVENT_NAME),
  ]);
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

