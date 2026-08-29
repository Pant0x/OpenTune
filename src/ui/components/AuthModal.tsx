import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { supabase } from "../../lib/supabaseClient";
import { MailIcon, LockIcon, UserIcon, GoogleIcon, DiscordIcon, CloseIcon } from "@/ui/icons";
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
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleEmailAuth = async (isSignUp: boolean) => {
    if (!supabase) return;
    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (isSignUp && username.trim().length < 2) {
      setError("Username must be at least 2 characters");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username.trim(),
              display_name: username.trim(),
            },
          },
        });
        if (error) throw error;
        
        if (data.user?.identities?.length === 0) {
          throw new Error("Email already registered");
        }
        
        setError("Account created! Please check your email to verify.");
        setTimeout(() => {
          setMode("signin");
          setError(null);
        }, 3000);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        onAuthSuccess?.();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "discord") => {
    if (!supabase) return;
    setBusy(true);
    setError(null);

    try {
      const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth failed");
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setError(null);
    setEmail("");
    setPassword("");
    setUsername("");
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
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-md rounded-2xl bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon size={18} />
            </button>

            <div className="p-6">
              {/* Header */}
              <div className="mb-6 text-center">
                <h2 id="auth-modal-title" className="text-2xl font-bold text-foreground">
                  {mode === "signin" ? "Welcome back" : "Create account"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "signin"
                    ? "Sign in to access your library and playlists"
                    : "Join Amber to sync your music across devices"}
                </p>
              </div>

              {/* OAuth Buttons */}
              <div className="mb-5 grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() => handleOAuth("google")}
                  className="flex items-center justify-center gap-2"
                >
                  <GoogleIcon size={18} className="text-primary" />
                  Google
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() => handleOAuth("discord")}
                  className="flex items-center justify-center gap-2"
                >
                  <DiscordIcon size={18} className="text-[#5865F2]" />
                  Discord
                </Button>
              </div>

              {/* Divider */}
              <div className="mb-5 flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex-1 h-px bg-border" />
                <span>or</span>
                <span className="flex-1 h-px bg-border" />
              </div>

              {/* Email/Password Form */}
              <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleEmailAuth(mode === "signup"); }}>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                  </motion.div>
                )}

                {mode === "signup" && (
                  <div className="mb-4">
                    <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-foreground">
                      Username
                    </label>
                    <div className="relative">
                      <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                      <input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter username"
                        className={cn(
                          "w-full rounded-lg bg-background px-10 py-2.5 text-sm outline-none ring-1 transition-colors",
                          "placeholder:text-muted-foreground/50",
                          "focus:ring-2 focus:ring-inset focus:ring-primary/50",
                          "hover:ring-border/50"
                        )}
                        autoComplete="username"
                        required
                        disabled={busy}
                      />
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
                    Email
                  </label>
                  <div className="relative">
                    <MailIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter email"
                      className={cn(
                        "w-full rounded-lg bg-background px-10 py-2.5 text-sm outline-none ring-1 transition-colors",
                        "placeholder:text-muted-foreground/50",
                        "focus:ring-2 focus:ring-inset focus:ring-primary/50",
                        "hover:ring-border/50"
                      )}
                      autoComplete={mode === "signin" ? "email" : "email"}
                      required
                      disabled={busy}
                    />
                  </div>
                </div>

                <div className="mb-5">
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
                    Password
                  </label>
                  <div className="relative">
                    <LockIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className={cn(
                        "w-full rounded-lg bg-background px-10 py-2.5 text-sm outline-none ring-1 transition-colors",
                        "placeholder:text-muted-foreground/50",
                        "focus:ring-2 focus:ring-inset focus:ring-primary/50",
                        "hover:ring-border/50"
                      )}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  className="w-full"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <Loader variant="spinner" size={18} className="mr-2" />
                      {mode === "signin" ? "Signing in..." : "Creating account..."}
                    </>
                  ) : (
                    mode === "signin" ? "Sign in" : "Create account"
                  )}
                </Button>
              </form>

              {/* Switch mode */}
              <p className="mt-5 text-center text-sm text-muted-foreground">
                {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-primary font-medium hover:underline"
                >
                  {mode === "signin" ? "Sign up" : "Sign in"}
                </button>
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}