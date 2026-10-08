import { useState, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CloseIcon, ImageIcon, CheckIcon, PencilIcon } from "@/ui/icons";
import { cn } from "@/lib/utils";
import type { Playlist, Track } from "../../datasource/types";
import {
  getCustomPlaylistArtwork,
  getCustomPlaylistTracksArtwork,
  setCustomPlaylistArtwork,
} from "../../player/playlistArtwork";
import { TrackArtwork } from "./TrackArtwork";

interface PlaylistArtworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: Playlist;
  initialImagePath?: string | null;
  tracks?: Track[];
  onArtworkApplied?: (newArtworkUrl: string | null) => void;
}

export function PlaylistArtworkModal({
  isOpen,
  onClose,
  playlist,
  initialImagePath = null,
  tracks,
  onArtworkApplied,
}: PlaylistArtworkModalProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(initialImagePath);
  const [applyToTracks, setApplyToTracks] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedPath(initialImagePath ?? null);
      setApplyToTracks(Boolean(getCustomPlaylistTracksArtwork(playlist.id)));
    }
  }, [isOpen, initialImagePath, playlist.id]);

  if (!isOpen) return null;

  const currentCustom = getCustomPlaylistArtwork(playlist.id);
  const previewUrl = selectedPath
    ? (selectedPath.startsWith("http") || selectedPath.startsWith("local-image:")
        ? selectedPath
        : `local-image:${selectedPath}`)
    : currentCustom;

  const handlePickFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        title: "Choose playlist cover image",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp"] }],
      });
      if (typeof selected === "string") {
        setSelectedPath(selected);
      }
    } catch (e) {
      console.error("Failed to pick image:", e);
    }
  };

  const handleSave = async () => {
    if (!selectedPath) return;
    setIsSaving(true);
    try {
      await setCustomPlaylistArtwork(playlist.id, selectedPath, {
        applyToTracks,
        tracks,
      });
      const newUrl = getCustomPlaylistArtwork(playlist.id);
      onArtworkApplied?.(newUrl);
      onClose();
    } catch (e) {
      console.error("Failed to set playlist artwork:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreDefault = async () => {
    setIsSaving(true);
    try {
      await setCustomPlaylistArtwork(playlist.id, null);
      onArtworkApplied?.(null);
      onClose();
    } catch (e) {
      console.error("Failed to restore default artwork:", e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-md flex-col gap-5 rounded-2xl border border-white/10 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Change Playlist Cover</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Image Preview & Selection */}
        <div className="flex items-center gap-4">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-md">
            {previewUrl ? (
              <TrackArtwork
                artworkUrl={previewUrl}
                size={120}
                variant="playlist"
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <ImageIcon size={32} />
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-2">
            <button
              type="button"
              onClick={() => void handlePickFile()}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-white/10 active:scale-95"
            >
              <PencilIcon size={16} />
              <span>{previewUrl ? "Choose different image" : "Select image from PC"}</span>
            </button>
            <p className="text-xs text-muted-foreground">
              Supports PNG, JPG, GIF, WebP. Recommended square aspect ratio.
            </p>
          </div>
        </div>

        {/* Options: Playlist cover only vs Apply to all songs in playlist */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Apply Cover Art
          </p>

          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg p-2.5 transition",
              !applyToTracks ? "bg-primary/10 border border-primary/20" : "hover:bg-white/5"
            )}
            onClick={() => setApplyToTracks(false)}
          >
            <input
              type="radio"
              name="artworkScope"
              checked={!applyToTracks}
              onChange={() => setApplyToTracks(false)}
              className="mt-0.5 accent-primary"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">Playlist cover only</span>
              <span className="text-xs text-muted-foreground">
                Only changes the playlist's main cover. Songs keep their individual album art.
              </span>
            </div>
          </label>

          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg p-2.5 transition",
              applyToTracks ? "bg-primary/10 border border-primary/20" : "hover:bg-white/5"
            )}
            onClick={() => setApplyToTracks(true)}
          >
            <input
              type="radio"
              name="artworkScope"
              checked={applyToTracks}
              onChange={() => setApplyToTracks(true)}
              className="mt-0.5 accent-primary"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                Apply to all songs in playlist
              </span>
              <span className="text-xs text-muted-foreground">
                Sets this artwork on the playlist and replaces the artwork for all songs inside it.
              </span>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {currentCustom ? (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleRestoreDefault()}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/10"
            >
              Restore dynamic collage
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving || !selectedPath}
              onClick={() => void handleSave()}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02] active:scale-95 disabled:opacity-40"
            >
              <CheckIcon size={16} />
              <span>{isSaving ? "Saving..." : "Save Cover"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
