import { useSyncExternalStore } from "react";
import {
  BaseDirectory,
  readDir,
  writeFile,
  remove,
  mkdir,
  exists,
  stat,
} from "@tauri-apps/plugin-fs";
import type { Track } from "../datasource/types";
import { logInternalError, logInternalInfo, logInternalWarn } from "../internal/logging";
import { getAppSetting, setAppSetting } from "../internal/appSettings";
import { getDownloadQuality, type AudioQuality } from "../internal/audioQuality";
import { tauriFetch } from "../datasource/youtube/tauriFetch";
import { revokeOfflineBlobUrl } from "./offlinePlayback";

const MANIFEST_KEY = "amber.offline-manifest.v1";
const MAX_BYTES_KEY = "amber.offline-max-bytes.v1";
const OFFLINE_DIR = "amber/downloads";
const CHUNK_BYTES = 4 * 1024 * 1024; // 4 MiB per spec

/** Default ceiling for downloaded audio. Roughly 1,500 songs at typical bitrates. */
export const DEFAULT_OFFLINE_MAX_BYTES = 8 * 1024 * 1024 * 1024;

const DOWNLOAD_CONCURRENCY = 1;

export type OfflineStatus = "absent" | "queued" | "downloading" | "ready" | "failed";

export interface OfflineEntry {
  track: Track;
  byteLength: number;
  downloadedAt: number;
}

export interface OfflineState {
  entries: Record<string, OfflineEntry>;
  progress: number | null;
  queued: string[];
  pending: Record<string, Track>;
  downloadingId: string | null;
  failed: Record<string, string>;
  usedBytes: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: OfflineState = {
  entries: {},
  progress: null,
  pending: {},
  queued: [],
  downloadingId: null,
  failed: {},
  usedBytes: 0,
};
let hydrated = false;
let pumping = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function asManifest(parsed: unknown): Record<string, OfflineEntry> | null {
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, OfflineEntry>)
    : null;
}

function readManifest(): Record<string, OfflineEntry> {
  try {
    return asManifest(JSON.parse(localStorage.getItem(MANIFEST_KEY) ?? "{}")) ?? {};
  } catch {
    return {};
  }
}

async function readDurableManifest(): Promise<Record<string, OfflineEntry>> {
  return asManifest(await getAppSetting<unknown>(MANIFEST_KEY)) ?? {};
}

