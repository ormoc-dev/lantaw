import { getSession, onAuthChange } from "../services/authService.js";

const routes = [];
let current = null;
let outlet = null;
let renderToken = 0;

const PUBLIC_PATHS = new Set(["/login", "/privacy"]);
const RETURN_KEY = "lantaw-return-path";

function currentPath() {
  return (location.hash.replace(/^#/, "") || "/").split("?")[0];
}

function rememberReturnPath(pathname) {
  if (!pathname || pathname === "/login" || PUBLIC_PATHS.has(pathname)) return;
  try {
    sessionStorage.setItem(RETURN_KEY, pathname);
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

export function createRouter(rootEl) {
  outlet = rootEl;

  window.addEventListener("hashchange", () => {
    const path = currentPath();
    if (path !== "/login") rememberReturnPath(path);
    render();
  });

  onAuthChange((session, event) => {
    // Token refresh must not remount the page or bounce category routes to home
    if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;

    const pathname = currentPath();

    if (event === "SIGNED_OUT" || (!session && event === "INITIAL_SESSION")) {
      if (!PUBLIC_PATHS.has(pathname)) {
        rememberReturnPath(pathname);
        if (location.hash !== "#/login") location.hash = "#/login";
        else render();
      } else {
        render();
      }
      return;
    }

    if (session && pathname === "/reset-password") {
      render();
      return;
    }

    // Only leave /login after a real sign-in — restore the last category/page
    if (session && pathname === "/login") {
      const next = takeReturnPath();
      const hash = `#${next.startsWith("/") ? next : `/${next}`}`;
      if (location.hash !== hash) location.hash = hash;
      else render();
      return;
    }

    if (session && !location.hash) {
      location.hash = "#/";
      return;
    }

    if (!session && !PUBLIC_PATHS.has(pathname)) {
      rememberReturnPath(pathname);
      if (location.hash !== "#/login") location.hash = "#/login";
      else render();
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

async function show(viewFn, params = {}, token) {
  if (!outlet || !viewFn) return;

  if (current?.unmount) {
    try {
      current.unmount();
    } catch (_) {
      /* ignore */
    }
  }

  if (token !== renderToken) return;

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
}

async function render() {
  const token = ++renderToken;
  const pathname = currentPath();
  let session = null;

  try {
    session = await getSession();
  } catch (_) {
    session = null;
  }

  if (token !== renderToken) return;

  if (!session && !PUBLIC_PATHS.has(pathname)) {
    rememberReturnPath(pathname);
    if (location.hash !== "#/login") {
      location.hash = "#/login";
      return;
    }
    const login = matchRoute("/login");
    await show(login?.route.viewFn, {}, token);
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

  await show(matched.route.viewFn, matched.params, token);
}

export function linkTo(path) {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}
