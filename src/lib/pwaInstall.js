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

export function isSafariBrowser() {
  const ua = window.navigator.userAgent || "";
  // Chrome/Firefox/Edge on iOS include CriOS/FxiOS/EdgiOS
  const isVendorSafari =
    /Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/i.test(ua);
  return isVendorSafari || (isIosDevice() && !/CriOS|FxiOS|EdgiOS/i.test(ua) && /Safari/i.test(ua));
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
  const safari = isSafariBrowser();

  if (isStandalone()) {
    return {
      canInstall: false,
      mode: "installed",
      ios,
      safari,
      dismissed,
    };
  }
  if (deferredPrompt) {
    return { canInstall: true, mode: "prompt", ios, safari, dismissed };
  }
  if (ios) {
    // iPhone/iPad never get beforeinstallprompt — guide Add to Home Screen
    return {
      canInstall: true,
      mode: safari ? "ios" : "ios-other",
      ios: true,
      safari,
      dismissed,
    };
  }
  // Desktop/Android: still show the install UI (browser may enable prompt later)
  return { canInstall: true, mode: "manual", ios, safari, dismissed };
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
    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: base ? `${base}/` : "/",
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
