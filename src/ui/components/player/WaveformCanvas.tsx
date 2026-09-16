import { memo, useEffect, useRef } from "react";

interface WaveformCanvasProps {
  progress: number;
  isPlaying: boolean;
  color?: string;
  inactiveColor?: string;
  className?: string;
}

export const WaveformCanvas = memo(function WaveformCanvas({
  progress,
  isPlaying,
  color,
  inactiveColor,
  className,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animFrameId: number;
    let cachedWidth = 0;
    let cachedHeight = 0;
    let dpr = 1;

    const updateSize = () => {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      cachedWidth = rect.width;
      cachedHeight = rect.height;
      canvas.width = Math.round(cachedWidth * dpr);
      canvas.height = Math.round(cachedHeight * dpr);
    };

    updateSize();

    const ro = new ResizeObserver(() => {
      updateSize();
      draw();
    });
    ro.observe(canvas);

    const numBars = 48;
    const gap = 2;

    const draw = () => {
      if (!ctx || cachedWidth <= 0 || cachedHeight <= 0) return;

      const time = performance.now() * 0.003;
      const activeProg = progressRef.current;
      const playing = isPlayingRef.current;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cachedWidth, cachedHeight);

      const totalGap = (numBars - 1) * gap;
      const barWidth = Math.max(1.5, (cachedWidth - totalGap) / numBars);
      const centerY = cachedHeight / 2;

      // Primary theme color fallback (Amber Brand Red)
      const activeFill = color || "#ff0033";
      const inactiveFill = inactiveColor || "rgba(255, 255, 255, 0.22)";

      for (let i = 0; i < numBars; i++) {
        const barPos = i / numBars;
        const isPassed = barPos <= activeProg;

        const phase = playing ? time : 0;
        const waveH = Math.sin(i * 0.35 + phase) * 4 + 6;
        const h = Math.min(cachedHeight, Math.max(3, waveH));
        const x = i * (barWidth + gap);
        const y = centerY - h / 2;

        ctx.fillStyle = isPassed ? activeFill : inactiveFill;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, y, barWidth, h, [barWidth / 2]);
        } else {
          ctx.rect(x, y, barWidth, h);
        }
        ctx.fill();
      }

      ctx.restore();
    };

    let running = true;
    const loop = () => {
      if (!running) return;
      draw();
      if (isPlayingRef.current) {
        animFrameId = requestAnimationFrame(loop);
      }
    };

    if (isPlaying) {
      loop();
    } else {
      draw();
    }

    return () => {
      running = false;
      cancelAnimationFrame(animFrameId);
      ro.disconnect();
    };
  }, [isPlaying, color, inactiveColor]);

  // Redraw when progress changes while paused
  useEffect(() => {
    if (!isPlaying) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0) return;

      const numBars = 48;
      const gap = 2;
      const totalGap = (numBars - 1) * gap;
      const barWidth = Math.max(1.5, (rect.width - totalGap) / numBars);
      const centerY = rect.height / 2;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const activeFill = color || "#1ed760";
      const inactiveFill = inactiveColor || "rgba(255, 255, 255, 0.22)";

      for (let i = 0; i < numBars; i++) {
        const barPos = i / numBars;
        const isPassed = barPos <= progress;
        const waveH = Math.sin(i * 0.35) * 4 + 6;
        const h = Math.min(rect.height, Math.max(3, waveH));
        const x = i * (barWidth + gap);
        const y = centerY - h / 2;

        ctx.fillStyle = isPassed ? activeFill : inactiveFill;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, y, barWidth, h, [barWidth / 2]);
        } else {
          ctx.rect(x, y, barWidth, h);
        }
        ctx.fill();
      }
      ctx.restore();
    }
  }, [progress, isPlaying, color, inactiveColor]);

  return (
    <canvas
      ref={canvasRef}
      className={className || "pointer-events-none absolute inset-x-0 h-3.5 w-full"}
    />
  );
});
