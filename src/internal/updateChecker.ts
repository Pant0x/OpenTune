import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { logInternalError } from "./logging";

const RELEASE_TAG_PREFIX = "v";
const RELEASES_URL = "https://github.com/Pant0x/OpenTune/releases/tag";
const RELEASES_API_URL = "https://api.github.com/repos/Pant0x/OpenTune/releases/latest";
const SNOOZE_PREFIX = "just-another-music-client:update-snooze:";
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  installedVersion: string;
  version: string;
  releaseUrl: string;
  releaseTitle?: string;
  releaseNotes?: string;
  publishedAt?: string;
  canInstall: boolean;
  downloadAssetUrl?: string;
  downloadAssetName?: string;
  downloadAssetSize?: number;
  update?: Update;
}

export interface UpdateInstallProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export async function getInstalledVersion(): Promise<string> {
  return getVersion();
}

function parseVersion(version: string): number[] {
  const clean = version.replace(/^v/, "").split(/[-+]/)[0] ?? "";
  return clean.split(".").map((part) => {
    const num = Number(part);
    return Number.isFinite(num) ? num : 0;
  });
}

function isNewerVersion(installed: string, candidate: string): boolean {
  const installedParts = parseVersion(installed);
  const candidateParts = parseVersion(candidate);
  for (let i = 0; i < Math.max(installedParts.length, candidateParts.length); i++) {
    const a = installedParts[i] ?? 0;
    const b = candidateParts[i] ?? 0;
    if (b > a) return true;
    if (b < a) return false;
  }
  return false;
}

async function checkViaGithubApi(): Promise<UpdateInfo | null> {
  try {
    const installedVersion = await getVersion();
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      html_url?: string;
      assets?: Array<{
        name: string;
        size: number;
        browser_download_url: string;
      }>;
    };
    const tagName = data.tag_name ?? "";
    const latestVersion = tagName.replace(RELEASE_TAG_PREFIX, "");

    if (!latestVersion || !isNewerVersion(installedVersion, latestVersion)) {
      return null;
    }

    const assets = data.assets || [];
    const isWindows =
      typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent || navigator.platform);
    const isMac =
      typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent || navigator.platform);

    let matchedAsset: { name: string; size: number; browser_download_url: string } | undefined;

    if (isWindows) {
      // 1. Setup / installer exe
      // 2. Portable opentune.exe / OpenTune-Windows-portable.exe
      // 3. MSI installer
      matchedAsset =
        assets.find(
          (a) =>
            a.name.toLowerCase().endsWith(".exe") &&
            (a.name.toLowerCase().includes("setup") || a.name.toLowerCase().includes("install")),
        ) ||
        assets.find(
          (a) =>
            a.name.toLowerCase() === "opentune.exe" ||
            a.name.toLowerCase() === "opentune-windows-portable.exe" ||
            a.name.toLowerCase().endsWith(".exe"),
        ) ||
        assets.find((a) => a.name.toLowerCase().endsWith(".msi"));
    } else if (isMac) {
      matchedAsset = assets.find((a) => a.name.toLowerCase().endsWith(".dmg"));
    } else {
      matchedAsset =
        assets.find((a) => a.name.toLowerCase().endsWith(".appimage")) ||
        assets.find((a) => a.name.toLowerCase().endsWith(".deb")) ||
        assets.find((a) => a.name.toLowerCase().endsWith(".rpm"));
    }

    const releaseUrl =
      data.html_url || `${RELEASES_URL}/${encodeURIComponent(tagName || latestVersion)}`;

    return {
      installedVersion,
      version: latestVersion,
      releaseUrl,
      releaseTitle: data.name || `OpenTune ${latestVersion}`,
      releaseNotes: data.body || "",
      publishedAt: data.published_at,
      canInstall: Boolean(matchedAsset),
      downloadAssetUrl: matchedAsset?.browser_download_url,
      downloadAssetName: matchedAsset?.name,
      downloadAssetSize: matchedAsset?.size,
    };
  } catch (error) {
    logInternalError("checkViaGithubApi failed", error);
    return null;
  }
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  // First attempt: Tauri native updater (if valid signed latest.json exists)
  try {
    const tauriUpdate = await check();
    if (tauriUpdate) {
      return {
        installedVersion: tauriUpdate.currentVersion,
        version: tauriUpdate.version,
        releaseUrl: `${RELEASES_URL}/${RELEASE_TAG_PREFIX}${encodeURIComponent(tauriUpdate.version)}`,
        releaseTitle: `OpenTune ${tauriUpdate.version}`,
        releaseNotes: tauriUpdate.body,
        publishedAt: tauriUpdate.date,
        canInstall: true,
        update: tauriUpdate,
      };
    }
  } catch {
    // Normal when latest.json is not present on GitHub release.
    // Gracefully proceed to GitHub Releases API.
  }

  // Second attempt: Direct GitHub Releases API
  return checkViaGithubApi();
}

export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (progress: UpdateInstallProgress) => void,
): Promise<void> {
  // 1. If native Tauri update handle exists:
  if (info.update) {
    let downloadedBytes = 0;
    let totalBytes: number | undefined;

    const reportProgress = (event: DownloadEvent) => {
      if (event.event === "Started") {
        downloadedBytes = 0;
        totalBytes = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
      } else if (event.event === "Finished" && totalBytes !== undefined) {
        downloadedBytes = totalBytes;
      }

      onProgress?.({
        downloadedBytes,
        totalBytes,
        percent:
          totalBytes && totalBytes > 0
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : undefined,
      });
    };

    try {
      await info.update.downloadAndInstall(reportProgress);
      await relaunch();
      return;
    } catch (error) {
      logInternalError("updateChecker.installUpdate (Tauri) failed", error, {
        version: info.version,
      });
      // Fall through to try direct GitHub asset download if available
    }
  }

  // 2. Direct GitHub Asset download and installation via Rust:
  if (info.downloadAssetUrl && info.downloadAssetName) {
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{
        downloadedBytes: number;
        totalBytes?: number;
        percent?: number;
        status: string;
      }>("update-download-progress", (event) => {
        onProgress?.({
          downloadedBytes: event.payload.downloadedBytes,
          totalBytes: event.payload.totalBytes,
          percent: event.payload.percent,
        });
      });

      await invoke("download_and_install_github_update", {
        assetUrl: info.downloadAssetUrl,
        fileName: info.downloadAssetName,
      });
    } catch (error) {
      logInternalError("updateChecker.installUpdate (GitHub direct) failed", error, {
        version: info.version,
      });
      throw error;
    } finally {
      unlisten?.();
    }
    return;
  }

  throw new Error(
    "This update cannot be installed automatically. Please download it from the release page.",
  );
}

export function getUpdateFailureMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.trim();

  if (!message) {
    return "Unable to check for updates. The updater did not return an error message.";
  }

  return `Unable to check for updates: ${message}`;
}

export function isUpdateSnoozed(version: string): boolean {
  const snoozedUntil = Number(localStorage.getItem(`${SNOOZE_PREFIX}${version}`));
  return Number.isFinite(snoozedUntil) && snoozedUntil > Date.now();
}

export function snoozeUpdate(version: string): void {
  localStorage.setItem(
    `${SNOOZE_PREFIX}${version}`,
    String(Date.now() + SNOOZE_DURATION_MS),
  );
}
