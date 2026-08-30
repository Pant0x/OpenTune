import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, SearchIcon, ClockIcon } from "@/ui/icons";
import { isMacOS, primaryModifierLabel } from "../platform";
import { searchController } from "../../player/playerStore";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";

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
}

export function SearchBar({
  onSearch,
  onOpen,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
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

  // Fetch search suggestions
  const fetchSuggestions = useCallback((searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }

    try {
      void searchController.getSearchSuggestions(trimmed, (updated: string[]) => {
        setSuggestions(updated.slice(0, 6));
      }).then((results: string[]) => {
        if (results) setSuggestions(results.slice(0, 6));
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
      fetchSuggestions(value);
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
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const displayList = query.trim() ? suggestions : recentSearches;

  return (
    <div ref={containerRef} className="relative flex items-center gap-2 max-w-2xl mx-auto w-full z-40">
      {showBackButton && (
        <Tooltip content="Back">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Go back"
            className="shrink-0 rounded-full"
          >
            <ArrowLeftIcon size={18} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}
      {canGoForward && (
        <Tooltip content="Forward">
          <Button
            variant="ghost"
            size="icon"
            onClick={onForward}
            aria-label="Go forward"
            className="shrink-0 rounded-full"
          >
            <ArrowRightIcon size={18} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}

      <div className="relative flex min-w-0 flex-1 items-center">
        <div className="group relative flex h-10 w-full items-center gap-2.5 rounded-full bg-card/90 px-3.5 border border-border/40 transition-all focus-within:border-primary/50 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/20">
          <SearchIcon size={17} className="shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              setIsOpen(true);
              if (query.trim()) fetchSuggestions(query);
            }}
            onKeyDown={handleKeyDown}
            placeholder="What do you want to play?"
            aria-label="Search music"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />

          {query ? (
            <button
              type="button"
              onClick={handleClear}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none"
              aria-label="Clear search"
            >
              <CloseIcon size={14} />
            </button>
          ) : (
            <kbd className="ml-auto hidden sm:inline-flex shrink-0 items-center rounded-md bg-background/60 px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground border border-border/30">
              {primaryModifierLabel} Space
            </kbd>
          )}
        </div>

        {/* Live Search Suggestions Dropdown */}
        <AnimatePresence>
          {isOpen && displayList.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl bg-card border border-border/50 shadow-2xl backdrop-blur-xl p-1.5"
            >
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {query.trim() ? "Suggestions" : "Recent Searches"}
              </div>
              <div className="flex flex-col gap-0.5">
                {displayList.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={`${item}-${index}`}
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
                      {query.trim() ? (
                        <SearchIcon size={15} className={cn("shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                      ) : (
                        <ClockIcon size={15} className="shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate flex-1">{item}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
