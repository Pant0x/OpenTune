import { useEffect, useSyncExternalStore } from "react";

const ZOOM_STORAGE_KEY = "amber-ui-zoom";
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.0;
export const STEP = 0.05;

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
    document.body.style.zoom = "";
  }
  const root = document.getElementById("root");
  if (root) {
    root.style.zoom = "";
  }
}

let globalZoom = getStoredZoom();
let hudTimeout: number | null = null;
let isHudVisible = false;

const zoomListeners = new Set<() => void>();
const hudListeners = new Set<() => void>();

function notifyZoom() {
  zoomListeners.forEach((fn) => fn());
}

function notifyHud() {
  hudListeners.forEach((fn) => fn());
}

function triggerHud() {
  isHudVisible = true;
  notifyHud();
  if (hudTimeout !== null) clearTimeout(hudTimeout);
  hudTimeout = window.setTimeout(() => {
    isHudVisible = false;
    notifyHud();
    hudTimeout = null;
  }, 1600);
}

export function applyZoom(nextZoom: number, showHud = true) {
  const clamped = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)) * 100) / 100;
  if (clamped === globalZoom) return;
  globalZoom = clamped;
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
  } catch {}
  applyDocumentZoom(clamped);
  notifyZoom();
  if (showHud) triggerHud();
}

export function resetZoom() {
  applyZoom(1, true);
}

export function zoomIn() {
  applyZoom(globalZoom + STEP, true);
}

export function zoomOut() {
  applyZoom(globalZoom - STEP, true);
}

export function useZoom() {
  const zoom = useSyncExternalStore(
    (callback) => {
      zoomListeners.add(callback);
      return () => zoomListeners.delete(callback);
    },
    () => globalZoom,
    () => 1,
  );

  const hudVisible = useSyncExternalStore(
    (callback) => {
      hudListeners.add(callback);
      return () => hudListeners.delete(callback);
    },
    () => isHudVisible,
    () => false,
  );

  useEffect(() => {
    // Apply initial stored zoom
    applyDocumentZoom(globalZoom);

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY < 0 ? STEP : -STEP;
      applyZoom(globalZoom + delta, true);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        applyZoom(globalZoom + STEP, true);
      } else if (event.key === "-") {
        event.preventDefault();
        applyZoom(globalZoom - STEP, true);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("wheel", handleWheel, { capture: true } as any);
      window.removeEventListener("keydown", handleKeyDown, { capture: true } as any);
    };
  }, []);

  const zoomPercent = Math.round(zoom * 100);
  const isNormal = zoomPercent === 100;
  const isZoomedIn = zoomPercent > 100;
  const isZoomedOut = zoomPercent < 100;
  const zoomStatus = isNormal ? "Normal" : isZoomedIn ? "Zoomed in" : "Zoomed out";

  return {
    zoom,
    zoomPercent,
    isNormal,
    isZoomedIn,
    isZoomedOut,
    zoomStatus,
    hudVisible,
    applyZoom,
    resetZoom,
    zoomIn,
    zoomOut,
  };
}
