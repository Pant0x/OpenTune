/**
 * Central icon module — featuring the official Spotify Iconography Set
 * (from Figma Spotify Icons Set & monochrome Social Media Icons).
 */

import { forwardRef, type ComponentPropsWithoutRef, type ForwardRefExoticComponent, type ReactNode, type RefAttributes } from "react";

export interface IconBaseProps {
  children?: ReactNode;
  alt?: string;
  color?: string;
  size?: string | number;
  strokeWidth?: string | number;
  secondaryColor?: string;
  secondaryOpacity?: number;
  iconName?: string;
  isolated?: boolean;
}

export interface IconProps extends ComponentPropsWithoutRef<"svg">, RefAttributes<SVGSVGElement>, Omit<IconBaseProps, "color"> {
  color?: string;
}

export type Icon = ForwardRefExoticComponent<Omit<IconProps, "ref"> & RefAttributes<SVGSVGElement>>;

function createSpotifyIcon(
  render: () => ReactNode,
  viewBox = "0 0 24 24"
): Icon {
  const comp = forwardRef<SVGSVGElement, any>(({ size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      viewBox={viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      {render()}
    </svg>
  ));
  return comp as unknown as Icon;
}

/* ── Fallback utility icons preserved from Solar for specialized views ── */
export { EyeIcon } from "@solar-icons/react/linear/eye";
export { EyeClosedIcon } from "@solar-icons/react/linear/eye-closed";
export { FolderIcon } from "@solar-icons/react/linear/folder";
export { FolderOpenIcon } from "@solar-icons/react/linear/folder-open";
export { AddFolderIcon as FolderAddIcon } from "@solar-icons/react/linear/add-folder";
export { GalleryIcon as ImageIcon } from "@solar-icons/react/linear/gallery";
export { DocumentTextIcon as LogFileIcon } from "@solar-icons/react/linear/document-text";
export { FileTextIcon } from "@solar-icons/react/linear/file-text";
export { PaletteIcon } from "@solar-icons/react/linear/palette";
export { PaletteIcon as PaletteActiveIcon } from "@solar-icons/react/bold/palette";
export { SettingsIcon } from "@solar-icons/react/linear/settings";
export { SettingsIcon as SettingsActiveIcon } from "@solar-icons/react/bold/settings";
export { SortIcon } from "@solar-icons/react/linear/sort";
export { RefreshIcon } from "@solar-icons/react/linear/refresh";
export { PenIcon as PencilIcon } from "@solar-icons/react/linear/pen";
export { ArrowUpIcon } from "@solar-icons/react/linear/arrow-up";
export { ArrowDownIcon } from "@solar-icons/react/linear/arrow-down";
export { ArrowLeftIcon } from "@solar-icons/react/linear/arrow-left";
export { ArrowRightIcon } from "@solar-icons/react/linear/arrow-right";
export { AltArrowDownIcon as ChevronDownIcon } from "@solar-icons/react/linear/alt-arrow-down";
export { Login2Icon as LoginIcon } from "@solar-icons/react/linear/login-2";
export { Logout2Icon as LogoutIcon } from "@solar-icons/react/linear/logout-2";
export { KeyIcon } from "@solar-icons/react/linear/key";
export { BugIcon } from "@solar-icons/react/linear/bug";
export { SpeedometerMaxIcon as SpeedIcon } from "@solar-icons/react/linear/speedometer-max";
export { CupHotIcon as CoffeeIcon } from "@solar-icons/react/linear/cup-hot";
export { MagicWandIcon as DiceIcon } from "@solar-icons/react/linear/magic-wand";
export { MagicWandIcon as DiceActiveIcon } from "@solar-icons/react/bold/magic-wand";
export { UserIcon as MailIcon } from "@solar-icons/react/linear/user";
export { LockIcon } from "@solar-icons/react/linear/lock";

/* ── Spotify Transport Controls ───────────────────────────────────── */
export const PlayIcon: Icon = createSpotifyIcon(() => (
  <path d="M7.05 3.606 20.54 11.394a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z" />
));
export const PlayActiveIcon: Icon = PlayIcon;

export const PauseIcon: Icon = createSpotifyIcon(() => (
  <path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z" />
));
export const PauseActiveIcon: Icon = PauseIcon;

export const SkipNextIcon: Icon = createSpotifyIcon(() => (
  <path d="M17.7 3a.7.7 0 0 0-.7.7v6.804L5.05 3.606A.7.7 0 0 0 4 4.212v15.576a.7.7 0 0 0 1.05.606L17 13.496V20.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-1.6z" />
));
export const SkipNextActiveIcon: Icon = SkipNextIcon;

export const SkipPreviousIcon: Icon = createSpotifyIcon(() => (
  <path d="M6.3 3a.7.7 0 0 1 .7.7v6.804L18.95 3.606A.7.7 0 0 1 20 4.212v15.576a.7.7 0 0 1-1.05.606L7 13.496V20.3a.7.7 0 0 1-.7.7H4.7a.7.7 0 0 1-.7-.7V3.7a.7.7 0 0 1 .7-.7h1.6z" />
));
export const SkipPreviousActiveIcon: Icon = SkipPreviousIcon;

/* ── Spotify Playback Order (Shuffle & Repeat) ─────────────────────── */
export const ShuffleIcon: Icon = createSpotifyIcon(() => (
  <path d="M13.151 4.793a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H13.5c-2.316 0-3.953.947-5.168 2.277C7.158 13.37 6.46 15.068 5.762 16.76l-.014.033C5.064 18.468 4.34 20 2.25 20a.75.75 0 0 1 0-1.5c1.65 0 2.193-1.282 2.898-2.998l.013-.031c.706-1.722 1.455-3.551 2.87-5.093C9.404 8.878 11.238 7.75 13.5 7.75h2.121l-2.47-2.47a.75.75 0 0 1 0-1.06zm3.75 9.75a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H13.5c-2.316 0-3.953-.947-5.168-2.277a11.16 11.16 0 0 1-1.04-1.319.75.75 0 1 1 1.258-.817c.28.43.606.84 1.002 1.272 1.071 1.17 2.27 1.641 3.948 1.641h3.621l-2.47-2.47a.75.75 0 0 1 0-1.06zM2.25 4a.75.75 0 0 1 .75.75c0 1.65.543 2.932 1.248 4.648l.013.031c.325.792.658 1.603 1.036 2.45a.75.75 0 1 1-1.378.59c-.38-.853-.717-1.673-1.047-2.478l-.013-.031C3.161 8.243 2.454 6.718 2.25 4.75A.75.75 0 0 1 2.25 4z" />
));

export const ShuffleActiveIcon: Icon = createSpotifyIcon(() => (
  <>
    <path d="M13.151 4.793a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H13.5c-2.316 0-3.953.947-5.168 2.277C7.158 13.37 6.46 15.068 5.762 16.76l-.014.033C5.064 18.468 4.34 20 2.25 20a.75.75 0 0 1 0-1.5c1.65 0 2.193-1.282 2.898-2.998l.013-.031c.706-1.722 1.455-3.551 2.87-5.093C9.404 8.878 11.238 7.75 13.5 7.75h2.121l-2.47-2.47a.75.75 0 0 1 0-1.06zm3.75 9.75a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H13.5c-2.316 0-3.953-.947-5.168-2.277a11.16 11.16 0 0 1-1.04-1.319.75.75 0 1 1 1.258-.817c.28.43.606.84 1.002 1.272 1.071 1.17 2.27 1.641 3.948 1.641h3.621l-2.47-2.47a.75.75 0 0 1 0-1.06zM2.25 4a.75.75 0 0 1 .75.75c0 1.65.543 2.932 1.248 4.648l.013.031c.325.792.658 1.603 1.036 2.45a.75.75 0 1 1-1.378.59c-.38-.853-.717-1.673-1.047-2.478l-.013-.031C3.161 8.243 2.454 6.718 2.25 4.75A.75.75 0 0 1 2.25 4z" />
    <circle cx="12" cy="21.5" r="1.5" />
  </>
));

export const RepeatIcon: Icon = createSpotifyIcon(() => (
  <path d="M4 8.75A3.75 3.75 0 0 1 7.75 5h10.379l-1.94-1.94a.75.75 0 1 1 1.062-1.06l3.22 3.22a.75.75 0 0 1 0 1.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06l1.939-1.94H7.75A2.25 2.25 0 0 0 5.5 8.75v3.5a.75.75 0 0 1-1.5 0v-3.5zm16 6.5A3.75 3.75 0 0 1 16.25 19H5.871l1.94 1.94a.75.75 0 1 1-1.062 1.06l-3.22-3.22a.75.75 0 0 1 0-1.06l3.22-3.22a.75.75 0 1 1 1.06 1.06L5.87 17.5h10.38a2.25 2.25 0 0 0 2.25-2.25v-3.5a.75.75 0 0 1 1.5 0v3.5z" />
));

export const RepeatActiveIcon: Icon = createSpotifyIcon(() => (
  <>
    <path d="M4 8.75A3.75 3.75 0 0 1 7.75 5h10.379l-1.94-1.94a.75.75 0 1 1 1.062-1.06l3.22 3.22a.75.75 0 0 1 0 1.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06l1.939-1.94H7.75A2.25 2.25 0 0 0 5.5 8.75v3.5a.75.75 0 0 1-1.5 0v-3.5zm16 6.5A3.75 3.75 0 0 1 16.25 19H5.871l1.94 1.94a.75.75 0 1 1-1.062 1.06l-3.22-3.22a.75.75 0 0 1 0-1.06l3.22-3.22a.75.75 0 1 1 1.06 1.06L5.87 17.5h10.38a2.25 2.25 0 0 0 2.25-2.25v-3.5a.75.75 0 0 1 1.5 0v3.5z" />
    <circle cx="12" cy="21.5" r="1.5" />
  </>
));

export const RepeatOneActiveIcon: Icon = createSpotifyIcon(() => (
  <>
    <path d="M4 8.75A3.75 3.75 0 0 1 7.75 5h10.379l-1.94-1.94a.75.75 0 1 1 1.062-1.06l3.22 3.22a.75.75 0 0 1 0 1.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06l1.939-1.94H7.75A2.25 2.25 0 0 0 5.5 8.75v3.5a.75.75 0 0 1-1.5 0v-3.5zm16 6.5A3.75 3.75 0 0 1 16.25 19H5.871l1.94 1.94a.75.75 0 1 1-1.062 1.06l-3.22-3.22a.75.75 0 0 1 0-1.06l3.22-3.22a.75.75 0 1 1 1.06 1.06L5.87 17.5h10.38a2.25 2.25 0 0 0 2.25-2.25v-3.5a.75.75 0 0 1 1.5 0v3.5z" />
    <path d="M12.5 8.5v7h-1.5v-5.2h-.75V9.1l1.25-.6h1z" />
  </>
));
export const RepeatOneIcon: Icon = RepeatOneActiveIcon;

/* ── Spotify Volume Controls ──────────────────────────────────────── */
export const VolumeSmallIcon: Icon = createSpotifyIcon(() => (
  <path d="M13.293 3.293a1 1 0 0 0-1.414 0L7 8.172H4a2 2 0 0 0-2 2v3.656a2 2 0 0 0 2 2h3l4.879 4.879a1 1 0 0 0 1.707-.707V4a1 1 0 0 0-.293-.707zm3.121 5.121a1 1 0 0 1 1.414 0 5 5 0 0 1 0 7.072 1 1 0 0 1-1.414-1.414 3 3 0 0 0 0-4.244 1 1 0 0 1 0-1.414z" />
));

export const VolumeLoudIcon: Icon = createSpotifyIcon(() => (
  <path d="M13.293 3.293a1 1 0 0 0-1.414 0L7 8.172H4a2 2 0 0 0-2 2v3.656a2 2 0 0 0 2 2h3l4.879 4.879a1 1 0 0 0 1.707-.707V4a1 1 0 0 0-.293-.707zm3.121 5.121a1 1 0 0 1 1.414 0 5 5 0 0 1 0 7.072 1 1 0 0 1-1.414-1.414 3 3 0 0 0 0-4.244 1 1 0 0 1 0-1.414zm2.829-2.828a1 1 0 0 1 1.414 0 9 9 0 0 1 0 12.728 1 1 0 1 1-1.414-1.414 7 7 0 0 0 0-9.9 1 1 0 0 1 0-1.414z" />
));
export const VolumeLoudActiveIcon: Icon = VolumeLoudIcon;

export const VolumeMutedIcon: Icon = createSpotifyIcon(() => (
  <path d="M13.293 3.293a1 1 0 0 0-1.414 0L7 8.172H4a2 2 0 0 0-2 2v3.656a2 2 0 0 0 2 2h3l4.879 4.879a1 1 0 0 0 1.707-.707V4a1 1 0 0 0-.293-.707zm4.414 6.293 1.768 1.768 1.768-1.768a1 1 0 0 1 1.414 1.414L20.889 12.77l1.768 1.768a1 1 0 0 1-1.414 1.414l-1.768-1.768-1.768 1.768a1 1 0 0 1-1.414-1.414l1.768-1.768-1.768-1.768a1 1 0 0 1 1.414-1.414z" />
));
export const VolumeMutedActiveIcon: Icon = VolumeMutedIcon;

/* ── Spotify Heart / Like / Save ──────────────────────────────────── */
export const HeartIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 4.248c-3.148-5.402-12-3.825-12 2.94 0 4.661 5.571 9.427 12 15.808 6.43-6.381 12-11.147 12-15.808 0-6.792-8.875-8.306-12-2.94zm0 18.069C5.485 16.033 2 11.83 2 7.188c0-4.053 5.372-5.434 8.28-1.503l1.72 2.32 1.72-2.32C16.628 1.754 22 3.135 22 7.188c0 4.642-3.485 8.845-10 15.129z" />
));

