import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { Playlist, Track } from "../datasource/types";
import { logInternalInfo, logInternalWarn } from "../internal/logging";
import { tauriFetch } from "../datasource/youtube/tauriFetch";

/** Bumped only on a breaking shape change; import accepts anything it still understands. */
const FORMAT_VERSION = 1;

interface ExportedTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSec?: number;
  /** Present for local files, so a re-import on the same machine keeps working. */
  localPath?: string;
}

interface ExportedPlaylist {
  format: "amber-playlist";
  version: number;
  title: string;
  owner?: string;
  exportedAt: string;
  tracks: ExportedTrack[];
}

function sanitizeFileName(name: string): string {
  /*
   * Replaces only what a filesystem actually rejects.
   *
   * The class is written out member by member on purpose. The obvious `[<>:"/\\|?* -]` reads
   * as "...asterisk, space, dash", but a regex parses `* -` as the *range* 0x2A-0x2D: it
   * quietly matched `+` and `,` and never matched a space at all. Accidental ranges inside a
   * character class are easy to write and invisible once written.
   *
   * Spaces are legal in filenames and kept, since mangling them only makes the suggested name
   * harder to recognise. Trailing dots and spaces go because Windows drops them silently,
   * which would mean the file saved under a different name than the one shown.
   */
  return name
    .replace(/[<>:"?*|\\/\\\\]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    || "playlist";
}

/**
 * Writes a playlist to disk as JSON, or as M3U when that extension is chosen.
 *
 * JSON is the lossless option and the one that round-trips back into Amber, because it keeps
 * the YouTube video ids. M3U is offered because everything else on the machine can read it,
 * but it only carries file paths — so it is useful for local playlists and near-useless for
 * YouTube ones, which is why the caller is told what was actually written.
 */
export async function exportPlaylist(
  playlist: Playlist,
  tracks: Track[],
): Promise<{ path: string; format: "json" | "m3u"; written: number } | null> {
  const path = await saveDialog({
    title: `Export ${playlist.title}`,
    defaultPath: `${sanitizeFileName(playlist.title)}.amber.json`,
    filters: [
      { name: "Amber playlist", extensions: ["json"] },
      { name: "M3U playlist", extensions: ["m3u", "m3u8"] },
    ],
  });
  if (!path) return null;

  const isM3u = /\.m3u8?$/i.test(path);

  if (isM3u) {
    const lines = ["#EXTM3U"];
    let written = 0;
    for (const track of tracks) {
      const target = track.localPath;
      // A YouTube track has no path an external player could open, so it is skipped rather
      // than written as a line that silently fails everywhere else.
      if (!target) continue;
      lines.push(`#EXTINF:${Math.round(track.durationSec ?? -1)},${track.artist} - ${track.title}`);
      lines.push(target);
      written += 1;
    }
    await invoke("write_text_file", { path, contents: `${lines.join("\n")}\n` });
    logInternalInfo("playlistTransfer.export m3u", { written, total: tracks.length });
    return { path, format: "m3u", written };
  }

  const payload: ExportedPlaylist = {
    format: "amber-playlist",
    version: FORMAT_VERSION,
    title: playlist.title,
    owner: playlist.owner,
    exportedAt: new Date().toISOString(),
    tracks: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSec: track.durationSec,
      localPath: track.localPath,
    })),
  };

  await invoke("write_text_file", { path, contents: JSON.stringify(payload, null, 2) });
  logInternalInfo("playlistTransfer.export json", { written: tracks.length });
  return { path, format: "json", written: tracks.length };
}

export interface ImportedPlaylist {
  title: string;
  tracks: Track[];
  artworkUrl?: string;
}

function parseAmberJson(contents: string): ImportedPlaylist | null {
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object") return null;

  const candidate = parsed as Partial<ExportedPlaylist>;
  if (candidate.format !== "amber-playlist" || !Array.isArray(candidate.tracks)) return null;

  const tracks: Track[] = candidate.tracks
    .filter((entry): entry is ExportedTrack => Boolean(entry?.id))
    .map((entry) => ({
      id: entry.id,
      source: entry.localPath ? "local" : "youtube",
      title: entry.title || entry.id,
      artist: entry.artist || "",
      album: entry.album,
      durationSec: entry.durationSec,
      localPath: entry.localPath,
    }) as Track);

  return { title: candidate.title?.trim() || "Imported playlist", tracks };
}

