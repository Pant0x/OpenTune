import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getStoredProfile } from "./authProfile";
import type { Track } from "../datasource/types";
import { playerController } from "../player/playerStore";

export interface FriendTrackInfo {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
}

export interface FriendActivity {
  id: string;
  username: string;
  avatarUrl?: string;
  isPlaying: boolean;
  track?: FriendTrackInfo;
  context?: {
    type: "playlist" | "album" | "artist" | "track";
    name: string;
  };
  timestamp: number;
  isOnline: boolean;
  isCustom?: boolean;
}

import { getAppSetting, setAppSetting } from "../internal/appSettings";

const SETTINGS_KEY = "opentune:listening-activity:settings";
const CUSTOM_FRIENDS_KEY = "opentune:listening-activity:custom-friends";
const ACTIVITY_CHANGED_EVENT = "opentune:listening-activity:changed";

interface ListeningSettings {
  enabled: boolean;
  sharingEnabled: boolean;
}

function getStoredSettings(): ListeningSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    enabled: true,
    sharingEnabled: true,
  };
}

function saveStoredSettings(settings: ListeningSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
  } catch {}
  void setAppSetting(SETTINGS_KEY, settings);
}

function getStoredCustomFriends(): FriendActivity[] {
  try {
    const raw = localStorage.getItem(CUSTOM_FRIENDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveStoredCustomFriends(friends: FriendActivity[]) {
  try {
    localStorage.setItem(CUSTOM_FRIENDS_KEY, JSON.stringify(friends));
    window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
  } catch {}
  void setAppSetting(CUSTOM_FRIENDS_KEY, friends);
}

export async function hydrateFriendsListeningSettings(): Promise<void> {
  try {
    const storedSettings = await getAppSetting<ListeningSettings>(SETTINGS_KEY);
    if (storedSettings && typeof storedSettings.enabled === "boolean") {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(storedSettings));
    }
    const storedFriends = await getAppSetting<FriendActivity[]>(CUSTOM_FRIENDS_KEY);
    if (Array.isArray(storedFriends)) {
      localStorage.setItem(CUSTOM_FRIENDS_KEY, JSON.stringify(storedFriends));
    }
    window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
  } catch {}
}

class FriendsListeningService {
  private settings: ListeningSettings = getStoredSettings();
  private customFriends: FriendActivity[] = getStoredCustomFriends();
  private peerFriends: Map<string, FriendActivity> = new Map();
  private realtimeChannel: any = null;
  private currentTrackState: Track | null = null;
  private isCurrentlyPlaying = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.initRealtime();
      this.initPlayerSubscription();
    }
  }

  private initRealtime() {
    if (!supabase) return;

    try {
      this.realtimeChannel = supabase.channel("opentune-presence-room", {
        config: { presence: { key: "online-users" } },
      });

      this.realtimeChannel
        .on("presence", { event: "sync" }, () => {
          const state = this.realtimeChannel.presenceState();
          const currentProfile = getStoredProfile();
          const newPeers = new Map<string, FriendActivity>();

          for (const key of Object.keys(state)) {
            const presences = state[key] as any[];
            for (const presence of presences) {
              if (presence.userId && presence.userId !== currentProfile?.id) {
                newPeers.set(presence.userId, {
                  id: presence.userId,
                  username: presence.username || "OpenTune User",
                  avatarUrl: presence.avatarUrl,
                  isPlaying: Boolean(presence.isPlaying),
                  track: presence.track,
                  context: presence.context,
                  timestamp: presence.timestamp || Date.now(),
                  isOnline: true,
                });
              }
            }
          }

          this.peerFriends = newPeers;
          window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
        })
        .subscribe(async (status: string) => {
          if (status === "SUBSCRIBED") {
            await this.broadcastCurrentPresence();
          }
        });
    } catch (err) {
      console.warn("[friends] Realtime presence setup:", err);
    }
  }

  private initPlayerSubscription() {
    try {
      playerController.subscribe(() => {
        const state = playerController.getState();
        const nextTrack = state.currentTrack;
        const nextPlaying = state.status === "playing";

        if (
          this.currentTrackState?.id !== nextTrack?.id ||
          this.isCurrentlyPlaying !== nextPlaying
        ) {
          this.currentTrackState = nextTrack;
          this.isCurrentlyPlaying = nextPlaying;
          void this.broadcastCurrentPresence();
        }
      });
    } catch {}
  }

  public async broadcastCurrentPresence() {
    if (!this.realtimeChannel || !this.settings.sharingEnabled || !this.settings.enabled) {
      if (this.realtimeChannel) {
        try {
          await this.realtimeChannel.untrack();
        } catch {}
      }
      return;
    }

    const profile = getStoredProfile();
    if (!profile) return;

    const track = this.currentTrackState;
    try {
      await this.realtimeChannel.track({
        userId: profile.id,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        isPlaying: this.isCurrentlyPlaying,
        track: track
          ? {
              id: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              artworkUrl: track.artworkUrl,
            }
          : undefined,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn("[friends] Broadcast presence failed:", err);
    }
  }

  public getSettings(): ListeningSettings {
    return this.settings;
  }

  public setSettings(patch: Partial<ListeningSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveStoredSettings(this.settings);
    void this.broadcastCurrentPresence();
  }

  public getFriendsList(): FriendActivity[] {
    if (!this.settings.enabled) return [];

    const result: FriendActivity[] = [];
    const addedUsernames = new Set<string>();

    // 1. Custom friends added by the user
    for (const custom of this.customFriends) {
      // Check if this friend is currently online in the presence room
      let livePeer: FriendActivity | undefined;
      for (const peer of this.peerFriends.values()) {
        if (
          peer.username.toLowerCase() === custom.username.toLowerCase() ||
          peer.id === custom.id
        ) {
          livePeer = peer;
          break;
        }
      }

      if (livePeer) {
        result.push({
          ...custom,
          isPlaying: livePeer.isPlaying,
          track: livePeer.track,
          context: livePeer.context,
          avatarUrl: livePeer.avatarUrl || custom.avatarUrl,
          isOnline: true,
          timestamp: livePeer.timestamp,
        });
      } else {
        result.push(custom);
      }
      addedUsernames.add(custom.username.toLowerCase());
    }

    // 2. Real online peers connected to the same live room
    for (const peer of this.peerFriends.values()) {
      if (!addedUsernames.has(peer.username.toLowerCase())) {
        result.push(peer);
      }
    }

    // Sort: Currently playing first, then newest timestamp
    return result.sort((a, b) => {
      if (a.isPlaying && !b.isPlaying) return -1;
      if (!a.isPlaying && b.isPlaying) return 1;
      return b.timestamp - a.timestamp;
    });
  }

  public addCustomFriend(name: string, avatarUrl?: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Check if an online peer has this username
    let livePeer: FriendActivity | undefined;
    for (const peer of this.peerFriends.values()) {
      if (peer.username.toLowerCase() === trimmed.toLowerCase()) {
        livePeer = peer;
        break;
      }
    }

    const newFriend: FriendActivity = {
      id: livePeer ? livePeer.id : `friend-${Date.now()}`,
      username: livePeer ? livePeer.username : trimmed,
      avatarUrl:
        avatarUrl ||
        livePeer?.avatarUrl ||
        `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(trimmed)}`,
      isPlaying: livePeer ? livePeer.isPlaying : false,
      track: livePeer?.track,
      context: livePeer?.context,
      timestamp: livePeer ? livePeer.timestamp : Date.now(),
      isOnline: Boolean(livePeer?.isOnline),
      isCustom: true,
    };

    // Prevent duplicate
    this.customFriends = [
      newFriend,
      ...this.customFriends.filter(
        (f) => f.username.toLowerCase() !== trimmed.toLowerCase()
      ),
    ];
    saveStoredCustomFriends(this.customFriends);
  }

  public removeCustomFriend(id: string) {
    this.customFriends = this.customFriends.filter((f) => f.id !== id);
    saveStoredCustomFriends(this.customFriends);
  }
}

export const friendsListeningService = new FriendsListeningService();

export function useFriendsActivity() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const handleUpdate = () => setVersion((v) => v + 1);
    window.addEventListener(ACTIVITY_CHANGED_EVENT, handleUpdate);
    return () => window.removeEventListener(ACTIVITY_CHANGED_EVENT, handleUpdate);
  }, []);

  const settings = friendsListeningService.getSettings();
  const friends = friendsListeningService.getFriendsList();

  return {
    settings,
    friends,
    setSettings: (patch: Partial<ListeningSettings>) => friendsListeningService.setSettings(patch),
    addFriend: (name: string, avatarUrl?: string) => friendsListeningService.addCustomFriend(name, avatarUrl),
    removeFriend: (id: string) => friendsListeningService.removeCustomFriend(id),
  };
}
