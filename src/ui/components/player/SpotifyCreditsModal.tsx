import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon } from "@/ui/icons";
import { SpinnerSteps } from "@/components/motion/loader";
import { SpotifyService, type SpotifyTrackCredits } from "../../../services/SpotifyService";
import type { Track } from "../../../datasource/types";
import { useArtistNavigation } from "../ArtistLinks";
import {
  isArtistFollowedLocally,
  setArtistFollowedLocally,
  subscribeToFollowedArtists,
} from "../../../player/followedArtists";
import { libraryController } from "../../../player/playerStore";

interface SpotifyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track;
  isFollowingArtist: boolean;
  onToggleFollowArtist: () => void;
}

function splitCreditPeople<T extends { name: string; role: string; avatarUrl?: string; uri?: string }>(
  items?: T[],
): T[] {
  if (!items || items.length === 0) return [];
  const result: T[] = [];
  for (const item of items) {
    if (!item.name) continue;
    const names = item.name
      .split(/,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+and\s+|•/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length > 1) {
      for (const n of names) {
        result.push({
          ...item,
          name: n,
          // Only preserve the avatar if this specific split person matches the source item name
          avatarUrl: n.toLowerCase() === item.name.toLowerCase() ? item.avatarUrl : undefined,
          uri: undefined,
        });
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

export function SpotifyCreditsModal({
  isOpen,
  onClose,
  track,
  isFollowingArtist,
  onToggleFollowArtist,
}: SpotifyCreditsModalProps) {
  const [credits, setCredits] = useState<SpotifyTrackCredits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [extraAvatars, setExtraAvatars] = useState<Record<string, string>>({});
  const navigateArtist = useArtistNavigation();

  // Re-read local followed store reactively so any follow button click updates immediately
  const followedKeys = useSyncExternalStore(
    subscribeToFollowedArtists,
    () => isArtistFollowedLocally(track?.artist),
    () => false,
  );
  void followedKeys;

  useEffect(() => {
    if (!isOpen || !track) return;
    let active = true;
    setIsLoading(true);

    void SpotifyService.getTrackCredits(track.title, track.artist).then((data) => {
      if (!active) return;
      if (data) {
        setCredits(data);
      } else {
        // Fallback default credits from track data
        setCredits({
          trackTitle: track.title,
          artists: [
            {
              name: track.artist,
              role: "Main Artist",
              avatarUrl: undefined,
            },
          ],
          writers: [{ name: track.artist, role: "Composer, Lyricist", avatarUrl: undefined }],
          producers: [],
        });
      }
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [isOpen, track?.title, track?.artist]);

  const splitArtists = useMemo(() => splitCreditPeople(credits?.artists), [credits?.artists]);
  const rawWriters = useMemo(() => splitCreditPeople(credits?.writers), [credits?.writers]);
  const rawProducers = useMemo(() => splitCreditPeople(credits?.producers), [credits?.producers]);

  // Match writers and producers against performers list first (e.g. Marwan Pablo, Lege-Cy, HatemBas)
  const splitWriters = useMemo(() => {
    return rawWriters.map((w) => {
      const matchedArtist = splitArtists.find(
        (a) => a.name.trim().toLowerCase() === w.name.trim().toLowerCase(),
      );
      if (matchedArtist?.avatarUrl) {
        return { ...w, avatarUrl: matchedArtist.avatarUrl, uri: matchedArtist.uri || w.uri };
      }
      return w;
    });
  }, [rawWriters, splitArtists]);

  const splitProducers = useMemo(() => {
    return rawProducers.map((p) => {
      const matchedArtist = splitArtists.find(
        (a) => a.name.trim().toLowerCase() === p.name.trim().toLowerCase(),
      );
      if (matchedArtist?.avatarUrl) {
        return { ...p, avatarUrl: matchedArtist.avatarUrl, uri: matchedArtist.uri || p.uri };
      }
      return p;
    });
  }, [rawProducers, splitArtists]);

  useEffect(() => {
    const allPeople = [...splitArtists, ...splitWriters, ...splitProducers];
    const missing = allPeople.filter(
      (p) => !p.avatarUrl && !extraAvatars[p.name.trim().toLowerCase()],
    );
    if (missing.length === 0) return;
    let active = true;

    for (const p of missing) {
      void SpotifyService.getArtistAvatar(p.uri || p.name).then((url) => {
        if (active && url) {
          setExtraAvatars((prev) => ({ ...prev, [p.name.trim().toLowerCase()]: url }));
        }
      });
    }

    return () => {
      active = false;
    };
  }, [splitArtists, splitWriters, splitProducers, extraAvatars]);

  if (!isOpen) return null;

  const handleOpenArtist = (person: { name: string; uri?: string }) => {
    onClose();
    const artistId = person.uri?.replace("spotify:artist:", "") || "";
    navigateArtist?.({ id: artistId, name: person.name }, false);
  };

  const handleToggleFollowPerson = (artist: { name: string; uri?: string }, isFirst: boolean) => {
    const artistId = artist.uri?.replace("spotify:artist:", "") || "";
    const isFollowed = isArtistFollowedLocally(artist.name, artistId);
    const nextState = !isFollowed;
    setArtistFollowedLocally(artistId, artist.name, nextState);
    void libraryController.setArtistSubscribed(
      { id: artistId, name: artist.name },
      nextState,
    );
    if (isFirst) {
      onToggleFollowArtist();
    }
  };

  // Resolve avatar for a person, ensuring no two different people display identical avatar images
  const getAvatarFor = (name: string, explicitUrl?: string) => {
    const raw = explicitUrl || extraAvatars[name.trim().toLowerCase()];
    if (!raw) return undefined;
    // Check if another artist in splitArtists already claimed this URL under a different name
    const conflictingPerformer = splitArtists.find(
      (a) => a.name.trim().toLowerCase() !== name.trim().toLowerCase() && (a.avatarUrl || extraAvatars[a.name.trim().toLowerCase()]) === raw,
    );
    if (conflictingPerformer) {
      return undefined;
    }
    return raw;
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-2xl bg-card border border-border/50 p-6 shadow-2xl flex flex-col gap-6 text-foreground cursor-default max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/40 pb-4 shrink-0">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Credits</h2>
            <span className="text-sm font-semibold text-muted-foreground line-clamp-1">
              {credits?.trackTitle || track.title}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex flex-col gap-6 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(128,128,128,0.2)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <SpinnerSteps size={24} color="currentColor" />
              <span className="text-sm font-medium">Loading credits...</span>
            </div>
          ) : (
            <>
              {/* 1. Performed by */}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Performed by
                </span>

                <div className="flex flex-col gap-1.5">
                  {splitArtists.map((artist, i) => {
                    const artistId = artist.uri?.replace("spotify:artist:", "") || "";
                    const isFollowed = isArtistFollowedLocally(artist.name, artistId) || (i === 0 && isFollowingArtist);
                    const avatar = getAvatarFor(artist.name, artist.avatarUrl);

                    return (
                      <div
                        key={artist.name + i}
                        onClick={() => handleOpenArtist(artist)}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={artist.name}
                              className="size-11 rounded-full object-cover ring-1 ring-border shrink-0 group-hover:ring-foreground/30 transition-all"
                            />
                          ) : (
                            <div className="size-11 rounded-full bg-muted flex items-center justify-center font-bold text-sm shrink-0 text-muted-foreground group-hover:bg-muted/80 transition-all">
                              {artist.name[0]?.toUpperCase() || "A"}
                            </div>
                          )}

                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-foreground truncate group-hover:underline">
                              {artist.name}
                            </span>
                            <span className="text-xs text-muted-foreground font-medium">
                              {artist.role}
                            </span>
                          </div>
                        </div>

                        {/* Individual Follow toggle button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFollowPerson(artist, i === 0);
                          }}
                          className={cn(
                            "rounded-full px-4 py-1.5 text-xs font-bold border transition-all cursor-pointer shrink-0",
                            isFollowed
                              ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
                              : "border-border text-foreground hover:bg-muted",
                          )}
                        >
                          {isFollowed ? "Following" : "Follow"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Written by */}
              <div className="flex flex-col gap-3 border-t border-border/40 pt-4">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Written by
                </span>

                <div className="flex flex-col gap-1.5">
                  {splitWriters.map((w, i) => {
                    const avatar = getAvatarFor(w.name, w.avatarUrl);
                    return (
                      <div
                        key={w.name + i}
                        onClick={() => handleOpenArtist(w)}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={w.name}
                              className="size-10 rounded-full object-cover ring-1 ring-border shrink-0 group-hover:ring-foreground/30 transition-all"
                            />
                          ) : (
                            <div className="size-10 rounded-full bg-muted flex items-center justify-center font-bold text-sm shrink-0 text-muted-foreground group-hover:bg-muted/80 transition-all">
                              {w.name[0]?.toUpperCase() || "W"}
                            </div>
                          )}

                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-foreground truncate group-hover:underline">
                              {w.name}
                            </span>
                            <span className="text-xs text-muted-foreground font-medium">
                              {w.role}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Produced by */}
              {Boolean(splitProducers.length) && (
                <div className="flex flex-col gap-3 border-t border-border/40 pt-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Produced by
                  </span>

                  <div className="flex flex-col gap-1.5">
                    {splitProducers.map((p, i) => {
                      const avatar = getAvatarFor(p.name, p.avatarUrl);
                      return (
                        <div
                          key={p.name + i}
                          onClick={() => handleOpenArtist(p)}
                          className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {avatar ? (
                              <img
                                src={avatar}
                                alt={p.name}
                                className="size-10 rounded-full object-cover ring-1 ring-border shrink-0 group-hover:ring-foreground/30 transition-all"
                              />
                            ) : (
                              <div className="size-10 rounded-full bg-muted flex items-center justify-center font-bold text-sm shrink-0 text-muted-foreground group-hover:bg-muted/80 transition-all">
                                {p.name[0]?.toUpperCase() || "P"}
                              </div>
                            )}

                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-bold text-foreground truncate group-hover:underline">
                                {p.name}
                              </span>
                              <span className="text-xs text-muted-foreground font-medium">
                                {p.role}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
