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
  cleanAdlibBrackets,
  isRtlText,
  parseLyricTokens,
  unmaskProfanity,
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

export interface CachedLyricWord {
  el: HTMLElement;
  start: number;
  end: number;
  state?: "sung" | "unsung" | "active";
}

/**
 * Sweeps words sequentially across the active line at 60fps (snake karaoke).
 * Avoids React re-renders by writing directly to word element datasets and style properties.
 */
export function updateLineWordsSweep(lineEl: HTMLElement, rawProgress: number): void {
  const progress = Math.min(1, Math.max(0, rawProgress));
  lineEl.style.setProperty("--sweep", `${(progress * 100).toFixed(2)}%`);

  const el = lineEl as HTMLElement & { __lyricWords?: CachedLyricWord[] };
  let words = el.__lyricWords;
  if (!words) {
    const wordNodes = lineEl.querySelectorAll<HTMLElement>(".lyric-word");
    words = [];
    for (let i = 0; i < wordNodes.length; i++) {
      const wEl = wordNodes[i]!;
      const start = parseFloat(wEl.dataset.start || "0");
      const end = parseFloat(wEl.dataset.end || "1");
      words.push({ el: wEl, start, end, state: (wEl.dataset.state as any) || undefined });
    }
    el.__lyricWords = words;
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (progress >= w.end) {
      if (w.state !== "sung") {
        w.state = "sung";
        w.el.dataset.state = "sung";
        w.el.style.setProperty("--w-sweep", "100%");
      }
    } else if (progress <= w.start) {
      if (w.state !== "unsung") {
        w.state = "unsung";
        w.el.dataset.state = "unsung";
        w.el.style.setProperty("--w-sweep", "0%");
      }
    } else {
      const frac = (progress - w.start) / Math.max(0.0001, w.end - w.start);
      w.state = "active";
      w.el.dataset.state = "active";
      w.el.style.setProperty("--w-sweep", `${(frac * 100).toFixed(1)}%`);
    }
  }
}

/**
 * Sets all words in a line to sung (100%) or unsung (0%) state.
 */
