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
        className="group flex items-center gap-3.5 w-full rounded-xl p-2.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none"
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
    if (!trimmed) {
      setSuggestions([]);
      setPreviewResults(null);
      return;
    }

    try {
      void searchController
        .getSearchSuggestions(trimmed, (updated: string[]) => {
          setSuggestions(updated.slice(0, 4));
        })
        .then((results: string[]) => {
          if (results) setSuggestions(results.slice(0, 4));
        });

      void searchController
        .search(trimmed, (updated: SearchResults) => {
          setPreviewResults(updated);
        })
        .then((results: SearchResults) => {
          if (results) setPreviewResults(results);
        });
    } catch {}
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(-1);
    setIsOpen(true);

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
    saveRecentSearch(artist.name);
    setRecentSearches(loadRecentSearches());
    navigateArtist?.(artist, false);
  };

  const handleSelectAlbum = (album: Album) => {
    setIsOpen(false);
    inputRef.current?.blur();
    saveRecentSearch(album.title);
    setRecentSearches(loadRecentSearches());
    navigateAlbum?.(album, false);
  };

  const handleSelectPlaylist = (playlist: Playlist) => {
    setIsOpen(false);
    inputRef.current?.blur();
    saveRecentSearch(playlist.title);
    setRecentSearches(loadRecentSearches());
    onNavigatePlaylist?.(playlist);
  };

  const handlePlayTrack = (track: Track) => {
    setIsOpen(false);
    inputRef.current?.blur();
    saveRecentSearch(track.title);
    setRecentSearches(loadRecentSearches());
    void playerController.playTrackById(track.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = query.trim() ? suggestions : recentSearches;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
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
  const matchingArtist = useMemo(() => {
    if (!previewResults?.artists?.length) return undefined;
    if (/\bpanto\b|prodbypanto/i.test(query)) {
      const panto = previewResults.artists.find(
        (a) => a.name.toLowerCase() === "panto" || /prodbypanto/i.test(a.id)
      ) || previewResults.artists.find(
        (a) => a.name.toLowerCase().includes("panto")
      );
      if (panto) return panto;
    }
    return previewResults.artists[0];
  }, [previewResults?.artists, query]);
  const matchingAlbums = (previewResults?.albums ?? []).slice(0, 2);
  const matchingPlaylists = (previewResults?.playlists ?? []).slice(0, 2);
  const matchingTracks = (previewResults?.tracks ?? []).slice(0, 2);

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
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10"
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
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/10"
          >
            <ArrowRightIcon size={16} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}

      <div className="relative flex min-w-0 flex-1 items-center">
        <div className="group relative flex h-8 sm:h-8.5 w-full items-center gap-2 rounded-full bg-white/[0.07] dark:bg-white/[0.06] hover:bg-white/[0.11] focus-within:bg-white/[0.14] backdrop-blur-xl px-3 border border-white/15 dark:border-white/10 shadow-sm transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
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
            <kbd className="ml-auto hidden md:inline-flex shrink-0 items-center rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground border border-white/10">
              {primaryModifierLabel} Space
            </kbd>
          )}
        </div>

        {/* Spotify-style Dropdown with query suggestions, closest artist card, albums and playlists */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 right-0 top-full mt-1.5 max-h-[75vh] overflow-y-auto rounded-2xl bg-card/90 dark:bg-[#181818]/95 border border-white/10 shadow-2xl backdrop-blur-2xl p-2 flex flex-col gap-2 z-50"
            >
              {hasQuery ? (
                <>
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
                                : "text-foreground hover:bg-white/5",
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
                          className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06]"
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
                          className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06]"
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
                          className="group flex items-center gap-3 w-full rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06]"
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
                    className="flex items-center justify-center gap-2 w-full rounded-xl py-2 mt-1 bg-white/[0.04] text-xs font-semibold text-foreground transition-colors hover:bg-white/[0.09]"
                  >
                    <SearchIcon size={13} className="text-primary" />
                    <span>See all results for &quot;{query}&quot;</span>
                  </button>
                </>
              ) : (
                /* Recent Searches */
                <div>
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Recent Searches
                  </div>
                  {recentSearches.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">No recent searches</p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {recentSearches.map((item, index) => {
                        const isSelected = index === selectedIndex;
                        return (
                          <button
                            key={`rec-${item}-${index}`}
                            type="button"
                            onClick={() => {
                              setQuery(item);
                              handleExecuteSearch(item);
                            }}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className={cn(
                              "flex items-center gap-3 w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                              isSelected
                                ? "bg-primary/15 text-primary font-medium"
                                : "text-foreground hover:bg-white/5",
                            )}
                          >
                            <ClockIcon size={15} className="shrink-0 text-muted-foreground" />
                            <span className="truncate flex-1">{item}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
