import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "./supabaseClient";

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export interface OAuthCallbackPayload {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

/**
 * Cancels any pending OAuth listener in the background (e.g. if the user cancels or closes modal).
 */
export async function cancelOAuthLogin(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke("cancel_oauth_listener");
    } catch {}
  }
}

/**
 * Initiates an OAuth sign-in flow (Google or Discord) via the user's default web browser
 * (Brave, Chrome, Edge, etc.) using RFC 8252 local loopback callback, exactly like Spotify,
 * Discord, and VS Code.
 */
export async function signInWithOAuthBrowser(provider: "google" | "discord"): Promise<void> {
  if (!supabase) {
    throw new Error("OpenTune Cloud authentication is not configured in this build.");
  }

  if (isTauriEnvironment()) {
    // 1. Prepare local loopback listener on an available port (e.g. 8000 or dynamic)
    const port = await invoke<number>("prepare_oauth_listener");
    const callbackUrl = `http://localhost:${port}/callback`;

    try {
      // 2. Obtain Supabase OAuth authorization URL targeting our local loopback
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl,
          skipBrowserRedirect: true,
          scopes: provider === "discord" ? "identify email" : undefined,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error("Could not retrieve authentication URL.");

      // 3. Open user's default browser (e.g. Brave, Chrome, Edge)
      await openUrl(data.url);

      // 4. Await the callback from the browser
      const payload = await invoke<OAuthCallbackPayload>("wait_for_oauth_callback");

      if (payload.error) {
        throw new Error(payload.error);
      }

      // 5. Exchange code or save session
      if (payload.code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(payload.code);
        if (exchangeError) throw exchangeError;
      } else if (payload.accessToken && payload.refreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: payload.accessToken,
          refresh_token: payload.refreshToken,
        });
        if (setSessionError) throw setSessionError;
      } else {
        throw new Error("No authentication tokens or authorization code received.");
      }

      // 6. Refresh active session
      await supabase.auth.getSession();
    } catch (err) {
      await cancelOAuthLogin();
      throw err;
    }
  } else {
    // Web fallback
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  }
}

// Backward-compatible alias
export const signInWithOAuthPopup = signInWithOAuthBrowser;

/**
 * No-op helper for backwards compatibility.
 */
export async function handleOAuthPopupRedirect(): Promise<boolean> {
  return false;
}
