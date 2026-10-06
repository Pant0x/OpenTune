import type { Album, Artist, Playlist, SearchResults, Track } from "../../datasource/types";

export type TabView = "home" | "album" | "song" | "artist" | "discography" | "playlist" | "related" | "search" | "history" | "browse" | "library" | "settings" | "local-files" | "releases" | "profile";
export type NavigableTabView = Exclude<TabView, "settings">;
export type AppViewType = TabView;

export interface AppViewState {
  title?: string;
  view: AppViewType;
  album?: Album;
  song?: Track;
  artist?: Artist;
  releases?: Album[];
  playlist?: Playlist;
  /** The track a "related" view is about. */
  relatedTrack?: Track;
  searchQuery?: string;
  searchResults?: Track[];
  mixedSearchResults?: SearchResults;
  searchLoading?: boolean;
  /** Which Browse tab to open on. Only meaningful when `view` is "browse". */
  browseTab?: string;
  /** Automatically check for updates when navigating to settings. */
  autoCheckUpdates?: boolean;
}

export type TabViewState = AppViewState;

export interface TabNavigationHistory {
  back: TabViewState[];
  forward: TabViewState[];
}

export interface Tab {
  id: string;
  /** Which Browse tab to open on. Only meaningful when `view` is "browse". */
  browseTab?: string;
  title?: string;
  view: TabView;
  album?: Album;
  song?: Track;
  artist?: Artist;
  releases?: Album[];
  playlist?: Playlist;
  relatedTrack?: Track;
  searchQuery?: string;
  searchResults?: Track[];
  mixedSearchResults?: SearchResults;
  searchLoading?: boolean;
  isQueueOpen?: boolean;
  navigationHistory?: TabNavigationHistory;
}
