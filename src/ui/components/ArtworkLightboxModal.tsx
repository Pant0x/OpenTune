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
  const [backdropFailed, setBackdropFailed] = useState(false);
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

  useEffect(() => {
    if (isOpen) setBackdropFailed(false);
  }, [isOpen, artworkUrl]);

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
      {/* Ambient wash: the artwork itself, blurred to fill the screen. Dropped if it 404s. */}
      {!backdropFailed && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <img
            src={artworkUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBackdropFailed(true)}
            className="h-full w-full scale-125 object-cover opacity-60 blur-3xl saturate-150"
          />
          <div className="absolute inset-0 bg-black/55" />
        </div>
      )}

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
        initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className={cn(
          "relative z-10 flex items-center justify-center overflow-hidden rounded-2xl",
          "size-[min(65vh,65vw,460px)] sm:size-[420px] md:size-[460px]",
          "shadow-[0_40px_120px_rgba(0,0,0,0.85)] ring-1 ring-white/15 bg-black/40 cursor-default",
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
