import { useRef, useState, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { FriendActivityIcon, LoginIcon, RefreshIcon, SettingsIcon, UserIcon } from "@/ui/icons";
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
import { useAuthProfile } from "../../lib/authProfile";
import { usePlayerUIState, playerUIStore } from "../stores/playerUIStore";
import openTuneText from "../../../assets/img/opentune-text.png";
import { SearchBar } from "./SearchBar";
import type { Playlist } from "../../datasource/types";

interface TitleBarProps {
  sidebarWidth: number;
  isHomeActive: boolean;
  onNavigateHome: () => void;
  onOpenSettings: () => void;
  onOpenProfile?: () => void;
  onOpenDownloads?: () => void;
  onSearch?: (query: string, openInNewTab?: boolean) => void;
  onOpenSearch?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  onNavigatePlaylist?: (playlist: Playlist) => void;
  hasUpdateAvailable?: boolean;
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
  onOpenProfile,
  onOpenDownloads,
  onSearch,
  onOpenSearch,
  canGoBack = false,
  canGoForward = false,
  onNavigateBack = () => {},
  onNavigateForward = () => {},
  onNavigatePlaylist,
  hasUpdateAvailable = false,
}: TitleBarProps) {
  const appWindow = getCurrentWindow();
  const libraryState = useLibraryState();
  const account = libraryState.library?.account;
  const isSignedIn = Boolean(account) && libraryState.status !== "signed-out";
  const isConnecting = !isSignedIn
    && (libraryState.status === "restoring"
      || libraryState.status === "loading"
      || libraryState.status === "authorizing");
  const { profile: cloudProfile, signOut: signOutCloud } = useAuthProfile();
  const playerUIState = usePlayerUIState();
  const hasUserAccount = Boolean(cloudProfile || isSignedIn);
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
  const friendActivityVisible = useToolbarItemVisible("friendActivity");
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
    <div className="relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-stretch bg-shell">
      <button
        type="button"
        className={cn(
          "flex shrink-0 items-center gap-2.5 pl-5 pr-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset group cursor-pointer",
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
        aria-label="OpenTune Home"
        aria-current={isHomeActive ? "page" : undefined}
      >
        <img
          className="h-5 w-auto object-contain select-none transition-opacity group-hover:opacity-85 translate-y-1"
          src={openTuneText}
          alt="OpenTune"
        />
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
      <div className="flex shrink-0 items-center gap-1 px-2" aria-label="App actions">
        {/* Integration toggles */}
        {notificationsVisible && (
          <NotificationsPanel signedIn={libraryState.status === "ready"} />
        )}
        {hasUpdateAvailable && (
          <Tooltip side="bottom" content="New OpenTune update available!">
            <button
              type="button"
              aria-label="Update Available"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 rounded-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/40 px-2.5 py-1 text-xs font-semibold transition cursor-pointer shadow-sm"
            >
              <RefreshIcon size={13} className="text-primary" />
              <span>Update</span>
            </button>
          </Tooltip>
        )}
        {friendActivityVisible && (
          <Tooltip side="bottom" content="Friend Activity">
            <button
              type="button"
              aria-label="Friend Activity"
              aria-pressed={playerUIState.isListeningActivityOpen}
              onClick={() => playerUIStore.toggleListeningActivity()}
              className={cn(
                "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
                playerUIState.isListeningActivityOpen && "text-foreground bg-card shadow-sm ring-1 ring-border/50",
              )}
            >
              <FriendActivityIcon size={18} />
            </button>
          </Tooltip>
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
            <Tooltip side="bottom" content={hasUserAccount ? (cloudProfile?.username || account?.name || "Account") : "Sign in"}>
              <button
                type="button"
                onClick={() => setIsAccountPanelOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isAccountPanelOpen}
                aria-label={hasUserAccount ? `Account: ${cloudProfile?.username || account?.name || "User"}` : "Sign in"}
                className={cn(
                  "ml-0.5 grid size-7 place-items-center rounded-full transition-shadow",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
                  isAccountPanelOpen && "ring-1 ring-border",
                )}
              >
                <AccountAvatar
                  artworkUrl={cloudProfile?.avatarUrl ?? (isSignedIn ? account?.artworkUrl : undefined)}
                  className="size-7"
                  iconSize={15}
                />
              </button>
            </Tooltip>
          }
        >
          {hasUserAccount ? (
            <div className="flex flex-col gap-1">
              {/* OpenTune Cloud Profile if logged in */}
              {cloudProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setIsAccountPanelOpen(false);
                    onOpenProfile?.();
                  }}
                  className="flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-card/90 group cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AccountAvatar artworkUrl={cloudProfile.avatarUrl ?? undefined} className="size-9" iconSize={18} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {cloudProfile.username}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {cloudProfile.email || "OpenTune Cloud"}
                      </span>
                    </span>
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5 group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                    Profile &rarr;
                  </span>
                </button>
              )}

              {/* YouTube Music Account */}
              {isSignedIn ? (
                <>
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-card/60 border border-border/40">
                    <AccountAvatar artworkUrl={account?.artworkUrl} className="size-7" iconSize={15} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-xs font-medium text-foreground">
                        {account?.name || "YouTube Music"}
                      </span>
                      <span className="truncate text-[10px] text-emerald-400 font-medium">● YouTube Connected</span>
                    </span>
                  </div>

                  <span className="my-0.5 h-px bg-border" aria-hidden="true" />

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
                </>
              ) : (
                <button
                  type="button"
                  className={ACCOUNT_PANEL_ITEM}
                  onClick={() => {
                    setIsAccountPanelOpen(false);
                    onOpenSettings();
                  }}
                >
                  <span className="text-xs text-muted-foreground hover:text-foreground">
                    Connect YouTube Music in Settings &rarr;
                  </span>
                </button>
              )}

              <span className="my-0.5 h-px bg-border" aria-hidden="true" />

              {onOpenProfile && (
                <button
                  type="button"
                  className={ACCOUNT_PANEL_ITEM}
                  onClick={() => {
                    setIsAccountPanelOpen(false);
                    onOpenProfile();
                  }}
                >
                  <UserIcon size={16} aria-hidden="true" />
                  View profile
                </button>
              )}

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
                  if (cloudProfile) void signOutCloud();
                  if (isSignedIn) void libraryController.signOut();
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
                className="mt-3 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
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