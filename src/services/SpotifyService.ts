import { useEffect, useState } from "react";
import { logInternalError, logInternalInfo, logInternalWarn } from "../internal/logging";
import { tauriFetch } from "../datasource/youtube/tauriFetch";

export interface SpotifyTopCity {
  city: string;
  country: string;
  numberOfListeners: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  playcount: string;
  isExplicit: boolean;
  durationMs: number;
  artists: string[];
  coverUrl?: string;
  uri: string;
}

export interface SpotifyExternalLink {
  name: string;
  url: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  uri: string;
  ownerName?: string;
}

export interface SpotifyArtistOverview {
  uri: string;
  spotifyId: string;
  name: string;
  monthlyListeners: number;
  followers: number;
  worldRank?: number;
  bio?: string;
  cleanBio?: string;
  avatarUrl?: string;
  headerUrl?: string;
  galleryUrls: string[];
  instagramUrl?: string;
  externalLinks: SpotifyExternalLink[];
  topCities: SpotifyTopCity[];
  topTracks: SpotifyTrack[];
}

export interface SpotifyRelease {
  id: string;
  name: string;
  type: "album" | "single" | "ep";
  year?: number;
  date?: string;
  coverUrl?: string;
  trackCount: number;
  uri: string;
}

export interface SpotifyAlbumTrack {
  id: string;
  title: string;
  artist?: string;
  durationMs: number;
  isExplicit: boolean;
}

export interface SpotifyAlbumMetadata {
  id: string;
  name: string;
  type: "album" | "single" | "ep";
  releaseDate?: string;
  formattedReleaseDate?: string;
  copyrights: string[];
  trackCount: number;
  tracks: SpotifyAlbumTrack[];
}

/**
 * Sanitizes Spotify's raw biography text, stripping <a href="spotify:..."> tags
 * while preserving clean artist names and removing raw HTML.
 */
export function sanitizeSpotifyBio(rawHtml?: string): string {
  if (!rawHtml) return "";
  return rawHtml
    .replace(/<a\s+[^>]*href=["'][^"']*["'][^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/gi, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Generates open.spotify.com URLs for tracks, artists, albums, or playlists
 * that automatically generate rich playable embed cards in Discord/WhatsApp/Telegram.
 */
export function getSpotifyShareUrl(type: "track" | "artist" | "album" | "playlist", idOrUri: string): string {
  const cleanId = idOrUri.replace(/^spotify:(track|artist|album|playlist):/, "");
  return `https://open.spotify.com/${type}/${cleanId}`;
}

/**
 * Returns the highest-resolution image URL from a Spotify sources array.
 */
export function getHighestResSource(sources?: Array<{ url?: string; width?: number; height?: number }>): string | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  const valid = sources.filter((s): s is { url: string; width?: number; height?: number } => typeof s?.url === "string" && s.url.length > 0);
  if (valid.length === 0) return undefined;
  const sorted = [...valid].sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)));
  return sorted[0]?.url;
}

const SPOTIFY_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query";

const QUERY_HASHES = {
  searchDesktop: "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0",
  queryArtistOverview: "ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a",
  queryArtistDiscographyAll: "5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599",
};

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  // Use tauriFetch in desktop environment to bypass browser CORS completely
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

class SpotifyServiceManager {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string | null> | null = null;

  private artistOverviewCache = new Map<string, { data: SpotifyArtistOverview; timestamp: number }>();
  private discographyCache = new Map<string, { data: SpotifyRelease[]; timestamp: number }>();
  private playlistCache = new Map<string, { data: SpotifyPlaylist[]; timestamp: number }>();

  constructor() {
    if (typeof localStorage !== "undefined") {
      try {
        const savedToken = localStorage.getItem("spotify_anon_token_v2");
        const exp = Number(localStorage.getItem("spotify_anon_token_exp_v2") || 0);
        if (savedToken && exp > Date.now() + 60_000) {
          this.accessToken = savedToken;
          this.tokenExpiresAt = exp;
        }
      } catch {}
    }
  }

