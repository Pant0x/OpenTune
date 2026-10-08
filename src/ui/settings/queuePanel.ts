import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  hydrateLocalJsonSetting,
  readLocalBooleanSetting,
  readLocalJsonSetting,
  writeLocalBooleanSetting,
  writeLocalJsonSetting,
} from "../../internal/durableLocalSetting";

/**
 * Collapsed shows the queue as a narrow rail of artwork, the way the sidebar does with icons.
 * It defaults to collapsed: the queue is mostly something you glance at, and the full list
 * costs 340px of page width to answer a question ("what's next?") that a stack of covers
 * answers just as well.
 */
const QUEUE_PANEL_COLLAPSED_STORAGE_KEY = "queue-panel-collapsed";
const CHANGE_EVENT = "queue-panel-change";

export const DEFAULT_QUEUE_PANEL_WIDTH = 352;
export const MIN_QUEUE_PANEL_WIDTH = 290;
export const MAX_QUEUE_PANEL_WIDTH = 420;

const QUEUE_PANEL_WIDTH_STORAGE_KEY = "amber:queue-panel-width";
const QUEUE_PANEL_WIDTH_CHANGE_EVENT = "queue-panel-width-change";

export function isQueuePanelWidth(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value) && value >= 200 && value <= 700;
}

export function readQueuePanelWidth(): number {
  const parsed = readLocalJsonSetting(QUEUE_PANEL_WIDTH_STORAGE_KEY, isQueuePanelWidth);
  if (parsed === null) return DEFAULT_QUEUE_PANEL_WIDTH;
  return Math.round(
    Math.max(MIN_QUEUE_PANEL_WIDTH, Math.min(MAX_QUEUE_PANEL_WIDTH, parsed)),
  );
}

export function writeQueuePanelWidth(width: number): void {
  const clamped = Math.round(
    Math.max(MIN_QUEUE_PANEL_WIDTH, Math.min(MAX_QUEUE_PANEL_WIDTH, width)),
  );
  writeLocalJsonSetting(QUEUE_PANEL_WIDTH_STORAGE_KEY, clamped);
  window.dispatchEvent(new Event(QUEUE_PANEL_WIDTH_CHANGE_EVENT));
}

function readQueuePanelCollapsed() {
  return readLocalBooleanSetting(QUEUE_PANEL_COLLAPSED_STORAGE_KEY, false);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setQueuePanelCollapsed(collapsed: boolean) {
  writeLocalBooleanSetting(QUEUE_PANEL_COLLAPSED_STORAGE_KEY, collapsed, CHANGE_EVENT);
}

export function toggleQueuePanelCollapsed() {
  setQueuePanelCollapsed(!readQueuePanelCollapsed());
}

export async function hydrateQueuePanelSettings() {
  await hydrateLocalBooleanSetting(QUEUE_PANEL_COLLAPSED_STORAGE_KEY, false, CHANGE_EVENT);
  await hydrateLocalJsonSetting(QUEUE_PANEL_WIDTH_STORAGE_KEY, isQueuePanelWidth);
  window.dispatchEvent(new Event(QUEUE_PANEL_WIDTH_CHANGE_EVENT));
}

export function useQueuePanelCollapsed() {
  return useSyncExternalStore(subscribe, readQueuePanelCollapsed, () => false);
}

