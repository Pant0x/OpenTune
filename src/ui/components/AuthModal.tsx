import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { supabase } from "../../lib/supabaseClient";
import { signInWithOAuthPopup, cancelOAuthLogin } from "../../lib/oauthService";
import {
  CloseIcon,
  GoogleIcon,
  DiscordIcon,
  MailIcon,
  LockIcon,
  UserIcon,
  EyeIcon,
  EyeClosedIcon,
} from "@/ui/icons";
import { Loader } from "@/components/motion/loader";
import openTuneText from "../../../assets/img/opentune-text.png";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

/** Global request to open the Connect / Auth modal (e.g. sidebar empty states). */
export const OPEN_AUTH_MODAL_EVENT = "opentune:open-auth";

export function requestAuthModal(): void {
  window.dispatchEvent(new Event(OPEN_AUTH_MODAL_EVENT));
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
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

  const handleDismiss = () => {
    void cancelOAuthLogin();
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !busy) {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, busy]);

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

  const handleOAuth = async (provider: "google" | "discord") => {
    if (!supabase) {
      setError("OpenTune Cloud authentication is not configured in this build.");
      return;
    }
    setBusy(true);
    setActiveProvider(provider);
    setError(null);
    setInfo(null);

    try {
      await signInWithOAuthPopup(provider);
      onAuthSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof Error && /cancel/i.test(err.message)) {
        return;
      }
      setError(err instanceof Error ? err.message : `${provider} sign-in failed`);
    } finally {
      setBusy(false);
      setActiveProvider(null);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError("OpenTune Cloud authentication is not configured in this build.");
      return;
    }

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "signup" && username.trim().length < 2) {
      setError("Username must be at least 2 characters.");
      return;
    }

    setBusy(true);
    setActiveProvider("email");
    setError(null);
    setInfo(null);

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              username: username.trim(),
              display_name: username.trim(),
            },
          },
        });
        if (signUpError) throw signUpError;

        if (data.user?.identities && data.user.identities.length === 0) {
          throw new Error("This email is already registered. Please sign in instead.");
        }

        setInfo("Account created! Please check your email to verify and sign in.");
        setMode("signin");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;

        onAuthSuccess?.();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
      setActiveProvider(null);
    }
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
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
        onClick={busy ? undefined : handleDismiss}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="relative w-full max-w-md rounded-3xl bg-card border border-border/40 shadow-2xl overflow-hidden p-6 sm:p-7 max-h-[92vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            type="button"
            className="absolute top-4 right-4 z-20 flex size-8 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleDismiss}
            disabled={busy}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>

          {/* Branding Header */}
          <div className="flex flex-col items-center mb-5">
            <div className="flex items-center justify-center py-1.5 px-4 mb-2">
              <img
                src={openTuneText}
                alt="OpenTune"
                className="h-7 w-auto object-contain select-none"
              />
            </div>
            <h2 id="auth-modal-title" className="text-xl font-bold text-foreground">
              {mode === "signin" ? "Sign in to OpenTune" : "Create OpenTune Account"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground text-center max-w-[300px] leading-relaxed">
              {mode === "signin"
                ? "Sign in to sync your profile, playlists, and settings across your devices."
                : "Create your personal cloud account for seamless music syncing."}
            </p>
          </div>

          {/* Error Banner */}
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

          {/* Info Banner */}
          {info && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-500/15 p-3 text-xs text-emerald-400 border border-emerald-500/20"
            >
              <span>{info}</span>
            </motion.div>
          )}

          {/* 1-Click Social Sign In Buttons */}
          <div className="flex flex-col gap-2.5 mb-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleOAuth("google")}
              className={cn(
                "w-full flex items-center justify-center gap-3 rounded-2xl py-2.5 px-4 text-xs font-semibold transition-all shadow-sm",
                "bg-white text-[#1f1f1f] hover:bg-white/90 disabled:opacity-50 cursor-pointer",
              )}
            >
              {busy && activeProvider === "google" ? (
                <Loader variant="spinner" size={16} />
              ) : (
                <GoogleIcon size={17} />
              )}
              <span>Continue with Google</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleOAuth("discord")}
              className={cn(
                "w-full flex items-center justify-center gap-3 rounded-2xl py-2.5 px-4 text-xs font-semibold transition-all shadow-sm",
                "bg-[#5865F2] hover:bg-[#4752C4] text-white disabled:opacity-50 cursor-pointer",
              )}
            >
              {busy && activeProvider === "discord" ? (
                <Loader variant="spinner" size={16} />
              ) : (
                <DiscordIcon size={17} />
              )}
              <span>Continue with Discord</span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
            <span className="flex-1 h-px bg-border/60" />
            <span>or with email</span>
            <span className="flex-1 h-px bg-border/60" />
          </div>

          {/* Email / Password Form */}
          <form onSubmit={(e) => void handleEmailAuth(e)} className="flex flex-col gap-3">
            {mode === "signup" && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Username
                </label>
                <div className="relative">
                  <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. musiclover"
                    disabled={busy}
                    required
                    className="w-full rounded-xl bg-background/50 border border-border/50 pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Email
              </label>
              <div className="relative">
                <MailIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  disabled={busy}
                  required
                  className="w-full rounded-xl bg-background/50 border border-border/50 pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Password
              </label>
              <div className="relative">
                <LockIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={busy}
                  required
                  minLength={6}
                  className="w-full rounded-xl bg-background/50 border border-border/50 pl-9 pr-9 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className={cn(
                "mt-1 w-full flex items-center justify-center gap-2 rounded-2xl py-2.5 text-xs font-semibold shadow-sm transition-all cursor-pointer",
                "bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50",
              )}
            >
              {busy && activeProvider === "email" ? (
                <Loader variant="spinner" size={15} />
              ) : null}
              <span>{mode === "signin" ? "Sign In" : "Create Account"}</span>
            </button>
          </form>

          {/* Switch Mode Toggle */}
          <div className="mt-3 text-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setInfo(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline cursor-pointer"
            >
              {mode === "signin"
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
