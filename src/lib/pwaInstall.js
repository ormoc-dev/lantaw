import { getBasePath } from "../config/base.js";

const DISMISS_KEY = "lantaw-pwa-dismiss";
const listeners = new Set();

let deferredPrompt = null;
let ready = false;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  const ua = window.navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
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

  if (isStandalone()) {
    return { canInstall: false, mode: "installed", ios: isIos(), dismissed };
  }
  if (deferredPrompt) {
    return { canInstall: true, mode: "prompt", ios: isIos(), dismissed };
  }
  if (isIos()) {
    return { canInstall: true, mode: "ios", ios: true, dismissed };
  }
  return { canInstall: false, mode: "unavailable", ios: false, dismissed };
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
      scope: `${base}/` || "/",
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

  // Register after load so first paint stays light
  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", () => registerServiceWorker(), { once: true });
  }

  notify();
  return () => {};
}

export function isPwaReady() {
  return ready;
}
