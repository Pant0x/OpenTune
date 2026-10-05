import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { libraryController } from "../../player/playerStore";
import { CloseIcon } from "@/ui/icons";
import { GoogleSignInButton } from "./GoogleSignInButton";
import openTuneText from "../../../assets/img/opentune-text.png";
import { Loader } from "@/components/motion/loader";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

/**
 * Connect modal: exactly one way in.
 *
 * "Sign in with Google" opens a real browser window owned by the app on the
 * YouTube login. The user signs in there — once ever, then an account chooser —
 * the app notices the session itself, stores it as an ordinary slot, and syncs
 * the library exactly like the old window sign-in. No typing in the app, no
 * popup window, no passwords anywhere.
 */
export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    firstElement?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    modal.addEventListener("keydown", handleTab);
    return () => modal.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError(null);

    try {
      await libraryController.importBrowserSession();
      onAuthSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * The classic embedded window, for machines with no supported browser.
   * The overlay takes over progress from here — this just starts it and steps
   * aside, so a failure surfaces there instead of stranding this modal.
   */
  const handleClassicSignIn = () => {
    onClose();
    void libraryController.signIn().catch(() => {});
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="relative w-full max-w-md rounded-3xl bg-card border border-border/40 shadow-2xl overflow-hidden p-6 sm:p-7"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            type="button"
            className="absolute top-4 right-4 z-20 flex size-8 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>

          {/* Branding */}
          <div className="flex flex-col items-center mb-5">
            <div className="flex items-center justify-center py-2 px-4 mb-3">
              <img
                src={openTuneText}
                alt="OpenTune"
                className="h-8 w-auto object-contain select-none"
              />
            </div>
            <h2 id="auth-modal-title" className="text-xl font-bold text-foreground">
              Sign in to OpenTune
            </h2>
            <p className="mt-1 text-xs text-muted-foreground text-center">
              A browser window opens for sign-in — nothing is typed in here
            </p>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center gap-2 rounded-xl bg-destructive/15 p-3 text-xs text-destructive border border-destructive/20"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </motion.div>
          )}

          <div className="flex flex-col items-center gap-3">
            <GoogleSignInButton
              onClick={() => void handleGoogleSignIn()}
              isBusy={busy}
              fullWidth
            />
            {busy && (
              <p className="flex items-center gap-2 text-[11px] leading-relaxed text-muted-foreground/80">
                <Loader variant="spinner" size={12} />
                Waiting for the browser sign-in — finish it there, then come back.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleClassicSignIn}
            className="mt-4 w-full text-center text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            No supported browser? Use the classic window instead
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
