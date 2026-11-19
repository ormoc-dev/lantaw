import { linkTo } from "../router/index.js";
import { showInAppToast } from "../lib/inAppToast.js";

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatFeedTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))}h`;
  if (sec < 86400 * 7) return `${Math.max(1, Math.floor(sec / 86400))}d`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function avatarHtml(actor) {
  const name = actor?.display_name || actor?.email || "?";
  const initial = name.slice(0, 1).toUpperCase();
  if (actor?.avatar_url) {
    return `<img class="friends-feed__avatar" src="${escapeHtml(
      actor.avatar_url
    )}" alt="" referrerpolicy="no-referrer" />`;
  }
  return `<span class="friends-feed__avatar friends-feed__avatar--fallback">${escapeHtml(
    initial
  )}</span>`;
}

function itemHref(item) {
  if (item?.href) return linkTo(item.href);
  if (item?.chatId) return linkTo(`/friends?chat=${encodeURIComponent(item.chatId)}`);
  return linkTo("/friends");
}

function itemCopy(item) {
  const name = item.actor?.display_name || "Friend";
  if (item.kind === "watching") {
    return `<strong>${escapeHtml(name)}</strong> <em>${escapeHtml(
      item.action
    )}</em> <span>${escapeHtml(item.title || "something")}</span>`;
  }
  if (item.kind === "view") {
    return `<strong>${escapeHtml(name)}</strong> <em>${escapeHtml(
      item.action
    )}</em> <span>${escapeHtml(item.title || "a title")}</span>`;
  }
  if (item.kind === "comment") {
    const titleBit = item.title
      ? ` <span>${escapeHtml(item.title)}</span>`
      : " a title";
    return `<strong>${escapeHtml(name)}</strong> <em>${escapeHtml(
      item.action
    )}</em>${titleBit}${
      item.preview ? ` · “${escapeHtml(item.preview)}”` : ""
    }`;
  }
  return `<strong>${escapeHtml(name)}</strong> <em>${escapeHtml(
    item.action
  )}</em>${item.preview ? ` · “${escapeHtml(item.preview)}”` : ""}`;
}

function toastForItem(item) {
  const name = item.actor?.display_name || "Friend";
  if (item.kind === "watching") {
    return {
      title: "Activity",
      body: `${name} is watching ${item.title || "this"}`,
      avatarUrl: item.actor?.avatar_url || null,
    };
  }
  if (item.kind === "view") {
    return {
      title: "Activity",
      body: `${name} viewed ${item.title || "this"}`,
      avatarUrl: item.actor?.avatar_url || null,
    };
  }
  if (item.kind === "comment") {
    return {
      title: "Activity",
      body: `${name} commented${item.title ? ` on ${item.title}` : ""}`,
      avatarUrl: item.actor?.avatar_url || null,
    };
  }
  return null;
}

/**
 * Home Friends activity strip.
 * @returns {HTMLElement|null}
 */
export function FriendsActivityFeed({ items = [] } = {}) {
  if (!items.length) return null;

  const byId = new Map(items.map((item) => [item.id, item]));

  const section = document.createElement("section");
  section.className = "friends-feed";
  section.id = "friends-activity";
  section.setAttribute("aria-label", "Friends activity");
  section.innerHTML = `
    <header class="friends-feed__head">
      <h2>Friends activity</h2>
      <p class="muted">What your friends are watching and talking about.</p>
    </header>
    <div class="friends-feed__rail" role="list">
      ${items
        .map(
          (item) => `
        <a
          class="friends-feed__card ${item.kind === "watching" ? "is-live" : ""}"
          role="listitem"
          data-feed-id="${escapeHtml(item.id)}"
          href="${itemHref(item)}"
        >
          ${avatarHtml(item.actor)}
          <span class="friends-feed__meta">
            <span class="friends-feed__copy">${itemCopy(item)}</span>
            <time>${escapeHtml(formatFeedTime(item.at))}</time>
          </span>
          ${
            item.poster
              ? `<img class="friends-feed__poster" src="${escapeHtml(
                  item.poster
                )}" alt="" loading="lazy" />`
              : `<span class="friends-feed__poster friends-feed__poster--empty" aria-hidden="true"></span>`
          }
        </a>`
        )
        .join("")}
    </div>
  `;

  section.addEventListener("click", (e) => {
    const card = e.target.closest("a.friends-feed__card[data-feed-id]");
    if (!card) return;
    const item = byId.get(card.dataset.feedId);
    if (!item?.href) return;
    const toast = toastForItem(item);
    if (toast) showInAppToast(toast);
  });

  return section;
}
