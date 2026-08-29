import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { DiscordIcon, GitHubIcon, LoginIcon, SettingsIcon, YouTubeMusicIcon } from "@/ui/icons";
import { GITHUB_REPOSITORY_URL } from "../links";
import { DiscordRpcService } from "../../player/DiscordRPC";
import { useDiscordPresenceEnabled } from "../settings/discord";
import { setYouTubeScrobbling, useYouTubeScrobbling } from "../settings/youtubeAccount";
import { logInternalError, logInternalInfo, logInternalWarn } from "../../internal/logging";
import {
  isLinux,
  isTilingWindowManager,
  subscribeTilingWindowManager,
} from "../platform";
import { MusicTabs } from "./MusicTabs";
import type { Tab } from "../types/tab";
import {
  useForceWindowControls,
  useNativeWindowControls,
  useWindowsStyleWindowControls,
} from "../settings/windowControls";
import { Button } from "@/components/motion/button";
import { libraryController, useLibraryState } from "../../player/playerStore";
import { AccountAvatar, AccountSwitcher, GoogleAccountSwitcher } from "./AccountSwitcher";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { DownloadsPanel } from "./DownloadsPanel";
import { FloatingPanel } from "./FloatingPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { useToolbarItemVisible } from "../settings/toolbarItems";
import { motion } from "motion/react";
import { supabase } from "../../lib/supabaseClient";
import appIcon from "../../../assets/img/logo2-noBG.png";

interface TitleBarProps {
  tabs: Tab[];
  activeTabId: string;
  playingTabId: string | null;
  nonClosableTabId?: string | null;
  sidebarWidth: number;
  isHomeActive: boolean;
  onNavigateHome: () => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, insertAfter: boolean) => void;
  onOpenSettings: () => void;
  onOpenDownloads?: () => void;
  onboardingFirstTabId?: string;
}

