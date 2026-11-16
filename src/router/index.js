import {
  consumeIntentionalSignOut,
  getSession,
  onAuthChange,
  reviveSession,
} from "../services/authService.js";

const routes = [];
let current = null;
let outlet = null;
let renderToken = 0;
let authKickTimer = null;
let navChain = Promise.resolve();
let activePath = null;
let sessionKnown = false;
let sessionCache = null;

const TAB_PATHS = new Set(["/", "/shorts", "/rankings", "/friends", "/me"]);
const keptTabs = new Map();
const keepHost = document.createElement("div");
keepHost.hidden = true;
keepHost.setAttribute("aria-hidden", "true");

const PUBLIC_PATHS = new Set(["/login", "/privacy"]);
const RETURN_KEY = "lantaw-return-path";

function currentPath() {
  return (location.hash.replace(/^#/, "") || "/").split("?")[0];
}

function currentHashPath() {
  const raw = location.hash.replace(/^#/, "") || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function rememberReturnPath(pathname) {
  const bare = (pathname || "/").split("?")[0];
  if (!bare || bare === "/login" || PUBLIC_PATHS.has(bare)) return;
  const full = currentHashPath();
  const stored = full.split("?")[0] === bare ? full : pathname;
  try {
    sessionStorage.setItem(RETURN_KEY, stored);
  } catch {
    /* ignore */
  }
}

function takeReturnPath() {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    if (path) sessionStorage.removeItem(RETURN_KEY);
    if (path && path.startsWith("/") && path !== "/login") return path;
  } catch {
    /* ignore */
  }
  return "/";
}

/** Where to send the user after login (category routes, etc.). */
export function consumeReturnPath() {
  return takeReturnPath();
}

function onHashLinkClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
  const href = anchor.getAttribute("href") || "";
  if (!href.startsWith("#")) return;
  event.preventDefault();
  const nextPath = (href.slice(1) || "/").split("?")[0] || "/";
  if (nextPath === currentPath()) return;
  if (location.hash !== href) location.hash = href;
}

function dropKeptTabs() {
  for (const saved of keptTabs.values()) {
    try {
      saved.handle?.unmount?.();
    } catch {
      /* ignore */
    }
    saved.box.remove();
  }
  keptTabs.clear();
}

function parkActiveTab() {
  if (!activePath || !TAB_PATHS.has(activePath) || !current || !outlet) return false;
  try {
    current.suspend?.();
  } catch {
    /* ignore */
  }
  const box = document.createElement("div");
  const scroll = window.scrollY || document.documentElement.scrollTop || 0;
  while (outlet.firstChild) box.appendChild(outlet.firstChild);
  keepHost.appendChild(box);
  keptTabs.set(activePath, { box, handle: current, scroll });
  current = null;
  activePath = null;
  return true;
}

function restoreTab(pathname) {
  const saved = keptTabs.get(pathname);
  if (!saved || !outlet) return false;
  outlet.classList.remove("view--shorts", "view--friends-chat");
  outlet.innerHTML = "";
  while (saved.box.firstChild) outlet.appendChild(saved.box.firstChild);
  saved.box.remove();
  keptTabs.delete(pathname);
  current = saved.handle;
  activePath = pathname;
  try {
    current.resume?.();
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => window.scrollTo(0, saved.scroll || 0));
  return true;
}

export function createRouter(rootEl) {
  outlet = rootEl;
  if (outlet.parentElement && !keepHost.isConnected) {
    outlet.parentElement.appendChild(keepHost);
  }
  document.addEventListener("click", onHashLinkClick, true);

  window.addEventListener("hashchange", () => {
    const path = currentPath();
    if (path !== "/login") rememberReturnPath(path);
    render();
  });

  const kickToLogin = (pathname) => {
    if (PUBLIC_PATHS.has(pathname)) {
      render();
      return;
    }
    rememberReturnPath(pathname);
    if (location.hash !== "#/login") location.hash = "#/login";
    else render();
  };

  onAuthChange((session, event) => {
    sessionCache = session || null;
    sessionKnown = true;
    // These must not remount the page — remounting kills watch-party / stream iframes
    if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;

    const pathname = currentPath();

    // INITIAL_SESSION fires after start() already rendered. Remounting here
    // re-fetches CineSrc for watchers (see mountPlayer ← applyPlayback stack).
    if (event === "INITIAL_SESSION") {
      if (!session && !PUBLIC_PATHS.has(pathname)) {
        // Projector / wrong-clock: give persisted email session a chance to revive
        reviveSession().then((revived) => {
          if (revived) return;
          kickToLogin(pathname);
        });
      }
      return;
    }

    if (event === "SIGNED_OUT" || !session) {
      // Real Sign out → leave. Accidental refresh blips → try to stay signed in.
      if (consumeIntentionalSignOut()) {
        window.clearTimeout(authKickTimer);
        kickToLogin(pathname);
        return;
      }
      window.clearTimeout(authKickTimer);
      authKickTimer = window.setTimeout(() => {
        reviveSession().then((revived) => {
          if (revived) return;
          kickToLogin(pathname);
        });
      }, 400);
      return;
    }

    // Session came back (revive / refresh) — cancel any pending kick to login
    window.clearTimeout(authKickTimer);

    if (pathname === "/reset-password") {
      render();
      return;
    }

    // Only leave /login after a real sign-in — restore the last category/page
    if (pathname === "/login") {
      const next = takeReturnPath();
      const hash = `#${next.startsWith("/") ? next : `/${next}`}`;
      if (location.hash !== hash) location.hash = hash;
      else render();
      return;
    }

    if (!location.hash) {
      location.hash = "#/";
      return;
    }

    // SIGNED_IN while already on an app page (e.g. watch party): keep the live view
    if (event === "SIGNED_IN" && current && pathname !== "/login") {
      return;
    }

    render();
  });

  return {
    add(path, viewFn) {
      routes.push({
        path,
        viewFn,
        regex: pathToRegex(path),
        keys: pathKeys(path),
      });
    },
    push(path) {
      const hash = path.startsWith("#") ? path : `#${path.startsWith("/") ? path : `/${path}`}`;
      rememberReturnPath(hash.replace(/^#/, "").split("?")[0]);
      if (location.hash === hash) render();
      else location.hash = hash;
    },
    start() {
      const path = currentPath();
      if (path !== "/login") rememberReturnPath(path);
      if (!location.hash) location.hash = "#/";
      else render();
    },
  };
}

function pathToRegex(path) {
  const pattern = path.replace(/:([A-Za-z0-9_]+)/g, "([^/]+)");
  return new RegExp(`^${pattern}$`);
}

function pathKeys(path) {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

function matchRoute(pathname) {
  for (const route of routes) {
    const m = pathname.match(route.regex);
    if (!m) continue;
    const params = {};
    route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(m[i + 1]);
    });
    return { route, params };
  }
  return null;
}

async function show(viewFn, params = {}, token, pathname) {
  if (!outlet || !viewFn) return;
  if (token !== renderToken) return;

  if (pathname === "/login") {
    dropKeptTabs();
    if (current) {
      try {
        current.unmount?.();
      } catch {
        /* ignore */
      }
      current = null;
    }
    activePath = null;
    outlet.innerHTML = "";
  }

  if (activePath && activePath !== pathname) {
    if (!parkActiveTab() && current) {
      try {
        current.unmount?.();
      } catch {
        /* ignore */
      }
      current = null;
      outlet.innerHTML = "";
    }
  } else if (activePath === pathname && current) {
    try {
      current.unmount?.();
    } catch {
      /* ignore */
    }
    current = null;
    outlet.innerHTML = "";
    activePath = null;
  }

  if (token !== renderToken) return;

  if (TAB_PATHS.has(pathname) && restoreTab(pathname)) return;

  outlet.classList.remove("view--shorts", "view--friends-chat");
  document.body.classList.remove("is-shorts", "is-friends-chat", "is-friends-chat-kb");
  outlet.innerHTML = "";
  const next = await viewFn(outlet, params);

  // A newer navigation started while this view was loading — drop the stale result
  if (token !== renderToken) {
    try {
      next?.unmount?.();
    } catch (_) {
      /* ignore */
    }
    return;
  }

  current = next;
  activePath = pathname;
}

function render() {
  const token = ++renderToken;
  navChain = navChain
    .catch(() => {})
    .then(() => renderNow(token));
}

async function renderNow(token) {
  if (token !== renderToken) return;
  const pathname = currentPath();
  let session = null;

  if (sessionKnown) {
    session = sessionCache;
  } else {
    try {
      session = await getSession();
    } catch (_) {
      session = null;
    }
    if (token !== renderToken) return;
    sessionCache = session;
    sessionKnown = true;
  }

  if (token !== renderToken) return;

  if (!session && !PUBLIC_PATHS.has(pathname)) {
    dropKeptTabs();
    rememberReturnPath(pathname);
    if (location.hash !== "#/login") {
      location.hash = "#/login";
      return;
    }
    const login = matchRoute("/login");
    await show(login?.route.viewFn, {}, token, "/login");
    return;
  }

  if (session && pathname === "/login") {
    const next = takeReturnPath();
    location.hash = `#${next.startsWith("/") ? next : `/${next}`}`;
    return;
  }

  // Recovery link expired / opened without a session
  if (!session && pathname === "/reset-password") {
    location.hash = "#/login";
    return;
  }

  const matched = matchRoute(pathname) || matchRoute("/");
  if (!matched) return;
  if (token !== renderToken) return;

  await show(matched.route.viewFn, matched.params, token, pathname);
}

export function linkTo(path) {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}
