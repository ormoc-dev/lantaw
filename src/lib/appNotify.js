import { assetUrl } from "../config/base.js";

const ASKED_KEY = "lantaw-notify-asked";

export function notificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Request permission (needs a user gesture on many browsers). */
export async function ensureNotifyPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    try {
      sessionStorage.setItem(ASKED_KEY, "1");
    } catch {
      /* ignore */
    }
    return result;
  } catch {
    return Notification.permission;
  }
}

export function appIsForeground() {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

/**
 * Show a Chrome / OS notification via the service worker when possible.
 * @param {{
 *   title: string,
 *   body?: string,
 *   tag?: string,
 *   url?: string,
 *   actions?: { action: string, title: string }[],
 *   data?: Record<string, unknown>,
 *   requireInteraction?: boolean,
 *   force?: boolean,
 * }} opts
 */
export async function showAppNotification(opts = {}) {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;

  // In-app call / watch modals already cover the focused tab
  if (
    appIsForeground() &&
    (opts.kind === "call" || opts.kind === "watch") &&
    !opts.force
  ) {
    return false;
  }

  const icon = assetUrl("/public/icons/LOGO.png");
  const data = {
    url: opts.url || "#/friends",
    kind: opts.kind || "generic",
    ...(opts.data || {}),
  };

  const payload = {
    body: String(opts.body || "").slice(0, 180),
    icon,
    badge: icon,
    tag: opts.tag || undefined,
    renotify: Boolean(opts.tag),
    data,
    requireInteraction: Boolean(
      opts.requireInteraction ?? (opts.actions && opts.actions.length)
    ),
    actions: Array.isArray(opts.actions) ? opts.actions.slice(0, 2) : [],
    vibrate: opts.kind === "call" ? [200, 100, 200] : [120],
  };

  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification(String(opts.title || "LANTAW"), payload);
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    // Fallback when SW is unavailable
    // eslint-disable-next-line no-new
    new Notification(String(opts.title || "LANTAW"), payload);
    return true;
  } catch {
    return false;
  }
}

export function markNotifyAsked() {
  try {
    sessionStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function wasNotifyAsked() {
  try {
    return sessionStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}