export const HeartActiveIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
));

export const ThumbsUpIcon: Icon = HeartIcon;
export const ThumbsUpActiveIcon: Icon = HeartActiveIcon;
export const BookmarkIcon: Icon = HeartIcon;
export const BookmarkActiveIcon: Icon = HeartActiveIcon;
export const StarIcon: Icon = HeartIcon;
export const StarActiveIcon: Icon = HeartActiveIcon;

export const DislikeIcon: Icon = createSpotifyIcon(() => (
  <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
));
export const DislikeActiveIcon: Icon = DislikeIcon;
export const ThumbsDownIcon: Icon = DislikeIcon;
export const ThumbsDownActiveIcon: Icon = DislikeIcon;
export const HeartBrokenIcon: Icon = DislikeIcon;

/* ── Content Types & Navigation ───────────────────────────────────── */
export const MusicNoteIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
));
export const MusicNoteActiveIcon: Icon = MusicNoteIcon;

export const PlaylistIcon: Icon = createSpotifyIcon(() => (
  <path d="M3 21h3V3H3v18zm6 0h3V3H9v18zm6 0h3V3h-3v18zm5.5 0H23V4.5a1.5 1.5 0 0 0-1.5-1.5H20l.5 18z" />
));
export const PlaylistActiveIcon: Icon = PlaylistIcon;

