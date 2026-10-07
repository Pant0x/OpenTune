import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";
import { getAppSetting, setAppSetting } from "../../internal/appSettings";

const EVENT_NAME = "amber-player-addons-changed";

const KEYS = {
  volumeBadge: "amber_show_volume_badge_v2",
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

function readString<T extends string>(key: string, defaultValue: T): T {
  try {
    const val = localStorage.getItem(key);
    if (!val) return defaultValue;
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
  void setAppSetting(key, value);
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
  return useSyncExternalStore(
    subscribe,
    () => readLocalBooleanSetting(KEYS.volumeBadge, false),
    () => false,
  );
}
export function setVolumeBadge(enabled: boolean): void {
  writeLocalBooleanSetting(KEYS.volumeBadge, enabled, EVENT_NAME);
}

export function useWaveSeekbar(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readLocalBooleanSetting(KEYS.waveSeekbar, false),
    () => false,
  );
}
export function setWaveSeekbar(enabled: boolean): void {
  writeLocalBooleanSetting(KEYS.waveSeekbar, enabled, EVENT_NAME);
}

export function useDjTrackInfo(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readLocalBooleanSetting(KEYS.djTrackInfo, false),
    () => false,
  );
}
export function setDjTrackInfo(enabled: boolean): void {
  writeLocalBooleanSetting(KEYS.djTrackInfo, enabled, EVENT_NAME);
}

export function useOnekoEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readLocalBooleanSetting(KEYS.oneko, false),
    () => false,
  );
}
export function setOnekoEnabled(enabled: boolean): void {
  writeLocalBooleanSetting(KEYS.oneko, enabled, EVENT_NAME);
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
    () => readLocalBooleanSetting(KEYS.onekoKuroneko, false),
    () => false,
  );
}
export function setOnekoKuroneko(enabled: boolean): void {
  writeLocalBooleanSetting(KEYS.onekoKuroneko, enabled, EVENT_NAME);
}

export function useRewindButton(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readLocalBooleanSetting(KEYS.rewindButton, false),
    () => false,
  );
}
export function setRewindButton(enabled: boolean): void {
  writeLocalBooleanSetting(KEYS.rewindButton, enabled, EVENT_NAME);
}

export async function hydratePlayerAddonSettings(): Promise<void> {
  await Promise.all([
    hydrateLocalBooleanSetting(KEYS.volumeBadge, false, EVENT_NAME),
    hydrateLocalBooleanSetting(KEYS.waveSeekbar, false, EVENT_NAME),
    hydrateLocalBooleanSetting(KEYS.djTrackInfo, false, EVENT_NAME),
    hydrateLocalBooleanSetting(KEYS.oneko, false, EVENT_NAME),
    hydrateLocalBooleanSetting(KEYS.onekoKuroneko, false, EVENT_NAME),
    hydrateLocalBooleanSetting(KEYS.rewindButton, false, EVENT_NAME),
  ]);

  try {
    const storedVariant = await getAppSetting<string>(KEYS.onekoVariant);
    if (storedVariant) {
      localStorage.setItem(KEYS.onekoVariant, storedVariant);
      window.dispatchEvent(new Event(EVENT_NAME));
    }
  } catch {}
}
