import { useSyncExternalStore } from "react";
import { removeAppSetting } from "../../internal/appSettings";
import {
  hydrateLocalJsonSetting,
  readLocalJsonSetting,
  writeLocalJsonSetting,
} from "../../internal/durableLocalSetting";

/**
 * The linked Discord identity: who the listener connected as.
 *
 * Tokens live in the OS keyring (Rust owns them end to end); this is only the
 * public profile the UI shows. Written once per `discord_oauth_connect`, cleared
 * by `discord_oauth_disconnect`, mirrored durably like every other setting.
 */
export interface DiscordIdentity {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
}

const STORAGE_KEY = "discord-identity";
const CHANGE_EVENT = "discord-identity-change";

function isDiscordIdentity(value: unknown): value is DiscordIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.username === "string";
}

function readIdentity(): DiscordIdentity | null {
  return readLocalJsonSetting(STORAGE_KEY, isDiscordIdentity);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setDiscordIdentity(identity: DiscordIdentity | null): void {
  if (identity) {
    writeLocalJsonSetting(STORAGE_KEY, identity);
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Durable removal below still applies.
    }
    void removeAppSetting(STORAGE_KEY);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getDiscordIdentity(): DiscordIdentity | null {
  return readIdentity();
}

export async function hydrateDiscordIdentity(): Promise<void> {
  await hydrateLocalJsonSetting(STORAGE_KEY, isDiscordIdentity);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useDiscordIdentity(): DiscordIdentity | null {
  return useSyncExternalStore(subscribe, readIdentity, () => null);
}