const ACCOUNT_PANEL_ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** macOS-style traffic lights vs Windows-style square controls. */
const WINDOW_BUTTON_BASE =
  "flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TitleBar({
  tabs,
  activeTabId,
  playingTabId,
  nonClosableTabId,
  sidebarWidth,
  isHomeActive,
  onNavigateHome,
  onCreateTab,
  onCloseTab,
  onSwitchTab,
  onReorderTab,
  onOpenSettings,
  onOpenDownloads,
  onboardingFirstTabId,
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
  const [supabaseAuthState, setSupabaseAuthState] = useState<"idle" | "email" | "oauth">("idle");
  const [supabaseEmail, setSupabaseEmail] = useState("");
  const [supabasePassword, setSupabasePassword] = useState("");
  const [supabaseBusy, setSupabaseBusy] = useState(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
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
  const discordEnabled = useDiscordPresenceEnabled();
  const ytScrobblingEnabled = useYouTubeScrobbling();
  const notificationsVisible = useToolbarItemVisible("notifications");
  const downloadsVisible = useToolbarItemVisible("downloads");
  const discordVisible = useToolbarItemVisible("discord");
  const ytMusicVisible = useToolbarItemVisible("ytmusic");
  const githubVisible = useToolbarItemVisible("github");
  const homePointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressHomeClickRef = useRef(false);
  const hideHomeText = sidebarWidth <= 120;

  const startWindowDrag = async () => {
    try {
      window.dispatchEvent(new Event("main-window-drag-started"));

      if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
      }

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
      if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    } catch (error) {
      logInternalError("TitleBar.maximize failed", error);
    }
  };

  // Supabase auth state sync
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, _session) => {
      // Session changes are handled by the auth UI state
      // This keeps the UI in sync if auth happens elsewhere
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSupabaseEmailAuth = async (isSignUp: boolean) => {
    if (!supabase || !supabaseEmail.trim() || !supabasePassword.trim()) return;
    setSupabaseBusy(true);
    setSupabaseError(null);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: supabaseEmail,
          password: supabasePassword,
        });
        if (error) throw error;
        setSupabaseAuthState("idle");
        setSupabaseEmail("");
        setSupabasePassword("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: supabaseEmail,
          password: supabasePassword,
        });
        if (error) throw error;
        setSupabaseAuthState("idle");
        setSupabaseEmail("");
        setSupabasePassword("");
      }
    } catch (error) {
      setSupabaseError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setSupabaseBusy(false);
    }
  };

  const handleSupabaseOAuth = async (provider: "google" | "discord" | "spotify") => {
    if (!supabase) return;
    setSupabaseBusy(true);
    setSupabaseError(null);
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          scopes: provider === "spotify" 
            ? "playlist-read-private playlist-read-collaborative user-read-email"
            : undefined,
        },
      });
      if (error) throw error;
    } catch (error) {
      setSupabaseError(error instanceof Error ? error.message : "OAuth failed");
      setSupabaseBusy(false);
    }
  };

  return (
    <div className="relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-stretch bg-background">
      <button
        type="button"
        style={{ width: `${sidebarWidth}px` }}
        className={cn(
          "flex shrink-0 items-center gap-1 px-4 text-sm font-bold  transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
          isHomeActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
          hideHomeText && "justify-center gap-0 px-0",
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
        aria-label="Home"
        aria-current={isHomeActive ? "page" : undefined}
      >
         <motion.img
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="size-6 "
          src={appIcon}
          alt=""
        /> 
        {!hideHomeText && <h3 >amber_</h3>}
      </button>

      <MusicTabs
        tabs={tabs}
        activeTabId={activeTabId}
        playingTabId={playingTabId}
        nonClosableTabId={nonClosableTabId}
        onCreateTab={onCreateTab}
        onCloseTab={onCloseTab}
        onSwitchTab={onSwitchTab}
        onReorderTab={onReorderTab}
        onboardingFirstTabId={onboardingFirstTabId}
      />

      <div
        className="min-w-6 flex-1"
        aria-label="Drag window"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          void startWindowDrag();
        }}
        onDoubleClick={() => void handleToggleMaximize()}
      />

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
        {discordVisible && (
        <Tooltip
          side="bottom"
          content={discordEnabled ? "Discord presence on" : "Discord presence off"}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void DiscordRpcService.setEnabled(!discordEnabled)}
            aria-pressed={discordEnabled}
            aria-label={
              discordEnabled ? "Turn off Discord presence" : "Turn on Discord presence"
            }
          >
            <DiscordIcon
              size={16}
              aria-hidden="true"
              className={cn(
                "transition-opacity",
                discordEnabled ? "opacity-100 text-primary" : "opacity-40",
              )}
            />
          </Button>
        </Tooltip>
        )}
        {ytMusicVisible && (
        <Tooltip
          side="bottom"
          content={
            ytScrobblingEnabled
              ? "Adding plays to YouTube Music history"
              : "Not adding plays to YouTube Music history"
          }
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setYouTubeScrobbling(!ytScrobblingEnabled)}
            aria-pressed={ytScrobblingEnabled}
            aria-label={
              ytScrobblingEnabled
                ? "Stop adding plays to YouTube Music history"
                : "Add plays to YouTube Music history"
            }
          >
            <YouTubeMusicIcon
              size={16}
              aria-hidden="true"
              className={cn(
                "transition-opacity",
                ytScrobblingEnabled ? "opacity-100 text-primary" : "opacity-40",
              )}
            />
          </Button>
        </Tooltip>
        )}

        {githubVisible && (
        <Tooltip side="bottom" content="Source on GitHub">
          <Button
            variant='ghost'
          size='icon'
            onClick={() => void openUrl(GITHUB_REPOSITORY_URL)}
            aria-label="Open the project on GitHub"
          >
            <GitHubIcon size={16} aria-hidden="true"  />
          </Button>
        </Tooltip>
        )}
        <Tooltip side="bottom" content="Settings">
        <Button
            variant='ghost'
          size='icon'
            
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <SettingsIcon size={17} aria-hidden="true" />
          </Button>
        </Tooltip>

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

              {/* Supabase Account (Amber Account) */}
              {supabase ? (
                <div className="px-1 py-1">
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Amber Account
                  </p>
                  <SupabaseAuthPanel
                    supabaseAuthState={supabaseAuthState}
                    setSupabaseAuthState={setSupabaseAuthState}
                    supabaseEmail={supabaseEmail}
                    setSupabaseEmail={setSupabaseEmail}
                    supabasePassword={supabasePassword}
                    setSupabasePassword={setSupabasePassword}
                    supabaseBusy={supabaseBusy}
                    setSupabaseBusy={setSupabaseBusy}
                    supabaseError={supabaseError}
                    handleSupabaseEmailAuth={handleSupabaseEmailAuth}
                    handleSupabaseOAuth={handleSupabaseOAuth}
                  />
                </div>
              ) : (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Supabase not configured
                </p>
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
            </div>
          ) : (
            /*
             * Signed out, this panel is the way in, so it says what signing in gets you rather
             * than only offering a verb. The button hands off to settings because that screen
             * is where the device-code prompt is rendered — starting the flow from here would
             * put the code somewhere nobody is looking.
             */
            <div className="flex flex-col items-center gap-1 px-2 pb-2 pt-3 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                <LoginIcon size={20} aria-hidden="true" />
              </span>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {isConnecting ? "Connecting…" : "Not signed in"}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {isConnecting
                  ? "Restoring your YouTube Music session."
                  : "Connect YouTube Music for your library, playlists and likes."}
              </p>
              <GoogleSignInButton
                className="mt-2"
                fullWidth
                isBusy={isConnecting}
                onClick={() => {
                  setIsAccountPanelOpen(false);
                  onOpenSettings();
                }}
              />
              <span className="my-2 h-px bg-border w-full" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">Amber Account</p>
              <SupabaseAuthPanel
                supabaseAuthState={supabaseAuthState}
                setSupabaseAuthState={setSupabaseAuthState}
                supabaseEmail={supabaseEmail}
                setSupabaseEmail={setSupabaseEmail}
                supabasePassword={supabasePassword}
                setSupabasePassword={setSupabasePassword}
                supabaseBusy={supabaseBusy}
                setSupabaseBusy={setSupabaseBusy}
                supabaseError={supabaseError}
                handleSupabaseEmailAuth={handleSupabaseEmailAuth}
                handleSupabaseOAuth={handleSupabaseOAuth}
              />
            </div>
          )}
        </FloatingPanel>
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

