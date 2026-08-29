import { useSyncExternalStore } from "react";
import {
  hydrateLocalJsonSetting,
  readLocalJsonSetting,
  writeLocalJsonSetting,
} from "../../internal/durableLocalSetting";

const STORAGE_KEY = "download-location";
const CHANGE_EVENT = "download-location-change";
const DEFAULT_LOCATION = "amber/downloads";

function isDownloadLocation(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

let cached: string | null = null;

function readLocation(): string {
  if (cached !== null) return cached;
  cached = readLocalJsonSetting(STORAGE_KEY, isDownloadLocation) ?? DEFAULT_LOCATION;
  return cached;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", () => {
    cached = null;
  });
}

export function getDownloadLocation(): string {
  return readLocation();
}

export function setDownloadLocation(path: string) {
  const trimmed = path.trim() || DEFAULT_LOCATION;
  cached = trimmed;
  writeLocalJsonSetting(STORAGE_KEY, trimmed);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function hydrateDownloadLocation() {
  await hydrateLocalJsonSetting(STORAGE_KEY, isDownloadLocation);
  cached = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useDownloadLocation(): string {
  return useSyncExternalStore(subscribe, readLocation, () => DEFAULT_LOCATION);
}
