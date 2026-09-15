import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import { SpinnerSteps } from "@/components/motion/loader";
import { CloseIcon, RefreshIcon, BellIcon, BellActiveIcon } from "@/ui/icons";
import type { FeedNotification } from "../../datasource/types";
import { libraryController, playerController } from "../../player/playerStore";
import { logInternalError } from "../../internal/logging";
import { FloatingPanel } from "./FloatingPanel";

const DISMISSED_STORAGE_KEY = "amber-dismissed-notifications";
const SEEN_STORAGE_KEY = "amber-seen-notifications-v2";
const LAST_SEEN_AT_KEY = "amber_notifications_last_seen_at";
const UNSEEN_POLL_MS = 60_000;

let cachedNotifications: FeedNotification[] | null = null;

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

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
      }
    }
  } catch {}
  return new Set();
}

function saveSeenIds(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...ids].slice(-250)));
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

function isNotificationSeen(notification: FeedNotification, seenSet: Set<string>): boolean {
  const keys = getNotificationKeys(notification);
  return keys.some((key) => seenSet.has(key));
}

function isStaleLiveNotification(notification: FeedNotification): boolean {
  const txt = notification.text.toLowerCase();
  const isLive = txt.includes("is live") || txt.includes("بث مباشر");
  if (!isLive) return false;
  const time = (notification.sentAtText || "").toLowerCase();
  return (
    time.includes("day") ||
    time.includes("week") ||
    time.includes("month") ||
    time.includes("year") ||
    time.includes("يوم") ||
    time.includes("أيام") ||
    time.includes("اسبوع") ||
    time.includes("شهر")
  );
}

function parseRelativeTimeMs(text?: string): number {
  if (!text) return 0;
  let s = text.toLowerCase().trim();
  s = s.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString());
  const now = Date.now();

  if (s.includes("just now") || s.includes("الآن")) return now;

  const numMatch = s.match(/\d+/);
  const n = numMatch ? parseInt(numMatch[0], 10) : 1;

  if (/(sec|ثان)/i.test(s)) return now - n * 1000;
  if (/(min|دقيق|دقائق)/i.test(s)) return now - (s.includes("دقيقتين") ? 2 : n) * 60 * 1000;
  if (/(hour|ساع)/i.test(s)) return now - (s.includes("ساعتين") ? 2 : n) * 3600 * 1000;
  if (/(day|يوم|أيام|ايام)/i.test(s)) return now - (s.includes("يومين") ? 2 : n) * 86400 * 1000;
  if (/(week|أسبوع|اسبوع|أسابيع|اسابيع)/i.test(s)) return now - (/(أسبوعين|اسبوعين)/.test(s) ? 2 : n) * 7 * 86400 * 1000;
  if (/(month|شهر|أشهر|اشهر|شهور)/i.test(s)) return now - (s.includes("شهرين") ? 2 : n) * 30 * 86400 * 1000;
  if (/(year|سن|أعوام|اعوام)/i.test(s)) return now - (s.includes("سنتين") ? 2 : n) * 365 * 86400 * 1000;

  return 0;
}

function sortNotificationsNewestFirst(items: FeedNotification[]): FeedNotification[] {
  return [...items].sort((a, b) => {
    const timeA = parseRelativeTimeMs(a.sentAtText);
    const timeB = parseRelativeTimeMs(b.sentAtText);
    if (timeA && timeB) return timeB - timeA;
    if (timeA) return -1;
    if (timeB) return 1;
    return 0;
  });
}

function isClearedBefore(notification: FeedNotification, clearedAt: number): boolean {
  if (clearedAt <= 0) return false;
  const time = parseRelativeTimeMs(notification.sentAtText);
  if (time > 0 && time < clearedAt - 60_000) {
    return true;
  }
  return false;
}

function computeUnseenCount(
  items: FeedNotification[],
  dismissed: Set<string>,
  seen: Set<string>,
  clearedAt: number,
): number {
  return items.filter(
    (item) =>
      !isNotificationDismissed(item, dismissed) &&
      !isNotificationSeen(item, seen) &&
      !item.read &&
      !isStaleLiveNotification(item) &&
      !isClearedBefore(item, clearedAt),
  ).length;
}

