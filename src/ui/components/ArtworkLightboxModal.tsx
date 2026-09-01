import { useEffect, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { CopyIcon } from "@/ui/icons";
import { TrackArtwork } from "./TrackArtwork";
import { cn } from "@/lib/utils";

interface ArtworkLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  artworkUrl?: string;
  title?: string;
  subtitle?: string;
  circular?: boolean;
}

export function ArtworkLightboxModal({
  isOpen,
  onClose,
  artworkUrl,
  title,
  subtitle,
  circular = false,
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

  const handleCopyUrl = async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(artworkUrl);
    } catch {
      // ignore
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Cover art preview for ${title}` : "Cover art preview"}
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4 sm:p-8 backdrop-blur-xl animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        className="relative flex max-h-[85vh] max-w-[85vw] flex-col items-center gap-4 text-center cursor-default"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            "relative overflow-hidden shadow-2xl ring-1 ring-white/15 transition-transform duration-300",
            circular ? "rounded-full" : "rounded-2xl",
            "size-[min(65vh,65vw,540px)]",
          )}
        >
          <TrackArtwork
            className="size-full object-cover"
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

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleCopyUrl}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            <CopyIcon size={14} />
            <span>Copy image URL</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
