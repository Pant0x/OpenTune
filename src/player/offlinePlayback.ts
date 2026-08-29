import { readFile } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import { logInternalWarn } from "../internal/logging";

const OFFLINE_DIR = "amber/downloads";

/**
 * Active URL Revocation (RAM Cleanup)
 * Single-item LRU map for URL.createObjectURL(blob).
 * When switching tracks or pausing, revoke previous to free WebView RAM.
 */
const activeObjectUrls = new Map<string, string>();

function trackKey(trackId: string): string {
  return trackId;
}

export function getOfflineBlobUrl(trackId: string): string | undefined {
  return activeObjectUrls.get(trackKey(trackId));
}

/**
 * Reads Uint8Array binary from disk (plugin-fs) and converts to Blob Object URL.
 * Caller must hold revocation responsibility via revokeOfflineBlobUrl.
 */
export async function createOfflineBlobUrl(
  trackId: string,
  mimeType?: string,
): Promise<string> {
  // Revoke previous for same track to avoid duplicate leak on re-create
  revokeOfflineBlobUrl(trackId);

  const fileName = `${trackId}.bin`;
  const data = await readFile(`${OFFLINE_DIR}/${fileName}`, {
    baseDir: BaseDirectory.AppData,
  });

  // data is Uint8Array from plugin-fs
  const blob = new Blob([data as unknown as BlobPart], {
    type: mimeType || "audio/mp4",
  });
  const url = URL.createObjectURL(blob);
  activeObjectUrls.set(trackKey(trackId), url);
  return url;
}

/**
 * Revoke single track's Blob URL. Call on track switch / pause / removeDownload.
 */
export function revokeOfflineBlobUrl(trackId: string): void {
  const key = trackKey(trackId);
  const existing = activeObjectUrls.get(key);
  if (existing) {
    try {
      URL.revokeObjectURL(existing);
    } catch (error) {
      logInternalWarn("offlinePlayback.revoke failed", {
        trackId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    activeObjectUrls.delete(key);
  }
}

/**
 * Revoke all active Blob URLs. Call on app shutdown / clear all.
 */
export function revokeAllOfflineBlobUrls(): void {
  for (const [trackId, url] of activeObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
    void trackId;
  }
  activeObjectUrls.clear();
}

/**
 * Totally number of active Object URLs (for debugging)
 */
export function activeBlobUrlCount(): number {
  return activeObjectUrls.size;
}
