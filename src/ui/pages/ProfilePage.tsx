import { useState, useRef, useEffect } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAuthProfile } from "@/lib/authProfile";
import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  EyeClosedIcon,
  EyeIcon,
  KeyIcon,
  LockIcon,
  LogoutIcon,
  MailIcon,
  PencilIcon,
  RefreshIcon,
  SettingsIcon,
} from "@/ui/icons";
import { useLibraryState } from "../../player/playerStore";
import { AccountAvatar } from "../components/AccountSwitcher";

interface ProfilePageProps {
  onBack: () => void;
  onOpenSettings?: () => void;
}

const PRESET_AVATARS = [
  { id: "synth", label: "Synthwave", url: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&auto=format&fit=crop&q=80" },
  { id: "cyber", label: "Cyberpunk", url: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=200&auto=format&fit=crop&q=80" },
  { id: "vinyl", label: "Vinyl Records", url: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=200&auto=format&fit=crop&q=80" },
  { id: "neon", label: "Neon Headphones", url: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=200&auto=format&fit=crop&q=80" },
  { id: "astral", label: "Astral Space", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&auto=format&fit=crop&q=80" },
  { id: "anime", label: "Lofi Beats", url: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&auto=format&fit=crop&q=80" },
];

export function ProfilePage({ onBack, onOpenSettings }: ProfilePageProps) {
  const {
    profile,
    sessionDetails,
    updateUsername,
    updateAvatarUrl,
    resetPassword,
    updatePassword,
    refreshSession,
    signOut,
  } = useAuthProfile();

  const libraryState = useLibraryState();
  const ytAccount = libraryState.library?.account;

  // Editing username
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState(profile?.username || "");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);

  // Avatar Modal
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // JWT / Token inspection
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(false);

  // Password management
  const [resetEmailSending, setResetEmailSending] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);

  // Direct password update
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordUpdating, setPasswordUpdating] = useState(false);
  const [passwordUpdateMessage, setPasswordUpdateMessage] = useState<string | null>(null);
  const [passwordUpdateError, setPasswordUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.username) {
      setUsernameInput(profile.username);
    }
  }, [profile?.username]);

  const handleSaveUsername = async () => {
    if (!usernameInput.trim()) return;
    setUsernameSaving(true);
    setUsernameMessage(null);
    try {
      await updateUsername(usernameInput.trim());
      setIsEditingUsername(false);
      setUsernameMessage("Username updated successfully!");
      setTimeout(() => setUsernameMessage(null), 3500);
    } catch (err: any) {
      setUsernameMessage(err?.message || "Failed to update username");
    } finally {
      setUsernameSaving(false);
    }
  };

  const handleSaveAvatar = async (url: string) => {
    setAvatarSaving(true);
    try {
      await updateAvatarUrl(url);
      setIsAvatarModalOpen(false);
      setCustomAvatarUrl("");
    } catch (err) {
      console.error("Failed to update avatar:", err);
    } finally {
      setAvatarSaving(false);
    }
  };

  const handlePickLocalImage = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        title: "Select Profile Picture",
      });
      if (selected && typeof selected === "string") {
        // Fallback or trigger file picker
        handleSaveAvatar(selected);
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        void handleSaveAvatar(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCopy = (text: string, type: "token" | "userId") => {
    navigator.clipboard.writeText(text);
    if (type === "token") {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } else {
      setCopiedUserId(true);
      setTimeout(() => setCopiedUserId(false), 2000);
    }
  };

  const handleSendResetEmail = async () => {
    setResetEmailSending(true);
    setResetSuccessMessage(null);
    setResetErrorMessage(null);
    try {
      await resetPassword(profile?.email || undefined);
      setResetSuccessMessage(`Password reset email sent to ${profile?.email || "your address"}. Please check your inbox.`);
    } catch (err: any) {
      setResetErrorMessage(err?.message || "Failed to send password reset email");
    } finally {
      setResetEmailSending(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordUpdateMessage(null);
    setPasswordUpdateError(null);

    if (newPassword.length < 6) {
      setPasswordUpdateError("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordUpdateError("Passwords do not match.");
      return;
    }

    setPasswordUpdating(true);
    try {
      await updatePassword(newPassword);
      setPasswordUpdateMessage("Password changed successfully!");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordUpdateMessage(null), 4000);
    } catch (err: any) {
      setPasswordUpdateError(err?.message || "Failed to update password");
    } finally {
      setPasswordUpdating(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full w-full bg-background px-6 py-8 md:px-12 max-w-5xl mx-auto space-y-8 select-none">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card/70 transition-colors cursor-pointer"
          aria-label="Go back"
        >
          <ArrowLeftIcon size={18} />
          <span>Back</span>
        </button>

        <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          User Profile
        </span>
      </div>

      {/* Profile Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-b from-card/90 via-card/50 to-background border border-border/50 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          {/* Avatar with hover change button */}
          <div className="relative group shrink-0">
            <div className="size-28 md:size-32 rounded-full overflow-hidden ring-4 ring-card border-2 border-primary/30 shadow-xl bg-card flex items-center justify-center">
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.username}
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full bg-primary/20 text-primary flex items-center justify-center text-4xl font-extrabold">
                  {profile?.username?.[0]?.toUpperCase() || "U"}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsAvatarModalOpen(true)}
              className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white transition-opacity backdrop-blur-xs cursor-pointer"
              aria-label="Change profile picture"
            >
              <PencilIcon size={20} />
              <span className="text-[11px] font-semibold mt-1">Change</span>
            </button>
          </div>

          {/* User Details */}
          <div className="flex flex-col items-center sm:items-start flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-primary/10 text-primary border border-primary/20">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                {profile?.provider ? profile.provider.toUpperCase() : "OPEN TUNE"}
              </span>

              {sessionDetails?.accessToken && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Supabase Verified
                </span>
              )}
            </div>

            {/* Username Display & Edit */}
            {isEditingUsername ? (
              <div className="mt-2 flex items-center gap-2 w-full max-w-sm">
                <input
                  type="text"
                  autoFocus
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="rounded-lg bg-background px-3 py-1.5 text-xl font-bold text-foreground border border-primary focus:outline-none w-full"
                  placeholder="Username"
                />
                <button
                  type="button"
                  onClick={handleSaveUsername}
                  disabled={usernameSaving || !usernameInput.trim()}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                >
                  {usernameSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUsernameInput(profile?.username || "");
                    setIsEditingUsername(false);
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2.5">
                <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                  {profile?.username || "Guest User"}
                </h1>
                <button
                  type="button"
                  onClick={() => setIsEditingUsername(true)}
                  className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-card transition-colors cursor-pointer"
                  title="Edit username"
                >
                  <PencilIcon size={16} />
                </button>
              </div>
            )}

            {usernameMessage && (
              <p className="text-xs text-emerald-400 mt-1 font-medium">{usernameMessage}</p>
            )}

            <p className="mt-1 text-sm text-muted-foreground flex items-center gap-1.5">
              <MailIcon size={14} className="shrink-0" />
              <span>{profile?.email || "No email connected"}</span>
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsAvatarModalOpen(true)}
                className="rounded-full bg-card/80 hover:bg-card px-4 py-1.5 text-xs font-semibold text-foreground border border-border/60 transition shadow-xs cursor-pointer"
              >
                Change Picture
              </button>

              <button
                type="button"
                onClick={() => {
                  void signOut();
                  onBack();
                }}
                className="rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive px-4 py-1.5 text-xs font-semibold border border-destructive/20 transition flex items-center gap-1.5 cursor-pointer"
              >
                <LogoutIcon size={14} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Settings & Auth Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Section 1: Supabase Authentication & Session Credentials */}
        <div className="flex flex-col rounded-2xl bg-card/60 border border-border/50 p-6 backdrop-blur-sm space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <div className="flex items-center gap-2">
              <KeyIcon size={18} className="text-primary" />
              <h2 className="text-base font-bold text-foreground">Supabase Authentication</h2>
            </div>
            <button
              type="button"
              onClick={() => void refreshSession()}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-card"
              title="Refresh session data"
            >
              <RefreshIcon size={15} />
            </button>
          </div>

          <div className="space-y-3 text-xs">
            {/* User ID */}
            <div>
              <span className="text-muted-foreground font-medium">User ID (UUID):</span>
              <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-background/80 px-3 py-2 border border-border/40 font-mono text-[11px] text-foreground">
                <span className="truncate">{profile?.id || "None"}</span>
                {profile?.id && (
                  <button
                    type="button"
                    onClick={() => handleCopy(profile.id, "userId")}
                    className="shrink-0 text-muted-foreground hover:text-foreground p-1 transition-colors"
                    title="Copy User ID"
                  >
                    {copiedUserId ? <CheckIcon size={14} className="text-emerald-400" /> : <CopyIcon size={14} />}
                  </button>
                )}
              </div>
            </div>

            {/* Provider */}
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground font-medium">Sign-in Provider:</span>
              <span className="capitalize font-semibold text-foreground px-2 py-0.5 rounded-md bg-card border border-border/40">
                {profile?.provider || "local"}
              </span>
            </div>

            {/* Session JWT Token */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Auth JWT Access Token:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeClosedIcon size={13} /> : <EyeIcon size={13} />}
                    <span>{showToken ? "Hide" : "Show"}</span>
                  </button>
                </div>
              </div>

              <div className="mt-1.5 relative flex items-center rounded-lg bg-background/80 px-3 py-2 border border-border/40 font-mono text-[11px] text-foreground">
                <span className="truncate flex-1 pr-6 select-all">
                  {sessionDetails?.accessToken
                    ? showToken
                      ? sessionDetails.accessToken
                      : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"
                    : "No active Supabase session"}
                </span>

                {sessionDetails?.accessToken && (
                  <button
                    type="button"
                    onClick={() => handleCopy(sessionDetails.accessToken, "token")}
                    className="shrink-0 text-muted-foreground hover:text-foreground p-1 transition-colors"
                    title="Copy JWT Token"
                  >
                    {copiedToken ? <CheckIcon size={14} className="text-emerald-400" /> : <CopyIcon size={14} />}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Token is safely managed in client storage and used to authorize Supabase API calls.
              </p>
            </div>

            {/* Timestamps */}
            {sessionDetails?.createdAt && (
              <div className="flex items-center justify-between pt-1 border-t border-border/20 text-[11px]">
                <span className="text-muted-foreground">Account Created:</span>
                <span className="text-foreground font-mono">
                  {new Date(sessionDetails.createdAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Password Management & Recovery */}
        <div className="flex flex-col rounded-2xl bg-card/60 border border-border/50 p-6 backdrop-blur-sm space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <LockIcon size={18} className="text-primary" />
            <h2 className="text-base font-bold text-foreground">Security &amp; Password</h2>
          </div>

          <div className="space-y-4 text-xs">
            {/* Forgot / Reset password button */}
            <div className="rounded-xl bg-background/50 border border-border/30 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Forgot Password?</span>
                <span className="text-[10px] text-muted-foreground">Via Supabase Auth</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Send a password recovery email to reset credentials securely.
              </p>

              {resetSuccessMessage && (
                <p className="text-[11px] text-emerald-400 font-medium">{resetSuccessMessage}</p>
              )}
              {resetErrorMessage && (
                <p className="text-[11px] text-destructive font-medium">{resetErrorMessage}</p>
              )}

              <button
                type="button"
                onClick={handleSendResetEmail}
                disabled={resetEmailSending || !profile?.email}
                className="w-full rounded-lg bg-card hover:bg-card/80 border border-border/60 py-2 text-xs font-semibold text-foreground transition disabled:opacity-50 cursor-pointer"
              >
                {resetEmailSending ? "Sending link…" : "Send Password Reset Email"}
              </button>
            </div>

            {/* Direct Password Update Form */}
            <form onSubmit={handleUpdatePassword} className="space-y-2.5 pt-1">
              <span className="font-semibold text-foreground block">Update Password</span>

              <input
                type="password"
                placeholder="New password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg bg-background px-3 py-1.5 text-xs text-foreground border border-border/60 focus:border-primary focus:outline-none"
              />

              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg bg-background px-3 py-1.5 text-xs text-foreground border border-border/60 focus:border-primary focus:outline-none"
              />

              {passwordUpdateMessage && (
                <p className="text-[11px] text-emerald-400 font-medium">{passwordUpdateMessage}</p>
              )}
              {passwordUpdateError && (
                <p className="text-[11px] text-destructive font-medium">{passwordUpdateError}</p>
              )}

              <button
                type="submit"
                disabled={passwordUpdating || !newPassword}
                className="w-full rounded-lg bg-primary hover:bg-primary/90 py-2 text-xs font-semibold text-primary-foreground transition disabled:opacity-50 cursor-pointer"
              >
                {passwordUpdating ? "Updating…" : "Update Password"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Section 3: YouTube Music Connection Status */}
      <div className="rounded-2xl bg-card/40 border border-border/40 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AccountAvatar artworkUrl={ytAccount?.artworkUrl} className="size-10 shrink-0" iconSize={20} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {ytAccount?.name ? `YouTube Music: ${ytAccount.name}` : "YouTube Music not connected"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {ytAccount
                ? "Your library, playlists, and favorites are synced directly with YouTube."
                : "Sign in with YouTube Music to sync playlists, likes, and music library."}
            </p>
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-full bg-card hover:bg-card/80 border border-border/60 px-4 py-2 text-xs font-semibold text-foreground transition flex items-center gap-1.5 cursor-pointer"
          >
            <SettingsIcon size={14} />
            <span>Manage in Settings</span>
          </button>
        )}
      </div>

      {/* Hidden file input for file upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/*"
        className="hidden"
      />

      {/* Avatar Change Modal */}
      {isAvatarModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-2xl animate-in fade-in zoom-in-95 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">Change Profile Picture</h3>
              <button
                type="button"
                onClick={() => setIsAvatarModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-full"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Option 1: File Upload */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-foreground">Upload from device</span>
              <button
                type="button"
                onClick={handlePickLocalImage}
                disabled={avatarSaving}
                className="w-full rounded-xl border border-dashed border-border/80 hover:border-primary/80 bg-background/50 p-4 text-center text-xs text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                {avatarSaving ? "Uploading picture…" : "Choose local image file (PNG, JPG, WebP)"}
              </button>
            </div>

            {/* Option 2: Image URL */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-foreground">Or enter image URL</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://example.com/avatar.png"
                  value={customAvatarUrl}
                  onChange={(e) => setCustomAvatarUrl(e.target.value)}
                  className="flex-1 rounded-xl bg-background px-3 py-2 text-xs text-foreground border border-border/60 focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!customAvatarUrl.trim() || avatarSaving}
                  onClick={() => handleSaveAvatar(customAvatarUrl.trim())}
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Option 3: Presets */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-foreground">Or choose a preset</span>
              <div className="grid grid-cols-3 gap-2.5">
                {PRESET_AVATARS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSaveAvatar(preset.url)}
                    className="group relative flex flex-col items-center gap-1.5 rounded-xl border border-border/40 p-2 hover:border-primary hover:bg-background/80 transition cursor-pointer"
                  >
                    <img
                      src={preset.url}
                      alt={preset.label}
                      className="size-12 rounded-full object-cover ring-1 ring-border/50 group-hover:ring-primary"
                    />
                    <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                      {preset.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Option 4: Remove Avatar */}
            {profile?.avatarUrl && (
              <div className="pt-2 border-t border-border/30 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleSaveAvatar("")}
                  className="text-xs text-destructive hover:underline cursor-pointer"
                >
                  Remove current avatar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