function parseM3u(contents: string, fallbackTitle: string): ImportedPlaylist {
  const tracks: Track[] = [];
  let pendingTitle: string | undefined;
  let pendingArtist: string | undefined;
  let pendingDuration: number | undefined;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      // "#EXTINF:<seconds>,<artist> - <title>"
      const [durationPart, ...rest] = line.slice("#EXTINF:".length).split(",");
      const seconds = Number(durationPart);
      pendingDuration = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
      const label = rest.join(",").trim();
      const dash = label.indexOf(" - ");
      if (dash > 0) {
        pendingArtist = label.slice(0, dash).trim();
        pendingTitle = label.slice(dash + 3).trim();
      } else {
        pendingTitle = label || undefined;
      }
      continue;
    }
    if (line.startsWith("#")) continue;

    tracks.push({
      // M3U carries no ids, so the path is the identity — which is exactly what local
      // playback already uses.
      id: `local:${line}`,
      source: "local",
      title: pendingTitle ?? line.split(/[\\/]/).pop() ?? line,
      artist: pendingArtist ?? "Local files",
      durationSec: pendingDuration,
      localPath: line,
    } as Track);
    pendingTitle = undefined;
    pendingArtist = undefined;
    pendingDuration = undefined;
  }

  return { title: fallbackTitle, tracks };
}

