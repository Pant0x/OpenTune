import { useSyncExternalStore } from "react";
import {
  hydrateLocalJsonSetting,
  readLocalJsonSetting,
  writeLocalJsonSetting,
} from "../../internal/durableLocalSetting";
import { logInternalWarn } from "../../internal/logging";
import { playerController } from "../../player/playerStore";
import {
  listOutputDevices as invokeListOutputDevices,
  setOutputDevice as pushOutputDevice,
  type OutputDevice,
} from "../../player/rustAudio";
import { usesRustAudioEngine } from "./audioEngine";

export type { OutputDevice };
export const listOutputDevices = invokeListOutputDevices;

/**
 * Which cpal output device the Rust engine writes to, by id. `null` is the OS default — what
 * `open_default_sink` grabs when nothing has ever been chosen.
 *
 * Only the Rust engine has a device to pick: the IFrame and native paths play through the
 * webview and follow the OS default the same as any other browser tab.
 */
const STORAGE_KEY = "audio-output-device";
const CHANGE_EVENT = "audio-output-device-change";

/** The `Select` sentinel for "no id" — Radix rejects an empty-string item value. */
export const SYSTEM_DEFAULT_DEVICE = "system-default";

function isDeviceId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function read(): string | null {
  return readLocalJsonSetting<string | null>(STORAGE_KEY, isDeviceId);
}

/**
 * Pushes the choice down to Rust and, if the engine was actively playing, reloads and resumes —
 * reopening the stream drops both decks, so playback must be restarted only if it was already
 * sounding.
 */
async function push(id: string | null): Promise<void> {
  const session = usesRustAudioEngine() ? playerController.getPlayerSession() : null;
  try {
    await pushOutputDevice(id);
  } catch (error) {
    logInternalWarn("Output device push failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // Only restart playback if audio was actively playing. If paused or idle, never blip playback.
  if (!session?.currentTrack || session.status !== "playing") return;
  await playerController.playTrackById(session.currentTrack.id);
  if (session.positionSec > 0) await playerController.seekTo(session.positionSec);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function getOutputDevice(): string | null {
  return read();
}

export function setOutputDevice(id: string | null): void {
  writeLocalJsonSetting(STORAGE_KEY, id);
  void push(id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function hydrateOutputDevice(): Promise<void> {
  await hydrateLocalJsonSetting(STORAGE_KEY, isDeviceId);
  // A fresh Rust process always opens the OS default until told otherwise, so the stored choice
  // has to be pushed down once at startup — pushOutputDevice sets the device without touching playback.
  try {
    await pushOutputDevice(read());
  } catch (error) {
    logInternalWarn("Output device hydration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useOutputDevice(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