export const PlaylistAddIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1z" />
));

export const AlbumIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm0-11a3 3 0 1 0 3 3 3 3 0 0 0-3-3zm0 4a1 1 0 1 1 1-1 1 1 0 0 1-1 1z" />
));
export const AlbumActiveIcon: Icon = AlbumIcon;

export const LyricsIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z" />
));
export const LyricsActiveIcon: Icon = LyricsIcon;

export const HomeIcon: Icon = createSpotifyIcon(() => (
  <path d="M12.5 3.247a1 1 0 0 0-1 0L4 7.577V20h4.5v-6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v6H20V7.577l-7.5-4.33zM3 6.993l8.25-4.763a2.5 2.5 0 0 1 2.5 0L22 6.993V21a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-5h-4v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.993z" />
));

export const HomeActiveIcon: Icon = createSpotifyIcon(() => (
  <path d="M12.5 2.23a1 1 0 0 0-1 0L2.5 7.427A1 1 0 0 0 2 8.293V21a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6h4v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8.293a1 1 0 0 0-.5-.866L12.5 2.23z" />
));

export const SearchIcon: Icon = createSpotifyIcon(() => (
  <path d="M10.533 1.279c-5.18 0-9.407 4.14-9.407 9.279s4.226 9.279 9.407 9.279c2.234 0 4.29-.77 5.907-2.058l4.353 4.353a1 1 0 1 0 1.414-1.414l-4.344-4.344a9.157 9.157 0 0 0 2.077-5.816c0-5.14-4.226-9.279-9.407-9.279zm-7.407 9.279c0-4.006 3.302-7.279 7.407-7.279s7.407 3.273 7.407 7.279-3.302 7.279-7.407 7.279-7.407-3.273-7.407-7.279z" />
));

