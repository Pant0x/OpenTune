import { memo, useEffect, useRef } from "react";
import { playerController } from "../../../player/playerStore";
import { useReduceMotion } from "../../settings/renderEffects";

interface SidebarAudioVisualizerProps {
  isPlaying: boolean;
  color?: string;
  className?: string;
  barCount?: number;
}

export const SidebarAudioVisualizer = memo(function SidebarAudioVisualizer({
  isPlaying,
  color = "#ffffff",
  className,
  barCount = 28,
}: SidebarAudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    // Current bar heights (normalized 0 to 1)
    const heights = new Float32Array(barCount).fill(0.05);
    const targetHeights = new Float32Array(barCount).fill(0.05);
    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const vol = playerController.getVolume();
      const activeFactor = isPlaying && !reduceMotion ? Math.max(0.2, vol) : 0;

      phase += 0.08;

      // Update simulated frequency heights
      for (let i = 0; i < barCount; i++) {
        if (activeFactor > 0) {
          // Harmonic wave + frequency variation + pseudo-random bounce
          const wave1 = Math.sin(phase + i * 0.45) * 0.35 + 0.35;
          const wave2 = Math.cos(phase * 0.7 - i * 0.3) * 0.25 + 0.25;
          const noise = Math.sin(phase * 2.3 + i * 1.7) * 0.15;
          const target = Math.min(1, Math.max(0.06, (wave1 + wave2 + noise) * activeFactor));
          targetHeights[i] = target;
        } else {
          targetHeights[i] = 0.04;
        }

        // Smooth interpolation
        heights[i] += (targetHeights[i] - heights[i]) * 0.18;
      }

      // Draw bars
      const gap = 3;
      const totalGaps = (barCount - 1) * gap;
      const barWidth = Math.max(2, (width - totalGaps) / barCount);

      // Create gradient
      const grad = ctx.createLinearGradient(0, height, 0, 0);
      grad.addColorStop(0, color);
      grad.addColorStop(0.7, color);
      grad.addColorStop(1, "rgba(255, 255, 255, 0.85)");

      ctx.fillStyle = grad;

      for (let i = 0; i < barCount; i++) {
        const h = Math.max(3, heights[i] * (height - 4));
        const x = i * (barWidth + gap);
        const y = height - h;
        const radius = Math.min(barWidth / 2, 3);

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, [radius, radius, 0, 0]);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isPlaying, color, barCount, reduceMotion]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={64}
      className={className}
    />
  );
});
