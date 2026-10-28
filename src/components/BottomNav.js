import { linkTo } from "../router/index.js";
import {
  FRIENDS_BADGE_EVENT,
  getFriendsActivityCounts,
  subscribeFriendsActivity,
} from "../services/friendsService.js";
import { getSession, onAuthChange } from "../services/authService.js";

const ITEMS = [
  {
    path: "/",
    label: "Home",
    match: (p) =>
      p === "/" ||
      p.startsWith("/movie/") ||
      p.startsWith("/tv/") ||
      p.startsWith("/recent") ||
      p.startsWith("/brand/") ||
      ["/recommend", "/filipino", "/movies", "/tv-show", "/anime", "/vivamax"].includes(p),
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
    path: "/friends",
    label: "Friends",
    match: (p) => p.startsWith("/friends") || p.startsWith("/watch-party/"),
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="9" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <circle cx="16.5" cy="10.2" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M3.8 18.8c1.4-2.7 3.5-4.1 5.2-4.1s3.8 1.4 5.2 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M13.4 18.5c1-1.8 2.4-2.8 3.5-2.8 1.2 0 2.4.8 3.3 2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
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
  const wrap = document.createElement("nav");
  wrap.className = "bottom-nav";
  wrap.setAttribute("aria-label", "Main");
  wrap.innerHTML = ITEMS.map(
    (item) => `
      <a class="bottom-nav__item" href="${linkTo(item.path)}" data-path="${item.path}">
        <span class="bottom-nav__icon">${item.icon}</span>
        <span class="bottom-nav__label">${item.label}</span>
        ${
          item.path === "/friends"
            ? `<span class="bottom-nav__badge" hidden aria-hidden="true"></span>`
            : ""
        }
      </a>
    `
  ).join("");

  let badgeUnsub = null;

  async function paintFriendsBadge() {
    const badge = wrap.querySelector(".bottom-nav__badge");
    const link = wrap.querySelector('[data-path="/friends"]');
    if (!badge || !link || wrap.hidden) return;
    try {
      const { total } = await getFriendsActivityCounts();
      if (!total) {
        badge.hidden = true;
        badge.textContent = "";
        link.setAttribute("aria-label", "Friends");
        return;
      }
      badge.hidden = false;
      badge.textContent = total > 9 ? "9+" : String(total);
      link.setAttribute(
        "aria-label",
        `Friends, ${total} notification${total === 1 ? "" : "s"}`
      );
    } catch {
      /* ignore */
    }
  }

  function bindBadgeLive(session) {
    badgeUnsub?.();
    badgeUnsub = null;
    if (!session?.user) return;
    badgeUnsub = subscribeFriendsActivity(() => {
      paintFriendsBadge();
    });
  }

  function sync() {
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const hide =
      pathname === "/login" ||
      pathname === "/privacy" ||
      pathname === "/reset-password" ||
      pathname.startsWith("/watch-party/");
    wrap.hidden = hide;
    document.body.classList.toggle("has-mobile-nav", !hide);
    document.body.classList.remove("has-mobile-nav-open");

    wrap.querySelectorAll(".bottom-nav__item").forEach((el) => {
      const item = ITEMS.find((i) => i.path === el.dataset.path);
      el.classList.toggle("is-active", Boolean(item?.match(pathname)));
    });

    if (!hide) {
      getSession()
        .then((session) => {
          bindBadgeLive(session);
          if (session?.user) paintFriendsBadge();
        })
        .catch(() => {});
    } else {
      badgeUnsub?.();
      badgeUnsub = null;
    }
  }

  sync();
  window.addEventListener("hashchange", sync);
  window.addEventListener(FRIENDS_BADGE_EVENT, paintFriendsBadge);
  const unsubAuth = onAuthChange(() => sync());

  return {
    el: wrap,
    sync,
    destroy() {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(FRIENDS_BADGE_EVENT, paintFriendsBadge);
      badgeUnsub?.();
      unsubAuth();
      wrap.remove();
    },
  };
}
