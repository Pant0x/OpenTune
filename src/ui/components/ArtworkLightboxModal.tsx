import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { TrackArtwork } from "./TrackArtwork";
import { cn } from "@/lib/utils";
import { CloseIcon, CopyIcon } from "@/ui/icons";

interface ArtworkLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  artworkUrl?: string;
  title?: string;
  subtitle?: string;
}

export function ArtworkLightboxModal({
  isOpen,
  onClose,
  artworkUrl,
  title,
  subtitle,
}: ArtworkLightboxModalProps) {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const copyToClipboard = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!artworkUrl) return;
    try {
      await navigator.clipboard.writeText(artworkUrl);
      setToast("Image link copied to clipboard");
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
    } catch {
      setToast("Unable to copy to clipboard");
    }
  };

  if (!isOpen || !artworkUrl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Cover art preview for ${title}` : "Cover art preview"}
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4 sm:p-8 backdrop-blur-xl animate-in fade-in duration-200 cursor-pointer select-none"
    >
      {/* Top action buttons */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={copyToClipboard}
          className="flex size-10 items-center justify-center rounded-full bg-black/60 hover:bg-black/90 text-white/90 hover:text-white transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg border border-white/10"
          title="Copy image link"
        >
          <CopyIcon size={18} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-full bg-black/60 hover:bg-black/90 text-white/90 hover:text-white transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg border border-white/10"
          title="Close preview"
        >
          <CloseIcon size={18} />
        </button>
      </div>

      <div
        className="relative flex max-h-[85vh] max-w-[85vw] flex-col items-center gap-4 text-center cursor-pointer select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          onClick={copyToClipboard}
          className={cn(
            "group relative flex items-center justify-center overflow-hidden shadow-2xl ring-1 ring-white/15 transition-all duration-300 rounded-2xl bg-black/60",
            "max-h-[78vh] max-w-[85vw] shrink-0 select-none cursor-pointer",
            "hover:shadow-[0_25px_60px_rgba(0,0,0,0.9)] hover:ring-white/30",
          )}
        >
          <TrackArtwork
            className="max-h-[78vh] max-w-[85vw] w-auto h-auto object-contain rounded-2xl select-none pointer-events-none transition-transform duration-300 group-hover:scale-[1.01]"
            artworkUrl={artworkUrl}
            iconSize={96}
            size={1600}
            loading="eager"
            preferProxy
          />
        </div>

        {(title || subtitle) && (
          <div className="flex flex-col items-center gap-1 px-4 select-none">
            {title && (
              <h2 className="max-w-xl truncate text-xl font-bold text-white drop-shadow-md sm:text-2xl">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="max-w-lg truncate text-sm font-medium text-white/70">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[310] rounded-full bg-white text-black px-5 py-2.5 text-xs font-bold shadow-2xl animate-in fade-in zoom-in duration-200">
          {toast}
        </div>
      )}
    </div>,
    document.body,
  );
}
