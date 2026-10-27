import { getSession, onAuthChange } from "../services/authService.js";
import {
  FRIENDS_BADGE_EVENT,
  getFriendsActivityCounts,
  subscribeFriendsActivity,
} from "../services/friendsService.js";
import { linkTo } from "../router/index.js";

export function createProfileTop() {
  const el = document.createElement("div");
  el.className = "top-actions";
  el.hidden = true;
  let renderToken = 0;
  let badgeUnsub = null;

  function badgeHtml(total) {
    if (!total) return "";
    const label = total > 9 ? "9+" : String(total);
    return `<span class="top-actions__badge" aria-hidden="true">${label}</span>`;
  }

  async function paintBadge() {
    const link = el.querySelector(".top-actions__friends");
    if (!link || el.hidden) return;
    try {
      const { total } = await getFriendsActivityCounts();
      const existing = link.querySelector(".top-actions__badge");
      if (!total) {
        existing?.remove();
        link.setAttribute("aria-label", "Friends");
        return;
      }
      const label = total > 9 ? "9+" : String(total);
      if (existing) {
        existing.textContent = label;
      } else {
        link.insertAdjacentHTML("beforeend", badgeHtml(total));
      }
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
      paintBadge();
    });
  }

  async function render(session) {
    const token = ++renderToken;
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const hide = pathname === "/login" || !session?.user;
    el.hidden = hide;
    document.body.classList.toggle("has-profile-top", !hide);
    if (hide) {
      el.innerHTML = "";
      badgeUnsub?.();
      badgeUnsub = null;
      return;
    }

    const counts = await getFriendsActivityCounts().catch(() => ({ total: 0 }));
    if (token !== renderToken) return;

    const onFriends = pathname.startsWith("/friends");
    const total = counts.total || 0;

    el.innerHTML = `
      <a
        class="top-actions__friends ${onFriends ? "is-active" : ""}"
        href="${linkTo("/friends")}"
        aria-label="${
          total
            ? `Friends, ${total} notification${total === 1 ? "" : "s"}`
            : "Friends"
        }"
        title="Friends"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="9" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle cx="16.5" cy="10.2" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path d="M3.8 18.8c1.4-2.7 3.5-4.1 5.2-4.1s3.8 1.4 5.2 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M13.4 18.5c1-1.8 2.4-2.8 3.5-2.8 1.2 0 2.4.8 3.3 2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        ${badgeHtml(total)}
      </a>
    `;

    bindBadgeLive(session);
  }

  function sync() {
    getSession()
      .then((session) => render(session))
      .catch(() => render(null));
  }

  sync();
  window.addEventListener("hashchange", sync);
  window.addEventListener(FRIENDS_BADGE_EVENT, paintBadge);
  const unsub = onAuthChange((session) => render(session));

  return {
    el,
    sync,
    refreshBadge: paintBadge,
    destroy() {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(FRIENDS_BADGE_EVENT, paintBadge);
      badgeUnsub?.();
      unsub();
      el.remove();
    },
  };
}
