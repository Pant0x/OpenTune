import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "") as string;
const supabaseAnonKey = (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : "") as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY - auth will be disabled");
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null as unknown as ReturnType<typeof createClient>;

/**
 * Your Supabase project: https://kdrgxnooesttppyhkoin.supabase.co
 * Enabled providers (per your dashboard): Google, Spotify, Discord, Email/Pass
 * Use: supabase.auth.signInWithOAuth({provider: "google"|"spotify"|"discord"})
 *      supabase.auth.signInWithPassword({email, password})
 */

export async function getSpotifyAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  // Supabase stores provider_token for OAuth when `provider` is spotify
  // You must enable "Spotify" in Auth Providers and add SPOTIFY_CLIENT_ID/SECRET
  return (data.session as unknown as { provider_token?: string })?.provider_token ?? null;
}

/**
 * Get Google access token with YouTube scopes from Supabase session.
 * Requires user to have signed in with Google OAuth via Supabase with YouTube scopes enabled.
 */
export async function getGoogleAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  // Supabase stores provider_token for OAuth when `provider` is google
  // Requires YouTube scopes: https://www.googleapis.com/auth/youtube.readonly, https://www.googleapis.com/auth/youtube.force-ssl
  return (data.session as unknown as { provider_token?: string })?.provider_token ?? null;
}

/**
 * Get YouTube Data API base URL
 */
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Fetch user's YouTube watch history
 */
export async function fetchYouTubeWatchHistory(accessToken: string, maxResults = 50): Promise<any[]> {
  const response = await fetch(
    `${YOUTUBE_API_BASE}/activities?part=snippet,contentDetails&mine=true&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}

/**
 * Fetch user's YouTube liked videos
 */
export async function fetchYouTubeLikedVideos(accessToken: string, maxResults = 50): Promise<any[]> {
  const response = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics&myRating=like&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}

/**
 * Fetch user's YouTube playlists
 */
export async function fetchYouTubePlaylists(accessToken: string, maxResults = 50): Promise<any[]> {
  const response = await fetch(
    `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}

/**
 * Fetch playlist items (tracks in a playlist)
 */
export async function fetchYouTubePlaylistItems(accessToken: string, playlistId: string, maxResults = 50): Promise<any[]> {
  const response = await fetch(
    `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}
