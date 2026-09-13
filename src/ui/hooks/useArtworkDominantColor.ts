import { useEffect, useState } from "react";

interface DominantColorResult {
  rgb: { r: number; g: number; b: number } | null;
  backgroundGradient: string;
  borderColor: string;
  boxShadow: string;
}

const defaultResult: DominantColorResult = {
  rgb: null,
  backgroundGradient: "linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 60%, transparent 100%)",
  borderColor: "rgba(255, 255, 255, 0.08)",
  boxShadow: "none",
};

const colorCache = new Map<string, DominantColorResult>();

export function useArtworkDominantColor(artworkUrl?: string | null): DominantColorResult {
  const [result, setResult] = useState<DominantColorResult>(() => {
    if (artworkUrl && colorCache.has(artworkUrl)) {
      return colorCache.get(artworkUrl)!;
    }
    return defaultResult;
  });

  useEffect(() => {
    if (!artworkUrl) {
      setResult(defaultResult);
      return;
    }

    if (colorCache.has(artworkUrl)) {
      setResult(colorCache.get(artworkUrl)!);
      return;
    }

    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";

    img.onload = () => {
      if (!active) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, 16, 16);
        const imgData = ctx.getImageData(0, 0, 16, 16).data;

        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let count = 0;

        let vibrantR = 0;
        let vibrantG = 0;
        let vibrantB = 0;
        let vibrantCount = 0;

        for (let i = 0; i < imgData.length; i += 4) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3];

          if (a < 128) continue;

          totalR += r;
          totalG += g;
          totalB += b;
          count++;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const delta = max - min;
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;

          // Prefer colorful/saturated non-extreme pixels
          if (delta > 28 && brightness > 30 && brightness < 220) {
            vibrantR += r;
            vibrantG += g;
            vibrantB += b;
            vibrantCount++;
          }
        }

        let r = 120;
        let g = 120;
        let b = 120;

        if (vibrantCount > 0) {
          r = Math.round(vibrantR / vibrantCount);
          g = Math.round(vibrantG / vibrantCount);
          b = Math.round(vibrantB / vibrantCount);
        } else if (count > 0) {
          r = Math.round(totalR / count);
          g = Math.round(totalB / count);
          b = Math.round(totalB / count);
        }

        // Keep color vibrant and rich
        const max = Math.max(r, g, b);
        if (max < 60) {
          const boost = 75 / (max || 1);
          r = Math.min(255, Math.round(r * boost));
          g = Math.min(255, Math.round(g * boost));
          b = Math.min(255, Math.round(b * boost));
        }

        const res: DominantColorResult = {
          rgb: { r, g, b },
          backgroundGradient: `linear-gradient(90deg, rgba(${r}, ${g}, ${b}, 0.42) 0%, rgba(${r}, ${g}, ${b}, 0.16) 55%, rgba(${r}, ${g}, ${b}, 0.02) 100%)`,
          borderColor: `rgba(${r}, ${g}, ${b}, 0.28)`,
          boxShadow: `0 4px 20px -4px rgba(${r}, ${g}, ${b}, 0.22)`,
        };

        colorCache.set(artworkUrl, res);
        if (colorCache.size > 200) {
          const firstKey = colorCache.keys().next().value;
          if (firstKey) colorCache.delete(firstKey);
        }
        setResult(res);
      } catch {
        // In case of canvas cross-origin taint
        const fallback: DominantColorResult = {
          ...defaultResult,
          backgroundGradient: "linear-gradient(90deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 60%, transparent 100%)",
        };
        setResult(fallback);
      }
    };

    img.onerror = () => {
      if (active) setResult(defaultResult);
    };

    img.src = artworkUrl;

    return () => {
      active = false;
    };
  }, [artworkUrl]);

  return result;
}
