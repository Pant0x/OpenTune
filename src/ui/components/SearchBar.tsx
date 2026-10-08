import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  SearchIcon,
  ClockIcon,
  PlayIcon,
} from "@/ui/icons";
import { isMacOS, primaryModifierLabel } from "../platform";
import { playerController, searchController } from "../../player/playerStore";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import type { Album, Artist, Playlist, SearchResults, Track } from "../../datasource/types";
import { useArtistNavigation, useAlbumNavigation } from "./ArtistLinks";
import { TrackArtwork } from "./TrackArtwork";
import { useSpotifyArtistAvatar } from "../../services/SpotifyService";
import { recordSearchSelection, simplifyText } from "../../player/searchAffinity";
import { normTranslit, parseSubscriberCount } from "../../datasource/searchNormalize";
import { parsePlaylistShareLink, registerSharedPlaylist } from "../../player/playlistShare";

const RECENT_SEARCHES_KEY = "amber:recent-searches";
const MAX_RECENT_SEARCHES = 6;

function loadRecentSearches(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const existing = loadRecentSearches().filter(
      (item) => item.toLocaleLowerCase() !== trimmed.toLocaleLowerCase(),
    );
    const updated = [trimmed, ...existing].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {}
}

function removeRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  try {
    const existing = loadRecentSearches().filter(
      (item) => item.toLocaleLowerCase() !== trimmed.toLocaleLowerCase(),
    );
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(existing));
    return existing;
  } catch {
    return [];
  }
}

function clearAllRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {}
}

interface SearchBarProps {
  onSearch?: (query: string, openInNewTab?: boolean) => void;
  onOpen?: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigatePlaylist?: (playlist: Playlist) => void;
}

function SearchTopArtistRow({
  artist,
  onSelect,
}: {
  artist: Artist;
  onSelect: (artist: Artist) => void;
}) {
  const spotifyAvatar = useSpotifyArtistAvatar(artist.name, artist.artworkUrl);
  return (
    <div className="pt-1">
      <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Top Artist
      </div>
      <button
        type="button"
        onClick={() => onSelect(artist)}
        className="group flex items-center gap-3.5 w-full rounded-xl p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none"
      >
        <div className="size-12 shrink-0 overflow-hidden rounded-full bg-muted/40 ring-1 ring-border/20 shadow-md">
          <TrackArtwork
            artworkUrl={spotifyAvatar || artist.artworkUrl}
            size={48}
            className="size-full object-cover"
            iconSize={22}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-bold text-foreground group-hover:text-primary transition-colors">
            {artist.name}
          </span>
          <span className="text-xs text-muted-foreground">Artist</span>
        </div>
      </button>
    </div>
  );
}

