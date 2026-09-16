import { useSyncExternalStore } from "react";

const EVENT_NAME = "amber-player-addons-changed";

const KEYS = {
  volumeBadge: "amber_show_volume_badge",
  waveSeekbar: "amber_wave_seekbar",
  djTrackInfo: "amber_dj_track_info",
  oneko: "amber_oneko_enabled",
} as const;

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const val = localStorage.getItem(key);
    if (val === null) return defaultValue;
    return val !== "false";
  } catch {
    return defaultValue;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
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

export function useVolumeBadge(): boolean {
  return useSyncExternalStore(subscribe, () => readBool(KEYS.volumeBadge, true), () => true);
}
export function setVolumeBadge(enabled: boolean): void {
  writeBool(KEYS.volumeBadge, enabled);
}

export function useWaveSeekbar(): boolean {
  return useSyncExternalStore(subscribe, () => readBool(KEYS.waveSeekbar, false), () => false);
}
export function setWaveSeekbar(enabled: boolean): void {
  writeBool(KEYS.waveSeekbar, enabled);
}

export function useDjTrackInfo(): boolean {
  return useSyncExternalStore(subscribe, () => readBool(KEYS.djTrackInfo, true), () => true);
}
export function setDjTrackInfo(enabled: boolean): void {
  writeBool(KEYS.djTrackInfo, enabled);
}

export function useOnekoEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => readBool(KEYS.oneko, false), () => false);
}
export function setOnekoEnabled(enabled: boolean): void {
  writeBool(KEYS.oneko, enabled);
}
