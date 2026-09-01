import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { supabase } from "../../lib/supabaseClient";
import { signInWithOAuthPopup } from "../../lib/oauthService";
import { libraryController } from "../../player/playerStore";
import { MailIcon, LockIcon, UserIcon, GoogleIcon, DiscordIcon, CloseIcon } from "@/ui/icons";
import loadingVideo from "../../../assets/img/Loading.mp4";
import { Loader } from "@/components/motion/loader";
import { Button } from "@/components/motion/button";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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

  const validateEmail = (emailStr: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
  };

  const handleEmailAuth = async (isSignUp: boolean) => {
    if (!supabase) {
      setError("Authentication service is not configured.");
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (isSignUp && username.trim().length < 2) {
      setError("Username must be at least 2 characters.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isSignUp) {
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

        if (data.user?.identities?.length === 0) {
          throw new Error("This email is already registered.");
        }

        setSuccessMessage("Account created! Check your email to confirm your sign up.");
        setTimeout(() => {
          setMode("signin");
          setSuccessMessage(null);
        }, 3000);
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
    }
  };

  const handleOAuth = async (provider: "google" | "discord") => {
    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    if (provider === "google") {
      try {
        await libraryController.signIn();
        if (libraryController.getState().status === "ready") {
          onAuthSuccess?.();
          onClose();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Google sign-in failed.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (provider === "discord") {
      if (!supabase) {
        setError("Supabase client is not configured.");
        setBusy(false);
        return;
      }
      try {
        await signInWithOAuthPopup("discord");
        onAuthSuccess?.();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Discord sign-in failed.");
      } finally {
        setBusy(false);
      }
    }
  };

  const switchMode = (targetMode: "signin" | "signup") => {
    setMode(targetMode);
    setError(null);
    setSuccessMessage(null);
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

          {/* Amber MP4 Animation Banner */}
          <div className="flex flex-col items-center mb-5">
            <div className="relative size-20 rounded-2xl overflow-hidden shadow-lg ring-1 ring-white/10 mb-3 bg-black/40">
              <video
                className="size-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
              >
                <source src={loadingVideo} type="video/mp4" />
              </video>
            </div>
            <h2 id="auth-modal-title" className="text-xl font-bold text-foreground">
              {mode === "signin" ? "Sign In to Amber" : "Create Amber Account"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground text-center">
              {mode === "signin"
                ? "Sign in to access your library, playlists, and synced history"
                : "Join Amber to sync your music and favorites across devices"}
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="mb-5 flex rounded-xl bg-background/80 p-1 border border-border/30">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={cn(
                "flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all",
                mode === "signin"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={cn(
                "flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all",
                mode === "signup"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Sign Up
            </button>
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

          {/* Form */}
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              void handleEmailAuth(mode === "signup");
            }}
            className="flex flex-col gap-3.5"
          >
            {mode === "signup" && (
              <div>
                <label
                  htmlFor="auth-username"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Username
                </label>
                <div className="relative">
                  <UserIcon
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                  />
                  <input
                    id="auth-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    className={cn(
                      "w-full rounded-xl bg-background/90 pl-9 pr-3 py-2 text-sm text-foreground outline-none border border-border/40 transition-colors",
                      "placeholder:text-muted-foreground/50",
                      "focus:border-primary focus:ring-1 focus:ring-primary",
                    )}
                    autoComplete="username"
                    required
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Email
              </label>
              <div className="relative">
                <MailIcon
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={cn(
                    "w-full rounded-xl bg-background/90 pl-9 pr-3 py-2 text-sm text-foreground outline-none border border-border/40 transition-colors",
                    "placeholder:text-muted-foreground/50",
                    "focus:border-primary focus:ring-1 focus:ring-primary",
                  )}
                  autoComplete="email"
                  required
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Password
              </label>
              <div className="relative">
                <LockIcon
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={cn(
                    "w-full rounded-xl bg-background/90 pl-9 pr-10 py-2 text-sm text-foreground outline-none border border-border/40 transition-colors",
                    "placeholder:text-muted-foreground/50",
                    "focus:border-primary focus:ring-1 focus:ring-primary",
                  )}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2 font-semibold text-sm rounded-xl py-2.5 shadow-md hover:shadow-lg transition-all"
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader variant="spinner" size={16} className="mr-2" />
                  {mode === "signin" ? "Signing In..." : "Creating Account..."}
                </>
              ) : mode === "signin" ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground/60">
            <span className="flex-1 h-px bg-border/40" />
            <span>or continue with</span>
            <span className="flex-1 h-px bg-border/40" />
          </div>

          {/* OAuth Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="md"
              disabled={busy}
              onClick={() => void handleOAuth("google")}
              className="flex items-center justify-center gap-2 rounded-xl text-xs"
            >
              <GoogleIcon size={16} className="text-primary" />
              Google
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={busy}
              onClick={() => void handleOAuth("discord")}
              className="flex items-center justify-center gap-2 rounded-xl text-xs"
            >
              <DiscordIcon size={16} className="text-[#5865F2]" />
              Discord
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}