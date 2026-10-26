import { getSession, onAuthChange } from "../services/authService.js";

const routes = [];
let current = null;
let outlet = null;
let rendering = false;

const PUBLIC_PATHS = new Set(["/login"]);

/**
 * path patterns:
 *   "/"           exact
 *   "/movie/:id"  param
 */
export function createRouter(rootEl) {
  outlet = rootEl;

  window.addEventListener("hashchange", () => render());

  // When Google finishes later, leave login and open home
  onAuthChange((session) => {
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    if (session && pathname === "/login") {
      location.hash = "#/";
      return;
    }
    if (!session && !PUBLIC_PATHS.has(pathname)) {
      location.hash = "#/login";
      return;
    }
    render();
  });

  return {
    add(path, viewFn) {
      routes.push({ path, viewFn, regex: pathToRegex(path), keys: pathKeys(path) });
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

async function render() {
  if (rendering) return;
  rendering = true;

  try {
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    let session = null;

    try {
      session = await getSession();
    } catch (_) {
      session = null;
    }

    if (!session && !PUBLIC_PATHS.has(pathname)) {
      if (location.hash !== "#/login") {
        location.hash = "#/login";
      } else {
        const login = matchRoute("/login");
        if (login && outlet) {
          if (current?.unmount) {
            try {
              current.unmount();
            } catch (_) {
              /* ignore */
            }
          }
          outlet.innerHTML = "";
          current = await login.route.viewFn(outlet, {});
        }
      }
      return;
    }

    if (session && pathname === "/login") {
      location.hash = "#/";
      return;
    }

    const matched = matchRoute(pathname) || matchRoute("/");
    if (!outlet || !matched) return;

    if (current?.unmount) {
      try {
        current.unmount();
      } catch (_) {
        /* ignore */
      }
    }

    outlet.innerHTML = "";
    current = await matched.route.viewFn(outlet, matched.params);
  } finally {
    rendering = false;
  }
}

export function linkTo(path) {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}
