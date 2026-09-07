import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import { SpinnerSteps } from "@/components/motion/loader";
import { CloseIcon, RefreshIcon, BookmarkIcon, BookmarkActiveIcon } from "@/ui/icons";
import type { FeedNotification } from "../../datasource/types";
import { libraryController, playerController } from "../../player/playerStore";
import { logInternalError } from "../../internal/logging";
import { FloatingPanel } from "./FloatingPanel";

const DISMISSED_STORAGE_KEY = "amber-dismissed-notifications";
const UNSEEN_POLL_MS = 60_000;

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
      }
    }
  } catch {}
  return new Set();
}

function saveDismissedIds(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {}
}

function getNotificationKeys(notification: FeedNotification): string[] {
  const keys: string[] = [];
  if (notification.id && notification.id !== "undefined") {
    keys.push(notification.id);
  }
  if (notification.videoId) {
    keys.push(`vid:${notification.videoId}`);
  }
  if (notification.text) {
    keys.push(`txt:${notification.text.trim()}`);
  }
  if (notification.videoId && notification.text) {
    keys.push(`combo:${notification.videoId}:${notification.text.trim()}`);
  }
  return keys;
}

function isNotificationDismissed(notification: FeedNotification, dismissedSet: Set<string>): boolean {
  const keys = getNotificationKeys(notification);
  return keys.some((key) => dismissedSet.has(key));
}

function NotificationRow({
  notification,
  onOpen,
  onDismiss,
}: {
  notification: FeedNotification;
  onOpen: (notification: FeedNotification) => void;
  onDismiss: (notification: FeedNotification) => void;
}) {
  const canOpen = Boolean(notification.videoId);

  return (
    <div className="group relative flex w-full items-center">
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 pr-9 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          canOpen ? "hover:bg-white/[0.06]" : "cursor-default",
          !notification.read && "bg-primary/[0.07]",
        )}
        disabled={!canOpen}
        onClick={() => onOpen(notification)}
      >
        {notification.thumbnailUrl ? (
          <img
            className="size-10 shrink-0 rounded-lg object-cover"
            src={notification.thumbnailUrl}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="size-10 shrink-0 rounded-lg bg-muted" aria-hidden="true" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm text-foreground">{notification.text}</span>
          {notification.sentAtText ? (
            <span className="text-xs text-muted-foreground">{notification.sentAtText}</span>
          ) : null}
        </span>
        {!notification.read && (
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
            aria-label="Unread"
          />
        )}
      </button>
      <button
        type="button"
        className="absolute right-2 top-2 grid size-6 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-white/[0.1] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Remove notification"
        title="Remove notification"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification);
        }}
      >
        <CloseIcon size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The account's notification inbox, as a toolbar button.
 *
 * The list is only fetched when the panel opens — it is a page of rendered HTML-ish content
 * nobody reads most sessions. Only the unseen *count* is polled, because that is what decides
 * whether the button is worth looking at.
 */
export function NotificationsPanel({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<FeedNotification[] | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(getDismissedIds);
  const [isLoading, setIsLoading] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const refreshUnseen = useCallback(() => {
    if (!signedIn) {
      setUnseen(0);
      return;
    }
    void libraryController.getUnseenNotificationCount()
      .then((count) => {
        setUnseen(count);
      })
      .catch(() => setUnseen(0));
  }, [signedIn]);

  useEffect(() => {
    // Defer initial check by 2.5s so startup rendering and immediate clicks have priority
    const initialTimer = window.setTimeout(refreshUnseen, 2500);
    const intervalId = window.setInterval(refreshUnseen, UNSEEN_POLL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [refreshUnseen]);

  const load = useCallback(() => {
    let active = true;
    setIsLoading(true);
    void libraryController.getNotifications()
      .then((fetched) => {
        if (active) {
          setNotifications(fetched);
          const currentDismissed = getDismissedIds();
          const unreadCount = fetched.filter(
            (item) => !isNotificationDismissed(item, currentDismissed) && !item.read,
          ).length;
          setUnseen(unreadCount);
        }
      })
      .catch((error: unknown) => {
        logInternalError("NotificationsPanel.load failed", error);
        if (active) setNotifications([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const cancel = load();
    setUnseen(0);
    return cancel;
  }, [load, open]);

  if (!signedIn) return null;

  const visibleNotifications = (notifications ?? []).filter(
    (item) => !isNotificationDismissed(item, dismissedIds),
  );

  const handleDismiss = (notification: FeedNotification) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const k of getNotificationKeys(notification)) {
        next.add(k);
      }
      saveDismissedIds(next);
      return next;
    });
  };

  const handleClearAll = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      const itemsToDismiss = [...visibleNotifications, ...(notifications ?? [])];
      for (const item of itemsToDismiss) {
        for (const k of getNotificationKeys(item)) {
          next.add(k);
        }
      }
      saveDismissedIds(next);
      return next;
    });
    setNotifications([]);
    setUnseen(0);
  };

  const handleOpen = (notification: FeedNotification) => {
    if (!notification.videoId) return;
    setOpen(false);
    void playerController.playTrackById(notification.videoId);
  };

  return (
    <FloatingPanel
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      className="w-96 max-w-[calc(100vw-2rem)] p-2"
      trigger={
        <Tooltip side="bottom" content="Notifications">
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={unseen > 0 ? `Notifications, ${unseen} unread` : "Notifications"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {unseen > 0 ? (
              <BookmarkActiveIcon size={16} aria-hidden="true" className="text-primary" />
            ) : (
              <BookmarkIcon size={16} aria-hidden="true" className="opacity-40" />
            )}
            {unseen > 0 && (
              <span
                className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-primary px-1 text-[10px] font-semibold leading-3.5 text-primary-foreground"
                aria-hidden="true"
              >
                {unseen > 9 ? "9+" : unseen}
              </span>
            )}
          </Button>
        </Tooltip>
      }
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {visibleNotifications.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={handleClearAll}
            >
              Clear all
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh notifications"
          disabled={isLoading}
          onClick={() => load()}
        >
          <RefreshIcon size={15} aria-hidden="true" />
        </Button>
      </div>

      {isLoading && !notifications ? (
        <div className="grid place-items-center py-10" role="status" aria-label="Loading">
          <SpinnerSteps size={24} color="currentColor" />
        </div>
      ) : visibleNotifications.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">
          Nothing new. Subscribe to artists to hear about their releases here.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {visibleNotifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={handleOpen}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </FloatingPanel>
  );
}
