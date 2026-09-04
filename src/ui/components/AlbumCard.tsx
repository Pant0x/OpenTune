import { memo, useCallback, useRef, type MouseEvent, type ReactNode } from "react";
import { TiltCard } from "@/components/motion/tilt-card";
import { PlayActiveIcon } from "@/ui/icons";
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
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
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
  isOfficialYouTube,
  onClick,
  onContextMenu,
}: AlbumCardProps) {
  const handlersRef = useRef({ onClick, onContextMenu });
  handlersRef.current = { onClick, onContextMenu };

  const handleClick = useCallback(() => handlersRef.current.onClick?.(), []);
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => handlersRef.current.onContextMenu?.(event),
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
      className="group/card flex w-full cursor-pointer flex-col gap-2  p-2 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [content-visibility:auto] [contain-intrinsic-size:auto_232px]"
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
          {isOfficialYouTube && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5 backdrop-blur-md border border-white/10 shadow-md">
              <svg viewBox="0 0 24 24" className="size-3.5 fill-red-600">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              <span className="text-[10px] font-bold tracking-tight text-white/90">YT Music</span>
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
