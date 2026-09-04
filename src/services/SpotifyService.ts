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
  coverUrl?: string;
  trackCount: number;
  uri: string;
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
    const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
      searchTerm: artistName,
      offset: 0,
      limit: 5,
      numberOfTopResults: 5,
      includeAudiobooks: false,
    });

    const artists = result?.data?.searchV2?.artists?.items;
    if (Array.isArray(artists) && artists.length > 0) {
      const match = artists.find((a: any) => a?.data?.profile?.name?.toLowerCase() === cleanName) || artists[0];
      return match?.data?.uri || null;
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
      const albums = result?.data?.searchV2?.albums?.items;
      if (Array.isArray(albums) && albums.length > 0) {
        const match = albums[0];
        const uri = match?.data?.uri;
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
      const tracks = result?.data?.searchV2?.tracks?.items;
      if (Array.isArray(tracks) && tracks.length > 0) {
        const match = tracks[0];
        const uri = match?.item?.data?.uri || match?.data?.uri;
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
      const result = await this.callPathfinder<any>("searchDesktop", QUERY_HASHES.searchDesktop, {
        searchTerm: name,
        offset: 0,
        limit: 5,
        numberOfTopResults: 5,
        includeAudiobooks: false,
      });
      const artists = result?.data?.searchV2?.artists?.items;
      if (Array.isArray(artists) && artists.length > 0) {
        const match = artists[0];
        const uri = match?.data?.uri;
        if (uri && uri.startsWith("spotify:artist:")) {
          return `https://open.spotify.com/artist/${uri.replace("spotify:artist:", "")}`;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Fetches artist monthly listeners, followers, bio, top cities, avatar, gallery, and top tracks.
   */
  async getArtistOverview(artistNameOrUri: string): Promise<SpotifyArtistOverview | null> {
    const cached = this.artistOverviewCache.get(artistNameOrUri.toLowerCase());
    if (cached && Date.now() - cached.timestamp < 3600_000) {
      return cached.data;
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
          .map((item: any) => item.sources?.[0]?.url)
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
            coverUrl: track.albumOfTrack?.coverArt?.sources?.[0]?.url,
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
      avatarUrl: visuals.avatarImage?.sources?.[0]?.url || undefined,
      headerUrl: visuals.headerImage?.sources?.[0]?.url || undefined,
      galleryUrls,
      instagramUrl: instagramItem?.url || undefined,
      externalLinks,
      topCities,
      topTracks,
    };

    this.artistOverviewCache.set(artistNameOrUri.toLowerCase(), { data: overview, timestamp: Date.now() });
    this.artistOverviewCache.set(uri.toLowerCase(), { data: overview, timestamp: Date.now() });
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
    const cached = this.discographyCache.get(artistNameOrUri.toLowerCase());
    if (cached && Date.now() - cached.timestamp < 3600_000) {
      return cached.data;
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

      releases.push({
        id: release.id || "",
        name: release.name || "",
        type,
        year: release.date?.year || undefined,
        coverUrl: release.coverArt?.sources?.[0]?.url || undefined,
        trackCount: release.tracks?.totalCount || 1,
        uri: release.uri || "",
      });
    }

    this.discographyCache.set(artistNameOrUri.toLowerCase(), { data: releases, timestamp: Date.now() });
    return releases;
  }
}

export const SpotifyService = new SpotifyServiceManager();
