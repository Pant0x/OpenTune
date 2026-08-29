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

const LOCAL_PROFILE_KEY = "amber_user_profile";

function getLocalProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocalProfile(profile: UserProfile | null) {
  try {
    if (profile) {
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(LOCAL_PROFILE_KEY);
    }
  } catch {}
}

export function useAuthProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(() => getLocalProfile());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function syncSession() {
      if (!supabase) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          if (mounted) {
            setProfile(null);
            saveLocalProfile(null);
            setLoading(false);
          }
          return;
        }

        const user = session.user;
        const provider = (user.app_metadata?.provider as "google" | "discord" | "email") ||
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
          saveLocalProfile(userProf);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to sync profile:", err);
        if (mounted) setLoading(false);
      }
    }

    void syncSession();

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
        void syncSession();
      });

      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    }

    return () => {
      mounted = false;
    };
  }, []);

  const updateUsername = async (newUsername: string) => {
    if (!newUsername.trim()) throw new Error("Username cannot be empty");
    if (!supabase) {
      if (profile) {
        const updated = { ...profile, username: newUsername.trim() };
        setProfile(updated);
        saveLocalProfile(updated);
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
      saveLocalProfile(updated);
    }
  };

  const updateAvatarUrl = async (newAvatarUrl: string) => {
    if (!supabase) {
      if (profile) {
        const updated = { ...profile, avatarUrl: newAvatarUrl.trim() };
        setProfile(updated);
        saveLocalProfile(updated);
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
      saveLocalProfile(updated);
    }
  };

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setProfile(null);
    saveLocalProfile(null);
  };

  return {
    profile,
    loading,
    updateUsername,
    updateAvatarUrl,
    signOut,
  };
}

