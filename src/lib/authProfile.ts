import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export interface UserProfile {
  id: string;
  email: string | null;
  username: string;
  avatarUrl: string | null;
  provider: "google" | "discord" | "email" | "unknown";
  isGoogleConnected: boolean;
  isDiscordConnected: boolean;
}

const LOCAL_PROFILE_KEY = "opentune_user_profile";
const PROFILE_CHANGE_EVENT = "opentune:profile-change";

export function getStoredProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStoredProfile(profile: UserProfile | null) {
  try {
    if (profile) {
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(LOCAL_PROFILE_KEY);
    }
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT));
  } catch {}
}

export function useAuthProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(() => getStoredProfile());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function syncSession() {
      if (!supabase) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.warn("[auth] getSession error:", error);
          if (mounted) setLoading(false);
          return;
        }

        if (!session?.user) {
          // Check if there is an existing Supabase auth token in localStorage.
          // If so, the session may still be refreshing or network is briefly offline;
          // do NOT prematurely wipe the saved user profile.
          const hasSbToken = Object.keys(localStorage).some(
            (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
          );

          if (!hasSbToken) {
            if (mounted) {
              setProfile(null);
              saveStoredProfile(null);
            }
          }
          if (mounted) setLoading(false);
          return;
        }

        const user = session.user;
        const provider =
          (user.app_metadata?.provider as "google" | "discord" | "email") ||
          (user.identities?.[0]?.provider as "google" | "discord" | "email") ||
          (user.email ? "email" : "unknown");

        const meta = user.user_metadata || {};
        const username =
          meta.username ||
          meta.display_name ||
          meta.full_name ||
          meta.name ||
          user.email?.split("@")[0] ||
          "User";

        const avatarUrl =
          meta.avatar_url ||
          meta.picture ||
          null;

        const identities = user.identities || [];
        const isGoogleConnected = provider === "google" || identities.some((i) => i.provider === "google");
        const isDiscordConnected = provider === "discord" || identities.some((i) => i.provider === "discord");

        const userProf: UserProfile = {
          id: user.id,
          email: user.email ?? null,
          username,
          avatarUrl,
          provider,
          isGoogleConnected,
          isDiscordConnected,
        };

        if (mounted) {
          setProfile(userProf);
          saveStoredProfile(userProf);
          setLoading(false);
        }
      } catch (err) {
        console.error("[auth] Failed to sync profile:", err);
        if (mounted) setLoading(false);
      }
    }

    void syncSession();

    const handleProfileChange = () => {
      setProfile(getStoredProfile());
    };
    window.addEventListener(PROFILE_CHANGE_EVENT, handleProfileChange);

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          setProfile(null);
          saveStoredProfile(null);
          setLoading(false);
        } else {
          void syncSession();
        }
      });

      return () => {
        mounted = false;
        window.removeEventListener(PROFILE_CHANGE_EVENT, handleProfileChange);
        subscription.unsubscribe();
      };
    }

    return () => {
      mounted = false;
      window.removeEventListener(PROFILE_CHANGE_EVENT, handleProfileChange);
    };
  }, []);

  const updateUsername = async (newUsername: string) => {
    if (!newUsername.trim()) throw new Error("Username cannot be empty");
    if (!supabase) {
      if (profile) {
        const updated = { ...profile, username: newUsername.trim() };
        setProfile(updated);
        saveStoredProfile(updated);
      }
      return;
    }

    const { error } = await supabase.auth.updateUser({
      data: {
        username: newUsername.trim(),
        display_name: newUsername.trim(),
      },
    });

    if (error) throw error;

    if (profile) {
      const updated = { ...profile, username: newUsername.trim() };
      setProfile(updated);
      saveStoredProfile(updated);
    }
  };

  const updateAvatarUrl = async (newAvatarUrl: string) => {
    if (!supabase) {
      if (profile) {
        const updated = { ...profile, avatarUrl: newAvatarUrl.trim() };
        setProfile(updated);
        saveStoredProfile(updated);
      }
      return;
    }

    const { error } = await supabase.auth.updateUser({
      data: {
        avatar_url: newAvatarUrl.trim(),
        picture: newAvatarUrl.trim(),
      },
    });

    if (error) throw error;

    if (profile) {
      const updated = { ...profile, avatarUrl: newAvatarUrl.trim() };
      setProfile(updated);
      saveStoredProfile(updated);
    }
  };

  const signOut = async () => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {}
    }
    setProfile(null);
    saveStoredProfile(null);
  };

  return {
    profile,
    loading,
    updateUsername,
    updateAvatarUrl,
    signOut,
  };
}
