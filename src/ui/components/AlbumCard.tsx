import { memo, useCallback, useRef, type MouseEvent, type ReactNode } from "react";
import { TiltCard } from "@/components/motion/tilt-card";
import { MenuDotsIcon, PlayActiveIcon } from "@/ui/icons";
import { propsEqualIgnoringHandlers } from "../../internal/propsEqual";
import { TrackArtwork } from "./TrackArtwork";

/**
 * Rendered card width in CSS pixels.
 *
 * The default covers the `minmax(9rem…9.5rem, 1fr)` grids these sit in. It only has to land in
 * the right size bucket, not be exact — a column stretched a little wider by `1fr` still
 * resolves to the same request.
 */
const DEFAULT_CARD_SIZE = 176;

interface AlbumCardProps {
  color?: string;
  artworkUrl?: string;
  title?: string;
  subtitle?: string;
  subtitleContent?: ReactNode;
  /** Override when the card is laid out at a materially different width. */
  size?: number;
  isOfficialYouTube?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => void;
}

/**
 * Memoised on everything except handler identity.
 *
 * Every grid that renders these hands them a fresh inline arrow, so a plain `memo` would never
 * once return true — a search keystroke or a hover elsewhere on the page rebuilt every card on
 * screen. `propsEqualIgnoringHandlers` skips those comparisons, which is only sound because
 * the handlers are invoked through a ref refreshed on each render: a card that *does* render
 * picks up the current closures, and a card that does not render is one whose every other prop
 * is unchanged.
 */
export const AlbumCard = memo(function AlbumCard({
  color = "#333333",
  artworkUrl,
  title,
  subtitle,
  subtitleContent,
  size = DEFAULT_CARD_SIZE,
  isOfficialYouTube: _isOfficialYouTube,
  onClick,
  onContextMenu,
}: AlbumCardProps) {
  const handlersRef = useRef({ onClick, onContextMenu });
  handlersRef.current = { onClick, onContextMenu };

  const handleClick = useCallback(() => handlersRef.current.onClick?.(), []);
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => handlersRef.current.onContextMenu?.(event),
    [],
  );
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") handlersRef.current.onClick?.();
  }, []);

  return (
    <div
      /*
       * Off-screen cards skip style, layout and paint — the same treatment `TrackRow` gets,
       * and for the same reason: these grids are not windowed, so a library page really does
       * build every card it has loaded. A card is heavier than a row (artwork, tilt wrapper,
       * hover overlay), which makes it the better candidate, not the worse one.
       *
       * `auto 232px` is a square cover at the ~176px grid column plus the two label lines. The
       * `auto` keyword means the guess only ever applies to a card that has not yet been on
       * screen once; after that the browser uses the size it actually measured.
       */
      className="group/card flex w-full cursor-pointer flex-col gap-2 p-2 select-none transition-all duration-300 hover:-translate-y-1 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [content-visibility:auto] [contain-intrinsic-size:auto_232px]"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <TiltCard max={9} className="aspect-square w-full overflow-hidden rounded-lg shadow-sm">
        <div className="relative size-full" style={{ backgroundColor: color }}>
          <TrackArtwork
            className="size-full object-cover"
            artworkUrl={artworkUrl}
            iconSize={48}
            size={size}
            variant="album"
          />
          {/* 3-dots menu button in top-right corner on hover */}
          {onContextMenu && (
            <div className="absolute top-2 right-2 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label={`Options for ${title || "album"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e);
                }}
                className="flex size-8 items-center justify-center rounded-full bg-black/70 hover:bg-black/90 text-white/90 hover:text-white shadow-lg backdrop-blur-sm transition-all hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
              >
                <MenuDotsIcon size={16} />
              </button>
            </div>
          )}
          {/* Play affordance fades in on hover rather than sitting permanently on the art. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/50 opacity-0 transition-opacity group-hover/card:opacity-100">
            <span className="grid size-12 place-items-center rounded-full bg-red-600 text-white shadow-xl transition-transform duration-200 group-hover/card:scale-105">
              <PlayActiveIcon size={26} />
            </span>
          </div>
        </div>
      </TiltCard>

      {title && (
        <span className="line-clamp-2 text-sm font-medium text-foreground">{title}</span>
      )}
      {(subtitleContent || subtitle) && (
        <span className="line-clamp-1 text-xs text-muted-foreground">
          {subtitleContent ?? subtitle}
        </span>
      )}
    </div>
  );
}, propsEqualIgnoringHandlers);
