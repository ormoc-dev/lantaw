import { getSession, onAuthChange } from "../services/authService.js";

const routes = [];
let current = null;
let outlet = null;
let renderToken = 0;

const PUBLIC_PATHS = new Set(["/login"]);

export function createRouter(rootEl) {
  outlet = rootEl;

  window.addEventListener("hashchange", () => {
    render();
  });

  onAuthChange((session) => {
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    if (session && (pathname === "/login" || !location.hash)) {
      if (location.hash !== "#/") location.hash = "#/";
      else render();
      return;
    }
    if (!session && !PUBLIC_PATHS.has(pathname)) {
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
      const hash = path.startsWith("#") ? path : `#${path}`;
      if (location.hash === hash) render();
      else location.hash = hash;
    },
    start() {
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

async function show(viewFn, params = {}) {
  if (!outlet || !viewFn) return;

  if (current?.unmount) {
    try {
      current.unmount();
    } catch (_) {
      /* ignore */
    }
  }

  outlet.innerHTML = "";
  current = await viewFn(outlet, params);
}

async function render() {
  const token = ++renderToken;
  const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  let session = null;

  try {
    session = await getSession();
  } catch (_) {
    session = null;
  }

  if (token !== renderToken) return;

  if (!session && !PUBLIC_PATHS.has(pathname)) {
    if (location.hash !== "#/login") {
      location.hash = "#/login";
      return;
    }
    const login = matchRoute("/login");
    await show(login?.route.viewFn, {});
    return;
  }

  if (session && pathname === "/login") {
    location.hash = "#/";
    return;
  }

  const matched = matchRoute(pathname) || matchRoute("/");
  if (!matched) return;
  if (token !== renderToken) return;

  await show(matched.route.viewFn, matched.params);
}

export function linkTo(path) {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}
