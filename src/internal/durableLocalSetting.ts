import { getAppSetting, setAppSetting } from "./appSettings";

export function readLocalBooleanSetting(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === "true";
  } catch {
    return defaultValue;
  }
}

export function writeLocalBooleanSetting(
  key: string,
  enabled: boolean,
  changeEvent: string,
): void {
  try {
    localStorage.setItem(key, String(enabled));
  } catch {
    // Durable app settings still get the write below.
  }

  window.dispatchEvent(new Event(changeEvent));
  void setAppSetting(key, enabled);
}

export async function hydrateLocalBooleanSetting(
  key: string,
  defaultValue: boolean,
  changeEvent: string,
  apply?: (enabled: boolean) => void | Promise<void>,
): Promise<void> {
  const stored = await getAppSetting<boolean>(key);
  const nextValue = typeof stored === "boolean"
    ? stored
    : readLocalBooleanSetting(key, defaultValue);

  try {
    localStorage.setItem(key, String(nextValue));
  } catch {
    // The in-memory UI still receives the event below.
  }

  await apply?.(nextValue);
  window.dispatchEvent(new Event(changeEvent));

  if (typeof stored !== "boolean") {
    void setAppSetting(key, nextValue);
  }
}

export function readLocalJsonSetting<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalJsonSetting<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Durable app settings still get the write below.
  }

  void setAppSetting(key, value);
}

export async function hydrateLocalJsonSetting<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): Promise<void> {
  const stored = await getAppSetting<unknown>(key);
  if (isValid(stored)) {
    try {
      localStorage.setItem(key, JSON.stringify(stored));
    } catch {
      // A later explicit save will retry durable persistence.
    }
    return;
  }

  const localValue = readLocalJsonSetting(key, isValid);
  if (localValue) {
    void setAppSetting(key, localValue);
  }
}

export function readLocalStringSetting(key: string, defaultValue: string): string {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored;
  } catch {
    return defaultValue;
  }
}

export function writeLocalStringSetting(
  key: string,
  value: string,
  changeEvent?: string,
): void {
  try {
    localStorage.setItem(key, value);
  } catch {}

  if (changeEvent) {
    window.dispatchEvent(new Event(changeEvent));
  }
  void setAppSetting(key, value);
}

export async function hydrateLocalStringSetting(
  key: string,
  defaultValue: string,
  changeEvent?: string,
  apply?: (value: string) => void | Promise<void>,
): Promise<void> {
  const stored = await getAppSetting<string>(key);
  const nextValue = typeof stored === "string" && stored.length > 0
    ? stored
    : readLocalStringSetting(key, defaultValue);

  try {
    localStorage.setItem(key, nextValue);
  } catch {}

  await apply?.(nextValue);
  if (changeEvent) {
    window.dispatchEvent(new Event(changeEvent));
  }

  if (typeof stored !== "string") {
    void setAppSetting(key, nextValue);
  }
}

export function readLocalNumberSetting(key: string, defaultValue: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    const num = Number(stored);
    return Number.isFinite(num) ? num : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writeLocalNumberSetting(
  key: string,
  value: number,
  changeEvent?: string,
): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}

  if (changeEvent) {
    window.dispatchEvent(new Event(changeEvent));
  }
  void setAppSetting(key, value);
}

export async function hydrateLocalNumberSetting(
  key: string,
  defaultValue: number,
  changeEvent?: string,
  apply?: (value: number) => void | Promise<void>,
): Promise<void> {
  const stored = await getAppSetting<number>(key);
  const nextValue = typeof stored === "number" && Number.isFinite(stored)
    ? stored
    : readLocalNumberSetting(key, defaultValue);

  try {
    localStorage.setItem(key, String(nextValue));
  } catch {}

  await apply?.(nextValue);
  if (changeEvent) {
    window.dispatchEvent(new Event(changeEvent));
  }

  if (typeof stored !== "number") {
    void setAppSetting(key, nextValue);
  }
}

