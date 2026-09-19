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
  const url = sorted[0]?.url;
  if (!url) return undefined;
  return url
    .replace(/ab67616d0000(?:4851|1e02)/, "ab67616d0000b273")
    .replace(/ab6761610000(?:f178|5174)/, "ab6761610000e5eb");
}

/**
 * Picks the widest landscape (width ≥ height) image from a sources array — a banner, not a
 * portrait. Undefined for square-only galleries, because stretching a 640×640 photo across a
 * hero reads as a blur, not a banner.
 */
export function getLandscapeSource(sources?: Array<{ url?: string; width?: number; height?: number }>): string | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  const valid = sources.filter((s): s is { url: string; width?: number; height?: number } => typeof s?.url === "string" && s.url.length > 0);
  const landscape = valid.filter((s) => (s.width ?? 0) >= (s.height ?? 0));
  return getHighestResSource(landscape);
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
  private artistUriCache = new Map<string, string>();

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

    if (this.artistUriCache.has(cleanName)) {
      return this.artistUriCache.get(cleanName)!;
    }
    if (typeof localStorage !== "undefined") {
      try {
        const cached = localStorage.getItem(`sp_uri_${cleanName}`);
        if (cached) {
          this.artistUriCache.set(cleanName, cached);
          return cached;
        }
      } catch {}
    }

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

      const saveMatch = (uri: string) => {
        this.artistUriCache.set(cleanName, uri);
        if (typeof localStorage !== "undefined") {
          try {
            localStorage.setItem(`sp_uri_${cleanName}`, uri);
          } catch {}
        }
        return uri;
      };

      // 1. Exact match (case-insensitive)
      const exactMatch = artists.find((a: any) => {
        const aName = a?.data?.profile?.name?.toLowerCase()?.trim();
        return aName === cleanName;
      });
      if (exactMatch?.data?.uri) return saveMatch(exactMatch.data.uri);

      // 2. Simplified match (ignoring hyphens, punctuation, spaces, e.g. "lege-cy" == "legecy")
      const simpMatch = artists.find((a: any) => {
        const aName = a?.data?.profile?.name || "";
        const aSimp = aName.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/gi, "");
        return aSimp && aSimp === cleanSimp;
      });
      if (simpMatch?.data?.uri) return saveMatch(simpMatch.data.uri);

      // 3. Close alias (e.g. "The Weeknd" vs "Weeknd") - must be closely related
      const closeMatch = artists.find((a: any) => {
        const aName = (a?.data?.profile?.name || "").toLowerCase().trim();
        const aSimp = aName.replace(/[^a-z0-9\u0600-\u06FF]/gi, "");
        const stripThe = (s: string) => s.replace(/^the\s+/, "");
        return stripThe(aName) === stripThe(cleanName)
          || (aSimp.length >= 6 && cleanSimp.length >= 6 && (aSimp.startsWith(cleanSimp) || cleanSimp.startsWith(aSimp)));
      });
      if (closeMatch?.data?.uri) return saveMatch(closeMatch.data.uri);

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
   * Fast artist search returning official Spotify artists with high-res avatar.
   */
  async searchArtists(query: string, limit = 5): Promise<Array<{
    id: string;
    name: string;
    artworkUrl?: string;
    uri: string;
  }>> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: cleanQuery,
        offset: 0,
        limit,
        numberOfTopResults: limit,
        includeAudiobooks: false,
      });

      const items = result?.data?.searchV2?.artists?.items;
      if (!Array.isArray(items) || items.length === 0) return [];

      const artists: Array<{ id: string; name: string; artworkUrl?: string; uri: string }> = [];
      for (const item of items) {
        const data = item?.data;
        const name = data?.profile?.name;
        const uri = data?.uri;
        if (!name || !uri) continue;
        const id = uri.replace(/^spotify:artist:/, "");
        const artworkUrl = getHighestResSource(data?.visuals?.avatarImage?.sources);
        artists.push({ id, name, artworkUrl, uri });
      }
      return artists;
    } catch {
      return [];
    }
  }

  /**
   * Search for an album by title and artist (with optional sample track fallback),
   * returns open.spotify.com album URL if matched.
   */
  async searchAlbumUrl(title: string, artist: string, sampleTrackTitle?: string): Promise<string | null> {
    try {
      const cleanTitle = title.replace(/\s*\(?(?:album|ep|single|deluxe|version)\)?/gi, "").trim();
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: `${cleanTitle || title} ${artist}`.trim(),
        offset: 0,
        limit: 10,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });
      const albums = result?.data?.searchV2?.albumsV2?.items ?? result?.data?.searchV2?.albums?.items;
      if (Array.isArray(albums) && albums.length > 0) {
        const lowerTitle = cleanTitle.toLowerCase();
        const best = albums.find((a: any) => {
          const name = (a?.data?.name || a?.name || "").toLowerCase();
          return name === lowerTitle || name.includes(lowerTitle) || lowerTitle.includes(name);
        }) || albums[0];

        const uri = best?.data?.uri || best?.uri;
        if (uri && uri.startsWith("spotify:album:")) {
          return `https://open.spotify.com/album/${uri.replace("spotify:album:", "")}`;
        }
      }

      // If sampleTrackTitle is provided, search track to find its album
      if (sampleTrackTitle) {
        const trackAlbumUrl = await this.searchTrackAlbumUrl(sampleTrackTitle, artist);
        if (trackAlbumUrl) return trackAlbumUrl;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Searches for a track and returns its parent album's open.spotify.com URL.
   */
  async searchTrackAlbumUrl(trackTitle: string, artist: string): Promise<string | null> {
    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: `${trackTitle} ${artist}`.trim(),
        offset: 0,
        limit: 5,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });
      const tracks = result?.data?.searchV2?.tracksV2?.items ?? result?.data?.searchV2?.tracks?.items;
      if (Array.isArray(tracks) && tracks.length > 0) {
        for (const item of tracks) {
          const albumUri = item?.item?.data?.albumOfTrack?.uri || item?.data?.albumOfTrack?.uri;
          if (albumUri && typeof albumUri === "string" && albumUri.startsWith("spotify:album:")) {
            return `https://open.spotify.com/album/${albumUri.replace("spotify:album:", "")}`;
          }
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
   * Search for a track by title and artist, returns Spotify track URI (e.g. spotify:track:...) if matched.
   */
  async searchTrackUri(title: string, artist: string): Promise<string | null> {
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
          return uri;
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
        const raw = localStorage.getItem(`sp_ov_v2_${cacheKey}`);
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

    /*
     * Spotify moved the artist banner out of `visuals`: the live API now carries it as a
     * top-level `headerImage` wrapping `{ data: { sources } }`, and `visuals.headerImage`
     * comes back empty for every artist. Read the new shape first and keep the old one for
     * cached/older payloads. A square gallery photo is deliberately NOT a substitute — a
     * banner that isn't landscape is no banner, and the UI falls back to the YouTube one.
     */
    const headerUrl =
      getLandscapeSource(union.headerImage?.data?.sources)
      || getLandscapeSource(union.headerImage?.sources)
      || getLandscapeSource(visuals.headerImage?.sources)
      || undefined;

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
      headerUrl,
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
        localStorage.setItem(`sp_ov_v2_${cacheKey}`, JSON.stringify({ data: overview, timestamp: Date.now() }));
        localStorage.setItem(`sp_ov_v2_${uri.toLowerCase()}`, JSON.stringify({ data: overview, timestamp: Date.now() }));
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
    if (cached && Date.now() - cached.timestamp < 3600_000 * 4) {
      return cached.data;
    }

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(`sp_disc_${cacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Date.now() - parsed.timestamp < 3600_000 * 12) {
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
        coverUrl: getHighestResSource(release.coverArt?.sources) || release.coverArt?.sources?.[0]?.url || undefined,
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
   * Invalidates cached discography for an artist to force fresh fetch.
   */
  invalidateArtistDiscography(artistNameOrUri: string): void {
    const cacheKey = artistNameOrUri.toLowerCase();
    this.discographyCache.delete(cacheKey);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(`sp_disc_${cacheKey}`);
      } catch {}
    }
  }

  private trackCoverMemory = new Map<string, { url: string; timestamp: number }>();
  private trackCreditsCache = new Map<string, { data: SpotifyTrackCredits; timestamp: number }>();

  /**
   * Synchronous cache retrieval for Spotify track album cover URL.
   */
  getCachedTrackCoverUrl(trackTitle: string, artist: string, album?: string): string | null {
    if (!trackTitle?.trim()) return null;
    let cleanTitle = trackTitle
      .replace(/\s*[\(\[][^\)\]]*(?:video|audio|visualizer|lyric|clip|hd|4k|remastered|official)[^\)\]]*[\)\]]/gi, "")
      .replace(/["“”]/g, "")
      .trim();
    let cleanArtist = (artist || "")
      .replace(/\s*-\s*topic$/i, "")
      .replace(/\s*vevo$/i, "")
      .replace(/,\s*feat\..*$/i, "")
      .replace(/\s+ft\..*$/i, "")
      .replace(/\s+feat\..*$/i, "")
      .trim();
    const key = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}${album ? `|${album.toLowerCase().trim()}` : ""}`;
    const mem = this.trackCoverMemory.get(key);
    if (mem && mem.url) return mem.url;
    if (typeof localStorage !== "undefined") {
      try {
        const storageKey = `sp_trk_cover_v2_${key.replace(/[^\w-]/g, "_").slice(0, 80)}`;
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.data) {
            this.trackCoverMemory.set(key, { url: parsed.data, timestamp: Date.now() });
            return parsed.data;
          }
        }
      } catch {}
    }
    return null;
  }

  /**
   * The track's album cover straight from Spotify, for the player-bar dock.
   *
   * YouTube-sourced tracks carry a video thumbnail as artwork whenever no album art was
   * attached — the dock then shows a video still instead of the album cover. One searchDesktop
   * request resolves the cover; cached in memory and localStorage, so a track gets looked up
   * once per machine, not once per play. Null means "nothing found" and is cached briefly so
   * a track with no Spotify presence does not re-search on every render.
   */
  async getTrackCoverUrl(trackTitle: string, artist: string, album?: string): Promise<string | null> {
    if (!trackTitle?.trim()) return null;

    // Clean title and artist to maximize Spotify search matches
    let cleanTitle = trackTitle
      .replace(/\s*[\(\[][^\)\]]*(?:video|audio|visualizer|lyric|clip|hd|4k|remastered|official)[^\)\]]*[\)\]]/gi, "")
      .replace(/["“”]/g, "")
      .trim();

    let cleanArtist = (artist || "")
      .replace(/\s*-\s*topic$/i, "")
      .replace(/\s*vevo$/i, "")
      .replace(/,\s*feat\..*$/i, "")
      .replace(/\s+ft\..*$/i, "")
      .replace(/\s+feat\..*$/i, "")
      .trim();

    // If title has "Artist - Song" or "Song - Artist", extract the pure song title
    const dashParts = cleanTitle.split(/\s+-\s+/);
    if (dashParts.length === 2) {
      const p0 = dashParts[0].trim();
      const p1 = dashParts[1].trim();
      if (cleanArtist && p0.toLowerCase().includes(cleanArtist.toLowerCase())) {
        cleanTitle = p1;
      } else if (cleanArtist && p1.toLowerCase().includes(cleanArtist.toLowerCase())) {
        cleanTitle = p0;
      } else {
        cleanTitle = p1;
      }
    }

    const key = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}${album ? `|${album.toLowerCase().trim()}` : ""}`;
    const DAY_MS = 86_400_000;
    const mem = this.trackCoverMemory.get(key);
    if (mem && Date.now() - mem.timestamp < 30 * DAY_MS) return mem.url;
    const storageKey = `sp_trk_cover_v2_${key.replace(/[^\w-]/g, "_").slice(0, 80)}`;
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.data && Date.now() - parsed.timestamp < 30 * DAY_MS) {
            this.trackCoverMemory.set(key, { url: parsed.data, timestamp: Date.now() });
            return parsed.data;
          }
        }
      } catch {}
    }

    const searchQuery = `${cleanArtist} ${cleanTitle}`.trim();
    const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
      searchTerm: searchQuery,
      offset: 0,
      limit: 10,
      numberOfTopResults: 5,
      includeAudiobooks: false,
    });

    const items: any[] = Array.isArray(result?.data?.searchV2?.tracksV2?.items)
      ? result.data.searchV2.tracksV2.items
      : Array.isArray(result?.data?.searchV2?.tracks?.items)
        ? result.data.searchV2.tracks.items
        : [];

    const normSimp = (str: string) => str.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/gi, "").trim();
    const tTitleSimp = normSimp(cleanTitle);
    const tArtistSimp = normSimp(cleanArtist);
    const tAlbumSimp = album ? normSimp(album) : "";

    let bestCover: string | null = null;
    let bestScore = -1;

    for (const item of items) {
      const data = item?.item?.data || item?.data;
      if (!data) continue;
      const rawName = String(data?.name ?? "");
      const nameSimp = normSimp(rawName);
      if (!nameSimp) continue;

      let score = 0;
      if (nameSimp === tTitleSimp) score += 100;
      else if (nameSimp.includes(tTitleSimp) || (tTitleSimp && tTitleSimp.includes(nameSimp))) score += 60;
      else continue;

      const artists: string[] = Array.isArray(data?.artists?.items)
        ? data.artists.items.map((a: any) => normSimp(String(a?.profile?.name ?? "")))
        : [];

      let hasArtistMatch = false;
      if (artists.some((a) => a === tArtistSimp)) {
        score += 50;
        hasArtistMatch = true;
      } else if (artists.some((a) => tArtistSimp && (a.includes(tArtistSimp) || tArtistSimp.includes(a)))) {
        score += 25;
        hasArtistMatch = true;
      }

      // CRITICAL: If artist was specified, reject any result where the artist doesn't match!
      // This prevents cross-artist mismatches (e.g. random guy's single "Loser" for Tame Impala).
      if (tArtistSimp && !hasArtistMatch) continue;

      if (tAlbumSimp) {
        const albumName = normSimp(String(data?.albumOfTrack?.name ?? ""));
        if (albumName) {
          if (albumName === tAlbumSimp) score += 40;
          else if (albumName.includes(tAlbumSimp) || tAlbumSimp.includes(albumName)) score += 20;
        }
      }

      const coverUrl = getHighestResSource(data?.albumOfTrack?.coverArt?.sources);
      if (score > bestScore && coverUrl) {
        bestScore = score;
        bestCover = coverUrl;
      }
    }

    // Cache misses too — briefly (1 day) — so absent tracks do not re-search forever
    if (bestCover) {
      this.trackCoverMemory.set(key, { url: bestCover, timestamp: Date.now() });
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ data: bestCover, timestamp: Date.now() }));
        } catch {}
      }
    } else {
      this.trackCoverMemory.set(key, { url: "", timestamp: Date.now() - 29 * DAY_MS });
    }
    return bestCover;
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
          if (!c || c.length < 3 || c.length > 250) return false;
          if (!/^[©℗]/.test(c)) return false;
          if (/ey[\w.-]{4,}|oy[\w.-]{4,}|[{}<>;_\\\/]{2,}/i.test(c)) return false;
          if (!/\s/.test(c)) return false;
          return true;
        });

      let releaseDate: string | undefined =
        typeof entity?.releaseDate === "string"
          ? entity.releaseDate
          : (entity?.releaseDate?.isoString || entity?.releaseDate?.text || (typeof entity?.releaseDate?.year === "number" ? String(entity.releaseDate.year) : undefined));
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
      if (typeof releaseDate === "string" && releaseDate.length > 0) {
        try {
          const parts = releaseDate.split("T")[0].split("-");
          if (parts.length >= 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const d = parseInt(parts[2], 10);
            const dateObj = new Date(Date.UTC(y, m, d));
            formattedReleaseDate = dateObj.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            });
          } else if (parts.length === 2) {
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

  /**
   * Fetches real track credits from Spotify, including performers with avatars,
   * songwriters/composers, producers/engineers, and official record label.
   */
  async getTrackCredits(trackTitle: string, artistName: string): Promise<SpotifyTrackCredits | null> {
    if (!trackTitle?.trim() || !artistName?.trim()) return null;

    const cleanTitle = trackTitle
      .replace(/\s*[\(\[][^\)\]]*(?:video|audio|visualizer|lyric|clip|hd|4k|remastered|official)[^\)\]]*[\)\]]/gi, "")
      .replace(/["“”]/g, "")
      .trim();
    const cleanArtist = artistName
      .replace(/\s*-\s*topic$/i, "")
      .replace(/\s*vevo$/i, "")
      .trim();

    const cacheKey = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}`;
    const mem = this.trackCreditsCache.get(cacheKey);
    if (mem && Date.now() - mem.timestamp < 7 * 86_400_000) return mem.data;

    try {
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: `${cleanTitle} ${cleanArtist}`,
        offset: 0,
        limit: 5,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });

      const items: any[] = Array.isArray(result?.data?.searchV2?.tracksV2?.items)
        ? result.data.searchV2.tracksV2.items
        : Array.isArray(result?.data?.searchV2?.tracks?.items)
          ? result.data.searchV2.tracks.items
          : [];

      if (!items.length) return null;

      const trackData = items[0]?.item?.data || items[0]?.data;
      if (!trackData) return null;

      const spotifyTrackName = trackData.name || cleanTitle;
      const trackId = trackData.id || (typeof trackData.uri === "string" ? trackData.uri.replace("spotify:track:", "") : "");
      const albumId = trackData.albumOfTrack?.id;
      const albumMeta = albumId ? await this.getAlbumMetadata(albumId) : null;
      const artistAvatar = await this.getArtistAvatar(cleanArtist);

      // Fetch authentic credits from Spotify internal credits endpoint
      let spotifyCreditsData: any = null;
      if (trackId) {
        try {
          const token = await this.getAccessToken();
          if (token) {
            const creditsRes = await safeFetch(
              `https://spclient.wg.spotify.com/track-credits-view/v0/experimental/${trackId}/credits`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "app-platform": "WebPlayer",
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                },
              },
            );
            if (creditsRes.ok) {
              spotifyCreditsData = await creditsRes.json();
            }
          }
        } catch (err) {
          logInternalWarn("SpotifyService: track-credits-view request failed", { err });
        }
      }

      const roleCredits = Array.isArray(spotifyCreditsData?.roleCredits) ? spotifyCreditsData.roleCredits : [];
      const performersSection = roleCredits.find((r: any) => r.roleTitle === "Performers");
      const writersSection = roleCredits.find((r: any) => r.roleTitle === "Writers");
      const producersSection = roleCredits.find((r: any) => r.roleTitle === "Producers");

      // 1. Performers
      let artists: Array<{ name: string; role: string; avatarUrl?: string; uri?: string }> = [];
      if (Array.isArray(performersSection?.artists) && performersSection.artists.length > 0) {
        artists = performersSection.artists.map((a: any, index: number) => ({
          name: a.name || cleanArtist,
          role: a.subroles?.join(", ") || (index === 0 ? "Main Artist" : "Featured Artist"),
          avatarUrl: a.imageUri || (index === 0 ? (artistAvatar || undefined) : undefined),
          uri: a.uri,
        }));
      } else {
        const rawArtists: any[] = Array.isArray(trackData.artists?.items)
          ? trackData.artists.items
          : [];
        artists = await Promise.all(
          rawArtists.map(async (a, index) => {
            const name = a?.profile?.name || cleanArtist;
            const avatar = index === 0 ? (artistAvatar || undefined) : (await this.getArtistAvatar(name) || undefined);
            return {
              name,
              role: index === 0 ? "Main Artist" : "Featured Artist",
              avatarUrl: avatar,
              uri: a?.uri,
            };
          }),
        );
      }

      if (artists.length === 0) {
        artists.push({
          name: cleanArtist,
          role: "Main Artist",
          avatarUrl: artistAvatar || undefined,
        });
      }

      // 2. Writers
      let writers: Array<{ name: string; role: string }> = [];
      if (Array.isArray(writersSection?.artists) && writersSection.artists.length > 0) {
        writers = writersSection.artists.map((w: any) => ({
          name: w.name || cleanArtist,
          role: w.subroles?.join(", ") || "Composer, Lyricist",
        }));
      } else {
        writers = [{ name: cleanArtist, role: "Composer, Lyricist" }];
      }

      // 3. Producers
      let producers: Array<{ name: string; role: string }> = [];
      if (Array.isArray(producersSection?.artists) && producersSection.artists.length > 0) {
        producers = producersSection.artists.map((p: any) => ({
          name: p.name,
          role: p.subroles?.join(", ") || "Producer",
        }));
      }

      // 4. Source & Label
      const sourceNames = Array.isArray(spotifyCreditsData?.sourceNames)
        ? spotifyCreditsData.sourceNames.filter(Boolean)
        : [];
      const cleanCopyright = albumMeta?.copyrights?.[0]
        ? albumMeta.copyrights[0].replace(/^[©℗]\s*(\d{4})?\s*/, "").trim()
        : undefined;
      const label =
        sourceNames.length > 0
          ? sourceNames.join(", ")
          : (cleanCopyright || (albumMeta?.name ? `Released by ${albumMeta.name}` : undefined));

      const releaseDate = albumMeta?.formattedReleaseDate || albumMeta?.releaseDate;

      const creditsResult: SpotifyTrackCredits = {
        trackTitle: spotifyTrackName,
        artists,
        writers,
        producers,
        label,
        releaseDate,
      };

      this.trackCreditsCache.set(cacheKey, { data: creditsResult, timestamp: Date.now() });
      return creditsResult;
    } catch (err) {
      logInternalWarn("SpotifyService.getTrackCredits failed", { trackTitle, artistName, err });
      return null;
    }
  }
}

