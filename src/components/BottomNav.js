import { linkTo } from "../router/index.js";

const ITEMS = [
  {
    path: "/",
    label: "Home",
    match: (p) =>
      p === "/" ||
      p.startsWith("/movie/") ||
      p.startsWith("/tv/") ||
      p.startsWith("/recent") ||
      ["/recommend", "/filipino", "/movies", "/tv-show", "/anime"].includes(p),
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>`,
  },
  {
    path: "/shorts",
    label: "Shorts",
    match: (p) => p.startsWith("/shorts"),
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="3" width="10" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M11 10.2v4.6l3.6-2.3-3.6-2.3Z" fill="currentColor"/>
      </svg>`,
  },
  {
    path: "/rankings",
    label: "Rankings",
    match: (p) => p.startsWith("/rankings"),
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 20V11h3v9H7Zm7 0V7h3v13h-3Zm-10 0v-5h3v5H4Z" fill="currentColor"/>
        <path d="M4 4h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`,
  },
  {
    path: "/discover",
    label: "Discover",
    match: (p) => p.startsWith("/discover"),
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="m16.2 16.2 3.3 3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`,
  },
  {
    path: "/me",
    label: "Me",
    match: (p) => p.startsWith("/me") || p.startsWith("/watchlist"),
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M5.5 19.2c1.6-3 4-4.5 6.5-4.5s4.9 1.5 6.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`,
  },
];

export function createBottomNav() {
  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Main");

  nav.innerHTML = ITEMS.map(
    (item) => `
      <a class="bottom-nav__item" href="${linkTo(item.path)}" data-path="${item.path}">
        <span class="bottom-nav__icon">${item.icon}</span>
        <span class="bottom-nav__label">${item.label}</span>
      </a>
    `
  ).join("");

  function sync() {
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const hide = pathname === "/login";
    nav.hidden = hide;
    document.body.classList.toggle("has-bottom-nav", !hide);

    nav.querySelectorAll(".bottom-nav__item").forEach((el) => {
      const item = ITEMS.find((i) => i.path === el.dataset.path);
      el.classList.toggle("is-active", Boolean(item?.match(pathname)));
    });
  }

  sync();
  window.addEventListener("hashchange", sync);

  return {
    el: nav,
    sync,
    destroy() {
      window.removeEventListener("hashchange", sync);
      nav.remove();
    },
  };
}