export const CompassIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm3.89 6.11-2.22 5a.5.5 0 0 1-.28.28l-5 2.22a.5.5 0 0 1-.65-.65l2.22-5a.5.5 0 0 1 .28-.28l5-2.22a.5.5 0 0 1 .65.65zM12 11a1 1 0 1 0 1 1 1 1 0 0 0-1-1z" />
));

export const RadioIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-5.657-3.157a1 1 0 0 1 1.414 0 6.98 6.98 0 0 1 0 9.9 1 1 0 0 1-1.414-1.414 4.98 4.98 0 0 0 0-7.072 1 1 0 0 1 0-1.414zm11.314 0a1 1 0 0 1 0 1.414 4.98 4.98 0 0 0 0 7.072 1 1 0 0 1-1.414 1.414 6.98 6.98 0 0 1 0-9.9 1 1 0 0 1 1.414 0zM3.515 3.515a1 1 0 0 1 1.414 0 11.967 11.967 0 0 1 0 16.97 1 1 0 1 1-1.414-1.414 9.967 9.967 0 0 0 0-14.142 1 1 0 0 1 0-1.414zm16.97 0a1 1 0 0 1 0 1.414 9.967 9.967 0 0 0 0 14.142 1 1 0 0 1-1.414 1.414 11.967 11.967 0 0 1 0-16.97 1 1 0 0 1 1.414 0z" />
));

