import { getBasePath } from "../config/base.js";

const DISMISS_KEY = "lantaw-pwa-dismiss";
const listeners = new Set();

let deferredPrompt = null;
let ready = false;

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true
  );
}

export function isIosDevice() {
  const ua = window.navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = ua.includes("Mac") && "ontouchend" in document;
  return iOS || iPadOs;
}

export function isAndroidDevice() {
  return /Android/i.test(window.navigator.userAgent || "");
}

function isKnownIosBrowserApp(ua = "") {
  return /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave/i.test(ua);
}

export function isSafariBrowser() {
  const ua = window.navigator.userAgent || "";
  // In-app WebViews often include "Safari" in the UA — they are not Safari.
  if (isNamedInAppBrowser(ua)) return false;
  if (isIosDevice() && !("safari" in window) && !isKnownIosBrowserApp(ua)) {
    return false;
  }
  // Chrome/Firefox/Edge on iOS include CriOS/FxiOS/EdgiOS
  const isVendorSafari =
    /Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/i.test(ua);
  return (
    isVendorSafari ||
    (isIosDevice() &&
      "safari" in window &&
      !/CriOS|FxiOS|EdgiOS/i.test(ua) &&
      /Safari/i.test(ua))
  );
}

/** Explicit app tokens in the user agent (Instagram, Facebook, etc.). */
function isNamedInAppBrowser(ua = "") {
  return (
    /FBAN|FBAV|FB_IAB|FBIOS|FB_FW|FBBV|IABMV|IABMH|MessengerLite|Messenger(?:ForiOS)?/i.test(
      ua
    ) ||
    /Instagram|IGLA|\bIG\s?\d/i.test(ua) ||
    /Line\//i.test(ua) ||
    /Twitter|X\/|Tweetbot/i.test(ua) ||
    /TikTok|BytedanceWebview|musical_ly|ByteLocale/i.test(ua) ||
    /Snapchat|Pinterest|LinkedInApp|MicroMessenger|WhatsApp|Discord|Telegram/i.test(
      ua
    ) ||
    /GSA\//i.test(ua) // Google Search App WebView
  );
}

/**
 * Facebook, Instagram, Messenger, and other WebViews cannot install PWAs.
 * Detect them so we can send users to Chrome (Android) or Safari (iOS).
 *
 * Instagram/Facebook on iOS often omit their name and look like Safari —
 * real Safari exposes window.safari; their WKWebView usually does not.
 */
export function isInAppBrowser() {
  const ua = window.navigator.userAgent || "";
  if (isNamedInAppBrowser(ua)) return true;

  // Android WebView marker (Chrome has "Chrome/… Mobile Safari", WV has "; wv)")
  if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return true;

  // iOS in-app browser heuristic (covers Instagram when UA is stripped)
  if (isIosDevice() && /AppleWebKit/i.test(ua) && !isKnownIosBrowserApp(ua)) {
    if (!("safari" in window)) return true;
  }

  return false;
}

export function getPreferredBrowserLabel() {
  if (isIosDevice()) return "Safari";
  if (isAndroidDevice()) return "Chrome";
  return "your browser";
}

/** Try to leave Messenger/IG/FB and open a real browser that can install the PWA. */
export function openInExternalBrowser() {
  const url = window.location.href;
  const ios = isIosDevice();
  const android = isAndroidDevice();

  if (android) {
    // Prefer Chrome navigate scheme so hash routes (#/login) stay intact
    window.location.href = `googlechrome://navigate?url=${encodeURIComponent(url)}`;
    // If the scheme is ignored, fall back to an Intent (path only + full URL fallback)
    window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      try {
        const parsed = new URL(url);
        const intent =
          `intent://${parsed.host}${parsed.pathname}${parsed.search}` +
          `#Intent;scheme=https;package=com.android.chrome;` +
          `S.browser_fallback_url=${encodeURIComponent(url)};end`;
        window.location.href = intent;
      } catch {
        /* ignore */
      }
    }, 700);
    return { attempted: true, target: "chrome" };
  }

  if (ios) {
    // Private Safari scheme supported by some iOS apps / versions
    const safariUrl = url
      .replace(/^https:\/\//i, "x-safari-https://")
      .replace(/^http:\/\//i, "x-safari-http://");
    try {
      window.location.href = safariUrl;
    } catch {
      /* ignore */
    }
    return { attempted: true, target: "safari" };
  }

  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    /* ignore */
  }
  return { attempted: true, target: "blank" };
}

function notify() {
  const state = getInstallState();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* ignore */
    }
  });
}

export function getInstallState() {
  const dismissed = (() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  })();

  const ios = isIosDevice();
  const android = isAndroidDevice();
  const safari = isSafariBrowser();
  const inApp = isInAppBrowser();
  const browserLabel = getPreferredBrowserLabel();

  if (isStandalone()) {
    return {
      canInstall: false,
      mode: "installed",
      ios,
      android,
      safari,
      inApp,
      browserLabel,
      dismissed,
    };
  }

  // In-app browsers cannot install — send user to Chrome/Safari first
  if (inApp) {
    return {
      canInstall: true,
      mode: "in-app",
      ios,
      android,
      safari,
      inApp: true,
      browserLabel,
      dismissed,
    };
  }

  if (deferredPrompt) {
    return {
      canInstall: true,
      mode: "prompt",
      ios,
      android,
      safari,
      inApp,
      browserLabel,
      dismissed,
    };
  }

  if (ios) {
    // iPhone/iPad never get beforeinstallprompt — guide Add to Home Screen
    return {
      canInstall: true,
      mode: safari ? "ios" : "ios-other",
      ios: true,
      android,
      safari,
      inApp,
      browserLabel,
      dismissed,
    };
  }

  // Desktop/Android Chrome: show install UI (prompt may arrive later)
  return {
    canInstall: true,
    mode: "manual",
    ios,
    android,
    safari,
    inApp,
    browserLabel,
    dismissed,
  };
}

export function onInstallStateChange(fn) {
  listeners.add(fn);
  fn(getInstallState());
  return () => listeners.delete(fn);
}

export function dismissInstallBanner() {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
  notify();
}

export async function promptInstall() {
  if (!deferredPrompt) return { outcome: "unavailable" };
  const event = deferredPrompt;
  deferredPrompt = null;
  event.prompt();
  const choice = await event.userChoice;
  notify();
  return choice;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const base = getBasePath();
  const swUrl = `${base}/sw.js`;
  try {
    // When a new SW takes control, reload once so phones get the deploy
    // without a manual refresh / reinstall.
    if (!window.__lantawSwReloadBound) {
      window.__lantawSwReloadBound = true;
      const hadController = Boolean(navigator.serviceWorker.controller);
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing || !hadController) return;
        refreshing = true;
        window.location.reload();
      });
    }

    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: base ? `${base}/` : "/",
      updateViaCache: "none",
    });

    const askUpdate = () => {
      try {
        reg.update();
      } catch {
        /* ignore */
      }
    };

    // Pick up deploys while the installed app stays open
    askUpdate();
    setInterval(askUpdate, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") askUpdate();
    });

    ready = true;
    notify();
    return reg;
  } catch (err) {
    console.warn("Service worker registration failed:", err?.message || err);
    return null;
  }
}

export function initPwaInstall() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", () => registerServiceWorker(), { once: true });
  }

  notify();
}

export function isPwaReady() {
  return ready;
}
