import { useEffect, useState } from "react";

const ZOOM_STORAGE_KEY = "amber-ui-zoom";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const STEP = 0.05;

function getStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= MAX_ZOOM) {
        return Math.round(parsed * 100) / 100;
      }
    }
  } catch {
    // Ignore storage failures
  }
  return 1;
}

function applyDocumentZoom(zoomValue: number) {
  const zoomStr = String(zoomValue);
  document.documentElement.style.zoom = zoomStr;
  if (document.body) {
    document.body.style.zoom = zoomStr;
  }
  const root = document.getElementById("root");
  if (root) {
    root.style.zoom = zoomStr;
  }
}

export function useZoom() {
  const [zoom, setZoomState] = useState<number>(getStoredZoom);

  const applyZoom = (nextZoom: number) => {
    const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)) * 100) / 100;
    setZoomState(clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage failures
    }
    applyDocumentZoom(clamped);
  };

  useEffect(() => {
    // Apply initial stored zoom
    const initial = getStoredZoom();
    applyDocumentZoom(initial);

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setZoomState((current) => {
        const delta = event.deltaY < 0 ? STEP : -STEP;
        const next = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)) * 100) / 100;
        try {
          localStorage.setItem(ZOOM_STORAGE_KEY, String(next));
        } catch {}
        applyDocumentZoom(next);
        return next;
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        applyZoom(zoom + STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        applyZoom(zoom - STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        applyZoom(1);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("wheel", handleWheel, { capture: true } as any);
      window.removeEventListener("keydown", handleKeyDown, { capture: true } as any);
    };
  }, [zoom]);

  return { zoom, applyZoom, resetZoom: () => applyZoom(1) };
}