export const ListIcon: Icon = createSpotifyIcon(() => (
  <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h15a1.5 1.5 0 0 1 0 3h-15A1.5 1.5 0 0 1 3 5.5zm0 6.5A1.5 1.5 0 0 1 4.5 10.5h15a1.5 1.5 0 0 1 0 3h-15A1.5 1.5 0 0 1 3 12zm0 6.5a1.5 1.5 0 0 1 1.5-1.5h15a1.5 1.5 0 0 1 0 3h-15a1.5 1.5 0 0 1-1.5-1.5z" />
));
export const QueuePanelIcon: Icon = ListIcon;
export const SidebarToggleIcon: Icon = ListIcon;

export const MenuDotsIcon: Icon = createSpotifyIcon(() => (
  <>
    <circle cx="4.5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19.5" cy="12" r="2" />
  </>
));

export const FullScreenIcon: Icon = createSpotifyIcon(() => (
  <path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 4h-4v2h6v-6h-2v4z" />
));
export const QuitFullScreenIcon: Icon = FullScreenIcon;

export const PlusIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h4a1 1 0 0 1 0 2h-4v4a1 1 0 0 1-2 0v-4H7a1 1 0 0 1 0-2h4V7a1 1 0 0 1 2 0v4z" />
));

export const CheckIcon: Icon = createSpotifyIcon(() => (
  <path d="M19.293 5.293a1 1 0 0 1 1.414 1.414l-11 11a1 1 0 0 1-1.414 0l-5-5a1 1 0 0 1 1.414-1.414L9 15.586l10.293-10.293z" />
));
export const CheckActiveIcon: Icon = CheckIcon;

export const DownloadIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z" />
));

export const TrashIcon: Icon = createSpotifyIcon(() => (
  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
));

export const CopyIcon: Icon = createSpotifyIcon(() => (
  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
));

export const LinkIcon: Icon = createSpotifyIcon(() => (
  <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
));

export const CloseIcon: Icon = createSpotifyIcon(() => (
  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
));
export const CloseActiveIcon: Icon = CloseIcon;

export const UserIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
));
export const UserActiveIcon: Icon = UserIcon;

export const UserPlusIcon: Icon = createSpotifyIcon(() => (
  <path d="M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm2 0a6 6 0 1 0-12 0 6 6 0 0 0 12 0zm-8 8c-3.866 0-7 2.239-7 5a1 1 0 0 0 2 0c0-1.657 2.239-3 5-3s5 1.343 5 3a1 1 0 0 0 2 0c0-2.761-3.134-5-7-5zm12-4h-2V9a1 1 0 1 0-2 0v3h-2a1 1 0 1 0 0 2h2v3a1 1 0 1 0 2 0v-3h2a1 1 0 1 0 0-2z" />
));

export const ClockIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.75-13h-1.5v6l5.25 3.15.75-1.23-4.5-2.67z" />
));

export const ShareIcon: Icon = createSpotifyIcon(() => (
  <>
    <path d="M11.25 3.06a.75.75 0 0 1 1.5 0v10.19l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V3.06z" />
    <path d="M4.5 14.25a.75.75 0 0 1 .75.75v4.5h13.5V15a.75.75 0 0 1 1.5 0v5.25a.75.75 0 0 1-.75.75h-15a.75.75 0 0 1-.75-.75V15a.75.75 0 0 1 .75-.75z" />
  </>
));

