import { useSyncExternalStore } from "react";

const EVENT_NAME = "amber-player-addons-changed";

const KEYS = {
  volumeBadge: "amber_show_volume_badge",
  waveSeekbar: "amber_wave_seekbar",
  djTrackInfo: "amber_dj_track_info",
  oneko: "amber_oneko_enabled",
  onekoVariant: "oneko:variant",
  onekoKuroneko: "oneko:kuroneko",
  rewindButton: "amber_rewind_button",
} as const;

export type OnekoVariant = "classic" | "dog" | "tora" | "maia" | "vaporwave";

export const ONEKO_VARIANTS: { id: OnekoVariant; label: string }[] = [
  { id: "classic", label: "Classic Cat" },
  { id: "dog", label: "Dog" },
  { id: "tora", label: "Tora (Tiger)" },
  { id: "maia", label: "Maia" },
  { id: "vaporwave", label: "Vaporwave" },
];

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

function readString<T extends string>(key: string, defaultValue: T): T {
  try {
    const val = localStorage.getItem(key);
    if (!val) return defaultValue;
    // Strip JSON quotes if present
    const clean = val.replace(/^"|"$/g, "");
    return (clean as T) || defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
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
  return useSyncExternalStore(subscribe, () => readBool(KEYS.volumeBadge, false), () => false);
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
  return useSyncExternalStore(subscribe, () => readBool(KEYS.djTrackInfo, false), () => false);
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

export function useOnekoVariant(): OnekoVariant {
  return useSyncExternalStore(
    subscribe,
    () => readString<OnekoVariant>(KEYS.onekoVariant, "classic"),
    () => "classic",
  );
}
export function setOnekoVariant(variant: OnekoVariant): void {
  writeString(KEYS.onekoVariant, variant);
}

export function useOnekoKuroneko(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readBool(KEYS.onekoKuroneko, false),
    () => false,
  );
}
export function setOnekoKuroneko(enabled: boolean): void {
  writeBool(KEYS.onekoKuroneko, enabled);
}

export function useRewindButton(): boolean {
  return useSyncExternalStore(subscribe, () => readBool(KEYS.rewindButton, false), () => false);
}
export function setRewindButton(enabled: boolean): void {
  writeBool(KEYS.rewindButton, enabled);
}