  /**
   * Fetches an anonymous client access token from open.spotify.com embed page.
   * Zero authentication/login required.
   */
  async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    this.tokenPromise = (async () => {
      try {
        const response = await safeFetch("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          throw new Error(`Spotify embed returned HTTP ${response.status}`);
        }

        const html = await response.text();
        const tokenMatch = html.match(/"accessToken":"([^"]+)"/);
        const expMatch = html.match(/"accessTokenExpirationTimestampMs":([0-9]+)/);

        if (!tokenMatch) {
          throw new Error("Could not extract Spotify accessToken from embed page");
        }

        const token = tokenMatch[1];
        const expiresAt = expMatch ? Number(expMatch[1]) : (Date.now() + 3500 * 1000);

        this.accessToken = token;
        this.tokenExpiresAt = expiresAt;
        try {
          localStorage.setItem("spotify_anon_token_v2", token);
          localStorage.setItem("spotify_anon_token_exp_v2", String(expiresAt));
        } catch {}
        logInternalInfo("SpotifyService: Acquired anonymous access token successfully");
        return token;
      } catch (err) {
        logInternalError("SpotifyService: Failed to acquire anonymous access token", err);
        return null;
      } finally {
        this.tokenPromise = null;
      }
    })();

    return this.tokenPromise;
  }

  private async callPathfinder<T>(operationName: string, queryHash: string, variables: Record<string, unknown>): Promise<T | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const url = new URL(SPOTIFY_PATHFINDER_URL);
      url.searchParams.set("operationName", operationName);
      url.searchParams.set(
        "extensions",
        JSON.stringify({
          persistedQuery: {
            version: 1,
            sha256Hash: queryHash,
          },
        }),
      );
      url.searchParams.set("variables", JSON.stringify(variables));

      const response = await safeFetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          "app-platform": "WebPlayer",
          "content-type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.accessToken = null;
          this.tokenExpiresAt = 0;
        }
        logInternalWarn(`SpotifyService: ${operationName} returned HTTP ${response.status}`);
        return null;
      }

      return (await response.json()) as T;
    } catch (err) {
      logInternalError(`SpotifyService: ${operationName} failed`, err);
      return null;
    }
  }

  /**
   * Search for an artist by name and return Spotify artist URI.
   */
  async searchArtistUri(artistName: string): Promise<string | null> {
    const cleanName = artistName.trim().toLowerCase();
    if (!cleanName) return null;

    const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
      searchTerm: artistName,
      offset: 0,
      limit: 5,
      numberOfTopResults: 5,
      includeAudiobooks: false,
    });

    const artists = result?.data?.searchV2?.artists?.items;
    if (Array.isArray(artists) && artists.length > 0) {
      const cleanSimp = cleanName.replace(/[^a-z0-9\u0600-\u06FF]/gi, "");

      // 1. Exact match (case-insensitive)
      const exactMatch = artists.find((a: any) => {
        const aName = a?.data?.profile?.name?.toLowerCase()?.trim();
        return aName === cleanName;
      });
      if (exactMatch) return exactMatch?.data?.uri || null;

      // 2. Simplified match (ignoring hyphens, punctuation, spaces, e.g. "lege-cy" == "legecy")
      const simpMatch = artists.find((a: any) => {
        const aName = a?.data?.profile?.name || "";
        const aSimp = aName.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/gi, "");
        return aSimp && aSimp === cleanSimp;
      });
      if (simpMatch) return simpMatch?.data?.uri || null;

      // 3. Close alias (e.g. "The Weeknd" vs "Weeknd") - must be closely related
      const closeMatch = artists.find((a: any) => {
        const aName = (a?.data?.profile?.name || "").toLowerCase().trim();
        const aSimp = aName.replace(/[^a-z0-9\u0600-\u06FF]/gi, "");
        const stripThe = (s: string) => s.replace(/^the\s+/, "");
        return stripThe(aName) === stripThe(cleanName)
          || (aSimp.length >= 6 && cleanSimp.length >= 6 && (aSimp.startsWith(cleanSimp) || cleanSimp.startsWith(aSimp)));
      });
      if (closeMatch) return closeMatch?.data?.uri || null;

      return null;
    }
    return null;
  }

  /**
   * Fast avatar resolver that returns Spotify artist avatar URL or null.
   */
  async getArtistAvatar(artistName: string): Promise<string | null> {
    const overview = await this.getArtistOverview(artistName).catch(() => null);
    return overview?.avatarUrl || null;
  }

  /**
   * Search for an album by title and artist, returns open.spotify.com album URL if matched.
   */
  async searchAlbumUrl(title: string, artist: string): Promise<string | null> {
    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: `${title} ${artist}`,
        offset: 0,
        limit: 5,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });
      const albums = result?.data?.searchV2?.albumsV2?.items ?? result?.data?.searchV2?.albums?.items;
      if (Array.isArray(albums) && albums.length > 0) {
        const match = albums[0];
        const uri = match?.data?.uri || match?.uri;
        if (uri && uri.startsWith("spotify:album:")) {
          return `https://open.spotify.com/album/${uri.replace("spotify:album:", "")}`;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Search for a track by title and artist, returns open.spotify.com track URL if matched.
   */
  async searchTrackUrl(title: string, artist: string): Promise<string | null> {
    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: `${title} ${artist}`,
        offset: 0,
        limit: 5,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });
      const tracks = result?.data?.searchV2?.tracksV2?.items ?? result?.data?.searchV2?.tracks?.items;
      if (Array.isArray(tracks) && tracks.length > 0) {
        const match = tracks[0];
        const uri = match?.item?.data?.uri || match?.data?.uri || match?.uri;
        if (uri && uri.startsWith("spotify:track:")) {
          return `https://open.spotify.com/track/${uri.replace("spotify:track:", "")}`;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Search for an artist by name, returns open.spotify.com artist URL if matched.
   */
  async searchArtistUrl(name: string): Promise<string | null> {
    try {
      const uri = await this.searchArtistUri(name);
      if (uri && uri.startsWith("spotify:artist:")) {
        return `https://open.spotify.com/artist/${uri.replace("spotify:artist:", "")}`;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Search for a playlist by title, returns open.spotify.com playlist URL if matched.
   */
  async searchPlaylistUrl(title: string): Promise<string | null> {
    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: title,
        offset: 0,
        limit: 5,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });
      const playlists = result?.data?.searchV2?.playlists?.items;
      if (Array.isArray(playlists) && playlists.length > 0) {
        const match = playlists[0];
        const uri = match?.data?.uri;
        if (uri && uri.startsWith("spotify:playlist:")) {
          return `https://open.spotify.com/playlist/${uri.replace("spotify:playlist:", "")}`;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Resolves a fast Spotify sharable link for tracks, albums, artists, or playlists with a 1.5s timeout,
   * falling back automatically to the provided fallback URL (e.g. YouTube Music).
   */
  async getSharableLink(entity: {
    type: "track" | "album" | "artist" | "playlist";
    title: string;
    artist?: string;
    id?: string;
    fallbackUrl?: string;
  }): Promise<string> {
    const fallback = entity.fallbackUrl
      || (entity.type === "track" && entity.id ? `https://music.youtube.com/watch?v=${entity.id}` : undefined)
      || (entity.type === "album" && entity.id ? `https://music.youtube.com/browse/${entity.id}` : undefined)
      || (entity.type === "artist" && entity.id ? `https://music.youtube.com/channel/${entity.id}` : undefined)
      || (entity.type === "playlist" && entity.id ? `https://music.youtube.com/playlist?list=${entity.id.replace(/^VL/, "")}` : undefined)
      || "https://music.youtube.com";

    const spotifyPromise = (async () => {
      switch (entity.type) {
        case "track":
          return this.searchTrackUrl(entity.title, entity.artist || "");
        case "album":
          return this.searchAlbumUrl(entity.title, entity.artist || "");
        case "artist":
          return this.searchArtistUrl(entity.title);
        case "playlist":
          return this.searchPlaylistUrl(entity.title);
      }
    })();

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    try {
      const spotifyUrl = await Promise.race([spotifyPromise, timeoutPromise]);
      if (spotifyUrl) return spotifyUrl;
    } catch {}
    return fallback;
  }

  /**
   * Fetches artist monthly listeners, followers, bio, top cities, avatar, gallery, and top tracks.
   */
  async getArtistOverview(artistNameOrUri: string): Promise<SpotifyArtistOverview | null> {
    const cacheKey = artistNameOrUri.toLowerCase();
    const inMem = this.artistOverviewCache.get(cacheKey);
    if (inMem && Date.now() - inMem.timestamp < 3600_000 * 24) {
      return inMem.data;
    }

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(`sp_ov_${cacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Date.now() - parsed.timestamp < 3600_000 * 72) {
            this.artistOverviewCache.set(cacheKey, parsed);
            return parsed.data;
          }
        }
      } catch {}
    }

    let uri = artistNameOrUri;
    if (!uri.startsWith("spotify:artist:")) {
      const foundUri = await this.searchArtistUri(artistNameOrUri);
      if (!foundUri) return null;
      uri = foundUri;
    }

    const result = await this.callPathfinder<any>("queryArtistOverview", QUERY_HASHES.queryArtistOverview, {
      uri,
      locale: "",
    });

    const union = result?.data?.artistUnion;
    if (!union) return null;

    const stats = union.stats || {};
    const profile = union.profile || {};
    const visuals = union.visuals || {};

    const topCities: SpotifyTopCity[] = Array.isArray(stats.topCities?.items)
      ? stats.topCities.items.map((item: any) => ({
          city: item.city || "",
          country: item.country || "",
          numberOfListeners: Number(item.numberOfListeners) || 0,
        }))
      : [];

    const galleryUrls: string[] = Array.isArray(visuals.gallery?.items)
      ? visuals.gallery.items
          .map((item: any) => getHighestResSource(item.sources))
          .filter((url: any): url is string => typeof url === "string")
      : [];

    const topTracks: SpotifyTrack[] = Array.isArray(union.discography?.topTracks?.items)
      ? union.discography.topTracks.items.map((item: any) => {
          const track = item.track || {};
          return {
            id: track.id || "",
            name: track.name || "",
            playcount: track.playcount ? Number(track.playcount).toLocaleString() : "",
            isExplicit: track.contentRating?.label === "EXPLICIT",
            durationMs: track.duration?.totalMilliseconds || 0,
            artists: Array.isArray(track.artists?.items)
              ? track.artists.items.map((a: any) => a.profile?.name || "").filter(Boolean)
              : [],
            coverUrl: getHighestResSource(track.albumOfTrack?.coverArt?.sources) || track.albumOfTrack?.coverArt?.sources?.[0]?.url,
            uri: track.uri || "",
          };
        })
      : [];

    const externalLinks: SpotifyExternalLink[] = Array.isArray(profile.externalLinks?.items)
      ? profile.externalLinks.items
          .map((item: any) => ({
            name: (item.name || "").trim().toUpperCase(),
            url: item.url || "",
          }))
          .filter((link: any) => link.url && link.name)
      : [];

    const instagramItem = externalLinks.find((link) => link.name === "INSTAGRAM");
    const rawBio = profile.biography?.text;
    const cleanBio = sanitizeSpotifyBio(rawBio);
    const spotifyId = uri.replace("spotify:artist:", "");

    const overview: SpotifyArtistOverview = {
      uri,
      spotifyId,
      name: profile.name || "",
      monthlyListeners: Number(stats.monthlyListeners) || 0,
      followers: Number(stats.followers) || 0,
      worldRank: Number(stats.worldRank) || undefined,
      bio: rawBio || undefined,
      cleanBio: cleanBio || undefined,
      avatarUrl: getHighestResSource(visuals.avatarImage?.sources) || undefined,
      headerUrl: getHighestResSource(visuals.headerImage?.sources) || getHighestResSource(visuals.gallery?.items?.[0]?.sources) || galleryUrls[0] || undefined,
      galleryUrls,
      instagramUrl: instagramItem?.url || undefined,
      externalLinks,
      topCities,
      topTracks,
    };

    this.artistOverviewCache.set(artistNameOrUri.toLowerCase(), { data: overview, timestamp: Date.now() });
    this.artistOverviewCache.set(uri.toLowerCase(), { data: overview, timestamp: Date.now() });
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(`sp_ov_${cacheKey}`, JSON.stringify({ data: overview, timestamp: Date.now() }));
        localStorage.setItem(`sp_ov_${uri.toLowerCase()}`, JSON.stringify({ data: overview, timestamp: Date.now() }));
      } catch {}
    }
    return overview;
  }

  /**
   * Fetches official artist playlists (e.g. "This Is [Artist]", "[Artist] Radio") from Spotify.
   */
  async getArtistPlaylists(artistName: string): Promise<SpotifyPlaylist[]> {
    const cleanName = artistName.trim();
    if (!cleanName) return [];
    const cached = this.playlistCache.get(cleanName.toLowerCase());
    if (cached && Date.now() - cached.timestamp < 3600_000) {
      return cached.data;
    }

    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: `This Is ${cleanName}`,
        offset: 0,
        limit: 8,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });

      const playlistItems = result?.data?.searchV2?.playlists?.items;
      if (!Array.isArray(playlistItems)) return [];

      const playlists: SpotifyPlaylist[] = [];
      for (const item of playlistItems) {
        const data = item?.data;
        if (!data) continue;
        const name = data.name || "";
        const uri = data.uri || "";
        const id = uri.replace("spotify:playlist:", "");
        const coverUrl = data.images?.items?.[0]?.sources?.[0]?.url;
        playlists.push({
          id: id || uri,
          name,
          description: data.description || "",
          coverUrl,
          uri: uri || `spotify:playlist:${id}`,
          ownerName: data.ownerV2?.data?.name || "Spotify",
        });
      }

      this.playlistCache.set(cleanName.toLowerCase(), { data: playlists, timestamp: Date.now() });
      return playlists;
    } catch (err) {
      logInternalError("SpotifyService.getArtistPlaylists failed", err);
      return [];
    }
  }

  /**
   * Fetches artist discography (albums, singles, eps) from Spotify.
   */
  async getArtistDiscography(artistNameOrUri: string): Promise<SpotifyRelease[]> {
    const cacheKey = artistNameOrUri.toLowerCase();
    const cached = this.discographyCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 3600_000 * 24) {
      return cached.data;
    }

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(`sp_disc_${cacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Date.now() - parsed.timestamp < 3600_000 * 72) {
            this.discographyCache.set(cacheKey, parsed);
            return parsed.data;
          }
        }
      } catch {}
    }

    let uri = artistNameOrUri;
    if (!uri.startsWith("spotify:artist:")) {
      const foundUri = await this.searchArtistUri(artistNameOrUri);
      if (!foundUri) return [];
      uri = foundUri;
    }

    const result = await this.callPathfinder<any>("queryArtistDiscographyAll", QUERY_HASHES.queryArtistDiscographyAll, {
      uri,
      offset: 0,
      limit: 100,
    });

    const items = result?.data?.artistUnion?.discography?.all?.items;
    if (!Array.isArray(items)) return [];

    const releases: SpotifyRelease[] = [];
    for (const group of items) {
      const release = group?.releases?.items?.[0];
      if (!release) continue;

      const rawType = (release.type || "").toUpperCase();
      let type: "album" | "single" | "ep" = "album";
      if (rawType.includes("SINGLE")) {
        type = "single";
      } else if (rawType.includes("EP")) {
        type = "ep";
      }

      const year = release.date?.year || undefined;
      const month = release.date?.month ? String(release.date.month).padStart(2, "0") : "01";
      const day = release.date?.day ? String(release.date.day).padStart(2, "0") : "01";
      const date = year ? `${year}-${month}-${day}` : undefined;

      releases.push({
        id: release.id || "",
        name: release.name || "",
        type,
        year,
        date,
        coverUrl: release.coverArt?.sources?.[0]?.url || undefined,
        trackCount: release.tracks?.totalCount || 1,
        uri: release.uri || "",
      });
    }

    // Sort by latest release date descending (new drops like Yeat appear at the top)
    releases.sort((a, b) => {
      const da = a.date || (a.year ? `${a.year}-01-01` : "");
      const db = b.date || (b.year ? `${b.year}-01-01` : "");
      return db.localeCompare(da);
    });

    this.discographyCache.set(cacheKey, { data: releases, timestamp: Date.now() });
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(`sp_disc_${cacheKey}`, JSON.stringify({ data: releases, timestamp: Date.now() }));
      } catch {}
    }
    return releases;
  }

  /**
   * Fetches rich album / single metadata including track list, release date,
   * record label, and copyrights (℗ and ©).
   */
  async getAlbumMetadata(albumIdOrUri: string): Promise<SpotifyAlbumMetadata | null> {
    const cleanId = albumIdOrUri.replace(/^spotify:album:/, "").trim();
    if (!cleanId) return null;

    const cacheKey = cleanId.toLowerCase();
    const cached = typeof localStorage !== "undefined" ? localStorage.getItem(`sp_alb_v2_${cacheKey}`) : null;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 1000 * 60 * 60 * 24 * 7) {
          const hasBadCopyright = parsed.data?.copyrights?.some((c: string) => /ey[\w.-]{4,}|oy[\w.-]{4,}/i.test(c));
          if (!hasBadCopyright && parsed.data) {
            return parsed.data;
          }
        }
      } catch {}
    }

    try {
      // 1. Fetch embed page which contains exact Next.js trackList entity
      const embedHtml = await safeFetch(`https://open.spotify.com/embed/album/${cleanId}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      }).then((r) => r.text());

      const nextDataMatch = embedHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      const entity = nextDataMatch ? JSON.parse(nextDataMatch[1])?.props?.pageProps?.state?.data?.entity : null;

      // 2. Fetch main web page for release date and copyrights
      const pageHtml = await safeFetch(`https://open.spotify.com/album/${cleanId}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      }).then((r) => r.text()).catch(() => "");

      const copyrightMatches = [...pageHtml.matchAll(/([©℗]\s*[^<"&]+)/g)]
        .map((m) => m[1].replace(/&amp;/g, "&").trim())
        .filter((c, i, arr) => arr.indexOf(c) === i)
        .filter((c) => {
          if (!c || c.length < 3 || c.length > 90) return false;
          if (!/^[©℗]/.test(c)) return false;
          if (/ey[\w.-]{4,}|oy[\w.-]{4,}|[{}<>;_\\\/]{2,}/i.test(c)) return false;
          if (!/\s/.test(c)) return false;
          return true;
        });

      let releaseDate: string | undefined = entity?.releaseDate;
      if (!releaseDate) {
        const datePublishedMatch = pageHtml.match(/"datePublished":\s*"([^"]+)"/);
        if (datePublishedMatch) {
          releaseDate = datePublishedMatch[1];
        } else {
          const metaDateMatch = pageHtml.match(/<meta property="music:release_date" content="([^"]+)"/);
          if (metaDateMatch) releaseDate = metaDateMatch[1];
        }
      }

      let formattedReleaseDate: string | undefined;
      if (releaseDate) {
        try {
          const parts = releaseDate.split("T")[0].split("-");
          if (parts.length >= 2) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const d = new Date(Date.UTC(y, m, 1));
            formattedReleaseDate = d.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              timeZone: "UTC",
            });
          } else if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
            formattedReleaseDate = parts[0];
          }
        } catch {}
      }

      const tracks: SpotifyAlbumTrack[] = Array.isArray(entity?.trackList)
        ? entity.trackList.map((t: any) => ({
            id: (t.uri || "").replace("spotify:track:", ""),
            title: t.title || "",
            artist: t.subtitle || entity?.subtitle || "",
            durationMs: Number(t.duration) || 0,
            isExplicit: Boolean(t.isExplicit),
          }))
        : [];

      const result: SpotifyAlbumMetadata = {
        id: cleanId,
        name: entity?.title || entity?.name || "",
        type: (entity?.type === "album" ? "album" : "single") as "album" | "single" | "ep",
        releaseDate,
        formattedReleaseDate,
        copyrights: copyrightMatches,
        trackCount: tracks.length || 1,
        tracks,
      };

      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(`sp_alb_v2_${cacheKey}`, JSON.stringify({ data: result, timestamp: Date.now() }));
        } catch {}
      }

      return result;
    } catch (err) {
      logInternalWarn("SpotifyService.getAlbumMetadata failed", { cleanId, err });
      return null;
    }
  }
}

export const SpotifyService = new SpotifyServiceManager();

const spotifyAvatarMemory = new Map<string, string>();

/**
 * Resolves artist avatar prioritizing Spotify, with instant memory caching
 * and automatic fallback to YouTube Music artwork.
 */
export function useSpotifyArtistAvatar(artistName?: string, fallbackUrl?: string): string | undefined {
  const [avatar, setAvatar] = useState<string | undefined>(() => {
    if (!artistName) return fallbackUrl;
    return spotifyAvatarMemory.get(artistName.trim().toLowerCase()) || fallbackUrl;
  });

  useEffect(() => {
    if (!artistName?.trim()) {
      setAvatar(fallbackUrl);
      return;
    }
    const key = artistName.trim().toLowerCase();
    const cached = spotifyAvatarMemory.get(key);
    if (cached) {
      setAvatar(cached);
      return;
    }
    let active = true;
    void SpotifyService.getArtistAvatar(artistName).then((url) => {
      if (!active) return;
      if (url) {
        spotifyAvatarMemory.set(key, url);
        setAvatar(url);
      } else {
        setAvatar(fallbackUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [artistName, fallbackUrl]);

  return avatar;
}