export function SearchBar({
  onSearch,
  onOpen,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNavigatePlaylist,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [previewResults, setPreviewResults] = useState<SearchResults | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

  const navigateArtist = useArtistNavigation();
  const navigateAlbum = useAlbumNavigation();

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const latestQueryRef = useRef("");

  const showBackButton = canGoBack || canGoForward;

  // Global Ctrl+Space / Cmd+Space shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = isMacOS ? e.metaKey : e.ctrlKey;
      if (modifier && e.code === "Space") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setIsOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch search suggestions and quick preview entities
  const fetchSuggestionsAndPreview = useCallback((searchQuery: string) => {
    const trimmed = searchQuery.trim();
    latestQueryRef.current = trimmed;
    const currentRequestId = ++requestIdRef.current;

    if (!trimmed) {
      setSuggestions([]);
      setPreviewResults(null);
      return;
    }

    try {
      void searchController
        .search(trimmed, (updated: SearchResults) => {
          if (currentRequestId === requestIdRef.current) {
            setPreviewResults(updated);
          }
        })
        .then((results: SearchResults) => {
          if (currentRequestId === requestIdRef.current && results) {
            setPreviewResults(results);
          }
        });

      void searchController
        .getSearchSuggestions(trimmed, (updated: string[]) => {
          if (currentRequestId === requestIdRef.current) {
            setSuggestions(updated.slice(0, 4));
          }
        })
        .then((results: string[]) => {
          if (currentRequestId === requestIdRef.current) {
            setSuggestions((results || []).slice(0, 4));
          }
        });
    } catch {}
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(-1);
    setIsOpen(true);

    if (!value.trim()) {
      latestQueryRef.current = "";
      ++requestIdRef.current;
      setSuggestions([]);
      setPreviewResults(null);
    }

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      fetchSuggestionsAndPreview(value);
    }, 150);
  };

  const handleExecuteSearch = (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    saveRecentSearch(trimmed);
    setRecentSearches(loadRecentSearches());
    setIsOpen(false);
    inputRef.current?.blur();
    if (onSearch) {
      onSearch(trimmed, false);
    } else {
      onOpen?.();
    }
  };

  const handleSelectArtist = (artist: Artist) => {
    setIsOpen(false);
    inputRef.current?.blur();
    recordSearchSelection(query, { id: artist.id, name: artist.name });
    saveRecentSearch(artist.name);
    setRecentSearches(loadRecentSearches());
    navigateArtist?.(artist, false);
  };

  const handleSelectAlbum = (album: Album) => {
    setIsOpen(false);
    inputRef.current?.blur();
    recordSearchSelection(query, { id: album.id, title: album.title, artist: album.artist });
    saveRecentSearch(album.title);
    setRecentSearches(loadRecentSearches());
    navigateAlbum?.(album, false);
  };

  const handleSelectPlaylist = (playlist: Playlist) => {
    setIsOpen(false);
    inputRef.current?.blur();
    recordSearchSelection(query, { id: playlist.id, title: playlist.title });
    saveRecentSearch(playlist.title);
    setRecentSearches(loadRecentSearches());
    onNavigatePlaylist?.(playlist);
  };

  const handlePlayTrack = (track: Track) => {
    setIsOpen(false);
    inputRef.current?.blur();
    recordSearchSelection(query, { id: track.id, title: track.title, artist: track.artist });
    saveRecentSearch(track.title);
    setRecentSearches(loadRecentSearches());
    void playerController.playTrackById(track.id);
  };

  const handleRemoveRecentSearch = (e: React.MouseEvent, item: string) => {
    e.stopPropagation();
    const updated = removeRecentSearch(item);
    setRecentSearches(updated);
  };

  const handleClearAllRecentSearches = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearAllRecentSearches();
    setRecentSearches([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = query.trim() ? suggestions : recentSearches;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen && (query.trim() || recentSearches.length > 0)) {
        setIsOpen(true);
        return;
      }
      if (items.length > 0) {
        setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && items[selectedIndex]) {
        const selected = items[selectedIndex];
        setQuery(selected);
        handleExecuteSearch(selected);
      } else {
        handleExecuteSearch(query);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    setQuery("");
    setSuggestions([]);
    setPreviewResults(null);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const hasQuery = Boolean(query.trim());
  const shouldShowDropdown = isOpen && (hasQuery || recentSearches.length > 0);
  const matchingArtist = useMemo(() => {
    const artists = previewResults?.artists;
    if (!artists?.length) return undefined;

    if (/\bpanto\b|prodbypanto/i.test(query)) {
      const panto = artists.find(
        (a) => a.name.toLowerCase() === "panto" || /prodbypanto/i.test(a.id)
      ) || artists.find(
        (a) => a.name.toLowerCase().includes("panto")
      );
      if (panto) return panto;
    }

    const querySimp = simplifyText(query);
    const queryTranslit = normTranslit(query);

    // 1. If suggestions are available, check if an artist matches top suggestions
    if (suggestions.length > 0) {
      for (const sugg of suggestions) {
        const simpSugg = simplifyText(sugg);
        const translitSugg = normTranslit(sugg);
        if (!simpSugg) continue;

        // Exact match with suggestion (e.g. sugg is "drake" and artist is "Drake")
        const exactMatch = artists.find((a) => {
          const aSimp = simplifyText(a.name);
          const aTranslit = normTranslit(a.name);
          return aSimp === simpSugg || (translitSugg && aTranslit === translitSugg);
        });
        if (exactMatch) return exactMatch;

        // Suggestion prefix matches, prioritized by official artist status and subscriber count
        const candidateMatches = artists.filter((a) => {
          const aSimp = simplifyText(a.name);
          const aTranslit = normTranslit(a.name);
          return (
            (simpSugg.length >= 3 && aSimp.startsWith(simpSugg)) ||
            (translitSugg && translitSugg.length >= 3 && aTranslit.startsWith(translitSugg))
          );
        });
        if (candidateMatches.length > 0) {
          candidateMatches.sort((a, b) => {
            if (!a.isCreator && b.isCreator) return -1;
            if (a.isCreator && !b.isCreator) return 1;
            return parseSubscriberCount(b.subscriberCount) - parseSubscriberCount(a.subscriberCount);
          });
          return candidateMatches[0];
        }
      }
    }

    // 2. Transliteration match with query (e.g. 'sherein' -> 'Sherine', 'fayrouz' -> 'Fairouz')
    if (queryTranslit) {
      const translitMatch = artists.find((a) => normTranslit(a.name) === queryTranslit);
      if (translitMatch) return translitMatch;
    }

    // 3. Prefix match with query, prioritizing official artists and subscriber count
    const queryMatches = artists.filter((a) => {
      const aSimp = simplifyText(a.name);
      const aTranslit = normTranslit(a.name);
      return (
        (querySimp && aSimp.startsWith(querySimp)) ||
        (queryTranslit && aTranslit.startsWith(queryTranslit))
      );
    });
    if (queryMatches.length > 0) {
      queryMatches.sort((a, b) => {
        if (!a.isCreator && b.isCreator) return -1;
        if (a.isCreator && !b.isCreator) return 1;
        return parseSubscriberCount(b.subscriberCount) - parseSubscriberCount(a.subscriberCount);
      });
      return queryMatches[0];
    }

    return artists[0];
  }, [previewResults?.artists, query, suggestions]);
  const matchingAlbums = (previewResults?.albums ?? []).slice(0, 2);
  const matchingPlaylists = (previewResults?.playlists ?? []).slice(0, 2);
  const matchingTracks = (previewResults?.tracks ?? []).slice(0, 2);

  const sharedPlaylistPreview = useMemo(() => {
    const rawTrimmed = query.trim();
    if (
      rawTrimmed.startsWith("opentune://")
      || rawTrimmed.includes("list=")
      || rawTrimmed.includes("spotify.com/playlist/")
      || rawTrimmed.startsWith("spotify:playlist:")
    ) {
      const share = parsePlaylistShareLink(rawTrimmed);
      if (share) {
        if (share.type === "data") {
          return registerSharedPlaylist(share.data);
        }
        if (share.type === "youtube") {
          return {
            id: share.playlistId.startsWith("VL") ? share.playlistId : `VL${share.playlistId}`,
            title: share.name || "YouTube Playlist",
            owner: "YouTube",
          } as Playlist;
        }
      }
    }
    return null;
  }, [query]);

  return (
    <div ref={containerRef} data-tauri-drag-region="none" className="relative flex items-center gap-1.5 max-w-lg mx-auto w-full z-40">
      {showBackButton && (
        <Tooltip content="Back">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Go back"
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <ArrowLeftIcon size={16} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}
      {canGoForward && (
        <Tooltip content="Forward">
          <Button
            variant="ghost"
            size="icon"
            onClick={onForward}
            disabled={!canGoForward}
            aria-label="Go forward"
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <ArrowRightIcon size={16} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}

      <div className="relative flex min-w-0 flex-1 items-center">
        <div className="group relative flex h-8 sm:h-8.5 w-full items-center gap-2 rounded-full bg-black/[0.05] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.11] focus-within:bg-black/[0.10] dark:focus-within:bg-white/[0.14] backdrop-blur-xl px-3 border border-black/10 dark:border-white/10 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          <SearchIcon size={15} className="shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              setIsOpen(true);
              if (query.trim()) fetchSuggestionsAndPreview(query);
            }}
            onClick={() => {
              if (!isOpen) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="What do you want to play?"
            aria-label="Search music"
            data-tauri-drag-region="none"
            className="min-w-0 flex-1 bg-transparent text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/70 outline-none"
          />

          {query ? (
            <button
              type="button"
              onClick={handleClear}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none"
              aria-label="Clear search"
            >
              <CloseIcon size={13} />
            </button>
          ) : (
            <kbd className="ml-auto hidden md:inline-flex shrink-0 items-center rounded-md bg-black/5 dark:bg-white/10 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground border border-black/10 dark:border-white/10">
              {primaryModifierLabel} Space
            </kbd>
          )}
        </div>

        {/* Spotify-style Dropdown with query suggestions, closest artist card, albums and playlists */}
        <AnimatePresence>
          {shouldShowDropdown && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 right-0 top-full mt-1.5 max-h-[75vh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl backdrop-blur-2xl p-2 flex flex-col gap-2 z-50"
            >
              {hasQuery ? (
                <>
                  {/* Shared Playlist Link Quick Action */}
                  {sharedPlaylistPreview && (
                    <div className="pb-1.5 border-b border-border/30">
                      <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                        Shared Playlist Link
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectPlaylist(sharedPlaylistPreview)}
                        className="group flex items-center gap-3 w-full rounded-xl p-2.5 text-left bg-primary/10 hover:bg-primary/20 transition-colors"
                      >
                        <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-primary/20 ring-1 ring-primary/40 flex items-center justify-center">
                          {sharedPlaylistPreview.artworkUrl ? (
                            <TrackArtwork artworkUrl={sharedPlaylistPreview.artworkUrl} size={40} className="size-full object-cover" />
                          ) : (
                            <PlayIcon size={20} className="text-primary" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                            {sharedPlaylistPreview.title}
                          </span>
                          <span className="text-xs text-muted-foreground">Click to open shared playlist</span>
                        </div>
                      </button>
                    </div>
                  )}

                  {/* 1. Query Text Suggestions */}
                  {suggestions.length > 0 && (
                    <div className="flex flex-col gap-0.5 pb-1 border-b border-border/30">
                      {suggestions.map((item, index) => {
                        const isSelected = index === selectedIndex;
                        return (
                          <button
                            key={`sugg-${item}-${index}`}
                            type="button"
                            onClick={() => {
                              setQuery(item);
                              handleExecuteSearch(item);
                            }}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className={cn(
                              "flex items-center gap-3 w-full rounded-xl px-3 py-1.5 text-left text-sm transition-colors",
                              isSelected
                                ? "bg-primary/15 text-primary font-medium"
                                : "text-foreground hover:bg-muted/60",
                            )}
                          >
                            <SearchIcon size={14} className={cn("shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                            <span className="truncate flex-1">{item}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 2. Closest Matching Artist (Spotify style) */}
                  {matchingArtist && (
                    <SearchTopArtistRow
                      artist={matchingArtist}
                      onSelect={handleSelectArtist}
                    />
                  )}

                  {/* 3. Related Albums & Playlists */}
                  {(matchingAlbums.length > 0 || matchingPlaylists.length > 0 || matchingTracks.length > 0) && (
                    <div className="pt-1 border-t border-border/30 flex flex-col gap-1">
                      <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        Top Results & Releases
                      </div>

                      {matchingAlbums.map((album) => (
                        <button
                          key={`alb-${album.id}`}
                          type="button"
                          onClick={() => handleSelectAlbum(album)}
                          className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-muted/60"
                        >
                          <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted/30 ring-1 ring-border/20">
                            <TrackArtwork artworkUrl={album.artworkUrl} size={40} className="size-full object-cover" iconSize={18} />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                              {album.title}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              Album {album.artist ? `• ${album.artist}` : ""}
                            </span>
                          </div>
                        </button>
                      ))}

                      {matchingPlaylists.map((playlist) => (
                        <button
                          key={`pl-${playlist.id}`}
                          type="button"
                          onClick={() => handleSelectPlaylist(playlist)}
                          className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-muted/60"
                        >
                          <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted/30 ring-1 ring-border/20">
                            <TrackArtwork artworkUrl={playlist.artworkUrl} size={40} className="size-full object-cover" iconSize={18} />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                              {playlist.title}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              Playlist {playlist.owner ? `• ${playlist.owner}` : ""}
                            </span>
                          </div>
                        </button>
                      ))}

                      {matchingTracks.map((track) => (
                        <button
                          key={`trk-${track.id}`}
                          type="button"
                          onClick={() => handlePlayTrack(track)}
                          className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-muted/60"
                        >
                          <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted/30 ring-1 ring-border/20">
                            <TrackArtwork artworkUrl={track.artworkUrl} size={40} className="size-full object-cover" iconSize={18} />
                            <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                              <PlayIcon size={16} className="text-white fill-white" />
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                              {track.title}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              Song • {track.artist}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* See all results row */}
                  <button
                    type="button"
                    onClick={() => handleExecuteSearch(query)}
                    className="flex items-center justify-center gap-2 w-full rounded-xl py-2 mt-1 bg-muted/40 text-xs font-semibold text-foreground transition-colors hover:bg-muted/80 cursor-pointer"
                  >
                    <SearchIcon size={13} className="text-primary" />
                    <span>See all results for &quot;{query}&quot;</span>
                  </button>
                </>
              ) : recentSearches.length > 0 ? (
                /* Recent Searches */
                <div>
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Recent Searches
                    </span>
                    <button
                      type="button"
                      onClick={handleClearAllRecentSearches}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {recentSearches.map((item, index) => {
                      const isSelected = index === selectedIndex;
                      return (
                        <div
                          key={`rec-${item}-${index}`}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            "group flex items-center justify-between w-full rounded-xl px-3 py-2 text-sm transition-colors cursor-pointer",
                            isSelected
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-foreground hover:bg-muted/60",
                          )}
                          onClick={() => {
                            setQuery(item);
                            handleExecuteSearch(item);
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <ClockIcon size={15} className={cn("shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                            <span className="truncate">{item}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleRemoveRecentSearch(e, item)}
                            className="shrink-0 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={`Remove ${item} from recent searches`}
                          >
                            <CloseIcon size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
