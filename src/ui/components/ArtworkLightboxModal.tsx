import { useEffect } from "react";
import { createPortal } from "react-dom";
import { TrackArtwork } from "./TrackArtwork";
import { cn } from "@/lib/utils";

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

  if (!isOpen || !artworkUrl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Cover art preview for ${title}` : "Cover art preview"}
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4 sm:p-8 backdrop-blur-xl animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        className="relative flex max-h-[85vh] max-w-[85vw] flex-col items-center gap-4 text-center cursor-pointer"
        onClick={onClose}
      >
        <div
          className={cn(
            "relative flex items-center justify-center overflow-hidden shadow-2xl ring-1 ring-white/15 transition-transform duration-300 rounded-2xl bg-black/60 hover:scale-[1.01]",
            "size-[min(70vh,70vw,600px)]",
          )}
          title="Click to close"
        >
          <TrackArtwork
            className="size-full object-cover rounded-2xl"
            artworkUrl={artworkUrl}
            iconSize={96}
            size={1200}
            loading="eager"
            preferProxy
          />
        </div>

        {(title || subtitle) && (
          <div className="flex flex-col items-center gap-1 px-4">
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
    </div>,
    document.body,
  );
}
