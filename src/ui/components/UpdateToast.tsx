import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader } from "@/components/motion/loader";
import { CloseIcon, RefreshIcon, GitHubIcon } from "@/ui/icons";
import type { UpdateInfo, UpdateInstallProgress } from "../../internal/updateChecker";
import { installUpdate, snoozeUpdate } from "../../internal/updateChecker";

const AUTO_DISMISS_MS = 90_000;

interface UpdateToastProps {
  update: UpdateInfo;
  onDismiss: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function UpdateToast({ update, onDismiss }: UpdateToastProps) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    if (installing) return;
    const timer = window.setTimeout(() => {
      snoozeUpdate(update.version);
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [installing, onDismiss, update.version]);

  const dismiss = () => {
    if (installing) return;
    snoozeUpdate(update.version);
    onDismiss();
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await installUpdate(update, (p) => setProgress(p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Installation failed. Please download directly from GitHub.");
      setInstalling(false);
    }
  };

  const percent = progress?.percent ?? (installing ? 0 : 0);
  const isFinalizing = percent >= 100 || (progress?.totalBytes && progress.downloadedBytes >= progress.totalBytes);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 30, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 350, damping: 28 }}
      className="fixed bottom-24 right-6 z-50 flex w-[420px] max-w-[calc(100vw-3rem)] flex-col gap-3 rounded-2xl border border-primary/30 bg-background/95 p-4 shadow-2xl backdrop-blur-xl ring-1 ring-white/10"
      role="status"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <RefreshIcon size={18} className={installing ? "animate-spin" : ""} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Update Available
              </span>
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                v{update.version}
              </span>
            </div>
            <h4 className="text-xs font-medium text-foreground line-clamp-1 mt-0.5">
              {update.releaseTitle || `OpenTune v${update.version}`}
            </h4>
          </div>
        </div>

        <button
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-card hover:text-foreground disabled:opacity-40 cursor-pointer"
          type="button"
          disabled={installing}
          onClick={dismiss}
          aria-label="Close"
          title="Close"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Asset info / note snippet */}
      {update.downloadAssetName && !installing && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground bg-card/60 px-2.5 py-1.5 rounded-lg border border-border/40">
          <span className="truncate font-mono">{update.downloadAssetName}</span>
          {update.downloadAssetSize && (
            <span className="shrink-0 font-medium ml-2">{formatBytes(update.downloadAssetSize)}</span>
          )}
        </div>
      )}

      {/* Release notes expander */}
      {update.releaseNotes && !installing && (
        <div>
          <button
            type="button"
            onClick={() => setShowNotes(!showNotes)}
            className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
          >
            {showNotes ? "Hide release notes" : "View what's new &rarr;"}
          </button>
          <AnimatePresence>
            {showNotes && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mt-1.5"
              >
                <div className="max-h-36 overflow-y-auto rounded-lg bg-card/70 p-2.5 text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed border border-border/40 select-text">
                  {update.releaseNotes}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Download / Installation Progress Bar */}
      {installing && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-foreground font-medium">
              <Loader variant="spinner" size={12} />
              {isFinalizing
                ? "Finalizing update & restarting..."
                : `Downloading v${update.version}...`}
            </span>
            <span className="font-bold text-primary">{percent}%</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-card">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>

          {progress?.downloadedBytes !== undefined && progress.totalBytes && (
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{formatBytes(progress.downloadedBytes)}</span>
              <span>of {formatBytes(progress.totalBytes)}</span>
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
        <button
          type="button"
          disabled={installing}
          onClick={dismiss}
          className="text-xs text-muted-foreground hover:text-foreground transition px-2.5 py-1.5 rounded-lg hover:bg-card disabled:opacity-50 cursor-pointer"
        >
          Remind Later
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-card transition cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              void openUrl(update.releaseUrl);
            }}
          >
            <GitHubIcon size={13} />
            <span>GitHub</span>
          </button>

          {update.canInstall && (
            <button
              type="button"
              disabled={installing}
              onClick={() => void install()}
              className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-4 py-1.5 transition shadow-sm disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              {installing ? (
                <>
                  <Loader variant="spinner" size={13} />
                  <span>Updating...</span>
                </>
              ) : (
                <span>Update Now</span>
              )}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
