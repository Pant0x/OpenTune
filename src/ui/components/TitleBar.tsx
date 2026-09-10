import { useRef, useState, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { LoginIcon, SettingsIcon } from "@/ui/icons";
import { logInternalError, logInternalInfo, logInternalWarn } from "../../internal/logging";
import {
  isLinux,
  isTilingWindowManager,
  subscribeTilingWindowManager,
} from "../platform";
import {
  useForceWindowControls,
  useNativeWindowControls,
  useWindowsStyleWindowControls,
} from "../settings/windowControls";
import { libraryController, useLibraryState } from "../../player/playerStore";
import { AccountAvatar, AccountSwitcher, GoogleAccountSwitcher } from "./AccountSwitcher";
import { DownloadsPanel } from "./DownloadsPanel";
import { FloatingPanel } from "./FloatingPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { useToolbarItemVisible } from "../settings/toolbarItems";
import { AuthModal } from "./AuthModal";
import appIcon from "../../../assets/img/logo2-noBG.png";
import { SearchBar } from "./SearchBar";
import type { Playlist } from "../../datasource/types";

interface TitleBarProps {
  sidebarWidth: number;
  isHomeActive: boolean;
  onNavigateHome: () => void;
  onOpenSettings: () => void;
  onOpenDownloads?: () => void;
  onSearch?: (query: string, openInNewTab?: boolean) => void;
  onOpenSearch?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  onNavigatePlaylist?: (playlist: Playlist) => void;
}

const ACCOUNT_PANEL_ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** macOS-style traffic lights vs Windows-style square controls. */
const WINDOW_BUTTON_BASE =
  "flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TitleBar({
  sidebarWidth: _sidebarWidth,
  isHomeActive,
  onNavigateHome,
  onOpenSettings,
  onOpenDownloads,
  onSearch,
  onOpenSearch,
  canGoBack = false,
  canGoForward = false,
  onNavigateBack = () => {},
  onNavigateForward = () => {},
  onNavigatePlaylist,
}: TitleBarProps) {
  const appWindow = getCurrentWindow();
  const libraryState = useLibraryState();
  const account = libraryState.library?.account;
  // Confirmed by YouTube, not merely by having a library on screen — a cache with no expiry
  // will happily supply one long after the session behind it stopped working.
  const isSignedIn = libraryState.status === "ready"
    && Boolean(account)
    && libraryState.sessionConfirmedAt !== null;
  // Startup restores the session before it can say whether there is one — "Not signed in" is
  // the wrong answer while that is still happening.
  const isConnecting = !isSignedIn
    && (libraryState.status === "restoring"
      || libraryState.status === "loading"
      || libraryState.status === "authorizing");
  const [isAccountPanelOpen, setIsAccountPanelOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const nativeWindowControls = useNativeWindowControls();
  const windowsStyleWindowControls = useWindowsStyleWindowControls();
  const forceWindowControls = useForceWindowControls();
  // On Linux, window management belongs to the compositor. Tiling compositors (niri, sway,
  // hyprland, …) have no minimize at all and draw nothing, so app buttons would be dead
  // weight; desktops like GNOME/KDE get the custom buttons so close/minimize stay reachable.
  // "Show window controls" in settings overrides this for anyone who wants the buttons anyway.
  const tilingWindowManager = useSyncExternalStore(
    subscribeTilingWindowManager,
    isTilingWindowManager,
    () => false,
  );
  const showCustomWindowControls = !nativeWindowControls
    && (!isLinux || !tilingWindowManager || forceWindowControls);
  const notificationsVisible = useToolbarItemVisible("notifications");
  const downloadsVisible = useToolbarItemVisible("downloads");
  const homePointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressHomeClickRef = useRef(false);

  const handleAuthSuccess = () => {
    setIsAuthModalOpen(false);
    setIsAccountPanelOpen(false);
  };

  const startWindowDrag = async () => {
    try {
      window.dispatchEvent(new Event("main-window-drag-started"));
      await appWindow.startDragging();
    } catch (error) {
      logInternalError("TitleBar.startWindowDrag failed", error);
    }
  };

  const handleMinimize = async () => {
    try {
      if (await appWindow.isFullscreen()) {
        await appWindow.setFullscreen(false);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      await appWindow.minimize();
    } catch (error) {
      logInternalError("TitleBar.minimize failed", error);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const isMax = await appWindow.isMaximized();
      if (isMax) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    } catch (error) {
      logInternalError("TitleBar.maximize failed", error);
      try {
        await appWindow.toggleMaximize();
      } catch (fallbackError) {
        logInternalError("TitleBar.toggleMaximize fallback failed", fallbackError);
      }
    }
  };

  return (
    <div className="relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-stretch bg-background">
      <button
        type="button"
        className={cn(
          "flex shrink-0 items-center gap-2.5 px-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset group cursor-pointer",
          isHomeActive ? "text-primary" : "text-foreground",
        )}
        onClick={() => {
          if (suppressHomeClickRef.current) {
            suppressHomeClickRef.current = false;
            return;
          }
          onNavigateHome();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          suppressHomeClickRef.current = false;
          homePointerRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pointer = homePointerRef.current;
          if (!pointer || pointer.pointerId !== event.pointerId) return;

          const distance = Math.hypot(
            event.clientX - pointer.startX,
            event.clientY - pointer.startY,
          );
          if (distance < 5) return;

          homePointerRef.current = null;
          suppressHomeClickRef.current = true;
          void startWindowDrag();
        }}
        onPointerUp={(event) => {
          if (homePointerRef.current?.pointerId === event.pointerId) {
            homePointerRef.current = null;
          }
        }}
        onPointerCancel={() => {
          homePointerRef.current = null;
        }}
        aria-label="Amber Home"
        aria-current={isHomeActive ? "page" : undefined}
      >
        <div className="relative flex size-7 shrink-0 items-center justify-center">
          <img
            className="size-7 object-contain"
            src={appIcon}
            alt="Amber"
          />
        </div>
        <span className="font-kablammo text-lg font-normal tracking-wide text-foreground leading-none pt-0.5 select-none">
          Amber
        </span>
      </button>

      <div
        data-tauri-drag-region=""
        className="flex min-w-0 flex-1 items-center justify-center cursor-default select-none h-full"
        aria-label="Drag window"
      />

      {/* Mathematically Centered Search Bar across entire window width */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
        <div data-tauri-drag-region="none" className="w-full max-w-lg pointer-events-auto px-4">
          <SearchBar
            onSearch={onSearch}
            onOpen={onOpenSearch}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onBack={onNavigateBack}
            onForward={onNavigateForward}
            onNavigatePlaylist={onNavigatePlaylist}
          />
        </div>
      </div>

      {/*
        App actions sit immediately left of the window controls, separated by a hairline so
        "things that act on the app" and "things that act on the window" stay legible as two
        groups. They render regardless of the native-controls setting, since on Linux/native
        chrome the window buttons disappear but these still belong here.
      */}
      <div className="flex shrink-0 items-center gap-1 pl-2 pr-1" aria-label="App actions">
        {/*
          Integration toggles.

          Both share what the user is listening to with a third party, which is exactly the kind
          of thing worth being able to stop in one click rather than three — hence a toolbar
          toggle rather than only a setting buried in a panel. Dimmed when off so the current
          state reads at a glance without a label.
        */}
        {notificationsVisible && (
          <NotificationsPanel signedIn={libraryState.status === "ready"} />
        )}
        {downloadsVisible && <DownloadsPanel onOpenDownloads={onOpenDownloads} />}

        {/* Only once signed in: an avatar that opens nothing is worse than no avatar. The
            panel is portalled because the title bar clips its children. */}
        {/* Always present, signed in or not: when signed out it is the way *in*, so hiding
            it would leave the toolbar with no account affordance at all. */}
        <FloatingPanel
          open={isAccountPanelOpen}
          onOpenChange={setIsAccountPanelOpen}
          side="bottom"
          className="w-64"
          trigger={
            <Tooltip side="bottom" content={isSignedIn ? account?.name || "Account" : "Sign in"}>
              <button
                type="button"
                onClick={() => setIsAccountPanelOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isAccountPanelOpen}
                aria-label={isSignedIn ? `Account: ${account?.name || "YouTube Music"}` : "Sign in"}
                className={cn(
                  "ml-0.5 grid size-7 place-items-center rounded-full transition-shadow",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isAccountPanelOpen && "ring-1 ring-border",
                )}
              >
                <AccountAvatar
                  artworkUrl={isSignedIn ? account?.artworkUrl : undefined}
                  className="size-7"
                  iconSize={15}
                />
              </button>
            </Tooltip>
          }
        >
          {isSignedIn ? (
            <div className="flex flex-col gap-1">
              {/* YouTube Music Account */}
              <div className="flex items-center gap-2.5 px-1 py-1.5">
                <AccountAvatar artworkUrl={account?.artworkUrl} className="size-9" iconSize={18} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {account?.name || "YouTube Music"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">YouTube Music</span>
                </span>
              </div>

              <span className="my-0.5 h-px bg-border" aria-hidden="true" />

              {/* Separate Google logins first, channels within the active one after — labeled
                  so the two are never mistaken for one undifferentiated list. This is a quick
                  switcher, not where accounts are added or removed, so a section (label
                  included) renders nothing at all when there is only one option in it. */}
              <GoogleAccountSwitcher
                libraryController={libraryController}
                onSwitched={() => setIsAccountPanelOpen(false)}
                label="Account"
              />

              <AccountSwitcher
                libraryController={libraryController}
                onSwitched={() => setIsAccountPanelOpen(false)}
                label="Channel"
              />

              <span className="my-0.5 h-px bg-border" aria-hidden="true" />

              <button
                type="button"
                className={ACCOUNT_PANEL_ITEM}
                onClick={() => {
                  setIsAccountPanelOpen(false);
                  onOpenSettings();
                }}
              >
                <SettingsIcon size={16} aria-hidden="true" />
                Account settings
              </button>

              <button
                type="button"
                className={ACCOUNT_PANEL_ITEM}
                onClick={() => {
                  setIsAccountPanelOpen(false);
                  void libraryController.signOut();
                }}
              >
                <LoginIcon size={16} aria-hidden="true" />
                Sign out
              </button>
            </div>
          ) : (
            /*
             * Signed out, this panel is the way in, so it says what signing in gets you rather
             * than only offering a verb. The button hands off to settings because that screen
             * is where the device-code prompt is rendered — starting the flow from here would
             * put the code somewhere nobody is looking.
             */
            <div className="flex flex-col items-center gap-1.5 px-2 pb-2 pt-3 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                <LoginIcon size={20} aria-hidden="true" />
              </span>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {isConnecting ? "Connecting…" : "Not signed in"}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sign in to access your library, playlists and favorites.
              </p>
              <button
                type="button"
                className="mt-3 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setIsAccountPanelOpen(false);
                  setIsAuthModalOpen(true);
                }}
              >
                Sign In / Sign Up
              </button>
            </div>
          )}
        </FloatingPanel>
      
      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
      </div>

      {showCustomWindowControls && (
        <span className="my-3 w-px shrink-0 bg-border" aria-hidden="true" />
      )}

      {showCustomWindowControls && (
        <div
          className={cn(
            "flex shrink-0 items-center",
            windowsStyleWindowControls ? "gap-0" : "gap-1.5 px-3",
          )}
          aria-label="Window controls"
        >
          <button
            type="button"
            aria-label="Minimize"
            className={cn(
              WINDOW_BUTTON_BASE,
              windowsStyleWindowControls
                ? "h-full w-12 hover:bg-card"
                : "size-3 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground",
            )}
            onClick={() => void handleMinimize()}
          >
            {windowsStyleWindowControls && <span aria-hidden="true">&#8211;</span>}
          </button>
          <button
            type="button"
            aria-label="Maximize"
            className={cn(
              WINDOW_BUTTON_BASE,
              windowsStyleWindowControls
                ? "h-full w-12 hover:bg-card"
                : "size-3 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground",
            )}
            onClick={() => void handleToggleMaximize()}
          >
            {windowsStyleWindowControls && <span aria-hidden="true">□</span>}
          </button>
          <button
            type="button"
            aria-label="Close"
            className={cn(
              WINDOW_BUTTON_BASE,
              windowsStyleWindowControls
                ? "h-full w-12 hover:bg-destructive hover:text-destructive-foreground"
                : "size-3 rounded-full bg-muted-foreground/40 hover:bg-primary",
            )}
            onClick={() => {
              logInternalInfo("TitleBar.close clicked");
              try {
                window.dispatchEvent(new Event("beforeunload"));
              } catch {}
              void invoke("quit_app")
                .then(() => {
                  logInternalInfo("TitleBar.close quit_app invoked");
                })
                .catch((error) => {
                  logInternalError("TitleBar.close quit_app failed", error);
                  logInternalWarn("TitleBar.close fallback to appWindow.close");
                  void appWindow.close();
                });
            }}
          >
            {windowsStyleWindowControls && <span aria-hidden="true">&#10005;</span>}
          </button>
        </div>
      )}
    </div>
  );
}