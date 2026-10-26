import {
  displayNameFromUser,
  getSession,
  onAuthChange,
} from "../services/authService.js";
import { linkTo } from "../router/index.js";

export function createProfileTop() {
  const el = document.createElement("div");
  el.className = "top-actions";
  el.hidden = true;

  async function render(session) {
    const pathname = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const hide = pathname === "/login" || !session?.user;
    el.hidden = hide;
    document.body.classList.toggle("has-profile-top", !hide);
    if (hide) {
      el.innerHTML = "";
      return;
    }

    const user = session.user;
    const name = displayNameFromUser(user) || "Me";
    const avatar = user.user_metadata?.avatar_url;
    const initial = (name || "?").slice(0, 1).toUpperCase();
    const onFriends = pathname.startsWith("/friends");
    const onMe = pathname.startsWith("/me") || pathname.startsWith("/watchlist");

    el.innerHTML = `
      <a
        class="top-actions__friends ${onFriends ? "is-active" : ""}"
        href="${linkTo("/friends")}"
        aria-label="Friends"
        title="Friends"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="9" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle cx="16.5" cy="10.2" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path d="M3.8 18.8c1.4-2.7 3.5-4.1 5.2-4.1s3.8 1.4 5.2 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M13.4 18.5c1-1.8 2.4-2.8 3.5-2.8 1.2 0 2.4.8 3.3 2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </a>
      <a
        class="profile-top ${onMe ? "is-active" : ""}"
        href="${linkTo("/me")}"
        aria-label="Open profile"
        title="${escapeHtml(name)}"
      >
        ${
          avatar
            ? `<img class="profile-top__avatar" src="${escapeHtml(avatar)}" alt="" width="36" height="36" />`
            : `<span class="profile-top__avatar profile-top__avatar--fallback">${escapeHtml(
                initial
              )}</span>`
        }
      </a>
    `;
  }

  function sync() {
    getSession()
      .then((session) => render(session))
      .catch(() => render(null));
  }

  sync();
  window.addEventListener("hashchange", sync);
  const unsub = onAuthChange((session) => render(session));

  return {
    el,
    sync,
    destroy() {
      window.removeEventListener("hashchange", sync);
      unsub();
      el.remove();
    },
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
