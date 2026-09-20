/**
 * One lyric-line renderer for every surface (fullscreen lyrics, Now Playing song screen,
 * right-panel preview card, mini window).
 *
 * Extracted from LyricsView's SyncedLine: same karaoke sweep, same ad-lib token styling,
 * same empty-line beat dots — but props in, no stores, no controllers. Timing (rAF loop,
 * 250ms tick, static) and follow/scroll stay with each caller; this component only paints
 * the state it is given. Visual differences between surfaces are isolated in the `size`
 * variant so each surface keeps pixel parity with what it renders today.
 */

import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  isRtlText,
  parseLyricTokens,
  type DuetAlignment,
} from "../../pages/lyricsTiming";

export type LyricLineSize = "fullscreen" | "song" | "preview" | "mini";

export interface LyricDepthStyle {
  opacity?: number;
  filter?: string;
  transform?: string;
}

export interface LyricLineViewProps {
  index: number;
  /** Caller passes duet-processed display text; raw text when duet mode is off. */
  text: string;
  isActive: boolean;
  /**
   * 0..1 karaoke fill, painted as `--sweep`. Omitted when the parent paints the var itself
   * on every frame (fullscreen rAF loop) — the sweep *class* still comes from `sweepEnabled`.
   */
  sweep01?: number;
  /** Mini pop-highlights instead of sweeping; ad-lib lines never sweep anywhere. */
  sweepEnabled?: boolean;
  enableAdlibs?: boolean;
  /** Whole-line ad-lib treatment (bare "Woo") on top of parenthetical token splitting. */
  forceAdlibLine?: boolean;
  size?: LyricLineSize;
  alignment?: DuetAlignment;
  /** Fullscreen focal-plane style; other surfaces use their flat dim classes. */
  depthStyle?: LyricDepthStyle;
  reduceMotion?: boolean;
  translation?: string;
  tabbable?: boolean;
  onSeek?: (index: number) => void;
  onFocusLine?: (index: number) => void;
  register?: (index: number, element: HTMLElement | null) => void;
  /** Direct node access (Queue's rAF sweep writer). Composes with `register`. */
  elementRef?: (element: HTMLElement | null) => void;
  emptyStyle?: "dots" | "note";
  /** Extra classes on the row (Queue's enter animation). */
  className?: string;
}

const ADLIB_TOKEN_CLASS: Record<LyricLineSize, string> = {
  fullscreen: "text-[0.76em] italic font-normal tracking-normal opacity-70 mx-1.5 inline-block text-white/80",
  song: "text-[0.8em] italic font-medium opacity-60",
  preview: "text-[0.82em] italic font-medium opacity-60",
  mini: "text-[0.82em] font-medium italic opacity-60",
};

