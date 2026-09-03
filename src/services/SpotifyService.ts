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

export interface SpotifyArtistOverview {
  uri: string;
  name: string;
  monthlyListeners: number;
  followers: number;
  worldRank?: number;
  bio?: string;
  avatarUrl?: string;
  headerUrl?: string;
  galleryUrls: string[];
  instagramUrl?: string;
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

    const instagramItem = profile.externalLinks?.items?.find((link: any) => link?.name?.toUpperCase() === "INSTAGRAM");

    const overview: SpotifyArtistOverview = {
      uri,
      name: profile.name || "",
      monthlyListeners: Number(stats.monthlyListeners) || 0,
      followers: Number(stats.followers) || 0,
      worldRank: Number(stats.worldRank) || undefined,
      bio: profile.biography?.text || undefined,
      avatarUrl: visuals.avatarImage?.sources?.[0]?.url || undefined,
      headerUrl: visuals.headerImage?.sources?.[0]?.url || undefined,
      galleryUrls,
      instagramUrl: instagramItem?.url || undefined,
      topCities,
      topTracks,
    };

    this.artistOverviewCache.set(artistNameOrUri.toLowerCase(), { data: overview, timestamp: Date.now() });
    this.artistOverviewCache.set(uri.toLowerCase(), { data: overview, timestamp: Date.now() });
    return overview;
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
