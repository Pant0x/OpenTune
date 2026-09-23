import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { supabase } from "../../lib/supabaseClient";
import { signInWithOAuthPopup } from "../../lib/oauthService";
import { libraryController } from "../../player/playerStore";
import { useClerkAuth } from "../../lib/clerkClient";
import { MailIcon, LockIcon, UserIcon, DiscordIcon, GoogleIcon, CloseIcon, EyeIcon, EyeClosedIcon } from "@/ui/icons";
import loadingVideo from "../../../assets/img/Loading.mp4";
import { Loader } from "@/components/motion/loader";
import { Button } from "@/components/motion/button";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

type AuthMode = "signin" | "signup" | "forgot" | "reset_otp";

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
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

  // Listen for Supabase password recovery event
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("reset_otp");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

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

  const handleSignIn = async () => {
    if (!supabase) {
      setError("Authentication service is not configured.");
      return;
    }
    const id = loginIdentifier.trim();
    if (!id) {
      setError("Please enter your email or username.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      let targetEmail = id;

      // If user provided a username (no '@'), resolve email via RPC
      if (!id.includes("@")) {
        const { data: resolvedEmail, error: rpcError } = await supabase.rpc(
          "get_email_by_username",
          { username_input: id }
        );

        if (rpcError || !resolvedEmail) {
          throw new Error(
            "No account found with this username. Please sign in with your email or check the spelling."
          );
        }
        targetEmail = String(resolvedEmail).trim();
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password,
      });
      if (signInError) throw signInError;

      onAuthSuccess?.();
      onClose();

      // Automatically connect to YouTube Music if not already active
      if (libraryController.getState().status !== "ready") {
        void libraryController.signIn().catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
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
    const trimmedUser = username.trim();
    if (trimmedUser.length > 0 && trimmedUser.length < 2) {
      setError("Username must be at least 2 characters if provided.");
      return;
    }

    const finalUsername = trimmedUser || email.trim().split("@")[0] || "User";

    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            username: finalUsername,
            display_name: finalUsername,
          },
        },
      });
      if (signUpError) throw signUpError;

      if (data.user?.identities?.length === 0) {
        throw new Error("This email is already registered.");
      }

      onAuthSuccess?.();
      onClose();

      // Automatically connect to YouTube Music so all accounts use YT Music data and storage
      if (libraryController.getState().status !== "ready") {
        void libraryController.signIn().catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!supabase) {
      setError("Authentication service is not configured.");
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (resetErr) throw resetErr;

      setSuccessMessage(`A 6-digit verification code has been sent to ${email.trim()}.`);
      setMode("reset_otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset code.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyAndResetPassword = async () => {
    if (!supabase) {
      setError("Authentication service is not configured.");
      return;
    }
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // 1. Verify OTP code
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "recovery",
      });
      if (verifyErr) throw verifyErr;

      // 2. Update password
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) throw updateErr;

      setSuccessMessage("Password reset successfully! Please sign in with your new password.");
      setPassword("");
      setNewPassword("");
      setOtpCode("");
      setLoginIdentifier(email.trim());
      setMode("signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password. Please verify the code.");
    } finally {
      setBusy(false);
    }
  };

  const { signInWithGoogle, isAvailable: isClerkAvailable } = useClerkAuth();

  const handleGoogleAuth = async () => {
    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isClerkAvailable) {
        await signInWithGoogle();
        onAuthSuccess?.();
        onClose();
      } else {
        // Fallback to Supabase Google OAuth if configured, or notify user
        if (supabase) {
          await signInWithOAuthPopup("google");
          onAuthSuccess?.();
          onClose();
        } else {
          throw new Error("Google authentication is not configured yet.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "discord") => {
    setBusy(true);
    setError(null);
    setSuccessMessage(null);

    if (provider === "discord") {
      if (!supabase) {
        setError("Supabase client is not configured.");
        setBusy(false);
        return;
      }
      try {
        await signInWithOAuthPopup("discord");
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          onAuthSuccess?.();
          onClose();
          if (libraryController.getState().status !== "ready") {
            void libraryController.signIn().catch(() => {});
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Discord sign-in failed.");
      } finally {
        setBusy(false);
      }
    }
  };

  const switchMode = (targetMode: AuthMode) => {
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
              {mode === "signin" && "Sign In to Amber"}
              {mode === "signup" && "Create Amber Account"}
              {mode === "forgot" && "Reset Password"}
              {mode === "reset_otp" && "Set New Password"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground text-center">
              {mode === "signin" && "Sign in with your email or username to access your music library"}
              {mode === "signup" && "Join Amber to sync your music and favorites across devices"}
              {mode === "forgot" && "Enter your account email to receive a 6-digit recovery code"}
              {mode === "reset_otp" && `Enter the 6-digit verification code sent to ${email || "your email"}`}
            </p>
          </div>

          {/* Mode Switcher Tabs (Only in signin & signup) */}
          {(mode === "signin" || mode === "signup") && (
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
          )}

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
              if (mode === "signin") void handleSignIn();
              else if (mode === "signup") void handleSignUp();
              else if (mode === "forgot") void handleForgotPassword();
              else if (mode === "reset_otp") void handleVerifyAndResetPassword();
            }}
            className="flex flex-col gap-3.5"
          >
            {/* SIGN IN: Email or Username */}
            {mode === "signin" && (
              <>
                <div>
                  <label
                    htmlFor="auth-identifier"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    Email or Username
                  </label>
                  <div className="relative">
                    <MailIcon
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                    />
                    <input
                      id="auth-identifier"
                      type="text"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="name@example.com or username"
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

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-medium text-foreground"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("forgot");
                        setError(null);
                        setSuccessMessage(null);
                        if (loginIdentifier.includes("@")) {
                          setEmail(loginIdentifier.trim());
                        }
                      }}
                      className="text-[11px] text-muted-foreground/80 hover:text-primary transition-colors focus:outline-none"
                    >
                      Forgot password?
                    </button>
                  </div>
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
                      autoComplete="current-password"
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
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
                      Signing In...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </>
            )}

            {/* SIGN UP: Username (Optional), Email, Password */}
            {mode === "signup" && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="auth-username"
                      className="block text-xs font-medium text-foreground"
                    >
                      Username
                    </label>
                    <span className="text-[11px] text-muted-foreground/60">Optional</span>
                  </div>
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
                      placeholder="e.g. Alex (optional)"
                      className={cn(
                        "w-full rounded-xl bg-background/90 pl-9 pr-3 py-2 text-sm text-foreground outline-none border border-border/40 transition-colors",
                        "placeholder:text-muted-foreground/50",
                        "focus:border-primary focus:ring-1 focus:ring-primary",
                      )}
                      autoComplete="username"
                      disabled={busy}
                    />
                  </div>
                </div>

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
                      autoComplete="new-password"
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
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
                      Creating Account...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </>
            )}

            {/* FORGOT PASSWORD: Enter Email */}
            {mode === "forgot" && (
              <>
                <div>
                  <label
                    htmlFor="auth-forgot-email"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <MailIcon
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                    />
                    <input
                      id="auth-forgot-email"
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
                      Sending Code...
                    </>
                  ) : (
                    "Send Reset Code"
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="mt-1 text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
                >
                  Back to Sign In
                </button>
              </>
            )}

            {/* RESET OTP: Enter 6-digit code and new password */}
            {mode === "reset_otp" && (
              <>
                <div>
                  <label
                    htmlFor="auth-otp"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    6-Digit Verification Code
                  </label>
                  <input
                    id="auth-otp"
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className={cn(
                      "w-full rounded-xl bg-background/90 px-3 py-2 text-center text-lg font-mono tracking-widest text-foreground outline-none border border-border/40 transition-colors",
                      "placeholder:text-muted-foreground/30",
                      "focus:border-primary focus:ring-1 focus:ring-primary",
                    )}
                    required
                    disabled={busy}
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-new-password"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    New Password
                  </label>
                  <div className="relative">
                    <LockIcon
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                    />
                    <input
                      id="auth-new-password"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className={cn(
                        "w-full rounded-xl bg-background/90 pl-9 pr-10 py-2 text-sm text-foreground outline-none border border-border/40 transition-colors",
                        "placeholder:text-muted-foreground/50",
                        "focus:border-primary focus:ring-1 focus:ring-primary",
                      )}
                      autoComplete="new-password"
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      aria-label={showNewPassword ? "Hide password" : "Show password"}
                    >
                      {showNewPassword ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
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
                      Setting Password...
                    </>
                  ) : (
                    "Set New Password"
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="mt-1 text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
                >
                  Back to Sign In
                </button>
              </>
            )}
          </form>

          {/* Divider & Discord - only for signin and signup */}
          {(mode === "signin" || mode === "signup") && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground/60">
                <span className="flex-1 h-px bg-border/40" />
                <span>or continue with</span>
                <span className="flex-1 h-px bg-border/40" />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  disabled={busy}
                  onClick={() => void handleGoogleAuth()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl text-xs hover:border-white/20 transition-all"
                >
                  <GoogleIcon size={16} />
                  Google
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  disabled={busy}
                  onClick={() => void handleOAuth("discord")}
                  className="w-full flex items-center justify-center gap-2 rounded-xl text-xs hover:border-[#5865F2]/40 transition-all"
                >
                  <DiscordIcon size={16} className="text-[#5865F2]" />
                  Discord
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}