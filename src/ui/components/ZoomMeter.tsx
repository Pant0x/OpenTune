import { useState, useRef, useEffect } from "react";
import { useZoom, MIN_ZOOM, MAX_ZOOM } from "../hooks/useZoom";
import { Tooltip } from "@/components/motion/tooltip";
import { ZoomInIcon, ZoomOutIcon } from "@/ui/icons";
import { cn } from "@/lib/utils";

export function ZoomMeter() {
  const {
    zoom,
    zoomPercent,
    isNormal,
    isZoomedIn,
    isZoomedOut,
    zoomStatus,
    resetZoom,
    zoomIn,
    zoomOut,
    applyZoom,
  } = useZoom();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const PRESET_ZOOMS = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5];

  return (
    <div ref={containerRef} className="relative flex items-center">
      <Tooltip
        content={`Zoom: ${zoomPercent}% (${zoomStatus}) • Click to reset (Ctrl+0)`}
        side="bottom"
      >
        <button
          type="button"
          onClick={() => {
            if (!isNormal) {
              resetZoom();
            } else {
              setIsOpen((prev) => !prev);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }}
          aria-label={`UI Zoom: ${zoomPercent}%, ${zoomStatus}`}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold tracking-tight transition-all select-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isNormal
              ? "text-muted-foreground/80 hover:text-foreground hover:bg-white/[0.08]"
              : isZoomedIn
              ? "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 shadow-xs"
              : "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 shadow-xs"
          )}
        >
          {isZoomedIn ? (
            <ZoomInIcon size={12} className="shrink-0" />
          ) : isZoomedOut ? (
            <ZoomOutIcon size={12} className="shrink-0" />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
          )}
          <span className="tabular-nums leading-none">{zoomPercent}%</span>
        </button>
      </Tooltip>

      {/* Popover Controls */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-44 rounded-xl bg-card/95 border border-white/10 p-2 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-2 select-none">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Zoom Scale
            </span>
            <span className="text-[11px] font-bold text-primary tabular-nums">
              {zoomPercent}%
            </span>
          </div>

          <div className="flex items-center justify-between gap-1 bg-white/[0.04] p-1 rounded-lg border border-white/5">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
              title="Zoom out (Ctrl + -)"
            >
              <ZoomOutIcon size={13} />
            </button>

            <button
              type="button"
              onClick={resetZoom}
              className={cn(
                "flex-1 text-center text-xs font-bold rounded-md py-0.5 transition-colors cursor-pointer",
                isNormal
                  ? "text-foreground bg-white/10"
                  : "text-primary hover:bg-primary/15"
              )}
              title="Reset zoom to 100% (Ctrl + 0)"
            >
              100%
            </button>

            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
              title="Zoom in (Ctrl + +)"
            >
              <ZoomInIcon size={13} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 pt-1 border-t border-border/30">
            {PRESET_ZOOMS.map((preset) => {
              const presetPercent = Math.round(preset * 100);
              const isSelected = zoomPercent === presetPercent;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    applyZoom(preset);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "text-[11px] py-1 rounded-md font-medium transition-colors cursor-pointer text-center",
                    isSelected
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/10"
                  )}
                >
                  {presetPercent}%
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ZoomHudOverlay() {
  const { zoomPercent, zoomStatus, isNormal, isZoomedIn, isZoomedOut, hudVisible } = useZoom();

  if (!hudVisible) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[320] pointer-events-none flex items-center gap-2 rounded-full bg-zinc-900/90 border border-white/15 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 select-none"
    >
      {isZoomedIn ? (
        <ZoomInIcon size={14} className="text-primary" />
      ) : isZoomedOut ? (
        <ZoomOutIcon size={14} className="text-amber-400" />
      ) : (
        <span className="size-2 rounded-full bg-emerald-400" />
      )}
      <span className="text-white font-bold tabular-nums">{zoomPercent}%</span>
      <span className="text-white/60 font-normal">
        {isNormal ? "Normal (100%)" : zoomStatus}
      </span>
    </div>
  );
}
