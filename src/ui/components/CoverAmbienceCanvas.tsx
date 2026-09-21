import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useArtworkDominantColor } from "../hooks/useArtworkDominantColor";
import { useCoverAmbienceEnabled } from "../settings/coverAmbience";
import { usePotatoPcMode, useReduceMotion } from "../settings/renderEffects";
import { usePlayerSelector } from "../../player/playerStore";

interface CoverAmbienceCanvasProps {
  artworkUrl?: string | null;
  className?: string;
  intensity?: number;
}

export const CoverAmbienceCanvas = memo(function CoverAmbienceCanvas({
  artworkUrl,
  className,
  intensity = 1,
}: CoverAmbienceCanvasProps) {
  const isEnabled = useCoverAmbienceEnabled();
  const reduceMotion = useReduceMotion();
  const potatoMode = usePotatoPcMode();
  const dominant = useArtworkDominantColor(artworkUrl);
  const isPlaying = usePlayerSelector((player) => player.status === "playing");

  const colors = useMemo(() => {
    const rgb = dominant.rgb || { r: 50, g: 30, b: 65 };
    const { r, g, b } = rgb;

    // Create 4 distinct harmonious colors for the mesh blobs
    const c1 = `rgba(${r}, ${g}, ${b}, ${0.72 * intensity})`;
    const c2 = `rgba(${Math.min(255, Math.round(b * 0.9 + 40))}, ${Math.min(255, Math.round(r * 0.85 + 20))}, ${Math.min(255, Math.round(g * 1.1 + 30))}, ${0.62 * intensity})`;
    const c3 = `rgba(${Math.min(255, Math.round(g * 1.15 + 25))}, ${Math.min(255, Math.round(b * 0.8 + 45))}, ${Math.min(255, Math.round(r * 0.95 + 40))}, ${0.58 * intensity})`;
    const c4 = `rgba(${Math.min(255, Math.round(r * 0.6 + 15))}, ${Math.min(255, Math.round(g * 0.5 + 15))}, ${Math.min(255, Math.round(b * 0.75 + 45))}, ${0.68 * intensity})`;

    return { c1, c2, c3, c4 };
  }, [dominant.rgb, intensity]);

  const shouldAnimate = isEnabled && !reduceMotion && !potatoMode;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden select-none bg-black",
        className,
      )}
      aria-hidden="true"
    >
      {/* Base blurred artwork backdrop */}
      {artworkUrl && (
        <div
          key={artworkUrl}
          className={cn(
            "absolute -inset-[35%] opacity-85 blur-[70px] saturate-[2.2] scale-135 transition-all duration-1000",
            shouldAnimate && "lyrics-drift",
          )}
        >
          <img
            src={artworkUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}

      {/* Dynamic Ambient Mesh Blobs (Cover Ambience) */}
      {isEnabled && (
        <div
          className={cn(
            "absolute inset-0 filter blur-[65px] saturate-[2.8] opacity-100 transition-transform duration-700 ease-out",
            isPlaying && shouldAnimate && "ambience-pulse-active",
          )}
        >
          {/* Top-Left Orb */}
          <div
            className={cn(
              "absolute -top-[25%] -left-[20%] size-[80vw] max-w-[900px] max-h-[900px] rounded-full transition-colors duration-1000",
              shouldAnimate && "ambience-blob-1",
            )}
            style={{
              background: `radial-gradient(circle, ${colors.c1} 0%, rgba(0,0,0,0) 70%)`,
            }}
          />

          {/* Top-Right Orb */}
          <div
            className={cn(
              "absolute -top-[20%] -right-[25%] size-[75vw] max-w-[850px] max-h-[850px] rounded-full transition-colors duration-1000",
              shouldAnimate && "ambience-blob-2",
            )}
            style={{
              background: `radial-gradient(circle, ${colors.c2} 0%, rgba(0,0,0,0) 70%)`,
            }}
          />

          {/* Bottom-Left Orb */}
          <div
            className={cn(
              "absolute -bottom-[25%] -left-[15%] size-[75vw] max-w-[850px] max-h-[850px] rounded-full transition-colors duration-1000",
              shouldAnimate && "ambience-blob-3",
            )}
            style={{
              background: `radial-gradient(circle, ${colors.c3} 0%, rgba(0,0,0,0) 70%)`,
            }}
          />

          {/* Bottom-Right Orb */}
          <div
            className={cn(
              "absolute -bottom-[20%] -right-[20%] size-[80vw] max-w-[900px] max-h-[900px] rounded-full transition-colors duration-1000",
              shouldAnimate && "ambience-blob-4",
            )}
            style={{
              background: `radial-gradient(circle, ${colors.c4} 0%, rgba(0,0,0,0) 70%)`,
            }}
          />
        </div>
      )}

      {/* Scrim Overlay for optimal contrast & legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-black/45 backdrop-brightness-[0.94]" />
    </div>
  );
});
