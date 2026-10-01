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
              avatarUrl: track.artworkUrl,
            },
          ],
          writers: [{ name: track.artist, role: "Composer, Lyricist", avatarUrl: track.artworkUrl }],
          producers: [],
          label: track.album ? `Released by ${track.album}` : undefined,
        });
      }
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [isOpen, track?.title, track?.artist]);

  const splitArtists = useMemo(() => splitCreditPeople(credits?.artists), [credits?.artists]);
  const splitWriters = useMemo(() => splitCreditPeople(credits?.writers), [credits?.writers]);
  const splitProducers = useMemo(() => splitCreditPeople(credits?.producers), [credits?.producers]);

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

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-2xl bg-[#282828] border border-white/10 p-6 shadow-2xl flex flex-col gap-6 text-white cursor-default max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4 shrink-0">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xl font-bold tracking-tight text-white">Credits</h2>
            <span className="text-sm font-semibold text-white/70 line-clamp-1">
              {credits?.trackTitle || track.title}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex flex-col gap-6 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-white/60">
              <SpinnerSteps size={24} color="currentColor" />
              <span className="text-sm font-medium">Loading credits...</span>
            </div>
          ) : (
            <>
              {/* 1. Performed by */}
              <div className="flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Performed by
                </span>

                <div className="flex flex-col gap-1.5">
                  {splitArtists.map((artist, i) => {
                    const artistId = artist.uri?.replace("spotify:artist:", "") || "";
                    const isFollowed = isArtistFollowedLocally(artist.name, artistId) || (i === 0 && isFollowingArtist);

                    return (
                      <div
                        key={artist.name + i}
                        onClick={() => handleOpenArtist(artist)}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {artist.avatarUrl ? (
                            <img
                              src={artist.avatarUrl}
                              alt={artist.name}
                              className="size-11 rounded-full object-cover ring-1 ring-white/10 shrink-0 group-hover:ring-white/30 transition-all"
                            />
                          ) : (
                            <div className="size-11 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm shrink-0 text-white/90 group-hover:bg-white/20 transition-all">
                              {artist.name[0]?.toUpperCase() || "A"}
                            </div>
                          )}

                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-white truncate group-hover:underline">
                              {artist.name}
                            </span>
                            <span className="text-xs text-white/60 font-medium">
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
                              ? "border-white/60 bg-white text-black hover:bg-white/90"
                              : "border-white/40 text-white hover:bg-white/15",
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
              <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Written by
                </span>

                <div className="flex flex-col gap-1.5">
                  {splitWriters.map((w, i) => (
                    <div
                      key={w.name + i}
                      onClick={() => handleOpenArtist(w)}
                      className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {w.avatarUrl ? (
                          <img
                            src={w.avatarUrl}
                            alt={w.name}
                            className="size-10 rounded-full object-cover ring-1 ring-white/10 shrink-0 group-hover:ring-white/30 transition-all"
                          />
                        ) : (
                          <div className="size-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm shrink-0 text-white/90 group-hover:bg-white/20 transition-all">
                            {w.name[0]?.toUpperCase() || "W"}
                          </div>
                        )}

                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-bold text-white truncate group-hover:underline">
                            {w.name}
                          </span>
                          <span className="text-xs text-white/60 font-medium">
                            {w.role}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Produced by */}
              {Boolean(splitProducers.length) && (
                <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                    Produced by
                  </span>

                  <div className="flex flex-col gap-1.5">
                    {splitProducers.map((p, i) => (
                      <div
                        key={p.name + i}
                        onClick={() => handleOpenArtist(p)}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {p.avatarUrl ? (
                            <img
                              src={p.avatarUrl}
                              alt={p.name}
                              className="size-10 rounded-full object-cover ring-1 ring-white/10 shrink-0 group-hover:ring-white/30 transition-all"
                            />
                          ) : (
                            <div className="size-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm shrink-0 text-white/90 group-hover:bg-white/20 transition-all">
                              {p.name[0]?.toUpperCase() || "P"}
                            </div>
                          )}

                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-white truncate group-hover:underline">
                              {p.name}
                            </span>
                            <span className="text-xs text-white/60 font-medium">
                              {p.role}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Source / Record Label */}
              {(credits?.label || credits?.releaseDate) && (
                <div className="flex flex-col gap-1.5 border-t border-white/10 pt-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                    Source
                  </span>
                  {credits.label && (
                    <span className="text-xs text-white/70 leading-relaxed font-medium">
                      {credits.label}
                    </span>
                  )}
                  {credits.releaseDate && (
                    <span className="text-[11px] text-white/50">
                      Released: {credits.releaseDate}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