export const CloudIcon: Icon = createSpotifyIcon(() => (
  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z" />
));

/* ── Monochrome Social Media Icons (from Figma Monochrome Set) ─────── */
export const InstagramIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
));

export const TwitterIcon: Icon = createSpotifyIcon(() => (
  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
));
export const XIcon: Icon = TwitterIcon;

export const FacebookIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" />
));

export const WikipediaIcon: Icon = createSpotifyIcon(() => (
  <path d="M12.09 13.124l2.42-6.505h1.928l-3.324 8.784-2.15-5.69-2.164 5.69-3.339-8.784h2.02l2.43 6.505 1.055-2.795-.733-1.97-.47-1.26h2.247l.51 1.34 1.09 2.89zm9.91-6.505l-4.148 11.026h-1.996l2.97-7.85-2.02-5.176h2.046l1.09 2.89 1.054-2.795.734-1.97.47-1.26h2.246l-.51 1.34-1.936 3.795zm-17.91 0l-4.09 11.026h-1.996l4.148-11.026h1.938z" />
));

export const SpotifyIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.627.627 0 0 1-.86.208c-2.355-1.439-5.32-1.765-8.813-.967a.627.627 0 1 1-.28-1.223c3.824-.874 7.108-.5 9.745 1.122a.627.627 0 0 1 .208.86zm1.226-2.724a.784.784 0 0 1-1.08.258c-2.697-1.658-6.809-2.138-9.998-1.17a.784.784 0 0 1-.462-1.498c3.644-1.106 8.188-.573 11.282 1.33a.784.784 0 0 1 .258 1.08zm.106-2.836C14.69 8.94 9.362 8.765 6.27 9.703a.94.94 0 1 1-.55-1.799c3.551-1.079 9.429-.877 13.167 1.343a.941.941 0 0 1-.97 1.617z" />
));

export const YouTubeIcon: Icon = createSpotifyIcon(() => (
  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
));
export const YouTubeMusicIcon: Icon = YouTubeIcon;

export const TikTokIcon: Icon = createSpotifyIcon(() => (
  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.86 4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.52 4.8 4.8 0 0 1-.96-.75 4.8 4.8 0 0 1-.84-1.25 4.9 4.9 0 0 1-.2-.9z" />
));

export const DiscordIcon: Icon = createSpotifyIcon(() => (
  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
));

export const GitHubIcon: Icon = createSpotifyIcon(() => (
  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
));

export const GoogleIcon: Icon = createSpotifyIcon(() => (
  <>
    <path fill="#4285F4" d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.396 3.622v3.01h3.878c2.269-2.089 3.58-5.165 3.58-8.819Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.956-1.075 7.94-2.908l-3.878-3.01c-1.075.72-2.45 1.145-4.062 1.145-3.125 0-5.77-2.11-6.714-4.945H1.276v3.109A11.995 11.995 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.286 14.282A7.212 7.212 0 0 1 4.91 12c0-.792.136-1.562.376-2.282V6.609H1.276A11.995 11.995 0 0 0 0 12c0 1.936.464 3.769 1.276 5.391l4.01-3.109Z" />
    <path fill="#EA4335" d="M12 4.773c1.762 0 3.344.605 4.587 1.794l3.442-3.442C17.951 1.19 15.235 0 12 0 7.309 0 3.251 2.69 1.276 6.609l4.01 3.109C6.23 6.882 8.875 4.773 12 4.773Z" />
  </>
));

export const LastFmIcon: Icon = createSpotifyIcon(() => (
  <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.62-3.932l-1.757-.385c-1.21-.275-1.567-.77-1.567-1.594 0-.934.742-1.485 1.952-1.485 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.869.907 1.869 1.694 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.749c-1.155-3.573-3-4.893-6.653-4.893C2.008 5.977 0 8.424 0 12.597c0 4.013 2.063 6.184 5.774 6.184 2.997 0 4.435-1.402 4.435-1.402l.375-.169z" />
));

export const GlobalIcon: Icon = createSpotifyIcon(() => (
  <g fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </g>
));
export const GlobeIcon: Icon = GlobalIcon;

export const ArrowUpRightIcon: Icon = createSpotifyIcon(() => (
  <path fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7v10" />
));

export const InAppFullscreenIcon: Icon = createSpotifyIcon(() => (
  <path fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
));