export const LyricLineView = memo(function LyricLineView({
  index,
  text,
  isActive,
  sweep01,
  sweepEnabled = true,
  enableAdlibs = true,
  forceAdlibLine = false,
  size = "fullscreen",
  alignment = "left",
  depthStyle,
  reduceMotion = false,
  translation,
  tabbable = false,
  onSeek,
  onFocusLine,
  register,
  elementRef,
  emptyStyle = "dots",
  className,
}: LyricLineViewProps) {
  const attach = useCallback(
    (element: HTMLElement | null) => {
      register?.(index, element);
      elementRef?.(element);
    },
    [index, register, elementRef],
  );

  const tokens = useMemo(() => {
    if (!enableAdlibs) return [{ type: "main" as const, text }];
    return parseLyricTokens(text);
  }, [text, enableAdlibs]);

  const adlibLine = forceAdlibLine
    || (tokens.length > 0 && tokens.every((token) => token.type === "adlib"));

  const isArabic = isRtlText(text);
  const sweeps = sweepEnabled && isActive && !adlibLine && !reduceMotion;
  const sweepStyle = sweeps && sweep01 !== undefined
    ? ({ "--sweep": `${(Math.min(1, Math.max(0, sweep01)) * 100).toFixed(2)}%` } as CSSProperties)
    : undefined;

  const alignClass = cn(
    alignment === "right" && "self-end text-end origin-right",
    alignment === "center" && "self-center text-center origin-center",
    (!alignment || alignment === "left") && "self-start text-start origin-left",
  );

  // An empty LRC line is a real instrumental beat, not junk.
  if (!text.trim()) {
    if (emptyStyle === "dots") {
      return (
        <div
          ref={attach}
          aria-hidden="true"
          className={cn(
            "flex items-center gap-1.5 py-1",
            alignment === "right" && "self-end justify-end",
            alignment === "center" && "self-center justify-center",
            alignment === "left" && "self-start justify-start",
          )}
          style={depthStyle ? { opacity: depthStyle.opacity } : undefined}
        >
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className={cn(
                "size-2 rounded-full bg-foreground/60",
                isActive && !reduceMotion && "animate-pulse",
              )}
              style={isActive ? { animationDelay: `${dot * 180}ms` } : undefined}
            />
          ))}
        </div>
      );
    }
    return (
      <p ref={attach} aria-hidden="true" className="opacity-60">
        <span aria-hidden="true">♪</span>
      </p>
    );
  }

  const tokenNodes = tokens.length > 0 ? (
    tokens.map((token, i) =>
      token.type === "adlib" ? (
        <span key={i} className={ADLIB_TOKEN_CLASS[size]}>
          {token.text}
        </span>
      ) : (
        <span key={i}>{token.text}</span>
      ),
    )
  ) : (
    <span aria-hidden="true">♪</span>
  );

  const translationNode = translation ? (
    <span className="mt-1 block text-[0.62em] font-medium leading-snug text-muted-foreground">
      {translation}
    </span>
  ) : null;

  if (size === "fullscreen") {
    return (
      <button
        ref={attach}
        type="button"
        dir={isArabic ? "rtl" : "ltr"}
        tabIndex={tabbable ? 0 : -1}
        aria-current={isActive ? "true" : undefined}
        onFocus={() => onFocusLine?.(index)}
        className={cn(
          "group relative text-pretty font-bold leading-[1.16] tracking-[-0.035em] max-w-[88%] synced-line lyrics-lyricsContent-lyric",
          alignClass,
          "transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[transform,opacity,filter]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
          isActive && "is-active lyrics-lyricsContent-active",
          sweeps ? "lyric-sweep font-black" : "text-foreground font-semibold",
          !isActive && "hover:opacity-95 hover:filter-none hover:scale-100",
        )}
        style={{
          ...(sweepStyle ?? {}),
          opacity: isActive ? 1 : depthStyle?.opacity,
          filter: isActive ? "none" : depthStyle?.filter,
          transform: isActive ? "scale(1.035) translateZ(0)" : "scale(0.985) translateZ(0)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSeek?.(index);
        }}
      >
        {tokenNodes}
        {translationNode}
      </button>
    );
  }

  if (size === "song") {
    return (
      <button
        ref={attach}
        type="button"
        dir={isArabic ? "rtl" : "ltr"}
        onClick={(e) => {
          e.stopPropagation();
          onSeek?.(index);
        }}
        style={sweepStyle}
        className={cn(
          "cursor-pointer font-bold leading-tight tracking-tight select-text text-2xl sm:text-3xl lg:text-3xl origin-center",
          "transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[transform,opacity,filter]",
          isArabic && "font-sans font-medium leading-relaxed",
          isActive && !adlibLine && "lyric-sweep text-white scale-[1.08] opacity-100 filter drop-shadow-[0_0_24px_rgba(255,255,255,0.45)]",
          isActive && adlibLine && "text-white italic scale-[1.06] opacity-100",
          !isActive && !adlibLine && "text-white/40 scale-100 opacity-60 hover:opacity-90 hover:scale-[1.02]",
          !isActive && adlibLine && "text-white/35 italic font-medium scale-100 opacity-45 hover:opacity-75",
        )}
      >
        {tokenNodes}
      </button>
    );
  }

  if (size === "preview") {
    const rowClass = cn(
      "transition-all duration-300 leading-normal select-text text-left w-full",
      isActive && !adlibLine && "font-bold text-sm sm:text-base text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] scale-[1.01] origin-left",
      isActive && adlibLine && "text-white text-xs sm:text-sm italic font-bold scale-[1.01] origin-left",
      !isActive && !adlibLine && "text-[#a7a7a7] font-semibold text-xs sm:text-sm hover:text-white/80",
      !isActive && adlibLine && "text-[#a7a7a7]/60 text-[11px] sm:text-xs italic font-semibold",
      sweeps && "lyric-sweep",
      className,
    );
    if (onSeek) {
      return (
        <button
          ref={attach}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSeek(index);
          }}
          style={sweepStyle}
          className={cn(rowClass, "cursor-pointer block")}
        >
          {tokenNodes}
        </button>
      );
    }
    return (
      <p ref={attach} style={sweepStyle} className={rowClass}>
        {tokenNodes}
      </p>
    );
  }

  // mini
  return (
    <p
      ref={attach}
      data-line-index={index}
      onClick={() => onSeek?.(index)}
      className={cn(
        "cursor-pointer rounded-lg px-2 py-1 text-sm font-semibold transition-all duration-300",
        isActive && !adlibLine && "scale-105 font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.7)]",
        isActive && adlibLine && "scale-105 font-bold italic text-white",
        !isActive && !adlibLine && "text-muted-foreground/45 hover:text-white/80",
        !isActive && adlibLine && "text-[13px] font-medium italic text-white/35",
      )}
    >
      {tokenNodes}
    </p>
  );
});