export interface SpotifyTrackCredits {
  trackTitle: string;
  artists: Array<{ name: string; role: string; avatarUrl?: string; uri?: string }>;
  writers: Array<{ name: string; role: string }>;
  producers: Array<{ name: string; role: string }>;
  label?: string;
  releaseDate?: string;
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

/**
 * Resolves track cover art prioritizing official Spotify album covers,
 * with synchronous instant cache lookup and automatic fallback.
 */
export function useSpotifyTrackCover(
  trackTitle?: string,
  artistName?: string,
  fallbackUrl?: string,
  albumName?: string,
): string | undefined {
  const [cover, setCover] = useState<string | undefined>(() => {
    if (!trackTitle) return fallbackUrl;
    return SpotifyService.getCachedTrackCoverUrl(trackTitle, artistName || "", albumName) || fallbackUrl;
  });

  useEffect(() => {
    if (!trackTitle?.trim()) {
      setCover(fallbackUrl);
      return;
    }
    const cached = SpotifyService.getCachedTrackCoverUrl(trackTitle, artistName || "", albumName);
    if (cached) {
      setCover(cached);
      return;
    }
    let active = true;
    void SpotifyService.getTrackCoverUrl(trackTitle, artistName || "", albumName).then((url) => {
      if (active && url) {
        setCover(url);
      }
    });
    return () => {
      active = false;
    };
  }, [trackTitle, artistName, fallbackUrl, albumName]);

  return cover || fallbackUrl;
}