function NotificationRow({
  notification,
  isSeen,
  onOpen,
  onDismiss,
}: {
  notification: FeedNotification;
  isSeen: boolean;
  onOpen: (notification: FeedNotification) => void;
  onDismiss: (notification: FeedNotification) => void;
}) {
  const canOpen = Boolean(notification.videoId);
  const isUnread = !notification.read && !isSeen;

  return (
    <div className="group relative flex w-full items-center">
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 pr-9 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          canOpen ? "hover:bg-white/[0.06]" : "cursor-default",
          isUnread && "bg-primary/[0.07]",
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
        {isUnread && (
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary shadow-sm shadow-primary/50"
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
 */
export function NotificationsPanel({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<FeedNotification[] | null>(() => cachedNotifications);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(getDismissedIds);
  const [seenIds, setSeenIds] = useState<Set<string>>(getSeenIds);
  const [isLoading, setIsLoading] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const markCurrentAsSeen = useCallback((items: FeedNotification[]) => {
    setSeenIds((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        for (const k of getNotificationKeys(item)) {
          next.add(k);
        }
      }
      saveSeenIds(next);
      return next;
    });
    setUnseen(0);
    try {
      localStorage.setItem(LAST_SEEN_AT_KEY, Date.now().toString());
    } catch {}
    void libraryController.clearNotifications();
  }, []);

  const refreshUnseen = useCallback(() => {
    if (!signedIn) {
      setUnseen(0);
      return;
    }
    const clearedAt = Number(localStorage.getItem("amber_notifications_cleared_at") || 0);
    void libraryController.getNotifications()
      .then((fetched) => {
        const sorted = sortNotificationsNewestFirst(fetched);
        cachedNotifications = sorted;
        setNotifications(sorted);
        const currentDismissed = getDismissedIds();
        const currentSeen = getSeenIds();
        const unreadCount = computeUnseenCount(sorted, currentDismissed, currentSeen, clearedAt);
        setUnseen(unreadCount);
      })
      .catch(() => {
        if (clearedAt > 0) {
          setUnseen(0);
          return;
        }
        void libraryController.getUnseenNotificationCount()
          .then((count) => {
            const currentSeen = getSeenIds();
            if (currentSeen.size > 0 && count > 0) {
              // Only surface if unseen count exceeds seen knowledge
              setUnseen(0);
            } else {
              setUnseen(count);
            }
          })
          .catch(() => setUnseen(0));
      });
  }, [signedIn]);

  useEffect(() => {
    // Check unseen on start after short settle delay
    const initialTimer = window.setTimeout(refreshUnseen, 2000);
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
          const sorted = sortNotificationsNewestFirst(fetched);
          cachedNotifications = sorted;
          setNotifications(sorted);
          const currentDismissed = getDismissedIds();
          const currentSeen = getSeenIds();
          const clearedAt = Number(localStorage.getItem("amber_notifications_cleared_at") || 0);
          if (open) {
            markCurrentAsSeen(sorted);
          } else {
            setUnseen(computeUnseenCount(sorted, currentDismissed, currentSeen, clearedAt));
          }
        }
      })
      .catch((error: unknown) => {
        logInternalError("NotificationsPanel.load failed", error);
        if (active && !cachedNotifications) setNotifications([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, markCurrentAsSeen]);

  useEffect(() => {
    if (!open) return;
    setUnseen(0);
    const cancel = load();
    return cancel;
  }, [load, open]);

  if (!signedIn) return null;

  const clearedAt = Number(localStorage.getItem("amber_notifications_cleared_at") || 0);

  const visibleNotifications = sortNotificationsNewestFirst(
    (notifications ?? []).filter(
      (item) =>
        !isNotificationDismissed(item, dismissedIds) &&
        !isStaleLiveNotification(item) &&
        !isClearedBefore(item, clearedAt),
    ),
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
    void libraryController.clearNotifications();
    const now = Date.now();
    try {
      localStorage.setItem("amber_notifications_cleared_at", now.toString());
      localStorage.setItem(LAST_SEEN_AT_KEY, now.toString());
    } catch {}
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
    cachedNotifications = [];
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
      className="w-96 max-w-[calc(100vw-2rem)] p-3 rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl"
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
              <BellActiveIcon size={18} aria-hidden="true" className="text-primary" />
            ) : (
              <BellIcon size={18} aria-hidden="true" className="text-muted-foreground hover:text-foreground transition-colors" />
            )}
            {unseen > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground shadow-sm shadow-primary/40 animate-in zoom-in-50 duration-200"
                aria-hidden="true"
              >
                {unseen > 9 ? "9+" : unseen}
              </span>
            )}
          </Button>
        </Tooltip>
      }
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2 pt-0.5 border-b border-white/[0.08] mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight text-foreground">Notifications</span>
          {unseen > 0 ? (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {unseen} new
            </span>
          ) : visibleNotifications.length > 0 ? (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {visibleNotifications.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {visibleNotifications.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-white/[0.06] cursor-pointer"
              onClick={handleClearAll}
            >
              Clear all
            </button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="Refresh notifications"
            disabled={isLoading}
            onClick={() => load()}
          >
            <RefreshIcon size={14} aria-hidden="true" className={isLoading ? "animate-spin" : ""} />
          </Button>
        </div>
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
              isSeen={open || isNotificationSeen(notification, seenIds)}
              onOpen={handleOpen}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </FloatingPanel>
  );
}
