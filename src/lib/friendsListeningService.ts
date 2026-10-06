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

const SETTINGS_KEY = "opentune:listening-activity:settings";
const CUSTOM_FRIENDS_KEY = "opentune:listening-activity:custom-friends";
const ACTIVITY_CHANGED_EVENT = "opentune:listening-activity:changed";

interface ListeningSettings {
  enabled: boolean;
  sharingEnabled: boolean;
  showCommunityFriends: boolean;
}

function getStoredSettings(): ListeningSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    enabled: true,
    sharingEnabled: true,
    showCommunityFriends: true,
  };
}

function saveStoredSettings(settings: ListeningSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
  } catch {}
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
}

/** Pre-populated dynamic community listening activities so the panel is vibrant immediately */
const COMMUNITY_FRIENDS: FriendActivity[] = [
  {
    id: "community-1",
    username: "Ahmed M.",
    avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=60",
    isPlaying: true,
    track: {
      id: "track-1",
      title: "Starboy",
      artist: "The Weeknd, Daft Punk",
      album: "Starboy",
      artworkUrl: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=100&auto=format&fit=crop&q=60",
    },
    context: {
      type: "album",
      name: "Starboy",
    },
    timestamp: Date.now() - 1000 * 60 * 2, // 2m ago
    isOnline: true,
  },
  {
    id: "community-2",
    username: "Sarah K.",
    avatarUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=60",
    isPlaying: true,
    track: {
      id: "track-2",
      title: "Blinding Lights",
      artist: "The Weeknd",
      album: "After Hours",
      artworkUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop&q=60",
    },
    context: {
      type: "playlist",
      name: "Today's Top Hits",
    },
    timestamp: Date.now() - 1000 * 60 * 14, // 14m ago
    isOnline: true,
  },
  {
    id: "community-3",
    username: "Ziad Cyber",
    avatarUrl: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=60",
    isPlaying: false,
    track: {
      id: "track-3",
      title: "FE!N",
      artist: "Travis Scott, Playboi Carti",
      album: "UTOPIA",
      artworkUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100&auto=format&fit=crop&q=60",
    },
    context: {
      type: "album",
      name: "UTOPIA",
    },
    timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2h ago
    isOnline: false,
  },
  {
    id: "community-4",
    username: "Nouran E.",
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=60",
    isPlaying: false,
    track: {
      id: "track-4",
      title: "Birds of a Feather",
      artist: "Billie Eilish",
      album: "HIT ME HARD AND SOFT",
      artworkUrl: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=100&auto=format&fit=crop&q=60",
    },
    context: {
      type: "album",
      name: "HIT ME HARD AND SOFT",
    },
    timestamp: Date.now() - 1000 * 60 * 60 * 5, // 5h ago
    isOnline: false,
  },
];

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
        context: track?.album ? { type: "album", name: track.album } : undefined,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.warn("[friends] broadcast presence error:", err);
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

    // 1. Real online peers from Supabase
    for (const peer of this.peerFriends.values()) {
      result.push(peer);
    }

    // 2. Custom friends added by user
    for (const custom of this.customFriends) {
      result.push(custom);
    }

    // 3. Fallback / community demo friends
    if (this.settings.showCommunityFriends) {
      for (const community of COMMUNITY_FRIENDS) {
        if (!result.some((r) => r.username.toLowerCase() === community.username.toLowerCase())) {
          result.push(community);
        }
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

    const newFriend: FriendActivity = {
      id: `custom-${Date.now()}`,
      username: trimmed,
      avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(trimmed)}`,
      isPlaying: true,
      track: {
        id: "custom-track",
        title: "Popular Song",
        artist: "Various Artists",
        album: "OpenTune Favorites",
      },
      context: {
        type: "playlist",
        name: "Discover Weekly",
      },
      timestamp: Date.now(),
      isOnline: true,
      isCustom: true,
    };

    this.customFriends = [newFriend, ...this.customFriends];
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
