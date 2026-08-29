import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { supabase } from "./supabaseClient";

export const OAUTH_POPUP_LABEL = "amber_oauth_popup";

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function isOAuthPopup(): boolean {
  if (!isTauriEnvironment()) return false;
  try {
    const currentWin = getCurrentWebviewWindow();
    return currentWin.label === OAUTH_POPUP_LABEL;
  } catch {
    return false;
  }
}

/**
 * Checks if the current window is an OAuth popup and handles closing after receiving tokens.
 */
export async function handleOAuthPopupRedirect(): Promise<boolean> {
  if (!isOAuthPopup()) return false;
  try {
    const currentWin = getCurrentWebviewWindow();
    const hash = window.location.hash;
    const search = window.location.search;
    if (
      hash.includes("access_token=") ||
      search.includes("code=") ||
      hash.includes("error=") ||
      search.includes("error=")
    ) {
      setTimeout(async () => {
        try {
          await currentWin.close();
        } catch {}
      }, 300);
      return true;
    }
  } catch {}
  return false;
}

/**
 * Initiates an OAuth sign-in flow (Discord or Google) inside a dedicated popup window,
 * keeping the main Amber application window intact without external navigation.
 */
export async function signInWithOAuthPopup(provider: "google" | "discord"): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase client is not configured.");
  }

  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("Could not retrieve authentication URL.");

  if (isTauriEnvironment()) {
    try {
      const existing = await WebviewWindow.getByLabel(OAUTH_POPUP_LABEL);
      if (existing) {
        await existing.close();
      }
    } catch {}

    const title =
      provider === "discord"
        ? "Sign in with Discord - Amber"
        : "Sign in with Google - Amber";

    const popup = new WebviewWindow(OAUTH_POPUP_LABEL, {
      url: data.url,
      title,
      width: 520,
      height: 720,
      center: true,
      resizable: true,
      focus: true,
    });

    await new Promise<void>((resolve) => {
      let resolved = false;

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session) {
          resolved = true;
          subscription.unsubscribe();
          try {
            void popup.close();
          } catch {}
          resolve();
        }
      });

      void popup.once("tauri://destroyed", () => {
        subscription.unsubscribe();
        if (!resolved) {
          resolve();
        }
      });

      setTimeout(() => {
        if (!resolved) {
          subscription.unsubscribe();
          resolve();
        }
      }, 300_000);
    });
  } else {
    window.open(data.url, OAUTH_POPUP_LABEL, "width=520,height=720,status=no,toolbar=no,menubar=no");
  }
}
