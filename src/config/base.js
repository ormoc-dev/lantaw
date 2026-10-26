/**
 * App base path:
 * - Root deploys (Vercel/Netlify) → ""
 * - XAMPP /movie/ → "/movie"
 */
export function getBasePath() {
  const path = window.location.pathname.replace(/\/index\.html$/, "");
  if (path === "/movie" || path.startsWith("/movie/")) return "/movie";
  return "";
}

export function assetUrl(path) {
  const base = getBasePath();
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}
