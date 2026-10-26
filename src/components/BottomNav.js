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
  const wrap = document.createElement("div");
  wrap.className = "mobile-nav";
  wrap.innerHTML = `
    <button
      type="button"
      class="mobile-nav__toggle"
      aria-label="Open menu"
      aria-expanded="false"
      aria-controls="mobile-nav-drawer"
    >
      <span class="mobile-nav__burger" aria-hidden="true"></span>
    </button>
    <div class="mobile-nav__overlay" hidden></div>
    <nav id="mobile-nav-drawer" class="mobile-nav__drawer" aria-label="Main" hidden>
      <div class="mobile-nav__drawer-head">
        <strong>Menu</strong>
        <button type="button" class="mobile-nav__close" aria-label="Close menu">✕</button>
      </div>
      <div class="mobile-nav__items">
        ${ITEMS.map(
          (item) => `
            <a class="mobile-nav__item" href="${linkTo(item.path)}" data-path="${item.path}">
              <span class="mobile-nav__icon">${item.icon}</span>
              <span class="mobile-nav__label">${item.label}</span>
            </a>
          `
        ).join("")}
      </div>
    </nav>
  `;

  const toggleBtn = wrap.querySelector(".mobile-nav__toggle");
  const closeBtn = wrap.querySelector(".mobile-nav__close");
  const overlay = wrap.querySelector(".mobile-nav__overlay");
  const drawer = wrap.querySelector(".mobile-nav__drawer");
  let open = false;
  let ignoreToggleUntil = 0;

  const setOpen = (next) => {
    open = next;
    drawer.hidden = !next;
    overlay.hidden = !next;
    wrap.classList.toggle("is-open", next);
    toggleBtn.setAttribute("aria-expanded", next ? "true" : "false");
    toggleBtn.setAttribute("aria-label", next ? "Close menu" : "Open menu");
    document.body.classList.toggle("has-mobile-nav-open", next);
  };

  const closeMenu = () => {
    if (!open) return;
    setOpen(false);
    // Prevent the same tap/click from reopening via the hamburger underneath.
    ignoreToggleUntil = Date.now() + 350;
  };

  const openMenu = () => {
    if (open) return;
    setOpen(true);
  };

  const onToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < ignoreToggleUntil) return;
    if (open) closeMenu();
    else openMenu();
  };

  const onClose = (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
  };

  const onEscape = (event) => {
    if (event.key === "Escape") closeMenu();
  };

  toggleBtn.addEventListener("click", onToggle);
  closeBtn.addEventListener("click", onClose);
  overlay.addEventListener("click", onClose);
  wrap.querySelectorAll(".mobile-nav__item").forEach((item) => {
    item.addEventListener("click", () => closeMenu());
  });
  window.addEventListener("keydown", onEscape);

  function sync() {
    closeMenu();
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const hide = pathname === "/login";
    wrap.hidden = hide;
    document.body.classList.toggle("has-mobile-nav", !hide);

    wrap.querySelectorAll(".mobile-nav__item").forEach((el) => {
      const item = ITEMS.find((i) => i.path === el.dataset.path);
      el.classList.toggle("is-active", Boolean(item?.match(pathname)));
    });
  }

  sync();
  window.addEventListener("hashchange", sync);

  return {
    el: wrap,
    sync,
    destroy() {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("keydown", onEscape);
      wrap.remove();
    },
  };
}