export function setLineSweepState(lineEl: HTMLElement, state: "sung" | "unsung"): void {
  lineEl.style.setProperty("--sweep", state === "sung" ? "100%" : "0%");
  const el = lineEl as HTMLElement & { __lyricWords?: CachedLyricWord[] };
  let words = el.__lyricWords;
  if (!words) {
    const wordNodes = lineEl.querySelectorAll<HTMLElement>(".lyric-word");
    words = [];
    for (let i = 0; i < wordNodes.length; i++) {
      const wEl = wordNodes[i]!;
      const start = parseFloat(wEl.dataset.start || "0");
      const end = parseFloat(wEl.dataset.end || "1");
      words.push({ el: wEl, start, end });
    }
    el.__lyricWords = words;
  }

  const sweepVal = state === "sung" ? "100%" : "0%";
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    w.state = state;
    w.el.dataset.state = state;
    w.el.style.setProperty("--w-sweep", sweepVal);
  }
}

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

  const cleanedText = useMemo(() => unmaskProfanity(text), [text]);

  const tokens = useMemo(() => {
    if (!enableAdlibs) return [{ type: "main" as const, text: cleanedText }];
    return parseLyricTokens(cleanedText);
  }, [cleanedText, enableAdlibs]);

  const adlibLine = forceAdlibLine
    || (tokens.length > 0 && tokens.every((token) => token.type === "adlib"));

  const isArabic = isRtlText(cleanedText);
  const sweeps = sweepEnabled && isActive && !adlibLine && !reduceMotion;
  const sweepStyle = sweeps && sweep01 !== undefined
    ? ({ "--sweep": `${(Math.min(1, Math.max(0, sweep01)) * 100).toFixed(2)}%` } as CSSProperties)
    : undefined;

  const alignClass = cn(
    alignment === "right" && "self-end text-end origin-right",
    alignment === "center" && "self-center text-center origin-center",
    (!alignment || alignment === "left") && "self-start text-start origin-left",
  );

  // Split tokens into snake-wipe word items with proportional durations
  const wordTokens = useMemo(() => {
    if (!cleanedText.trim()) return [];

    const hasMainTokens = tokens.some((t) => t.type === "main" && /\S/.test(t.text));

    let totalChars = 0;
    for (const token of tokens) {
      // If line has main vocal words, only main tokens count towards character timing!
      // Ad-libs play concurrently in the background and shouldn't rob time from main lyrics.
      if (hasMainTokens && token.type === "adlib") continue;
      const matches = token.text.match(/\S+/g);
      if (matches) {
        for (const m of matches) {
          totalChars += m.length;
        }
      }
    }
    if (totalChars === 0) totalChars = 1;

    let accumulatedChars = 0;
    return tokens.map((token, tIdx) => {
      const parts = token.text.match(/(\S+|\s+)/g) || [token.text];
      const items = parts.map((part, pIdx) => {
        const isWord = /\S/.test(part);
        if (!isWord) {
          return {
            id: `${tIdx}-${pIdx}`,
            text: part,
            isWord: false,
            start: 0,
            end: 0,
          };
        }
        if (hasMainTokens && token.type === "adlib") {
          // Ad-libs float independently alongside main lyrics; they don't consume the main sweep allocation
          return {
            id: `${tIdx}-${pIdx}`,
            text: part,
            isWord: true,
            start: 0,
            end: 1,
          };
        }
        const start = accumulatedChars / totalChars;
        accumulatedChars += part.length;
        const end = accumulatedChars / totalChars;
        return {
          id: `${tIdx}-${pIdx}`,
          text: part,
          isWord: true,
          start,
          end,
        };
      });
      return {
        type: token.type,
        items,
      };
    });
  }, [cleanedText, tokens]);

  // An empty LRC line is a real instrumental beat, not junk.
  if (!cleanedText.trim()) {
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

  const tokenNodes = wordTokens.length > 0 ? (
    wordTokens.map((group, gIdx) => {
      const content = group.items.map((item) => {
        if (!item.isWord) {
          return <span key={item.id}>{item.text}</span>;
        }

        let state: "sung" | "unsung" | "active" = "unsung";
        let wordSweepStyle: CSSProperties | undefined;

        if (sweep01 !== undefined && sweeps) {
          if (sweep01 >= item.end) {
            state = "sung";
            wordSweepStyle = { "--w-sweep": "100%" } as CSSProperties;
          } else if (sweep01 <= item.start) {
            state = "unsung";
            wordSweepStyle = { "--w-sweep": "0%" } as CSSProperties;
          } else {
            state = "active";
            const frac = (sweep01 - item.start) / Math.max(0.0001, item.end - item.start);
            wordSweepStyle = { "--w-sweep": `${(frac * 100).toFixed(1)}%` } as CSSProperties;
          }
        }

        return (
          <span
            key={item.id}
            className="lyric-word inline-block"
            data-start={item.start.toFixed(4)}
            data-end={item.end.toFixed(4)}
            data-state={state}
            style={wordSweepStyle}
          >
            {item.text}
          </span>
        );
      });

      if (group.type === "adlib") {
        const adlibContent = group.items.map((item) => {
          const rawText = item.text;
          const cleanText = cleanAdlibBrackets(rawText);
          if (!cleanText) return null;

          if (isActive && !reduceMotion) {
            return (
              <span key={item.id} className="inline-block whitespace-nowrap">
                {cleanText.split("").map((ch, cIdx) => (
                  <span
                    key={cIdx}
                    className="adlib-letter-rumble"
                    style={{ animationDelay: `${((cIdx % 10) * 0.14).toFixed(2)}s` }}
                  >
                    {ch === " " ? "\u00A0" : ch}
                  </span>
                ))}
              </span>
            );
          }

          return <span key={item.id}>{cleanText}</span>;
        });

        return (
          <span
            key={gIdx}
            className={cn(
              ADLIB_TOKEN_CLASS[size],
              isActive && "text-white/95 opacity-90 font-semibold",
            )}
          >
            {adlibContent}
          </span>
        );
      }
      return <span key={gIdx}>{content}</span>;
    })
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
          isArabic && "font-arabic tracking-normal font-black leading-snug",
          "transition-all duration-400 ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[transform,opacity,filter]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
          isActive && "is-active lyrics-lyricsContent-active",
          sweeps ? "lyric-sweep font-black" : "text-foreground font-semibold",
          adlibLine && isActive && "adlib-wobble-active opacity-90",
          adlibLine && !isActive && "opacity-50 italic",
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
          "cursor-pointer font-bold leading-snug tracking-tight select-text text-2xl sm:text-3xl lg:text-[34px] origin-center max-w-[92%] mx-auto block",
          "transition-all duration-350 ease-[cubic-bezier(0.25,1,0.5,1)] will-change-[transform,opacity,filter]",
          isArabic && "font-arabic tracking-normal font-black leading-snug",
          isActive && !adlibLine && "lyric-sweep text-white scale-[1.05] opacity-100 [text-shadow:0_0_12px_rgba(255,255,255,0.4)]",
          isActive && adlibLine && "text-white italic scale-[1.03] opacity-100",
          !isActive && !adlibLine && "text-white/40 scale-100 opacity-60 hover:text-white/85 hover:opacity-90 hover:scale-[1.015]",
          !isActive && adlibLine && "text-white/30 italic font-medium scale-100 opacity-45 hover:text-white/60 hover:opacity-75",
        )}
      >
        {tokenNodes}
      </button>
    );
  }

  if (size === "preview") {
    const rowClass = cn(
      "transition-all duration-300 leading-normal select-text w-full will-change-[transform,opacity,filter] preview-lyric-row",
      isArabic
        ? "font-arabic tracking-normal font-bold text-right origin-right"
        : "text-left origin-left",
      isActive && !adlibLine && cn(
        "is-active lyrics-lyricsContent-active font-bold text-sm sm:text-base text-white scale-[1.02]",
        isArabic ? "origin-right" : "origin-left",
      ),
      isActive && adlibLine && cn(
        "text-white text-xs sm:text-sm italic font-bold scale-[1.01]",
        isArabic ? "origin-right" : "origin-left",
      ),
      !isActive && !adlibLine && "text-white/45 font-semibold text-xs sm:text-sm hover:text-white/85 hover:!filter-none hover:!scale-100 transition-all",
      !isActive && adlibLine && "text-white/30 text-[11px] sm:text-xs italic font-semibold hover:text-white/70 hover:!filter-none transition-all",
      sweeps && "lyric-sweep font-bold",
      className,
    );
    const previewStyle: CSSProperties = {
      ...(sweepStyle ?? {}),
      opacity: isActive ? 1 : depthStyle?.opacity,
      filter: isActive ? "none" : depthStyle?.filter,
      transform: isActive ? "scale(1.03) translateZ(0)" : depthStyle?.transform,
    };
    if (onSeek) {
      return (
        <button
          ref={attach}
          type="button"
          dir={isArabic ? "rtl" : "ltr"}
          onClick={(e) => {
            e.stopPropagation();
            onSeek(index);
          }}
          style={previewStyle}
          className={cn(rowClass, "cursor-pointer block focus-visible:outline-none")}
        >
          {tokenNodes}
        </button>
      );
    }
    return (
      <p ref={attach} dir={isArabic ? "rtl" : "ltr"} style={previewStyle} className={rowClass}>
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
        isActive && !adlibLine && "scale-105 font-bold text-white [text-shadow:0_0_12px_rgba(255,255,255,0.7)]",
        isActive && adlibLine && "scale-105 font-bold italic text-white",
        !isActive && !adlibLine && "text-muted-foreground/45 hover:text-white/80",
        !isActive && adlibLine && "text-[13px] font-medium italic text-white/35",
      )}
    >
      {tokenNodes}
    </p>
  );
});
