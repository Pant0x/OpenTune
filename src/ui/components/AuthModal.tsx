import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { libraryController } from "../../player/playerStore";
import { setDiscordIdentity, type DiscordIdentity } from "../../ui/settings/discordIdentity";
import { DiscordIcon, CloseIcon, GlobeIcon } from "@/ui/icons";
import openTuneText from "../../../assets/img/opentune-text.png";
import { Loader } from "@/components/motion/loader";
import { Button } from "@/components/motion/button";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

interface BrowserImportCandidate {
  browser: string;
  profileName: string;
  kind: "chromium" | "firefox" | string;
  hasSession: boolean;
  restoresTabs: boolean;
}

/**
 * Connect modal: identity comes from connected services, not passwords.
 *
 * Three doors, in order of preference: a live browser session (one click, no
 * typing, no popup), a linked Discord identity (system browser loopback), and
 * the classic embedded sign-in window for machines with no browser session.
 * The old email/password + Supabase/Clerk apparatus is gone with its backends.
 */
export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BrowserImportCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);
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

  // Browsers with importable sessions. The primary sign-in path: one click, no
  // typing, no popup window.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCandidatesError(null);
    void invoke<BrowserImportCandidate[]>("browser_import_candidates")
      .then((found) => {
        if (!cancelled) setCandidates(found);
      })
      .catch((error) => {
        if (!cancelled) {
          setCandidates([]);
          setCandidatesError(error instanceof Error ? error.message : "Could not list browsers.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  /**
   * One-click sign-in from a live browser session. The backend reads the browser's
   * own session, stores it as an ordinary slot, and the controller syncs the
   * library exactly like a window sign-in — the overlay below is driven by the
   * same library state, so progress and errors surface identically.
   */
  const handleBrowserImport = async (browser: string, profileName: string) => {
    const key = `${browser}::${profileName}`;
    setImportingKey(key);
    setError(null);
    setSuccessMessage(null);

    try {
      await libraryController.importBrowserSession(browser, profileName);
      onAuthSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser import failed.");
    } finally {
      setImportingKey(null);
    }
  };

  /** Direct loopback OAuth in the system browser. Tokens stay in the OS keyring. */
  const handleDiscordConnect = async () => {
    setDiscordBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const identity = await invoke<DiscordIdentity>("discord_oauth_connect");
      setDiscordIdentity(identity);
      onAuthSuccess?.();
      onClose();
      if (libraryController.getState().status !== "ready") {
        void libraryController.signIn().catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discord sign-in failed.");
    } finally {
      setDiscordBusy(false);
    }
  };

  /**
   * The classic embedded window, for machines with no browser session to import.
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
              Connect OpenTune
            </h2>
            <p className="mt-1 text-xs text-muted-foreground text-center">
              Your browser session is your account — no passwords, no typing
            </p>
          </div>

          {/* Error & Success Messages */}
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

          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-500/15 p-3 text-xs text-emerald-400 border border-emerald-500/20"
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
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>{successMessage}</span>
            </motion.div>
          )}

          {/* Browser import — the primary sign-in. One click, no typing, no popup. */}
          <div className="mb-2">
            <div className="mb-1 block text-xs font-medium text-foreground">
              Connect your browser
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground/80">
              Uses the YouTube session already signed in there. Nothing is typed, nothing leaves your machine.
            </p>
            {candidates === null && !candidatesError && (
              <div className="flex items-center gap-2 rounded-xl bg-background/80 p-3 text-xs text-muted-foreground border border-border/30">
                <Loader variant="spinner" size={14} />
                Looking for browsers…
              </div>
            )}
            {candidatesError && (
              <div className="mb-2 rounded-xl bg-destructive/15 p-3 text-xs text-destructive border border-destructive/20">
                {candidatesError}
              </div>
            )}
            {candidates !== null && candidates.length === 0 && !candidatesError && (
              <div className="rounded-xl bg-background/80 p-3 text-xs text-muted-foreground border border-border/30">
                No browsers found. Sign into YouTube Music in Brave, Chrome, Edge or Firefox first.
              </div>
            )}
            <div className="flex flex-col gap-2">
              {(candidates ?? []).map((candidate) => {
                const key = `${candidate.browser}::${candidate.profileName}`;
                const importing = importingKey === key;
                const disabled = discordBusy || importingKey !== null;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-xl bg-background/80 p-3 border border-border/30"
                  >
                    <GlobeIcon size={18} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground">
                        {candidate.browser}
                        <span className="ml-1.5 font-normal text-muted-foreground/70">
                          {candidate.profileName}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
                        {!candidate.hasSession && "No YouTube session here yet."}
                        {candidate.hasSession && candidate.kind !== "chromium" && "YouTube session found."}
                        {candidate.hasSession && candidate.kind === "chromium" && `${candidate.browser} restarts once to hand it over.`}
                        {candidate.hasSession && candidate.kind === "chromium" && !candidate.restoresTabs && " Open tabs will not come back — enable “Continue where you left off” first."}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={candidate.hasSession ? "primary" : "outline"}
                      size="md"
                      disabled={disabled || !candidate.hasSession}
                      onClick={() => void handleBrowserImport(candidate.browser, candidate.profileName)}
                      className="shrink-0 rounded-xl text-xs"
                    >
                      {importing ? (
                        <>
                          <Loader variant="spinner" size={14} className="mr-1.5" />
                          Importing…
                        </>
                      ) : (
                        "Import"
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
            {importingKey !== null && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                Importing — if your browser restarts, leave it alone until the library appears.
              </p>
            )}
          </div>

          {/* Divider & Discord */}
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground/60">
            <span className="flex-1 h-px bg-border/40" />
            <span>or continue with</span>
            <span className="flex-1 h-px bg-border/40" />
          </div>

          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={discordBusy || importingKey !== null}
            onClick={() => void handleDiscordConnect()}
            className="w-full flex items-center justify-center gap-2 rounded-xl text-xs hover:border-[#5865F2]/40 transition-all"
          >
            {discordBusy ? (
              <>
                <Loader variant="spinner" size={14} />
                Connecting…
              </>
            ) : (
              <>
                <DiscordIcon size={16} className="text-[#5865F2]" />
                Discord
              </>
            )}
          </Button>

          <button
            type="button"
            onClick={handleClassicSignIn}
            className="mt-3 w-full text-center text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            No browser session? Use the classic window instead
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
