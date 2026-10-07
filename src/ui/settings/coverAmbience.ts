import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

const STORAGE_KEY = "amber_cover_ambience";
const EVENT_NAME = "amber-cover-ambience-changed";

function readSetting(): boolean {
  return readLocalBooleanSetting(STORAGE_KEY, true);
}

export function setCoverAmbienceEnabled(enabled: boolean): void {
  writeLocalBooleanSetting(STORAGE_KEY, enabled, EVENT_NAME);
}

export async function hydrateCoverAmbience(): Promise<void> {
  await hydrateLocalBooleanSetting(STORAGE_KEY, true, EVENT_NAME);
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

