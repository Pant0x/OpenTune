import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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
