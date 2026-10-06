import { useState } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, SettingsIcon, UserPlusIcon, PlayIcon, TrashIcon } from "@/ui/icons";
import { useFriendsActivity } from "../../lib/friendsListeningService";
import { Tooltip } from "@/components/motion/tooltip";
import type { Track } from "../../datasource/types";

interface ListeningActivityPanelProps {
  onClose: () => void;
  onOpenSettings?: () => void;
  onPlayTrack?: (track: Partial<Track>) => void;
}

function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

/** Animated 3-bar equalizer wave matching Spotify's active friend indicator */
function EqualizerWave() {
  return (
    <div className="flex items-end gap-0.5 h-3.5 w-3" aria-label="Listening now">
      <span className="w-0.5 bg-primary rounded-full animate-bounce h-2" style={{ animationDuration: "0.8s" }} />
      <span className="w-0.5 bg-primary rounded-full animate-bounce h-3.5" style={{ animationDuration: "0.6s", animationDelay: "0.2s" }} />
      <span className="w-0.5 bg-primary rounded-full animate-bounce h-2.5" style={{ animationDuration: "0.7s", animationDelay: "0.4s" }} />
    </div>
  );
}

export function ListeningActivityPanel({
  onClose,
  onOpenSettings,
  onPlayTrack,
}: ListeningActivityPanelProps) {
  const { settings, friends, setSettings, addFriend, removeFriend } = useFriendsActivity();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newFriendName, setNewFriendName] = useState("");

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFriendName.trim()) {
      addFriend(newFriendName.trim());
      setNewFriendName("");
      setIsAddModalOpen(false);
    }
  };

  return (
    <aside
      className="flex h-full w-full flex-col bg-background/95 backdrop-blur-md border-l border-border/40 select-none overflow-hidden"
      aria-label="Friend Activity"
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between px-4 border-b border-border/20">
        <h2 className="text-sm font-bold text-foreground tracking-tight">
          Listening activity
        </h2>

        <div className="flex items-center gap-1">
          {settings.enabled && (
            <Tooltip side="bottom" content="Add friend">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
                aria-label="Add friend"
              >
                <UserPlusIcon size={16} />
              </button>
            </Tooltip>
          )}

          {onOpenSettings && (
            <Tooltip side="bottom" content="Activity settings">
              <button
                type="button"
                onClick={onOpenSettings}
                className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
                aria-label="Settings"
              >
                <SettingsIcon size={16} />
              </button>
            </Tooltip>
          )}

          <Tooltip side="bottom" content="Close">
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
              aria-label="Close"
            >
              <CloseIcon size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0 custom-scrollbar">
        {!settings.enabled ? (
          /* Empty / Turned Off State matching Spotify reference */
          <div className="flex flex-col items-start gap-4 pt-4">
            <p className="text-sm font-semibold text-foreground leading-snug">
              Let friends and followers on OpenTune see what you're listening to.
            </p>

            {/* Skeleton Avatars with live blue indicator */}
            <div className="flex flex-col gap-4 w-full py-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <div className="relative size-10 rounded-full bg-card/80 border border-border/50 grid place-items-center shrink-0">
                    <svg className="size-5 text-muted-foreground/60" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                    <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-blue-500 ring-2 ring-background" />
                  </div>
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="h-2.5 w-24 rounded-full bg-card/70" />
                    <div className="h-2 w-16 rounded-full bg-card/40" />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Go to Settings &gt; Listening activity, and turn on Listening activity. You can turn this off at any time.
            </p>

            <button
              type="button"
              onClick={() => {
                setSettings({ enabled: true });
              }}
              className="mt-2 rounded-full bg-foreground px-6 py-2.5 text-xs font-bold text-background shadow-md transition hover:bg-foreground/90 active:scale-95 cursor-pointer"
            >
              Turn On
            </button>
          </div>
        ) : friends.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary mb-3.5">
              <UserPlusIcon size={26} />
            </div>
            <p className="text-sm font-bold text-foreground">No Friends Added Yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[220px] leading-relaxed">
              Add your friends by username to see what they are listening to in real time!
            </p>
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="mt-4 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-sm cursor-pointer"
            >
              Add Friend
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {friends.map((friend) => (
              <div
                key={friend.id}
                className="group relative flex items-start gap-3 rounded-xl p-2 transition-colors hover:bg-card/50"
              >
                {/* Avatar with Status indicator */}
                <div className="relative shrink-0">
                  {friend.avatarUrl ? (
                    <img
                      src={friend.avatarUrl}
                      alt={friend.username}
                      className="size-10 rounded-full object-cover ring-1 ring-border/50"
                    />
                  ) : (
                    <div className="size-10 rounded-full bg-primary/20 text-primary grid place-items-center font-bold text-sm ring-1 ring-border/50">
                      {friend.username[0]?.toUpperCase() || "U"}
                    </div>
                  )}

                  {/* Online indicator: Blue if live, green if recent */}
                  {friend.isPlaying ? (
                    <span
                      className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-blue-500 ring-2 ring-background shadow-xs"
                      title="Listening now"
                    />
                  ) : friend.isOnline ? (
                    <span
                      className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
                      title="Online"
                    />
                  ) : null}
                </div>

                {/* Friend Information */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-semibold text-foreground group-hover:underline cursor-pointer">
                      {friend.username}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground font-mono">
                      {friend.isPlaying ? <EqualizerWave /> : formatTimeAgo(friend.timestamp)}
                    </span>
                  </div>

                  {friend.track ? (
                    <div className="mt-0.5 flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-xs font-medium cursor-pointer transition-colors",
                            friend.isPlaying ? "text-foreground" : "text-muted-foreground",
                            "hover:text-primary hover:underline",
                          )}
                          onClick={() => {
                            if (friend.track && onPlayTrack) {
                              onPlayTrack({
                                id: friend.track.id,
                                title: friend.track.title,
                                artist: friend.track.artist,
                                album: friend.track.album,
                                artworkUrl: friend.track.artworkUrl,
                              });
                            }
                          }}
                        >
                          {friend.track.title}
                        </span>

                        {onPlayTrack && (
                          <button
                            type="button"
                            onClick={() => {
                              if (friend.track) {
                                onPlayTrack({
                                  id: friend.track.id,
                                  title: friend.track.title,
                                  artist: friend.track.artist,
                                  album: friend.track.album,
                                  artworkUrl: friend.track.artworkUrl,
                                });
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-full hover:bg-card text-muted-foreground hover:text-foreground"
                            aria-label={`Play ${friend.track.title}`}
                          >
                            <PlayIcon size={12} />
                          </button>
                        )}
                      </div>

                      <span className="truncate text-[11px] text-muted-foreground">
                        {friend.track.artist}
                      </span>

                      {friend.context && (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                          <svg className="size-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                          </svg>
                          <span className="truncate">{friend.context.name}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] italic text-muted-foreground/60">
                      Not listening to anything
                    </span>
                  )}
                </div>

                {/* Remove button for custom friends */}
                {friend.isCustom && (
                  <button
                    type="button"
                    onClick={() => removeFriend(friend.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-destructive"
                    aria-label="Remove friend"
                  >
                    <TrashIcon size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer controls */}
      {settings.enabled && (
        <div className="shrink-0 border-t border-border/20 p-3 bg-card/20 flex items-center justify-between text-xs text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={settings.sharingEnabled}
              onChange={(e) => setSettings({ sharingEnabled: e.target.checked })}
              className="accent-primary rounded size-3.5 cursor-pointer"
            />
            <span>Share what I'm playing</span>
          </label>
        </div>
      )}

      {/* Add Friend Dialog */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xs rounded-2xl bg-card border border-border p-5 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-sm font-bold text-foreground">Add Friend</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter a username or music buddy name to follow their listening activity.
            </p>

            <form onSubmit={handleAddSubmit} className="mt-4 flex flex-col gap-3">
              <input
                type="text"
                autoFocus
                placeholder="Friend username…"
                value={newFriendName}
                onChange={(e) => setNewFriendName(e.target.value)}
                className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground border border-border focus:border-primary focus:outline-none"
              />

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFriendName.trim()}
                  className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
