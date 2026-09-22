import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { supabase } from "./supabaseClient";

export const OAUTH_POPUP_LABEL = "amber_oauth_popup";
const OAUTH_BROADCAST_CHANNEL = "amber_oauth_channel";

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function isOAuthPopup(): boolean {
  if (typeof window === "undefined") return false;
  if (window.name === OAUTH_POPUP_LABEL) return true;
  if (isTauriEnvironment()) {
    try {
      const currentWin = getCurrentWebviewWindow();
      if (currentWin.label === OAUTH_POPUP_LABEL) return true;
    } catch {}
  }
  return false;
}

/**
 * Checks if the current window is an OAuth popup and handles closing after receiving tokens.
 */
export async function handleOAuthPopupRedirect(): Promise<boolean> {
  const isPopup = isOAuthPopup();
  if (!isPopup) return false;

  try {
    const hash = window.location.hash;
    const search = window.location.search;

    // Broadcast completion to the main window
    try {
      const bc = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
      bc.postMessage({ type: "OAUTH_SUCCESS", hash, search });
      bc.close();
    } catch {}

    const hasTokensOrCode =
      hash.includes("access_token=") ||
      search.includes("code=") ||
      hash.includes("error=") ||
      search.includes("error=");

    setTimeout(async () => {
      try {
        const currentWin = getCurrentWebviewWindow();
        await currentWin.destroy();
      } catch {
        try {
          const currentWin = getCurrentWebviewWindow();
          await currentWin.close();
        } catch {
          window.close();
        }
      }
    }, hasTokensOrCode ? 350 : 600);

    return true;
  } catch {
    window.close();
    return true;
  }
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

      const finish = async () => {
        if (resolved) return;
        resolved = true;
        try {
          await popup.destroy();
        } catch {
          try {
            await popup.close();
          } catch {}
        }
        if (supabase) {
          try {
            await supabase.auth.getSession();
          } catch {}
        }
        resolve();
      };

      // 1. Listen via BroadcastChannel from the popup window
      let bc: BroadcastChannel | null = null;
      try {
        bc = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        bc.onmessage = (event) => {
          if (event.data?.type === "OAUTH_SUCCESS") {
            void finish();
          }
        };
      } catch {}

      // 2. Listen to Supabase auth state change in main window
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session) {
          subscription.unsubscribe();
          void finish();
        }
      });

      // 3. Fallback when popup is closed or destroyed by user
      void popup.once("tauri://destroyed", () => {
        subscription.unsubscribe();
        if (bc) try { bc.close(); } catch {}
        if (!resolved) {
          resolve();
        }
      });

      // 4. Timeout after 5 minutes
      setTimeout(() => {
        subscription.unsubscribe();
        if (bc) try { bc.close(); } catch {}
        if (!resolved) {
          resolve();
        }
      }, 300_000);
    });
  } else {
    window.open(data.url, OAUTH_POPUP_LABEL, "width=520,height=720,status=no,toolbar=no,menubar=no");
  }
}

