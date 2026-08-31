import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { Album, Artist, ArtistReference } from "../../datasource/types";
import { cn } from "@/lib/utils";
import { isMacOS } from "../platform";

type NavigateArtist = (artist: Artist, openInNewTab: boolean) => void;
type NavigateAlbum = (album: Album, openInNewTab?: boolean) => void;

const ArtistNavigationContext = createContext<NavigateArtist | null>(null);
const AlbumNavigationContext = createContext<NavigateAlbum | null>(null);

export function AlbumNavigationProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate: NavigateAlbum;
}) {
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const navigate = useMemo<NavigateAlbum>(
    () => (album, openInNewTab = false) => navigateRef.current(album, openInNewTab),
    [],
  );

  return (
    <AlbumNavigationContext.Provider value={navigate}>
      {children}
    </AlbumNavigationContext.Provider>
  );
}

export function useAlbumNavigation() {
  return useContext(AlbumNavigationContext);
}

export function useArtistNavigation() {
  return useContext(ArtistNavigationContext);
}


export function ArtistNavigationProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate: NavigateArtist;
}) {
  /*
   * Stabilised here rather than asking every caller to `useCallback` it. The navigate handler
   * closes over most of App's state, so a correct dependency list would be long and would
   * change constantly anyway — and this provider wraps the whole app, so a new value means
   * every artist link in every list re-renders.
   */
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const navigate = useMemo<NavigateArtist>(
    () => (artist, openInNewTab) => navigateRef.current(artist, openInNewTab),
    [],
  );

  return (
    <ArtistNavigationContext.Provider value={navigate}>
      {children}
    </ArtistNavigationContext.Provider>
  );
}

export interface ParsedArtistFeature {
  mainArtists: ArtistReference[];
  featuredArtists: ArtistReference[];
}

export function parseTrackArtistsWithFeatures(
  title?: string,
  artistFallback = "",
  artists?: ArtistReference[],
): ParsedArtistFeature {
  const featRegex = /\s*(?:\(|\[|\b)(?:feat\.?|ft\.?|featuring|with)\s+([^()\[\]]+)(?:\)|\])?/i;
  const titleMatch = title ? title.match(featRegex) : null;
  const artistMatch = artistFallback.match(featRegex);

  const rawFeatNames: string[] = [];
  if (titleMatch && titleMatch[1]) {
    rawFeatNames.push(...titleMatch[1].split(/,\s*|\s*&\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean));
  }
  if (artistMatch && artistMatch[1]) {
    rawFeatNames.push(...artistMatch[1].split(/,\s*|\s*&\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean));
  }

  const existingArtists = artists && artists.length > 0
    ? [...artists]
    : artistFallback
        .replace(featRegex, "")
        .split(/,\s*|\s*&\s*|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ id: "", name }));

  const mainArtists: ArtistReference[] = [];
  const featuredArtists: ArtistReference[] = [];
  const featLowerSet = new Set(rawFeatNames.map((n) => n.toLowerCase()));

  for (const a of existingArtists) {
    if (featLowerSet.has(a.name.toLowerCase())) {
      featuredArtists.push(a);
    } else {
      mainArtists.push(a);
    }
  }

  for (const featName of rawFeatNames) {
    if (
      !featuredArtists.some((a) => a.name.toLowerCase() === featName.toLowerCase()) &&
      !mainArtists.some((a) => a.name.toLowerCase() === featName.toLowerCase())
    ) {
      featuredArtists.push({ id: "", name: featName });
    }
  }

  if (mainArtists.length === 0 && existingArtists.length > 0) {
    mainArtists.push(existingArtists[0]);
  }

  return { mainArtists, featuredArtists };
}

export function ArtistLinks({
  artists,
  fallback,
  trackTitle,
  className,
  interactive = true,
  suppressArtistId,
}: {
  artists?: ArtistReference[];
  fallback: string;
  trackTitle?: string;
  className?: string;
  interactive?: boolean;
  suppressArtistId?: string;
}) {
  const navigate = useContext(ArtistNavigationContext);

  if (!navigate) {
    return <span className={className}>{fallback}</span>;
  }

  const openArtist = (
    event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>,
    artist: ArtistReference,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const hasPrimaryModifier = isMacOS ? event.metaKey : event.ctrlKey;
    const openInNewTab = "button" in event
      ? event.button === 1 || event.shiftKey || hasPrimaryModifier
      : event.shiftKey || hasPrimaryModifier;
    navigate({ id: artist.id, name: artist.name }, openInNewTab);
  };

  const isSuppressed = (artist: ArtistReference) =>
    suppressArtistId && artist.id === suppressArtistId;

  const renderArtist = (artist: ArtistReference) => {
    const suppressed = isSuppressed(artist);
    const isDisabled = !interactive || suppressed;
    return (
      <span className={cn("min-w-0", isDisabled && "pointer-events-none")}>
        {isDisabled ? (
          <span className="text-inherit">
            {artist.name}
          </span>
        ) : (
          <span
            className="cursor-pointer rounded-sm text-inherit underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            tabIndex={0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => openArtist(event, artist)}
            onAuxClick={(event) => {
              if (event.button === 1) openArtist(event, artist);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                openArtist(event, artist);
              }
            }}
          >
            {artist.name}
          </span>
        )}
      </span>
    );
  };

  const { mainArtists, featuredArtists } = parseTrackArtistsWithFeatures(trackTitle, fallback, artists);

  return (
    <span className={className}>
      {mainArtists.map((artist, index) => (
        <span key={`main:${artist.id}:${artist.name}`}>
          {index > 0 && ", "}
          {renderArtist(artist)}
        </span>
      ))}
      {featuredArtists.length > 0 && (
        <span className="text-muted-foreground">
          {" feat. "}
          {featuredArtists.map((artist, index) => (
            <span key={`feat:${artist.id}:${artist.name}`}>
              {index > 0 && ", "}
              {renderArtist(artist)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
