import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SpinnerSteps } from "@/components/motion/loader";
import {
  getVideoDetails,
  getVideoComments,
  type VideoDetails,
  type VideoComment,
} from "../../../datasource/youtube/videoService";
import type { Track } from "../../../datasource/types";

interface VideoPlayerViewProps {
  videoId: string;
  track: Track;
  initialTime?: number;
  onSwitchToSong?: () => void;
  isPodcast?: boolean;
}

export function VideoPlayerView({
  videoId,
  track,
  initialTime = 0,
  onSwitchToSong,
  isPodcast = false,
}: VideoPlayerViewProps) {
  const [details, setDetails] = useState<VideoDetails | null>(null);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [totalComments, setTotalComments] = useState<string>("");
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

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

  const handleShare = () => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    void navigator.clipboard.writeText(url);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  const startTimeParam = Math.floor(initialTime) > 0 ? `&start=${Math.floor(initialTime)}` : "";
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&modestbranding=1${startTimeParam}`;

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto gap-6 pb-24 text-white">
      {/* 1. Video Player Surface */}
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10">
        <iframe
          src={embedUrl}
          title={track.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      </div>

      {/* 2. Video Header & Info */}
      <div className="flex flex-col gap-3 px-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white line-clamp-2">
          {details?.title || track.title}
        </h1>

        {/* Channel & Actions Row (YouTube interface) */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-1 border-b border-white/10 pb-4">
          {/* Channel metadata */}
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
            <div className="flex flex-col">
              <span className="font-semibold text-sm sm:text-base text-white hover:underline cursor-pointer">
                {details?.channelTitle || track.artist}
              </span>
              {details?.subscriberCount && (
                <span className="text-xs text-muted-foreground">{details.subscriberCount}</span>
              )}
            </div>

            {onSwitchToSong && (
              <button
                type="button"
                onClick={onSwitchToSong}
                className="ml-3 rounded-full bg-white/10 hover:bg-white/20 px-3.5 py-1.5 text-xs font-semibold text-white transition-all cursor-pointer border border-white/10"
              >
                {isPodcast ? "Switch to Audio" : "Switch to Song (No SFX)"}
              </button>
            )}
          </div>

          {/* Action Buttons: Like, Share, Copy */}
          <div className="flex items-center gap-2">
            {/* Like Pill */}
            <button
              type="button"
              onClick={() => setIsLiked(!isLiked)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer",
                isLiked
                  ? "bg-white text-black font-bold"
                  : "bg-white/10 hover:bg-white/15 text-white border border-white/10",
              )}
            >
              <span>{isLiked ? "❤️" : "👍"}</span>
              <span>{details?.likeCount || "Like"}</span>
            </button>

            {/* Share Pill */}
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 px-4 py-2 text-xs sm:text-sm font-semibold text-white transition-all cursor-pointer border border-white/10"
            >
              <span>🔗</span>
              <span>{isCopied ? "Copied!" : "Share"}</span>
            </button>
          </div>
        </div>

        {/* Description Box */}
        {(details?.description || details?.viewCount || details?.publishDate) && (
          <div
            className="rounded-xl bg-white/[0.05] hover:bg-white/[0.08] p-3.5 transition-colors cursor-pointer text-xs sm:text-sm"
            onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
          >
            <div className="flex items-center gap-2 font-semibold text-white/90 mb-1.5">
              {details?.viewCount && <span>{details.viewCount}</span>}
              {details?.publishDate && (
                <>
                  <span>•</span>
                  <span>{details.publishDate}</span>
                </>
              )}
            </div>
            <p
              className={cn(
                "text-muted-foreground whitespace-pre-wrap leading-relaxed",
                !isDescriptionExpanded && "line-clamp-2",
              )}
            >
              {details?.description || "No description provided."}
            </p>
            <button
              type="button"
              className="mt-1 font-semibold text-white/80 hover:text-white"
            >
              {isDescriptionExpanded ? "Show less" : "...more"}
            </button>
          </div>
        )}
      </div>

      {/* 3. YouTube Comments Section */}
      <div className="flex flex-col gap-4 px-1 pt-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg sm:text-xl font-bold text-white">
            {totalComments ? `${totalComments} Comments` : "Comments"}
          </h2>
        </div>

        {isLoadingComments ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <SpinnerSteps size={24} color="currentColor" />
            <span className="ml-3 text-sm">Loading comments...</span>
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">
            Comments are unavailable or turned off for this video.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-3 group">
                {comment.authorAvatarUrl ? (
                  <img
                    src={comment.authorAvatarUrl}
                    alt={comment.authorName}
                    className="size-9 rounded-full object-cover shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="size-9 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                    {comment.authorName[0]?.toUpperCase() || "U"}
                  </div>
                )}
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-white/90 truncate">
                      {comment.authorName}
                    </span>
                    {comment.publishedTime && (
                      <span className="text-muted-foreground">{comment.publishedTime}</span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-white/80 leading-relaxed whitespace-pre-wrap select-text">
                    {comment.text}
                  </p>
                  {comment.likeCount && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-0.5">
                      <span>👍</span>
                      <span>{comment.likeCount}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
