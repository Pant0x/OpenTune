import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SpinnerSteps } from "@/components/motion/loader";
import {
  getVideoDetails,
  getVideoComments,
  type VideoDetails,
  type VideoComment,
} from "../../../datasource/youtube/videoService";
import type { Track } from "../../../datasource/types";
import { isSavedVideo, subscribeToSavedVideos, toggleSaveVideo } from "../../../player/savedVideos";
import { libraryController, playerController, useLibraryState } from "../../../player/playerStore";
import { YouTubeShareModal } from "./YouTubeShareModal";
import { BellIcon, BellRingIcon, ChevronDownIcon } from "@/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";

interface VideoPlayerViewProps {
  videoId: string;
  track: Track;
  initialTime?: number;
  onSwitchToSong?: () => void;
  isPodcast?: boolean;
}

const TOKEN_REGEX =
  /(https?:\/\/[^\s]+|(?:[a-zA-Z0-9_-]+\.)+(?:com|org|net|io|co|me|to|shop|app|ai|dev|link|lnk\.to)[^\s]*|#[a-zA-Z0-9_]+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/gi;

export function VideoPlayerView({
  videoId,
  track,
  initialTime = 0,
  onSwitchToSong,
  isPodcast = false,
}: VideoPlayerViewProps) {
  const libraryState = useLibraryState();
  const account = libraryState.library?.account;
  const userAvatarUrl = account?.artworkUrl;
  const userName = account?.name || "You";

  const [details, setDetails] = useState<VideoDetails | null>(null);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [totalComments, setTotalComments] = useState<string>("");
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // User interactions
  const [userRating, setUserRating] = useState<"like" | "dislike" | "none">("none");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [bellState, setBellState] = useState<"all" | "personalized" | "none">("all");
  const [showBellMenu, setShowBellMenu] = useState(false);
  const [isSaved, setIsSaved] = useState(() => isSavedVideo(track.id));
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Comment posting
  const [newCommentText, setNewCommentText] = useState("");
  const [isCommentInputFocused, setIsCommentInputFocused] = useState(false);
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");

  // Iframe and dock playback synchronization
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentTimeRef = useRef(initialTime);
  const isPlayingRef = useRef(false);

  const postToIframe = useCallback((func: string, args: unknown[] = []) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "*",
      );
    }
  }, []);

  // Register video delegate with playerController so bottom dock controls video directly
  useEffect(() => {
    const delegate = {
      play: () => {
        postToIframe("playVideo");
      },
      pause: () => {
        postToIframe("pauseVideo");
      },
      seekTo: (time: number) => {
        currentTimeRef.current = time;
        postToIframe("seekTo", [time, true]);
      },
      getCurrentTime: () => currentTimeRef.current,
    };

    playerController.setVideoDelegate(delegate);

    return () => {
      playerController.setVideoDelegate(null);
    };
  }, [postToIframe]);

  // Listen to YouTube iframe events to synchronize dock status and progress
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== "object") return;

      if (data.event === "onStateChange") {
        const state = Number(data.info);
        if (state === 1) {
          isPlayingRef.current = true;
          playerController.notifyVideoState("playing", currentTimeRef.current);
        } else if (state === 2) {
          isPlayingRef.current = false;
          playerController.notifyVideoState("paused", currentTimeRef.current);
        } else if (state === 0) {
          isPlayingRef.current = false;
          playerController.notifyVideoState("ended");
        }
      } else if (data.event === "infoDelivery" && data.info) {
        if (typeof data.info.currentTime === "number") {
          currentTimeRef.current = data.info.currentTime;
        }
        if (typeof data.info.playerState === "number") {
          const state = data.info.playerState;
          if (state === 1 && !isPlayingRef.current) {
            isPlayingRef.current = true;
            playerController.notifyVideoState("playing", currentTimeRef.current);
          } else if (state === 2 && isPlayingRef.current) {
            isPlayingRef.current = false;
            playerController.notifyVideoState("paused", currentTimeRef.current);
          } else if (state === 0) {
            isPlayingRef.current = false;
            playerController.notifyVideoState("ended");
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  // Track saved state
  useEffect(() => {
    setIsSaved(isSavedVideo(track.id));
    return subscribeToSavedVideos(() => {
      setIsSaved(isSavedVideo(track.id));
    });
  }, [track.id]);

  // Fetch video details and comments
  useEffect(() => {
    let active = true;
    setIsLoadingComments(true);

    void getVideoDetails(videoId)
      .then((data) => {
        if (active) {
          setDetails(data);
        }
      })
      .catch(() => {});

    void getVideoComments(videoId)
      .then((res) => {
        if (active) {
          setComments(res.comments);
          if (res.totalComments) setTotalComments(res.totalComments);
          setIsLoadingComments(false);
        }
      })
      .catch(() => {
        if (active) setIsLoadingComments(false);
      });

    return () => {
      active = false;
    };
  }, [videoId]);

  // Initialize liked state from YouTube library
  const isLikedInLibrary = useMemo(() => {
    if (!track?.id || !libraryState.library?.likedSongs) return false;
    return libraryState.library.likedSongs.some((t) => t.id === track.id);
  }, [track?.id, libraryState.library?.likedSongs]);

  useEffect(() => {
    if (isLikedInLibrary) {
      setUserRating("like");
    }
  }, [isLikedInLibrary]);

  const handleToggleLike = async () => {
    const nextRating = userRating === "like" ? "none" : "like";
    setUserRating(nextRating);
    try {
      await libraryController.setTrackRating(track, nextRating);
    } catch (e) {
      console.warn("Could not sync like to YouTube:", e);
    }
  };

  const handleToggleDislike = async () => {
    const nextRating = userRating === "dislike" ? "none" : "dislike";
    setUserRating(nextRating);
    try {
      await libraryController.setTrackRating(track, nextRating);
    } catch (e) {
      console.warn("Could not sync dislike to YouTube:", e);
    }
  };

  // Sync subscription state with YouTube and local followed artists
  const channelId = details?.channelId || track.artists?.[0]?.id || "";
  const channelName = details?.channelTitle || track.artist || "";

  useEffect(() => {
    const artists = libraryState.library?.artists ?? [];
    const channelLower = channelName.toLowerCase();
    let followedLocally = false;
    try {
      const raw = localStorage.getItem("amber_followed_artists");
      const parsed = raw ? JSON.parse(raw) : [];
      followedLocally = Array.isArray(parsed) && Boolean(
        (channelId && parsed.includes(channelId)) ||
        (channelLower && parsed.includes(channelLower)),
      );
    } catch {}

    const followedInRemote = artists.some(
      (a) => (channelId && a.id === channelId) || (channelLower && a.name.toLowerCase() === channelLower),
    );

    setIsSubscribed(Boolean(followedLocally || followedInRemote));
  }, [libraryState.library?.artists, channelId, channelName]);

  const handleToggleSubscribe = async () => {
    const nextSub = !isSubscribed;
    setIsSubscribed(nextSub);
    setShowBellMenu(false);

    try {
      const raw = localStorage.getItem("amber_followed_artists");
      const parsed = raw ? JSON.parse(raw) : [];
      const set = new Set(Array.isArray(parsed) ? parsed : []);
      if (nextSub) {
        if (channelId) set.add(channelId);
        if (channelName) set.add(channelName.toLowerCase());
      } else {
        if (channelId) set.delete(channelId);
        if (channelName) set.delete(channelName.toLowerCase());
      }
      localStorage.setItem("amber_followed_artists", JSON.stringify([...set]));
    } catch {}

    try {
      await libraryController.setArtistSubscribed(
        { id: channelId, name: channelName },
        nextSub,
      );
    } catch (e) {
      console.warn("Could not sync subscription to YouTube:", e);
    }
  };

  const handleSelectBellState = (state: "all" | "personalized" | "none") => {
    setBellState(state);
    setShowBellMenu(false);
    if (channelId.startsWith("UC")) {
      void libraryController.setArtistNotificationLevel(
        { id: channelId, name: channelName },
        state,
      ).catch(() => {});
    }
  };

  const handleToggleSave = () => {
    const saved = toggleSaveVideo(track);
    setIsSaved(saved);
  };

  const handlePostComment = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newCommentText.trim()) return;

    const userComment: VideoComment = {
      id: `user_${Date.now()}`,
      authorName: userName,
      authorAvatarUrl: userAvatarUrl,
      text: newCommentText.trim(),
      publishedTime: "Just now",
      likeCount: "0",
    };

    setComments([userComment, ...comments]);
    setNewCommentText("");
    setIsCommentInputFocused(false);
  };

  const startTimeParam = Math.floor(initialTime) > 0 ? `&start=${Math.floor(initialTime)}` : "";
  const originParam = typeof window !== "undefined" && window.location?.origin
    ? `&origin=${encodeURIComponent(window.location.origin)}`
    : "";
  // autoplay=0 per user request ("w lma a7wl m4 lazm yb2a fy autoplay tmam")
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&enablejsapi=1&playsinline=1&rel=0&modestbranding=1${startTimeParam}${originParam}`;

  const displayedLikes = details?.likeCount || "Like";

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [videoId]);

  const formattedViews = useMemo(() => {
    if (!details?.viewCount) return "";
    const raw = details.viewCount.trim();
    if (/views?/i.test(raw)) return raw;
    return `${raw} views`;
  }, [details?.viewCount]);

  const isDescriptionExpandable = useMemo(() => {
    if (!details?.description) return false;
    const trimmed = details.description.trim();
    return trimmed.includes("\n") || trimmed.length > 80;
  }, [details?.description]);

  const handleLinkClick = useCallback(async (e: React.MouseEvent, rawUrl: string) => {
    e.stopPropagation();
    e.preventDefault();
    const target =
      rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
        ? rawUrl
        : `https://${rawUrl}`;
    try {
      await openUrl(target);
    } catch {
      window.open(target, "_blank");
    }
  }, []);

  const handleTimestampClick = useCallback(
    (e: React.MouseEvent, seconds: number) => {
      e.stopPropagation();
      e.preventDefault();
      currentTimeRef.current = seconds;
      postToIframe("seekTo", [seconds, true]);
      playerController.seekTo(seconds);
    },
    [postToIframe],
  );

  const renderFormattedDescription = useCallback(
    (text: string) => {
      if (!text) return null;
      const parts = text.split(TOKEN_REGEX);

      return parts.map((part, idx) => {
        if (!part) return null;

        // Hashtag (#tag)
        if (part.startsWith("#")) {
          return (
            <span key={idx} className="text-[#3ea6ff] font-medium select-text">
              {part}
            </span>
          );
        }

        // Timestamp (hh:mm:ss or mm:ss)
        const timeMatch = part.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (timeMatch) {
          const p1 = parseInt(timeMatch[1], 10);
          const p2 = parseInt(timeMatch[2], 10);
          const p3 = timeMatch[3] ? parseInt(timeMatch[3], 10) : undefined;
          const seconds = p3 !== undefined ? p1 * 3600 + p2 * 60 + p3 : p1 * 60 + p2;

          return (
            <button
              key={idx}
              type="button"
              onClick={(e) => handleTimestampClick(e, seconds)}
              className="text-[#3ea6ff] hover:underline font-medium cursor-pointer inline select-text"
            >
              {part}
            </button>
          );
        }

        // URL
        if (
          /^(https?:\/\/|(?:[a-zA-Z0-9_-]+\.)+(?:com|org|net|io|co|me|to|shop|app|ai|dev|link|lnk\.to))/i.test(
            part,
          )
        ) {
          const match = part.match(/^([\s\S]*?)([.,;:!?]+)?$/);
          const urlOnly = match ? match[1] : part;
          const punctuation = match ? match[2] || "" : "";

          return (
            <span key={idx}>
              <a
                href={urlOnly.startsWith("http") ? urlOnly : `https://${urlOnly}`}
                onClick={(e) => handleLinkClick(e, urlOnly)}
                className="text-[#3ea6ff] hover:underline cursor-pointer break-all select-text"
              >
                {urlOnly}
              </a>
              {punctuation && <span>{punctuation}</span>}
            </span>
          );
        }

        // Regular text
        return <span key={idx}>{part}</span>;
      });
    },
    [handleLinkClick, handleTimestampClick],
  );

  const sortedComments = [...comments].sort((a, b) => {
    if (commentSort === "newest") {
      if (a.publishedTime === "Just now") return -1;
      if (b.publishedTime === "Just now") return 1;
      return 0;
    }
    return 0;
  });

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto gap-6 pb-20 text-white">
      {/* 1. Video Player Surface */}
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10">
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={track.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
          onLoad={() => {
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                JSON.stringify({ event: "listening", id: 1 }),
                "*",
              );
            }
          }}
        />
      </div>

      {/* 2. Video Title */}
      <div className="flex flex-col gap-3 px-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white line-clamp-2">
          {details?.title || track.title}
        </h1>

        {/* 3. YouTube Channel & Action Buttons Row (Exact YouTube Style) */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-1 border-b border-white/10 pb-4">
          {/* Left: Channel info + Subscribe Button + Bell */}
          <div className="flex items-center gap-3">
            {details?.channelAvatarUrl ? (
              <img
                src={details.channelAvatarUrl}
                alt={details.channelTitle || track.artist}
                className="size-10 sm:size-11 rounded-full object-cover ring-1 ring-white/20"
              />
            ) : (
              <div className="size-10 sm:size-11 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm">
                {(details?.channelTitle || track.artist || "Y")[0].toUpperCase()}
              </div>
            )}

            <div className="flex flex-col mr-2">
              <span className="font-semibold text-sm sm:text-base text-white hover:underline cursor-pointer">
                {details?.channelTitle || track.artist}
              </span>
              {details?.subscriberCount && (
                <span className="text-xs text-muted-foreground">{details.subscriberCount}</span>
              )}
            </div>

            {/* Subscribe & Notification Bell Pill */}
            <div className="relative flex items-center">
              {!isSubscribed ? (
                <button
                  type="button"
                  onClick={handleToggleSubscribe}
                  className="rounded-full bg-white text-black px-4 py-2 text-xs sm:text-sm font-bold transition-all hover:bg-white/90 active:scale-95 shadow cursor-pointer"
                >
                  Subscribe
                </button>
              ) : (
                <div className="flex items-center rounded-full bg-white/10 hover:bg-white/15 px-3 py-1.5 gap-1.5 border border-white/10 transition-colors">
                  <button
                    type="button"
                    onClick={() => setShowBellMenu(!showBellMenu)}
                    className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-white/90 cursor-pointer"
                    aria-label="Notification settings"
                  >
                    {bellState === "all" ? (
                      <BellRingIcon size={16} className="text-white" />
                    ) : (
                      <BellIcon size={16} className="text-white/80" />
                    )}
                    <span>Subscribed</span>
                    <ChevronDownIcon size={14} className="text-white/70" />
                  </button>

                  {/* Bell Options Dropdown */}
                  {showBellMenu && (
                    <div className="absolute top-full left-0 mt-2 w-44 rounded-xl bg-[#282828] border border-white/10 p-1.5 shadow-2xl z-40 flex flex-col gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => handleSelectBellState("all")}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer",
                          bellState === "all" ? "bg-white/20 font-bold" : "hover:bg-white/10",
                        )}
                      >
                        <BellRingIcon size={16} />
                        <span>All</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectBellState("personalized")}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer",
                          bellState === "personalized" ? "bg-white/20 font-bold" : "hover:bg-white/10",
                        )}
                      >
                        <BellIcon size={16} />
                        <span>Personalized</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectBellState("none")}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer",
                          bellState === "none" ? "bg-white/20 font-bold" : "hover:bg-white/10",
                        )}
                      >
                        <BellIcon size={16} className="opacity-50" />
                        <span>None</span>
                      </button>
                      <div className="border-t border-white/10 my-0.5" />
                      <button
                        type="button"
                        onClick={handleToggleSubscribe}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-red-400 hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <span>Unsubscribe</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Switch to Song button */}
            {onSwitchToSong && (
              <button
                type="button"
                onClick={onSwitchToSong}
                className="ml-2 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold text-white/90 transition-all cursor-pointer border border-white/10"
              >
                {isPodcast ? "Switch to Audio" : "Switch to Song"}
              </button>
            )}
          </div>

          {/* Right: Actions Row (Segmented Like/Dislike, Share, Save) */}
          <div className="flex items-center gap-2">
            {/* Segmented Like / Dislike Button */}
            <div className="flex items-center rounded-full bg-white/10 border border-white/10 overflow-hidden text-xs font-semibold">
              <button
                type="button"
                onClick={handleToggleLike}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 transition-colors cursor-pointer hover:bg-white/10",
                  userRating === "like" ? "text-primary font-bold" : "text-white/90",
                )}
                aria-label="Like"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4l1 1h9.43c1.06 0 1.98-.67 2.19-1.61l1.34-6.03C21.2 13.13 20.19 11 18.77 11zM7 20H5v-7h2v7zm12.04-6.02-1.34 6.03H9v-7.59l5.12-5.55c.1-.11.23-.17.37-.17.28 0 .49.25.43.52L13.1 13h5.67c.53 0 .93.44.88.98z" />
                </svg>
                <span>{displayedLikes}</span>
              </button>

              <div className="w-px h-5 bg-white/20" />

              <button
                type="button"
                onClick={handleToggleDislike}
                className={cn(
                  "px-3 py-2 transition-colors cursor-pointer hover:bg-white/10",
                  userRating === "dislike" ? "text-primary font-bold" : "text-white/80",
                )}
                aria-label="Dislike"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M17 4h-4l-1-1H2.57C1.51 3 .59 3.67.38 4.61L.96 10.64C1.19 11.87 2.2 13 3.62 13H7.85l-1.52 4.94c-.32 1.03.52 2.06 1.68 2.06.58 0 1.14-.24 1.52-.65L14 13h4V4zm-2 7.59-5.12 5.55c-.1.11-.23.17-.37.17-.28 0-.49-.25-.43-.52L10.9 11H5.23c-.53 0-.93-.44-.88-.98l.58-6.02H15v7.59zM19 4h2v7h-2V4z" />
                </svg>
              </button>
            </div>

            {/* Share Button (Official curved arrow) */}
            <button
              type="button"
              onClick={() => setIsShareModalOpen(true)}
              className="flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-3.5 py-2 text-xs font-semibold text-white/90 transition-all cursor-pointer"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1l.86-.13V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-6 12-6v6l8-9-8-9z" />
              </svg>
              <span>Share</span>
            </button>

            {/* Save to Videos Button */}
            <button
              type="button"
              onClick={handleToggleSave}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer",
                isSaved
                  ? "bg-white text-black font-bold shadow"
                  : "bg-white/10 hover:bg-white/20 text-white/90",
              )}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              <span>{isSaved ? "Saved" : "Save"}</span>
            </button>
          </div>
        </div>

        {/* 4. Description Box (YouTube Style) */}
        <div
          onClick={() => {
            if (!isDescriptionExpanded && isDescriptionExpandable) {
              setIsDescriptionExpanded(true);
            }
          }}
          className={cn(
            "rounded-xl bg-white/[0.06] hover:bg-white/[0.08] p-3.5 sm:p-4 text-sm text-white/90 transition-all flex flex-col gap-2.5",
            !isDescriptionExpanded && isDescriptionExpandable && "cursor-pointer",
          )}
        >
          {/* Header Stats: Views & Date */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-xs sm:text-sm text-white/90">
            {formattedViews && <span>{formattedViews}</span>}
            {formattedViews && details?.publishDate && (
              <span className="text-white/40">•</span>
            )}
            {details?.publishDate && <span>{details.publishDate}</span>}
          </div>

          {/* Description Body */}
          {!isDescriptionExpanded ? (
            <div className="flex flex-col items-start">
              <div className="text-xs sm:text-sm text-white/80 whitespace-pre-wrap leading-relaxed line-clamp-3 select-text">
                {details?.description
                  ? renderFormattedDescription(details.description)
                  : "No description provided for this video."}
              </div>
              {isDescriptionExpandable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDescriptionExpanded(true);
                  }}
                  className="text-xs sm:text-sm font-bold text-white hover:underline mt-1.5 cursor-pointer"
                >
                  ...more
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-xs sm:text-sm text-white/90 whitespace-pre-wrap leading-relaxed select-text break-words">
                {details?.description
                  ? renderFormattedDescription(details.description)
                  : "No description provided for this video."}
              </div>

              {/* Show less button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDescriptionExpanded(false);
                }}
                className="text-xs sm:text-sm font-bold text-white hover:underline self-start cursor-pointer pt-1"
              >
                Show less
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 5. Real YouTube Comments Section */}
      <div className="flex flex-col gap-6 px-1 pt-2">
        {/* Comments Header & Sort */}
        <div className="flex items-center gap-6">
          <h2 className="text-lg sm:text-xl font-bold text-white">
            {totalComments ? `${totalComments} Comments` : "Comments"}
          </h2>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCommentSort("top")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                commentSort === "top" ? "bg-white/20 text-white" : "text-white/60 hover:text-white",
              )}
            >
              Top comments
            </button>
            <button
              type="button"
              onClick={() => setCommentSort("newest")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                commentSort === "newest" ? "bg-white/20 text-white" : "text-white/60 hover:text-white",
              )}
            >
              Newest first
            </button>
          </div>
        </div>

        {/* Add a comment... Interactive Form (Exact YouTube Style) */}
        <form onSubmit={handlePostComment} className="flex gap-3.5 items-start">
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt={userName}
              referrerPolicy="no-referrer"
              className="size-10 rounded-full object-cover shrink-0 ring-1 ring-white/10"
            />
          ) : (
            <div className="size-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0 ring-1 ring-white/10">
              {userName ? userName[0]?.toUpperCase() : "Y"}
            </div>
          )}

          <div className="flex flex-col gap-2 flex-1 min-w-0">
            <input
              type="text"
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              onFocus={() => setIsCommentInputFocused(true)}
              placeholder="Add a comment..."
              className="w-full bg-transparent border-b border-white/20 focus:border-white py-1.5 text-sm text-white placeholder:text-white/40 outline-none transition-colors"
            />

            {isCommentInputFocused && (
              <div className="flex items-center justify-end gap-2 pt-1 animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setIsCommentInputFocused(false);
                    setNewCommentText("");
                  }}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newCommentText.trim()}
                  className="rounded-full bg-primary disabled:bg-white/10 text-primary-foreground disabled:text-white/40 px-4 py-1.5 text-xs font-bold transition-all cursor-pointer disabled:cursor-default"
                >
                  Comment
                </button>
              </div>
            )}
          </div>
        </form>

        {/* Comments List */}
        {isLoadingComments ? (
          <div className="flex items-center justify-center py-12 text-white/50 gap-2">
            <SpinnerSteps size={20} color="currentColor" />
            <span className="text-sm font-medium">Loading comments...</span>
          </div>
        ) : sortedComments.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-white/40 text-sm">
            No comments yet. Be the first to comment!
          </div>
        ) : (
          <div className="flex flex-col gap-6 pt-2">
            {sortedComments.map((c) => (
              <div key={c.id} className="flex gap-3.5 items-start">
                {c.authorAvatarUrl ? (
                  <img
                    src={c.authorAvatarUrl}
                    alt={c.authorName}
                    referrerPolicy="no-referrer"
                    className="size-9 rounded-full object-cover ring-1 ring-white/10 shrink-0"
                  />
                ) : (
                  <div className="size-9 rounded-full bg-white/10 flex items-center justify-center font-bold text-xs shrink-0">
                    {(c.authorName || "U")[0].toUpperCase()}
                  </div>
                )}

                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white hover:underline cursor-pointer">
                      {c.authorName}
                    </span>
                    {c.publishedTime && (
                      <span className="text-[11px] text-white/50">{c.publishedTime}</span>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm text-white/90 whitespace-pre-wrap leading-relaxed">
                    {c.text}
                  </p>

                  {/* Comment Actions (Thumbs up, Thumbs down, Reply) */}
                  <div className="flex items-center gap-3 pt-1 text-white/60">
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer text-xs"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4l1 1h9.43c1.06 0 1.98-.67 2.19-1.61l1.34-6.03C21.2 13.13 20.19 11 18.77 11zM7 20H5v-7h2v7zm12.04-6.02-1.34 6.03H9v-7.59l5.12-5.55c.1-.11.23-.17.37-.17.28 0 .49.25.43.52L13.1 13h5.67c.53 0 .93.44.88.98z" />
                      </svg>
                      {c.likeCount && <span>{c.likeCount}</span>}
                    </button>

                    <button
                      type="button"
                      className="hover:text-white transition-colors cursor-pointer"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M17 4h-4l-1-1H2.57C1.51 3 .59 3.67.38 4.61L.96 10.64C1.19 11.87 2.2 13 3.62 13H7.85l-1.52 4.94c-.32 1.03.52 2.06 1.68 2.06.58 0 1.14-.24 1.52-.65L14 13h4V4zm-2 7.59-5.12 5.55c-.1.11-.23.17-.37.17-.28 0-.49-.25-.43-.52L10.9 11H5.23c-.53 0-.93-.44-.88-.98l.58-6.02H15v7.59zM19 4h2v7h-2V4z" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="text-xs font-semibold hover:text-white transition-colors cursor-pointer ml-1"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. YouTube Share Modal Dialog */}
      <YouTubeShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        videoId={videoId}
        videoTitle={details?.title || track.title}
        currentTimeSec={initialTime}
      />
    </div>
  );
}