/** Reads a playlist file chosen by the user. Returns null when the dialog is dismissed. */
export async function importPlaylistFile(): Promise<ImportedPlaylist | null> {
  const selected = await openDialog({
    title: "Import playlist",
    multiple: false,
    filters: [
      { name: "Playlists", extensions: ["json", "m3u", "m3u8"] },
    ],
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;

  const contents = await invoke<string>("read_text_file", { path });
  const fileName = path.split(/[\\/]/).pop() ?? "Imported playlist";
  const baseTitle = fileName.replace(/\.(amber\.)?(json|m3u8?)$/i, "");

  if (/\.m3u8?$/i.test(path)) {
    return parseM3u(contents, baseTitle);
  }

  try {
    const parsed = parseAmberJson(contents);
    if (!parsed) throw new Error("unrecognised");
    return parsed;
  } catch {
    throw new Error("That file is not an Amber playlist export.");
  }
}

/**
 * Imports a Spotify playlist or album by public URL without requiring login.
 * Parses the public embed widget metadata and tracks directly.
 */
export async function importSpotifyPlaylist(spotifyUrl: string): Promise<ImportedPlaylist | null> {
  const cleanUrl = spotifyUrl.trim();
  const playlistMatch =
    cleanUrl.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/) ||
    cleanUrl.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  const albumMatch =
    cleanUrl.match(/spotify\.com\/album\/([a-zA-Z0-9]+)/) ||
    cleanUrl.match(/spotify:album:([a-zA-Z0-9]+)/);

  if (!playlistMatch && !albumMatch) {
    throw new Error(
      "Invalid Spotify URL. Expected format: https://open.spotify.com/playlist/... or https://open.spotify.com/album/...",
    );
  }

  const type = playlistMatch ? "playlist" : "album";
  const id = playlistMatch ? playlistMatch[1] : albumMatch![1];
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

  let html: string;
  try {
    const response = await tauriFetch(embedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Spotify embed returned ${response.status}`);
    }
    html = await response.text();
  } catch (error) {
    logInternalWarn("importSpotifyPlaylist fetch error", { error: String(error), embedUrl });
    throw new Error("Unable to connect to Spotify. Please check the playlist URL or your connection.");
  }

  let title = "Spotify Playlist";
  let artworkUrl: string | undefined;
  const tracks: Track[] = [];

  // Try extracting from __NEXT_DATA__ if available
  const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextDataMatch && nextDataMatch[1]) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const entity = nextData.props?.pageProps?.state?.data?.entity;
      if (entity) {
        title = entity.name || entity.title || title;
        artworkUrl = entity.coverArt?.sources?.[0]?.url || entity.visualIdentity?.image?.[0]?.url || entity.images?.[0]?.url;
        const trackList = entity.trackList || entity.tracks || [];
        for (let i = 0; i < trackList.length; i++) {
          const t = trackList[i];
          const trackTitle = t.title || t.name;
          if (!trackTitle) continue;
          const trackArtists = (t.artists || []).map((a: any) => (typeof a === "string" ? a : a.name)).filter(Boolean).join(", ") || t.subtitle || "Unknown artist";
          const durationSec = typeof t.duration === "number" ? Math.round(t.duration / 1000) : typeof t.durationMs === "number" ? Math.round(t.durationMs / 1000) : undefined;
          tracks.push({
            id: `spotify:${t.id || t.uri || i}`,
            source: "spotify",
            title: trackTitle,
            artist: trackArtists,
            album: title,
            durationSec,
            artworkUrl,
            artists: (t.artists || []).map((a: any) => ({
              id: typeof a === "object" ? a.id ?? "" : "",
              name: typeof a === "string" ? a : a.name ?? "",
            })),
          });
        }
      }
    } catch {
      // Fallback to HTML DOM parsing
    }
  }

  // Fallback / standard HTML parsing
  if (tracks.length === 0) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract title
    const titleEl = doc.querySelector("[data-encore-id='text'].CondensedMetadata_title__FRgOV, .CondensedMetadata_condensedMetadataContainer__egWwQ, title");
    if (titleEl && titleEl.textContent) {
      const text = titleEl.textContent.trim().replace(/\s*·\s*Spotify\s*$/i, "").trim();
      if (text) title = text;
    }

    // Extract cover image
    const imgEl = doc.querySelector("img[alt*='cover'], img[data-encore-id='image']");
    if (imgEl) {
      const src = imgEl.getAttribute("src");
      if (src && src.startsWith("http")) artworkUrl = src;
    }

    // Extract tracklist rows
    const rows = doc.querySelectorAll("[data-testid^='tracklist-row-'], li.TracklistRow_trackListRow__vrAAd");
    if (rows.length > 0) {
      rows.forEach((row, index) => {
        const rowTitleEl = row.querySelector("[data-encore-id='text'].TracklistRow_title__1RtS6, h3, [dir='auto']");
        const rowArtistEl = row.querySelector("[data-encore-id='text'].TracklistRow_subtitle___DhJK, h4");
        const rowDurationEl = row.querySelector("[data-testid='duration-cell'], .TracklistRow_durationCell__CUhMO");

        const trackTitle = rowTitleEl?.textContent?.trim() || "";
        const trackArtist = rowArtistEl?.textContent?.trim().replace(/^E\s*/, "") || "Unknown artist";
        let durationSec: number | undefined;

        if (rowDurationEl?.textContent) {
          const parts = rowDurationEl.textContent.trim().split(":").map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            durationSec = parts[0] * 60 + parts[1];
          } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
        }

        if (trackTitle) {
          tracks.push({
            id: `spotify:${id}_${index}`,
            source: "spotify",
            title: trackTitle,
            artist: trackArtist,
            album: title,
            durationSec,
            artworkUrl,
            artists: trackArtist
              .split(/,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+/i)
              .map((name) => name.trim())
              .filter(Boolean)
              .map((name) => ({ id: "", name })),
          });
        }
      });
    }
  }

  if (tracks.length === 0) {
    throw new Error("No playable tracks found in this Spotify link. Please ensure the link is public.");
  }

  logInternalInfo("playlistTransfer.importSpotify success", {
    id,
    type,
    title,
    trackCount: tracks.length,
    hasArtwork: Boolean(artworkUrl),
  });

  return { title, tracks, artworkUrl };
}

/**
 * Pure parsing internals, exposed for the self-check.
 *
 * Kept behind one deliberately awkward name so it reads as a test seam rather than as API —
 * the dialog and file I/O around these are Tauri calls that cannot run under node.
 */
export const __parseForTest = { parseAmberJson, parseM3u, sanitizeFileName };