function writeManifest(entries: Record<string, OfflineEntry>): void {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries));
  } catch (error) {
    logInternalWarn("offlineStore.writeManifest failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  void setAppSetting(MANIFEST_KEY, entries);
}

function setState(next: Partial<OfflineState>): void {
  state = { ...state, ...next };
  emit();
}

function commitEntries(entries: Record<string, OfflineEntry>): void {
  writeManifest(entries);
  setState({
    entries,
    usedBytes: Object.values(entries).reduce((total, entry) => total + entry.byteLength, 0),
  });
}

export function getOfflineMaxBytes(): number {
  const raw = Number(localStorage.getItem(MAX_BYTES_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OFFLINE_MAX_BYTES;
}

export function setOfflineMaxBytes(maxBytes: number): void {
  localStorage.setItem(MAX_BYTES_KEY, String(Math.max(0, maxBytes)));
  void prune();
}

async function ensureOfflineDir(): Promise<void> {
  try {
    if (!(await exists(OFFLINE_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(OFFLINE_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {}
}

async function listOnDisk(): Promise<Array<{ trackId: string; byteLength: number }>> {
  try {
    await ensureOfflineDir();
    const entries = await readDir(OFFLINE_DIR, { baseDir: BaseDirectory.AppData });
    const result: Array<{ trackId: string; byteLength: number }> = [];
    for (const entry of entries) {
      if (!entry.name?.endsWith(".bin")) continue;
      const trackId = entry.name.slice(0, -4);
      try {
        const meta = await stat(`${OFFLINE_DIR}/${entry.name}`, {
          baseDir: BaseDirectory.AppData,
        });
        result.push({ trackId, byteLength: meta.size ?? 0 });
      } catch {
        result.push({ trackId, byteLength: 0 });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export function reconcileManifest(
  manifest: Record<string, OfflineEntry>,
  onDisk: ReadonlyArray<{ trackId: string; byteLength: number }>,
): { entries: Record<string, OfflineEntry>; orphans: string[] } {
  const byId = new Map(onDisk.map((entry) => [entry.trackId, entry.byteLength]));
  const entries: Record<string, OfflineEntry> = {};

  for (const [trackId, entry] of Object.entries(manifest)) {
    const byteLength = byId.get(trackId);
    if (byteLength === undefined) continue;
    entries[trackId] = { ...entry, byteLength };
  }

  const orphans =
    Object.keys(manifest).length === 0
      ? []
      : [...byId.keys()].filter((trackId) => !entries[trackId]);
  return { entries, orphans };
}

export async function hydrateOfflineStore(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  const manifest = { ...(await readDurableManifest()), ...readManifest() };
  try {
    const onDisk = await listOnDisk();
    const { entries, orphans } = reconcileManifest(manifest, onDisk);
    for (const trackId of orphans) {
      try {
        await remove(`${OFFLINE_DIR}/${trackId}.bin`, {
          baseDir: BaseDirectory.AppData,
        });
      } catch {}
    }

    commitEntries(entries);
    logInternalInfo("offlineStore.hydrate", { count: Object.keys(entries).length });
  } catch (error) {
    logInternalWarn("offlineStore.hydrate failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    commitEntries(manifest);
  }
}

/**
 * No Rust progress events - progress is updated locally during chunk assembly.
 * Keep feed as no-op for compatibility, or optionally emit synthetic progress.
 */
export function startOfflineProgressFeed(): void {
  // Progress now driven directly in pump() via setState({progress})
}

export function getOfflineStatus(trackId: string): OfflineStatus {
  if (state.entries[trackId]) return "ready";
  if (state.downloadingId === trackId) return "downloading";
  if (state.queued.includes(trackId)) return "queued";
  if (state.failed[trackId]) return "failed";
  return "absent";
}

export function isTrackDownloaded(trackId: string): boolean {
  return Boolean(state.entries[trackId]);
}

export function getOfflineTrack(trackId: string): Track | undefined {
  return state.entries[trackId]?.track;
}

type StreamUrlResolver = (
  track: Track,
  quality: AudioQuality,
) => Promise<{ url: string; mimeType: string; cookie?: string }>;

let resolveStreamUrl: StreamUrlResolver | null = null;

export function setOfflineStreamResolver(resolver: StreamUrlResolver): void {
  resolveStreamUrl = resolver;
}

export function queueDownload(track: Track): void {
  if (track.source === "local") return;
  if (state.entries[track.id] || state.queued.includes(track.id)) return;
  if (state.downloadingId === track.id) return;

  const { [track.id]: _cleared, ...failed } = state.failed;
  setState({
    queued: [...state.queued, track.id],
    pending: { ...state.pending, [track.id]: track },
    failed,
  });
  pendingTracks.set(track.id, track);
  void pump();
}

export function queueDownloads(tracks: Track[]): void {
  for (const track of tracks) queueDownload(track);
}

export function cancelDownload(trackId: string): void {
  pendingTracks.delete(trackId);
  const { [trackId]: _dropped, ...pending } = state.pending;
  setState({ queued: state.queued.filter((id) => id !== trackId), pending });
}

export async function removeDownload(trackId: string): Promise<void> {
  cancelDownload(trackId);
  revokeOfflineBlobUrl(trackId);
  try {
    await remove(`${OFFLINE_DIR}/${trackId}.bin`, {
      baseDir: BaseDirectory.AppData,
    });
  } catch (error) {
    logInternalWarn("offlineStore.remove failed", {
      trackId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const { [trackId]: _removed, ...entries } = state.entries;
  commitEntries(entries);
}

export async function removeAllDownloads(): Promise<void> {
  const ids = Object.keys(state.entries);
  setState({ queued: [], pending: {}, failed: {} });
  pendingTracks.clear();
  for (const trackId of ids) {
    revokeOfflineBlobUrl(trackId);
    try {
      await remove(`${OFFLINE_DIR}/${trackId}.bin`, {
        baseDir: BaseDirectory.AppData,
      });
    } catch {}
  }
  commitEntries({});
}

const pendingTracks = new Map<string, Track>();

/**
 * Chunk Assembly: allocate single target Uint8Array(totalBytes) and .set(chunkBytes, offset)
 * Faster and less memory than repeated concatenation.
 */
async function downloadToFile(
  url: string,
  trackId: string,
): Promise<{ totalBytes: number }> {
  await ensureOfflineDir();

  // Try to get total size via HEAD or first chunk content-range
  // Fallback: fetch whole file if range not supported
  const headRes = await tauriFetch(url, { method: "HEAD" }).catch(() => null);
  let totalBytes: number | null = null;
  const clen = headRes?.headers.get("content-length") ?? headRes?.headers.get("Content-Length");
  if (clen) totalBytes = Number(clen);
  // Also try to parse clen from URL (?clen=) as fallback
  if (!totalBytes || !Number.isFinite(totalBytes)) {
    try {
      const u = new URL(url);
      const c = u.searchParams.get("clen");
      if (c) totalBytes = Number(c);
    } catch {}
  }

  // If no total, fetch whole file as single blob
  if (!totalBytes || totalBytes <= 0) {
    const res = await tauriFetch(url);
    if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    await writeFile(`${OFFLINE_DIR}/${trackId}.bin`, buf, {
      baseDir: BaseDirectory.AppData,
    });
    return { totalBytes: buf.byteLength };
  }

  // Chunked download with single allocation
  const total = totalBytes;
  const target = new Uint8Array(total);
  let offset = 0;
  let received = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_BYTES - 1, total - 1);
    const res = await tauriFetch(url, {
      headers: { Range: `bytes=${offset}-${end}` },
    });
    // Some servers ignore Range and return 200 with full body on first chunk - handle
    if (res.status === 200 && offset === 0 && total > CHUNK_BYTES) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === total) {
        await writeFile(`${OFFLINE_DIR}/${trackId}.bin`, buf, {
          baseDir: BaseDirectory.AppData,
        });
        return { totalBytes: total };
      }
    }
    if (!res.ok && res.status !== 206) {
      throw new Error(`Chunk ${offset}-${end} failed HTTP ${res.status}`);
    }
    const chunk = new Uint8Array(await res.arrayBuffer());
    target.set(chunk, offset);
    offset += chunk.byteLength;
    received += chunk.byteLength;
    const percent = Math.round((received / total) * 100);
    setState({ progress: percent });
    // Handle short chunk (EOF)
    if (chunk.byteLength === 0) break;
  }

  await writeFile(`${OFFLINE_DIR}/${trackId}.bin`, target, {
    baseDir: BaseDirectory.AppData,
  });
  return { totalBytes: total };
}

async function pump(): Promise<void> {
  if (!pumping && state.downloadingId !== null) {
    logInternalWarn("offlineStore.pump clearing stale download", {
      trackId: state.downloadingId,
    });
    setState({ downloadingId: null, progress: null });
  }

  if (pumping || state.downloadingId !== null) return;
  if (state.queued.length === 0) return;
  if (!resolveStreamUrl) {
    logInternalWarn("offlineStore.pump has no stream resolver");
    return;
  }

  pumping = true;
  try {
    while (state.queued.length > 0) {
      const [trackId, ...rest] = state.queued;
      const track = pendingTracks.get(trackId);
      setState({ queued: rest, downloadingId: trackId, progress: 0 });

      if (!track) {
        setState({ downloadingId: null, progress: null });
        continue;
      }

      try {
        logInternalInfo("offlineStore.download start", { trackId, title: track.title });
        const { url, mimeType } = await resolveStreamUrl(track, getDownloadQuality());
        const { totalBytes } = await downloadToFile(url, trackId);
        logInternalInfo("offlineStore.download complete", { trackId, byteLength: totalBytes });
        pendingTracks.delete(trackId);
        {
          const { [trackId]: _done, ...pending } = state.pending;
          setState({ pending });
        }
        commitEntries({
          ...state.entries,
          [trackId]: { track: { ...track, mimeType }, byteLength: totalBytes, downloadedAt: Date.now() },
        });
        setState({ downloadingId: null, progress: null });
        await prune();
      } catch (error) {
        // Remove partial file on failure
        try {
          await remove(`${OFFLINE_DIR}/${trackId}.bin`, {
            baseDir: BaseDirectory.AppData,
          });
        } catch {}
        pendingTracks.delete(trackId);
        const { [trackId]: _failed, ...pending } = state.pending;
        const message = error instanceof Error ? error.message : String(error);
        logInternalError("offlineStore.download failed", error, { trackId });
        setState({
          downloadingId: null,
          progress: null,
          pending,
          failed: { ...state.failed, [trackId]: message },
        });
      }
    }
  } finally {
    pumping = false;
    if (DOWNLOAD_CONCURRENCY > 1 && state.queued.length > 0) void pump();
  }
}

async function prune(): Promise<void> {
  const maxBytes = getOfflineMaxBytes();
  if (state.usedBytes <= maxBytes) return;

  try {
    // Sort by downloadedAt (oldest first)
    const sorted = Object.entries(state.entries).sort(
      (a, b) => a[1].downloadedAt - b[1].downloadedAt,
    );
    let used = state.usedBytes;
    const kept = new Set(Object.keys(state.entries));
    for (const [trackId, entry] of sorted) {
      if (used <= maxBytes) break;
      try {
        await remove(`${OFFLINE_DIR}/${trackId}.bin`, {
          baseDir: BaseDirectory.AppData,
        });
        revokeOfflineBlobUrl(trackId);
      } catch {}
      kept.delete(trackId);
      used -= entry.byteLength;
    }
    const entries = Object.fromEntries(
      Object.entries(state.entries).filter(([trackId]) => kept.has(trackId)),
    );
    commitEntries(entries);
  } catch (error) {
    logInternalWarn("offlineStore.prune failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOfflineState(): OfflineState {
  return state;
}

export function useOfflineState(): OfflineState {
  return useSyncExternalStore(subscribe, getOfflineState, getOfflineState);
}
