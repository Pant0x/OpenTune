import type { DataSource } from "../datasource/DataSource";
import type { SearchCategory, SearchResults, Track } from "../datasource/types";
import { reRankSearchResults } from "./searchAffinity";

export class SearchController {
  private searchCache = new Map<string, { data: SearchResults; timestamp: number }>();
  private categoryCache = new Map<string, { data: SearchResults; timestamp: number }>();
  private suggestionsCache = new Map<string, { data: string[]; timestamp: number }>();

  constructor(private readonly dataSource: DataSource) {}

  async search(
    query: string,
    onUpdate?: (results: SearchResults) => void,
    options?: { suggestions?: string[] },
  ): Promise<SearchResults> {
    const normalizedKey = query.trim().toLowerCase();
    if (!normalizedKey) {
      return { artists: [], tracks: [], albums: [], playlists: [] };
    }

    const suggestions = options?.suggestions ?? this.suggestionsCache.get(normalizedKey)?.data;

    const cached = this.searchCache.get(normalizedKey);
    if (cached && Date.now() - cached.timestamp < 300_000) {
      const ranked = reRankSearchResults(query, cached.data, { suggestions });
      onUpdate?.(ranked);
      return ranked;
    }

    if (this.dataSource.search) {
      const results = await this.dataSource.search(query.trim(), (liveResults) => {
        const liveSuggestions = options?.suggestions ?? this.suggestionsCache.get(normalizedKey)?.data;
        const rankedLive = reRankSearchResults(query, liveResults, { suggestions: liveSuggestions });
        onUpdate?.(rankedLive);
        this.searchCache.set(normalizedKey, { data: rankedLive, timestamp: Date.now() });
      });
      const finalSuggestions = options?.suggestions ?? this.suggestionsCache.get(normalizedKey)?.data;
      const ranked = reRankSearchResults(query, results, { suggestions: finalSuggestions });
      this.searchCache.set(normalizedKey, { data: ranked, timestamp: Date.now() });
      return ranked;
    }
    const tracks = await this.searchTracks(query.trim(), (items) => {
      const live = reRankSearchResults(query, { artists: [], tracks: items, albums: [], playlists: [] }, { suggestions });
      onUpdate?.(live);
    });
    const fallbackRes = reRankSearchResults(query, { artists: [], tracks, albums: [], playlists: [] }, { suggestions });
    this.searchCache.set(normalizedKey, { data: fallbackRes, timestamp: Date.now() });
    return fallbackRes;
  }

  async searchCategory(query: string, category: SearchCategory): Promise<SearchResults> {
    const normalizedKey = `${category}:${query.trim().toLowerCase()}`;
    const rawQueryKey = query.trim().toLowerCase();
    if (!query.trim() || !this.dataSource.searchCategory) {
      return { artists: [], tracks: [], albums: [], playlists: [] };
    }

    const suggestions = this.suggestionsCache.get(rawQueryKey)?.data;

    const cached = this.categoryCache.get(normalizedKey);
    if (cached && Date.now() - cached.timestamp < 300_000) {
      return reRankSearchResults(query, cached.data, { suggestions });
    }

    const results = await this.dataSource.searchCategory(query.trim(), category);
    const ranked = reRankSearchResults(query, results, { suggestions });
    this.categoryCache.set(normalizedKey, { data: ranked, timestamp: Date.now() });
    return ranked;
  }

  async searchTracks(query: string, onUpdate?: (tracks: Track[]) => void): Promise<Track[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !this.dataSource.searchTracks) return [];
    return this.dataSource.searchTracks(normalizedQuery, onUpdate);
  }

  async getSearchSuggestions(
    query: string,
    onUpdate?: (suggestions: string[]) => void,
  ): Promise<string[]> {
    const normalizedKey = query.trim().toLowerCase();
    if (!normalizedKey || !this.dataSource.getSearchSuggestions) return [];

    const cached = this.suggestionsCache.get(normalizedKey);
    if (cached && Date.now() - cached.timestamp < 180_000) {
      onUpdate?.(cached.data);
      return cached.data;
    }

    const results = await this.dataSource.getSearchSuggestions(query.trim(), onUpdate);
    this.suggestionsCache.set(normalizedKey, { data: results, timestamp: Date.now() });
    return results;
  }
}
