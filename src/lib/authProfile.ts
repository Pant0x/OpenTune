import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getAppSetting, setAppSetting, removeAppSetting } from "../internal/appSettings";

export interface UserProfile {
  id: string;
  email: string | null;
  username: string;
  avatarUrl: string | null;
  provider: "google" | "discord" | "email" | "unknown";
  isGoogleConnected: boolean;
  isDiscordConnected: boolean;
}

export interface SessionDetails {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt?: string;
  lastSignInAt?: string;
}

const LOCAL_PROFILE_KEY = "opentune_user_profile";
const PROFILE_CHANGE_EVENT = "opentune:profile-change";
let cachedProfileInMemory: UserProfile | null = null;

export function getStoredProfile(): UserProfile | null {
  if (cachedProfileInMemory) return cachedProfileInMemory;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_PROFILE_KEY);
      if (raw) {
        cachedProfileInMemory = JSON.parse(raw);
        return cachedProfileInMemory;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function saveStoredProfile(profile: UserProfile | null) {
  cachedProfileInMemory = profile;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (profile) {
        window.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
      } else {
        window.localStorage.removeItem(LOCAL_PROFILE_KEY);
      }
    }
  } catch {}

  try {
    if (profile) {
      void setAppSetting(LOCAL_PROFILE_KEY, profile);
    } else {
      void removeAppSetting(LOCAL_PROFILE_KEY);
    }
    window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT));
  } catch {}
}

export function useAuthProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(() => getStoredProfile());
  const [sessionDetails, setSessionDetails] = useState<SessionDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1. Immediately hydrate from durable appSettings on disk
    void getAppSetting<UserProfile>(LOCAL_PROFILE_KEY).then((diskProfile) => {
      if (diskProfile && mounted) {
        cachedProfileInMemory = diskProfile;
        setProfile((current) => current || diskProfile);
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(diskProfile));
          }
        } catch {}
      }
    });

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

        if (session) {
          if (mounted) {
            setSessionDetails({
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
              expiresAt: session.expires_at,
              createdAt: session.user?.created_at,
              lastSignInAt: session.user?.last_sign_in_at,
            });
          }
        }

        if (session?.user) {
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
        } else {
          // If Supabase session is not immediately ready on boot (or offline), do NOT wipe profile
          if (mounted) setLoading(false);
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
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          // User explicitly signed out
          setProfile(null);
          saveStoredProfile(null);
          setLoading(false);
        } else if (session?.user) {
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
    const trimmed = newUsername.trim();

    if (profile) {
      const updated = { ...profile, username: trimmed };
      setProfile(updated);
      saveStoredProfile(updated);
    }

    if (supabase) {
      try {
        const { error } = await supabase.auth.updateUser({
          data: {
            username: trimmed,
            display_name: trimmed,
          },
        });
        if (error) console.warn("[auth] updateUser username error:", error);
      } catch (err) {
        console.warn("[auth] updateUser username error:", err);
      }
    }
  };

  const updateAvatarUrl = async (newAvatarUrl: string) => {
    const trimmed = newAvatarUrl.trim();

    if (profile) {
      const updated = { ...profile, avatarUrl: trimmed };
      setProfile(updated);
      saveStoredProfile(updated);
    }

    if (supabase) {
      try {
        const { error } = await supabase.auth.updateUser({
          data: {
            avatar_url: trimmed,
            picture: trimmed,
          },
        });
        if (error) console.warn("[auth] updateUser avatar error:", error);
      } catch (err) {
        console.warn("[auth] updateUser avatar error:", err);
      }
    }
  };

  const resetPassword = async (email?: string) => {
    if (!supabase) throw new Error("Authentication service is unavailable");
    const targetEmail = (email || profile?.email || "").trim();
    if (!targetEmail) throw new Error("Please provide a valid email address");
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: "opentune://auth/reset-password",
    });
    if (error) throw error;
  };

  const updatePassword = async (newPassword: string) => {
    if (!supabase) throw new Error("Authentication service is unavailable");
    if (!newPassword || newPassword.length < 6) {
      throw new Error("Password must be at least 6 characters long");
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  };

  const refreshSession = async () => {
    if (!supabase) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setSessionDetails({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
          createdAt: session.user?.created_at,
          lastSignInAt: session.user?.last_sign_in_at,
        });
      }
    } catch {}
  };

  const signOut = async () => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {}
    }
    setProfile(null);
    setSessionDetails(null);
    saveStoredProfile(null);
  };

  return {
    profile,
    sessionDetails,
    loading,
    updateUsername,
    updateAvatarUrl,
    resetPassword,
    updatePassword,
    refreshSession,
    signOut,
  };
}
