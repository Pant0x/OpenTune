import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, CheckIcon } from "@/ui/icons";
import { TrackArtwork } from "../TrackArtwork";
import { SpotifyService } from "../../../services/SpotifyService";
import type { Track } from "../../../datasource/types";

interface SpotifyScannableModalProps {
  track: Track;
  isOpen: boolean;
  onClose: () => void;
}

export function SpotifyScannableModal({
  track,
  isOpen,
  onClose,
}: SpotifyScannableModalProps) {
  const [spotifyUri, setSpotifyUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setLoading(true);
    setCopiedLink(false);
    setCopiedImage(false);

    SpotifyService
      .searchTrackUri(track.title, track.artist)
      .then((uri: string | null) => {
        if (!active) return;
        setSpotifyUri(uri);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSpotifyUri(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, track.title, track.artist]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trackId = spotifyUri ? spotifyUri.replace("spotify:track:", "") : null;
  const spotifyUrl = trackId ? `https://open.spotify.com/track/${trackId}` : null;
  const scannableUrl = spotifyUri
    ? `https://scannables.scdn.co/uri/800/${encodeURIComponent(spotifyUri)}`
    : null;

  const copyLink = () => {
    const url = spotifyUrl || `${window.location.origin}/#track=${encodeURIComponent(track.id)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const copyOrDownloadImage = async () => {
    if (!scannableUrl) return;
    try {
      const resp = await fetch(scannableUrl);
      const blob = await resp.blob();
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2000);
      } else {
        // Fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${track.title} - Spotify Code.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      window.open(scannableUrl, "_blank");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Spotify Scannable Code"
    >
      <div className="relative flex flex-col items-center max-w-sm w-full bg-card/95 border border-border/50 rounded-2xl p-6 shadow-2xl backdrop-blur-xl text-foreground">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          aria-label="Close"
        >
          <CloseIcon size={18} />
        </button>

        {/* Artwork */}
        <div className="size-48 rounded-xl overflow-hidden shadow-lg mb-4 mt-2">
          <TrackArtwork
            artworkUrl={track.artworkUrl}
            className="size-full object-cover"
          />
        </div>

        {/* Track Info */}
        <div className="text-center w-full px-2 mb-4">
          <h3 className="font-bold text-lg leading-tight truncate" title={track.title}>
            {track.title}
          </h3>
          <p className="text-sm text-muted-foreground truncate mt-0.5" title={track.artist}>
            {track.artist}
          </p>
        </div>

        {/* Spotify Scannable Code Card */}
        <div className="w-full bg-[#121212] rounded-xl p-3 flex flex-col items-center justify-center min-h-[72px] border border-white/5 mb-5 overflow-hidden">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <span className="size-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>Generating Spotify Code...</span>
            </div>
          ) : scannableUrl ? (
            <div className="flex flex-col items-center w-full group cursor-pointer" onClick={copyOrDownloadImage}>
              <img
                src={scannableUrl}
                alt="Spotify Scannable Code"
                className="w-full h-auto max-h-16 object-contain filter invert contrast-125"
                crossOrigin="anonymous"
              />
              <span className="text-[10px] text-white/50 tracking-wider uppercase mt-1 group-hover:text-white/80 transition-colors">
                Scan on Spotify to Play
              </span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-2">
              <span>Spotify code unavailable for this track.</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 w-full">
          <button
            type="button"
            onClick={copyLink}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer",
              copiedLink
                ? "bg-[#1ed760] text-black"
                : "bg-muted hover:bg-muted/80 text-foreground"
            )}
          >
            {copiedLink ? (
              <>
                <CheckIcon size={14} />
                <span>Copied Link!</span>
              </>
            ) : (
              <span>Copy Link</span>
            )}
          </button>

          {scannableUrl && (
            <button
              type="button"
              onClick={copyOrDownloadImage}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer",
                copiedImage
                  ? "bg-[#1ed760] text-black"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              )}
            >
              {copiedImage ? (
                <>
                  <CheckIcon size={14} />
                  <span>Code Saved!</span>
                </>
              ) : (
                <span>Save Code</span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
