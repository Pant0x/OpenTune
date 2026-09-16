/**
 * Spicetify Marketplace Snippets System
 * Loaded from https://github.com/spicetify/marketplace/blob/main/resources/snippets.json
 */

import { useEffect, useState } from "react";

export interface SpicetifySnippet {
  id: string;
  title: string;
  description: string;
  code: string;
  preview?: string;
  category?: "layout" | "lyrics" | "visuals" | "player" | "sidebar";
}

export const SPICETIFY_SNIPPETS: SpicetifySnippet[] = [
  {
    id: "hamsters-dancing",
    title: "Hamsters Dancing",
    description: "Adds a couple of dancing hamsters on the playback bar",
    category: "player",
    code: `.player-controls .playback-progressbar { position: relative; } .player-controls .playback-progressbar::before { content: ''; width: 80px; height: 80px; bottom: calc(100% - 20px); left: 0; position: absolute; background-size: 80px 80px; background-image: url('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExdXk2NW15cTJrdjF0YjZ5eTBjODE0M2l3ejg3bDlvYWh5NmVub2l0eCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/s7pdNRdwG1zxdwkazY/giphy.gif'); pointer-events: none; z-index: 0; } .player-controls .playback-progressbar::after { content: ''; width: 80px; height: 80px; bottom: calc(100% - 23px); right: 0; position: absolute; background-size: 80px 80px; background-image: url('https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExamN4OWxiOXY4dHZ5Mm90NjU5ZjhwcjV1dDd3dHdveHFkaGYzbGRmaSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/VxovskkECK4egQCltk/giphy.gif'); pointer-events: none; z-index: 0; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/dancing-hamster.png"
  },
  {
    id: "sonic-dancing",
    title: "Sonic Dancing",
    description: "You get sonic dancing on your playback bar!",
    category: "player",
    code: `.player-controls .playback-progressbar::before { content: ''; width: 32px; height: 32px; bottom: calc(100% - 7px); right: 10px; position: absolute; image-rendering: pixelated; background-size: 32px 32px; background-image: url('https://media.tenor.com/pWqGD2PHY3kAAAAj/fortnite-dance-sonic.gif'); }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/sonic-dancing.png"
  },
  {
    id: "better-lyrics-style",
    title: "Better lyrics style",
    description: "Spotify lyrics are focused and beautified with dynamic blur and active highlights",
    category: "lyrics",
    code: `.lyrics-lyrics-contentContainer .lyrics-lyricsContent-lyric.lyrics-lyricsContent-highlight { filter: blur(1.5px); padding: 15px; font-size: 110%; } .lyrics-lyrics-contentContainer .lyrics-lyricsContent-lyric.lyrics-lyricsContent-active { filter: none; padding: 20px; font-size: 130%; text-shadow: 0 0 12px rgba(255,255,255,0.7); } .lyrics-lyrics-contentContainer .lyrics-lyricsContent-lyric { filter: blur(1.5px); padding: 15px; font-size: 110%; } .lyrics-lyrics-contentContainer .lyrics-lyricsContent-lyric.lyrics-lyricsContent-unsynced { filter: none; padding: 10px; font-size: 100%; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/better-lyrics-style.png"
  },
  {
    id: "circular-album-art",
    title: "Circular Album Art",
    description: "Makes the now playing album art be circular (like a vinyl record)",
    category: "visuals",
    code: `.cover-art-image { clip-path: circle(50% at 50% 50%); } .main-nowPlayingBar-left { border-radius: 50%; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/circular-album-art.png"
  },
  {
    id: "rounded-now-playing",
    title: "Rounded 'Now Playing' Bar",
    description: "Adds rounded corners and floating elevation to the 'Now Playing' player bar so it matches modern floating docks.",
    category: "player",
    code: `:root { --border-radius-1: 12px; } .group\\/playerbar { border-radius: var(--border-radius-1) !important; margin: 6px 12px; border: 1px solid rgba(255,255,255,0.12) !important; box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/rounded-now-playing.png"
  },
  {
    id: "rounded-images",
    title: "Rounded Images",
    description: "Adds rounded modern corners to cover art, playlist covers, cards and other images",
    category: "visuals",
    code: `img { border-radius: 12px !important; } .cover-art-image { border-radius: 12px !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/rounded-images.png"
  },
  {
    id: "smooth-playlist-reveal-gradient",
    title: "Smooth Reveal Playlist Gradient",
    description: "Reveals playlist header gradient with a smooth fade in effect",
    category: "visuals",
    code: `.main-entityHeader-overlay, .main-actionBarBackground-background, .main-entityHeader-backgroundColor { transition: all 1.5s cubic-bezier(0.16, 1, 0.3, 1) !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/smooth-playlist-reveal-gradient.png"
  },
  {
    id: "dynamic-left-sidebar",
    title: "Dynamic Left Sidebar",
    description: "Make the left sidebar dynamic, expanding smoothly on hover",
    category: "sidebar",
    code: `aside:first-of-type { transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s ease; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/Dynamic-Left-Sidebar.gif"
  },
  {
    id: "fix-main-view-width",
    title: "Fix main view width",
    description: "Makes main view fill up all available screen space seamlessly",
    category: "layout",
    code: `.contentSpacing { max-width: 100% !important; width: 100% !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/fix-main-view-width.png"
  },
  {
    id: "fix-now-playing-icon-color",
    title: "Fix now playing icon color",
    description: "Highlights the animated playing icon in Spotify signature vibrant green",
    category: "visuals",
    code: `.main-trackList-playingIcon, [aria-label='Playing'] { color: #1ed760 !important; fill: #1ed760 !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/fix-now-playing-icon-color.png"
  },
  {
    id: "left-aligned-heart-icons",
    title: "Left aligned heart icons",
    description: "Moves the heart/like icon to the left side of track titles in track views",
    category: "layout",
    code: `.main-trackList-rowHeartButton { order: -1; margin-right: 8px; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/left-aligned-heart-icons.png"
  },
  {
    id: "remove-playlist-cover",
    title: "Remove Playlist Album Cover",
    description: "Remove the album cover from the playlist banner for a clean minimal view",
    category: "layout",
    code: `.main-entityHeader-imageContainer { display: none !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/Remove-Playlist-Cover.png"
  },
  {
    id: "hide-made-for-you",
    title: "Hide Made For YOU",
    description: "Hide the 'Made For You' section from homepage recommendations",
    category: "layout",
    code: `section[aria-label^='Made For'] { display: none !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/Hide-Made-For-YOU.png"
  },
  {
    id: "always-show-forward",
    title: "Always show forward button",
    description: "Always shows the navigate forward button regardless of window size",
    category: "player",
    code: `button[aria-label='Go forward'] { display: inline-flex !important; opacity: 1 !important; }`,
    preview: "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/assets/snippets/always-show-forward.png"
  },
];

const STORAGE_KEY = "spicetify_enabled_snippets";
const CUSTOM_SNIPPETS_KEY = "spicetify_custom_snippets";

export interface CustomSnippet {
  id: string;
  title: string;
  code: string;
  createdAt: number;
}

function getStoredEnabledIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function setStoredEnabledIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {}
}

export function getCustomSnippets(): CustomSnippet[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_SNIPPETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveCustomSnippet(title: string, code: string): CustomSnippet {
  const custom = getCustomSnippets();
  const newSnippet: CustomSnippet = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim() || "Custom CSS Snippet",
    code: code.trim(),
    createdAt: Date.now(),
  };
  const next = [newSnippet, ...custom];
  try {
    localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(next));
  } catch {}
  return newSnippet;
}

export function deleteCustomSnippet(id: string): void {
  const custom = getCustomSnippets().filter((s) => s.id !== id);
  try {
    localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(custom));
  } catch {}
  toggleSnippet(id, false);
}

/**
 * Applies or removes dynamic style tag for a snippet in document <head>.
 */
export function applySnippetStyle(id: string, code: string, enabled: boolean): void {
  if (typeof document === "undefined") return;
  const tagId = `spicetify-snippet-${id}`;
  let el = document.getElementById(tagId) as HTMLStyleElement | null;

  if (enabled) {
    if (!el) {
      el = document.createElement("style");
      el.id = tagId;
      el.setAttribute("data-spicetify-snippet", id);
      document.head.appendChild(el);
    }
    el.textContent = code;
  } else if (el) {
    el.remove();
  }
}

/**
 * Initializes and injects all currently enabled snippets into document head.
 */
export function initActiveSnippets(): void {
  if (typeof document === "undefined") return;
  const enabledIds = getStoredEnabledIds();
  const allSnippets = [...SPICETIFY_SNIPPETS, ...getCustomSnippets()];

  for (const snippet of allSnippets) {
    if (enabledIds.has(snippet.id)) {
      applySnippetStyle(snippet.id, snippet.code, true);
    } else {
      applySnippetStyle(snippet.id, snippet.code, false);
    }
  }
}

/**
 * Toggles a snippet on/off, updating DOM and local storage.
 */
export function toggleSnippet(id: string, enabled: boolean): void {
  const enabledIds = getStoredEnabledIds();
  if (enabled) {
    enabledIds.add(id);
  } else {
    enabledIds.delete(id);
  }
  setStoredEnabledIds(enabledIds);

  const allSnippets = [...SPICETIFY_SNIPPETS, ...getCustomSnippets()];
  const target = allSnippets.find((s) => s.id === id);
  if (target) {
    applySnippetStyle(id, target.code, enabled);
  } else if (!enabled) {
    applySnippetStyle(id, "", false);
  }
}

/**
 * React hook to observe and toggle enabled snippets.
 */
export function useSpicetifySnippets() {
  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => getStoredEnabledIds());
  const [customSnippets, setCustomSnippets] = useState<CustomSnippet[]>(() => getCustomSnippets());

  useEffect(() => {
    initActiveSnippets();
  }, []);

  const toggle = (id: string) => {
    const isCurrentlyEnabled = enabledIds.has(id);
    const nextState = !isCurrentlyEnabled;
    toggleSnippet(id, nextState);
    setEnabledIds(getStoredEnabledIds());
  };

  const addCustom = (title: string, code: string) => {
    const created = saveCustomSnippet(title, code);
    setCustomSnippets(getCustomSnippets());
    toggleSnippet(created.id, true);
    setEnabledIds(getStoredEnabledIds());
  };

  const removeCustom = (id: string) => {
    deleteCustomSnippet(id);
    setCustomSnippets(getCustomSnippets());
    setEnabledIds(getStoredEnabledIds());
  };

  return {
    enabledIds,
    customSnippets,
    toggle,
    addCustom,
    removeCustom,
  };
}
