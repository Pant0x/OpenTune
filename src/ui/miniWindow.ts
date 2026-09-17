/**
 * Main-window side ownership of the mini player OS window.
 *
 * The mini player is a real second window ("mini", serving mini.html) — not an overlay inside
 * the main window. This module opens it on demand, focuses it when asked to open again, and
 * closes it. Playback state flows through the player-layer mini bridge; this file only moves
 * the window itself.
 */

import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize, currentMonitor } from "@tauri-apps/api/window";
import { MINI_WINDOW_LABEL } from "../mini/protocol";
import { logInternalError } from "../internal/logging";

export async function getMiniWindow(): Promise<WebviewWindow | null> {
  try {
    const all = await getAllWebviewWindows();
    return all.find((window) => window.label === MINI_WINDOW_LABEL) ?? null;
  } catch {
    return null;
  }
}

export async function openMiniWindow(): Promise<void> {
  try {
    const existing = await getMiniWindow();
    if (existing) {
      try {
        await existing.setFocus();
      } catch {}
      return;
    }

    const mini = new WebviewWindow(MINI_WINDOW_LABEL, {
      url: "mini.html",
      title: "Amber Mini",
      decorations: false,
      transparent: true,
      shadow: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minWidth: 380,
      minHeight: 82,
      width: 440,
      height: 82,
    });

    // Bottom-right of the current monitor, the corner mini players live in. Best effort:
    // if the monitor cannot be read the window simply opens where the OS puts it.
    try {
      const monitor = await currentMonitor();
      const scale = monitor?.scaleFactor ?? 1;
      const size = monitor?.size;
      if (size) {
        const margin = 24;
        await mini.setPosition(
          new LogicalPosition(
            size.width / scale - 440 - margin,
            size.height / scale - 82 - margin,
          ),
        );
      }
    } catch (error) {
      logInternalError("miniWindow.position failed", error);
    }
  } catch (error) {
    logInternalError("miniWindow.open failed", error);
  }
}

export async function closeMiniWindow(): Promise<void> {
  try {
    const existing = await getMiniWindow();
    await existing?.close();
  } catch (error) {
    logInternalError("miniWindow.close failed", error);
  }
}

export async function setMiniWindowSize(width: number, height: number): Promise<void> {
  try {
    const existing = await getMiniWindow();
    await existing?.setSize(new LogicalSize(width, height));
  } catch {
    // The window resizes itself from the inside; this is only the main side asking.
  }
}