function SupabaseAuthPanel({
  supabaseAuthState,
  setSupabaseAuthState,
  supabaseEmail,
  setSupabaseEmail,
  supabasePassword,
  setSupabasePassword,
  supabaseBusy,
  supabaseError,
  setSupabaseBusy,
  handleSupabaseEmailAuth,
  handleSupabaseOAuth,
}: {
  supabaseAuthState: "idle" | "email" | "oauth";
  setSupabaseAuthState: (state: "idle" | "email" | "oauth") => void;
  supabaseEmail: string;
  setSupabaseEmail: (email: string) => void;
  supabasePassword: string;
  setSupabasePassword: (password: string) => void;
  supabaseBusy: boolean;
  setSupabaseBusy: (busy: boolean) => void;
  supabaseError: string | null;
  handleSupabaseEmailAuth: (isSignUp: boolean) => void;
  handleSupabaseOAuth: (provider: "google" | "discord" | "spotify") => void;
}) {
  if (!supabase) return null;

  const [supabaseUser, setSupabaseUser] = useState<any>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setSupabaseUser(data.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSupabaseUser(session?.user ?? null);
    }) ?? { data: { subscription: { unsubscribe: () => {} } } };
    return () => sub.subscription.unsubscribe();
  }, []);

  if (supabaseUser) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground truncate">{supabaseUser.email}</span>
          <button className="rounded-full bg-card px-3 py-1.5 text-sm hover:bg-muted" onClick={async () => { setSupabaseBusy(true); await supabase.auth.signOut(); setSupabaseBusy(false); }}>Sign out</button>
        </div>
        <span className="text-xs text-muted-foreground">Signed in to Amber</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {supabaseAuthState === "email" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <input className="flex-1 min-w-36 rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ring-border" placeholder="Email" value={supabaseEmail} onChange={e => setSupabaseEmail(e.target.value)} />
            <input className="flex-1 min-w-36 rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ring-border" placeholder="Password" type="password" value={supabasePassword} onChange={e => setSupabasePassword(e.target.value)} />
            <button disabled={supabaseBusy} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => handleSupabaseEmailAuth(false)}>{supabaseBusy ? "..." : "Sign In"}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="flex-1 min-w-36 rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ring-border" placeholder="Email" value={supabaseEmail} onChange={e => setSupabaseEmail(e.target.value)} />
            <input className="flex-1 min-w-36 rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ring-border" placeholder="Password" type="password" value={supabasePassword} onChange={e => setSupabasePassword(e.target.value)} />
            <button disabled={supabaseBusy} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => handleSupabaseEmailAuth(true)}>{supabaseBusy ? "..." : "Sign Up"}</button>
          </div>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setSupabaseAuthState("oauth")}>Or continue with OAuth</button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button disabled={supabaseBusy} className="rounded-full bg-card px-4 py-2 text-sm hover:bg-muted" onClick={() => handleSupabaseOAuth("google")}>Google</button>
            <button disabled={supabaseBusy} className="rounded-full bg-card px-4 py-2 text-sm hover:bg-muted" onClick={() => handleSupabaseOAuth("discord")}>Discord</button>
            <button disabled={supabaseBusy} className="rounded-full bg-[#1DB954] px-4 py-2 text-sm text-white hover:opacity-90" onClick={() => handleSupabaseOAuth("spotify")}>Connect Spotify</button>
          </div>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setSupabaseAuthState("email")}>Or use email/password</button>
        </>
      )}
      {supabaseError && <p className="text-xs text-destructive">{supabaseError}</p>}
    </div>
  );
}
