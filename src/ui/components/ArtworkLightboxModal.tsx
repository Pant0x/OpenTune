import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { TrackArtwork } from "./TrackArtwork";
import { cn } from "@/lib/utils";
import { CloseIcon, CopyIcon } from "@/ui/icons";

interface ArtworkLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  artworkUrl?: string;
}

/*
 * Spotify-style cover preview: the artwork enlarged over its own blurred wash, popped in with
 * a spring, and nothing else — no name or caption, the cover is the whole point. Esc, the
 * close button, or a click anywhere outside the artwork dismisses it.
 */
export function ArtworkLightboxModal({
  isOpen,
  onClose,
  artworkUrl,
}: ArtworkLightboxModalProps) {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

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

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  if (!isOpen || !artworkUrl) return null;

  const copyToClipboard = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(artworkUrl);
      setToast("Image link copied to clipboard");
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
    } catch {
      setToast("Unable to copy to clipboard");
    }
  };

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Cover art preview"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-black/80 p-6 select-none cursor-pointer"
    >
      {/* Top action buttons */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={copyToClipboard}
          className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white/90 backdrop-blur transition-all hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 cursor-pointer border border-white/10"
          title="Copy image link"
          aria-label="Copy image link"
        >
          <CopyIcon size={18} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white/90 backdrop-blur transition-all hover:bg-white/20 hover:text-white hover:scale-105 active:scale-95 cursor-pointer border border-white/10"
          title="Close preview"
          aria-label="Close preview"
        >
          <CloseIcon size={18} />
        </button>
      </div>

      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={reducedMotion ? false : { scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        className={cn(
          "relative z-10 flex items-center justify-center overflow-hidden rounded-2xl",
          "size-[min(76vh,76vw,540px)] sm:size-[480px] md:size-[540px]",
          "shadow-[0_25px_80px_rgba(0,0,0,0.95)] ring-1 ring-white/20 bg-zinc-950 cursor-default",
        )}
      >
        {/*
          TrackArtwork sizes its box from the className on the span, and the img inside is
          absolute inset-0 — so the box needs explicit dimensions or it collapses to the
          fallback icon and the "big cover" renders thumbnail-sized.
        */}
        <TrackArtwork
          className="size-full"
          artworkUrl={artworkUrl}
          iconSize={96}
          size={1600}
          loading="eager"
          preferProxy
        />
      </motion.div>

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[310] rounded-full bg-white text-black px-5 py-2.5 text-xs font-bold shadow-2xl animate-in fade-in zoom-in duration-200">
          {toast}
        </div>
      )}
    </motion.div>,
    document.body,
  );
}
