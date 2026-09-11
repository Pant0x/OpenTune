import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { SpinnerSteps } from "@/components/motion/loader";
import { Marquee } from "@/components/motion/marquee";
import { cn } from "@/lib/utils";
import { HeartActiveIcon, HeartBrokenIcon, HeartIcon } from "@/ui/icons";
import { shallowEqual, usePlayerSelector } from "../../../player/playerStore";
import { useLibraryState } from "../../../player/playerStore";
import { usePlayerUIState, playerUIStore } from "../../stores/playerUIStore";
import { TrackArtwork } from "../TrackArtwork";
import { ArtistLinks, useAlbumNavigation } from "../ArtistLinks";
import { useTrackContextMenu } from "../TrackContextMenu";
import { getVideoArtworkFallback } from "../../../datasource/youtube/artwork";
import { SpotifyService } from "../../../services/SpotifyService";

export function TrackInfo() {
  const state = usePlayerSelector((player) => ({ currentTrack: player.currentTrack }), shallowEqual);
  const libraryState = useLibraryState();
  const uiState = usePlayerUIState();
  const navigateAlbum = useAlbumNavigation();
  const { openTrackMenu, toggleTrackLike, openAlbumForTrack } = useTrackContextMenu();
  const currentTrack = state.currentTrack;
  const titleViewportRef = useRef<HTMLDivElement>(null);
  const titleTextRef = useRef<HTMLSpanElement>(null);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);

  const artistViewportRef = useRef<HTMLDivElement>(null);
  const artistTextRef = useRef<HTMLSpanElement>(null);
  const [isArtistOverflowing, setIsArtistOverflowing] = useState(false);

  /*
   * The dock prefers Spotify's album cover: YouTube-sourced tracks carry a video thumbnail as
   * artwork whenever the album art was missing, and a video still in the dock reads wrong.
   * Resolved once per track (service-level cache), falling back to the source artwork.
   */
  const [spotifyCover, setSpotifyCover] = useState<string | null>(null);
  useEffect(() => {
    setSpotifyCover(null);
    if (!currentTrack || currentTrack.source === "local" || !currentTrack.title) return;
    let active = true;
    void SpotifyService.getTrackCoverUrl(currentTrack.title, currentTrack.artist)
      .then((url) => {
        if (active && url) setSpotifyCover(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

  // Only scroll a title that actually overflows — a permanent marquee on short
  // titles is noise. Measured rather than guessed from character count.
  useLayoutEffect(() => {
    const viewport = titleViewportRef.current;
    const text = titleTextRef.current;
    if (!viewport || !text) return;

    const updateOverflow = () => {
      setIsTitleOverflowing(text.scrollWidth - viewport.clientWidth > 1);
    };
    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [currentTrack?.title]);

  useLayoutEffect(() => {
    const viewport = artistViewportRef.current;
    const text = artistTextRef.current;
    if (!viewport || !text) return;

    const updateOverflow = () => {
      setIsArtistOverflowing(text.scrollWidth - viewport.clientWidth > 1);
    };
    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [currentTrack?.artist, currentTrack?.artists, currentTrack?.album]);

  if (!currentTrack) {
    return null;
  }

  const isLikeStatusLoading =
    (libraryState.status === "restoring" || libraryState.status === "loading")
    && !libraryState.library;
  const canLikeCurrentTrack = currentTrack.source !== "local";
  const isLikePending = canLikeCurrentTrack && libraryState.pendingLikeTrackIds.has(currentTrack.id);
  const isLiked = canLikeCurrentTrack && (libraryState.library?.likedSongs.some(
    (track) => track.id === currentTrack.id,
  ) ?? false);

  const handleTitleClick = () => {
    if (openAlbumForTrack) {
      openAlbumForTrack(currentTrack);
      return;
    }
    if (navigateAlbum && (currentTrack.albumId || currentTrack.album)) {
      navigateAlbum({
        id: currentTrack.albumId || currentTrack.album!,
        title: currentTrack.album || currentTrack.title,
        artist: currentTrack.artist,
        artworkUrl: currentTrack.artworkUrl,
        releaseType: currentTrack.releaseType || "album",
      });
    } else if (navigateAlbum) {
      navigateAlbum({
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        artworkUrl: currentTrack.artworkUrl,
        releaseType: "single",
      });
    } else {
      playerUIStore.openNowPlaying();
    }
  };

  const handleAlbumClick = () => {
    if (currentTrack.albumId || currentTrack.album) {
      if (navigateAlbum) {
        navigateAlbum({
          id: currentTrack.albumId || currentTrack.album!,
          title: currentTrack.album || currentTrack.title,
          artist: currentTrack.artist,
          artworkUrl: currentTrack.artworkUrl,
          releaseType: currentTrack.releaseType || "album",
        });
      }
    }
  };

  return (
    <div
      className="flex min-w-0 max-w-full flex-1 items-center gap-3"
      onContextMenu={(event) => openTrackMenu(event, currentTrack)}
    >
      {uiState.showAlbumArt && (
        <button
          type="button"
          onClick={() => playerUIStore.openNowPlaying()}
          title="Open Now Playing view"
          className="group relative size-12 shrink-0 overflow-hidden rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TrackArtwork
            className="size-12 shrink-0 object-cover transition-transform group-hover:scale-105"
            size={48}
            loading="eager"
            preferProxy
            artworkUrl={spotifyCover
              ?? (currentTrack.artworkUrl
                || (currentTrack.id ? getVideoArtworkFallback(currentTrack.id) : undefined))}
            iconSize={22}
          />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          ref={titleViewportRef}
          className="relative min-w-0 overflow-hidden cursor-pointer"
          onClick={handleTitleClick}
          title={currentTrack.album ? `Go to album: ${currentTrack.album}` : `Go to album`}
        >
          {/* Hidden measuring copy — Marquee duplicates its children, so width
              must be read from a single stable node. */}
          <span
            ref={titleTextRef}
            aria-hidden={isTitleOverflowing}
            className={cn(
              "block whitespace-nowrap text-sm font-medium text-foreground hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all",
              isTitleOverflowing && "invisible absolute",
            )}
          >
            {currentTrack.title}
          </span>
          {isTitleOverflowing && (
            <Marquee speed={22} gap="2.5rem" className="text-sm font-medium text-foreground hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-all">
              <span className="whitespace-nowrap" title={currentTrack.title}>
                {currentTrack.title}
              </span>
            </Marquee>
          )}
        </div>
        <div
          ref={artistViewportRef}
          className="relative min-w-0 overflow-hidden text-xs text-muted-foreground"
        >
          {/* Measuring copy. Hidden unconditionally: making `invisible absolute` conditional
              on overflow left it visible next to the real text whenever the artist fit —
              the doubled "ArtistArtist" line in the player bar. */}
          <span
            ref={artistTextRef}
            aria-hidden="true"
            className="invisible absolute inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <ArtistLinks
              artists={currentTrack.artists}
              fallback={currentTrack.artist}
              trackTitle={currentTrack.title}
            />
            {currentTrack.album && (
              <>
                <span className="opacity-40 select-none">•</span>
                <span
                  className="hover:text-foreground cursor-pointer transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAlbumClick();
                  }}
                  title={`Album: ${currentTrack.album}`}
                >
                  {currentTrack.album}
                </span>
              </>
            )}
          </span>

          {isArtistOverflowing ? (
            <Marquee speed={20} gap="2rem" className="text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <ArtistLinks
                  artists={currentTrack.artists}
                  fallback={currentTrack.artist}
                  trackTitle={currentTrack.title}
                />
                {currentTrack.album && (
                  <>
                    <span className="opacity-40 select-none">•</span>
                    <span
                      className="hover:text-foreground cursor-pointer transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAlbumClick();
                      }}
                      title={`Album: ${currentTrack.album}`}
                    >
                      {currentTrack.album}
                    </span>
                  </>
                )}
              </span>
            </Marquee>
          ) : (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap truncate max-w-full">
              <ArtistLinks
                artists={currentTrack.artists}
                fallback={currentTrack.artist}
                trackTitle={currentTrack.title}
              />
              {currentTrack.album && (
                <>
                  <span className="opacity-40 select-none">•</span>
                  <span
                    className="hover:text-foreground cursor-pointer transition-colors truncate"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAlbumClick();
                    }}
                    title={`Album: ${currentTrack.album}`}
                  >
                    {currentTrack.album}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {canLikeCurrentTrack && (
        <button
          type="button"
          className={cn(
            "group/like flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
            "disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isLiked ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => void toggleTrackLike(currentTrack)}
          disabled={isLikeStatusLoading || isLikePending}
          aria-label={
            isLikeStatusLoading || isLikePending
              ? "Loading like status"
              : isLiked
                ? "Remove like"
                : libraryState.status === "signed-out"
                  ? "Sign in to like"
                  : "Like song"
          }
          title={
            libraryState.status === "signed-out"
              ? "Sign in to like"
              : isLiked
                ? "Remove like"
                : "Like song"
          }
        >
          {isLikeStatusLoading || isLikePending ? (
            <SpinnerSteps size={18} color="currentColor" />
          ) : isLiked ? (
            // Hovering a liked track previews the un-like action.
            <span className="relative grid size-[18px] place-items-center" aria-hidden="true">
              <HeartActiveIcon
                size={18}
                className="absolute transition-opacity group-hover/like:opacity-0"
              />
              <HeartBrokenIcon
                size={18}
                className="absolute opacity-0 transition-opacity group-hover/like:opacity-100"
              />
            </span>
          ) : (
            <HeartIcon size={18} />
          )}
        </button>
      )}
    </div>
  );
}
