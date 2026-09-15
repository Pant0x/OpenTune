import { useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import { CloseIcon } from "@/ui/icons";

interface YouTubeShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle: string;
  currentTimeSec?: number;
}

interface SharePlatform {
  name: string;
  color: string;
  icon: React.ReactNode;
  action: (url: string, title: string) => void;
}

export function YouTubeShareModal({
  isOpen,
  onClose,
  videoId,
  videoTitle,
  currentTimeSec = 0,
}: YouTubeShareModalProps) {
  const [startAt, setStartAt] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const currentSeconds = Math.max(0, Math.floor(currentTimeSec));
  const baseUrl = `https://youtu.be/${videoId}`;
  const shareUrl = startAt && currentSeconds > 0 ? `${baseUrl}?t=${currentSeconds}` : baseUrl;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // fallback
    }
  };

  const platforms: SharePlatform[] = [
    {
      name: "Embed",
      color: "bg-white/10 hover:bg-white/20 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M8.7 15.3 4.4 11l4.3-4.3L7.3 5.3 1.6 11l5.7 5.7 1.4-1.4zm6.6 0 4.3-4.3-4.3-4.3 1.4-1.4 5.7 5.7-5.7 5.7-1.4-1.4z" />
        </svg>
      ),
      action: () => {
        const iframe = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
        void navigator.clipboard.writeText(iframe);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      },
    },
    {
      name: "WhatsApp",
      color: "bg-[#25D366] hover:brightness-110 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.196 8.196 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25.7-.72 1.3-1.36 1.68-.62.36-1.4.45-2.07.28-1.57-.4-3.17-1.33-4.56-2.73-1.4-1.4-2.33-3-2.73-4.57-.18-.68-.08-1.46.28-2.07.38-.64.98-1.11 1.68-1.36.42-.15.9-.03 1.21.31l1.16 1.48c.28.36.31.86.07 1.25l-.57.94c.48.88 1.18 1.58 2.06 2.06l.94-.57c.39-.24.89-.21 1.25.07l1.48 1.16c.34.31.46.79.31 1.21z" />
        </svg>
      ),
      action: (url, title) => {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(`${title} ${url}`)}`, "_blank");
      },
    },
    {
      name: "Facebook",
      color: "bg-[#1877F2] hover:brightness-110 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      ),
      action: (url) => {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
      },
    },
    {
      name: "X",
      color: "bg-black hover:bg-neutral-900 text-white border border-white/20",
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
      action: (url, title) => {
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, "_blank");
      },
    },
    {
      name: "Email",
      color: "bg-[#757575] hover:brightness-110 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
      ),
      action: (url, title) => {
        window.open(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`, "_blank");
      },
    },
    {
      name: "Reddit",
      color: "bg-[#FF4500] hover:brightness-110 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
      ),
      action: (url, title) => {
        window.open(`https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`, "_blank");
      },
    },
    {
      name: "Pinterest",
      color: "bg-[#E60023] hover:brightness-110 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" />
        </svg>
      ),
      action: (url, title) => {
        window.open(`https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(title)}`, "_blank");
      },
    },
    {
      name: "LinkedIn",
      color: "bg-[#0A66C2] hover:brightness-110 text-white",
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
        </svg>
      ),
      action: (url) => {
        window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, "_blank");
      },
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg rounded-2xl bg-[#212121] border border-white/10 p-6 shadow-2xl flex flex-col gap-6 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Share</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Circular Share Buttons Carousel */}
        <div className="flex items-center gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {platforms.map((p) => (
            <div key={p.name} className="flex flex-col items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => p.action(shareUrl, videoTitle)}
                className={cn(
                  "flex size-14 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 shadow-md cursor-pointer",
                  p.color,
                )}
                aria-label={p.name}
              >
                {p.icon}
              </button>
              <span className="text-xs text-white/80 font-medium">{p.name}</span>
            </div>
          ))}
        </div>

        {/* Link Copy Box (YouTube Style) */}
        <div className="flex items-center justify-between rounded-xl bg-black/40 border border-white/10 px-4 py-2.5 gap-3">
          <span className="text-xs sm:text-sm text-white/90 truncate select-all font-mono">
            {shareUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "rounded-full px-5 py-2 text-xs font-bold transition-all cursor-pointer shrink-0 shadow",
              copied
                ? "bg-primary text-black"
                : "bg-white text-black hover:bg-white/90 active:scale-95",
            )}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* Start At Checkbox */}
        <div className="flex items-center gap-3 pt-1 border-t border-white/10">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={startAt}
              onChange={(e) => setStartAt(e.target.checked)}
              className="size-4 rounded accent-primary cursor-pointer"
            />
            <span className="text-sm font-medium text-white/90">
              Start at <span className="font-mono text-white">{formatMinutesSeconds(currentSeconds)}</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
