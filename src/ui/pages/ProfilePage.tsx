import { useState, useRef, useEffect } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useAuthProfile } from "@/lib/authProfile";
import {
  ArrowLeftIcon,
  CloseIcon,
  DiscordIcon,
  GoogleIcon,
  LockIcon,
  LogoutIcon,
  PencilIcon,
  UserIcon,
  YouTubeMusicIcon,
} from "@/ui/icons";
import { useLibraryState, libraryController } from "../../player/playerStore";

interface ProfilePageProps {
  onBack: () => void;
  onOpenSettings?: () => void;
}

const PRESET_AVATARS = [
  { id: "gamer", label: "Cyber Gamer", url: "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150&auto=format&fit=crop&q=80" },
  { id: "lofi", label: "Chill Vibes", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" },
  { id: "synth", label: "Neon Beat", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80" },
  { id: "music", label: "Audiophile", url: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80" },
  { id: "art", label: "Creative Art", url: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80" },
  { id: "wave", label: "Wave Rider", url: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80" },
];

function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfilePage({ onBack, onOpenSettings }: ProfilePageProps) {
  const {
    profile,
    sessionDetails,
    updateUsername,
    updateAvatarUrl,
    updatePassword,
    resetPassword,
    signOut,
  } = useAuthProfile();

  const libraryState = useLibraryState();
  const ytAccount = libraryState.library?.account;
  const isYouTubeConnected = Boolean(ytAccount) && libraryState.status !== "signed-out";

  // Username edit state
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState(profile?.username || "");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);

  // Avatar Modal State
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password reset/update state
  const [resetEmailSending, setResetEmailSending] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);

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

  const handlePickLocalImage = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: "Image Files", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        title: "Select Profile Picture",
      });
      if (selected && typeof selected === "string") {
        setAvatarSaving(true);
        const res = await fetch(selected);
        const blob = await res.blob();
        const file = new File([blob], "avatar.jpg", { type: blob.type });
        const dataUrl = await resizeImageToDataUrl(file);
        await updateAvatarUrl(dataUrl);
        setIsAvatarModalOpen(false);
      }
    } catch {
      fileInputRef.current?.click();
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarSaving(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await updateAvatarUrl(dataUrl);
      setIsAvatarModalOpen(false);
    } catch (err) {
      console.error("Failed to update avatar:", err);
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleSaveAvatar = async (url: string) => {
    setAvatarSaving(true);
    try {
      await updateAvatarUrl(url);
      setIsAvatarModalOpen(false);
      setCustomAvatarUrl("");
    } catch (err) {
      console.error("Failed to set avatar URL:", err);
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!profile?.email) return;
    setResetEmailSending(true);
    setResetSuccessMessage(null);
    setResetErrorMessage(null);
    try {
      await resetPassword(profile.email);
      setResetSuccessMessage("Password reset instructions sent to your email!");
      setTimeout(() => setResetSuccessMessage(null), 5000);
    } catch (err: any) {
      setResetErrorMessage(err?.message || "Failed to send reset email");
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
    <div className="flex flex-col min-h-full w-full bg-background px-6 py-8 md:px-12 max-w-4xl mx-auto space-y-8 select-none">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onOpenSettings || onBack}
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card/70 transition-colors cursor-pointer"
          aria-label="Back to settings"
        >
          <ArrowLeftIcon size={18} />
          <span>Back</span>
        </button>

        <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          User Profile
        </span>
      </div>

      {/* Profile Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-card/80 to-card/40 border border-border/60 p-6 md:p-8 backdrop-blur-md shadow-xl">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* Avatar with hover change trigger */}
          <div className="relative group size-24 md:size-28 rounded-full overflow-hidden ring-4 ring-primary/20 shadow-lg shrink-0 bg-card">
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.username}
                className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="size-full flex items-center justify-center bg-primary/10 text-primary text-3xl font-extrabold uppercase">
                {profile?.username?.[0] || "U"}
              </div>
            )}
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-background/80 border border-border/60 text-foreground shadow-xs">
                {profile?.provider === "google" ? (
                  <>
                    <GoogleIcon size={14} />
                    <span>Google</span>
                  </>
                ) : profile?.provider === "discord" ? (
                  <>
                    <DiscordIcon size={14} />
                    <span>Discord</span>
                  </>
                ) : (
                  <>
                    <UserIcon size={14} className="text-primary" />
                    <span>OpenTune Account</span>
                  </>
                )}
              </span>

              {isYouTubeConnected && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 shadow-xs">
                  <YouTubeMusicIcon size={14} />
                  <span>YouTube Connected</span>
                </span>
              )}
            </div>

            {/* Username Display & Edit */}
            {isEditingUsername ? (
              <div className="mt-2.5 flex items-center gap-2 w-full max-w-sm">
                <input
                  type="text"
                  autoFocus
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="rounded-xl bg-background px-3.5 py-1.5 text-xl font-bold text-foreground border border-primary focus:outline-none w-full"
                  placeholder="Username"
                />
                <button
                  type="button"
                  onClick={handleSaveUsername}
                  disabled={usernameSaving}
                  className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {usernameSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingUsername(false)}
                  className="rounded-xl bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2 group">
                <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight truncate">
                  {profile?.username || "OpenTune User"}
                </h1>
                <button
                  type="button"
                  onClick={() => setIsEditingUsername(true)}
                  className="text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-primary transition p-1 cursor-pointer"
                  title="Edit username"
                  aria-label="Edit username"
                >
                  <PencilIcon size={16} />
                </button>
              </div>
            )}

            {usernameMessage && (
              <p className="mt-1 text-xs text-primary font-medium">{usernameMessage}</p>
            )}

            {profile?.email && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1.5">
                <span>{profile.email}</span>
              </p>
            )}

            {/* Primary Action Buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIsAvatarModalOpen(true)}
                className="rounded-full bg-card hover:bg-card/80 border border-border/70 text-foreground text-xs font-semibold px-4 py-2 transition shadow-xs cursor-pointer"
              >
                Change Picture
              </button>

              <button
                type="button"
                onClick={() => {
                  void signOut();
                  if (isYouTubeConnected) void libraryController.signOut();
                  onBack();
                }}
                className="flex items-center gap-1.5 rounded-full bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 text-destructive text-xs font-semibold px-4 py-2 transition shadow-xs cursor-pointer"
              >
                <LogoutIcon size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Account Info & Security Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Account Summary Card */}
        <div className="flex flex-col rounded-2xl bg-card/60 border border-border/50 p-6 backdrop-blur-sm space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <UserIcon size={18} className="text-primary" />
            <h2 className="text-base font-bold text-foreground">Account Information</h2>
          </div>

          <div className="space-y-3.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-border/20">
              <span className="text-muted-foreground font-medium">Account Status:</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Active
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-border/20">
              <span className="text-muted-foreground font-medium">Authentication:</span>
              <span className="capitalize font-semibold text-foreground">
                {profile?.provider || "Email / Password"}
              </span>
            </div>

            {profile?.email && (
              <div className="flex items-center justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground font-medium">Registered Email:</span>
                <span className="text-foreground font-mono text-[11px] truncate max-w-[200px]">
                  {profile.email}
                </span>
              </div>
            )}

            {sessionDetails?.createdAt && (
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground font-medium">Member Since:</span>
                <span className="text-foreground font-medium">
                  {new Date(sessionDetails.createdAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Password Management & Security */}
        <div className="flex flex-col rounded-2xl bg-card/60 border border-border/50 p-6 backdrop-blur-sm space-y-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/40 pb-3">
            <LockIcon size={18} className="text-primary" />
            <h2 className="text-base font-bold text-foreground">Security &amp; Password</h2>
          </div>

          <div className="space-y-4 text-xs">
            {/* Forgot / Reset password button */}
            <div className="rounded-xl bg-background/50 border border-border/30 p-3.5 space-y-2">
              <span className="font-semibold text-foreground block">Forgot Password?</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Send a password recovery link to your registered email address.
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
              <span className="font-semibold text-foreground block">Change Password</span>

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

      {/* Hidden file input */}
      <input type="file" ref={fileInputRef} onChange={handleFileInputChange} accept="image/*" className="hidden" />

      {/* Avatar Change Modal */}
      {isAvatarModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-2xl animate-in fade-in zoom-in-95 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">Change Profile Picture</h3>
              <button
                type="button"
                onClick={() => setIsAvatarModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-full cursor-pointer"
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
