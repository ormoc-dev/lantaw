import {
  getSession,
  resolveUserProfile,
  signOut,
} from "../services/authService.js";
import { listWatchlist } from "../services/watchlistService.js";
import { loadingHtml } from "../components/Loading.js";
import { linkTo } from "../router/index.js";
import {
  enableNotifications,
  notificationPermission,
} from "../services/notifyService.js";
import { notificationsSupported } from "../lib/appNotify.js";
import { showNotice } from "../lib/appModal.js";
import {
  STREAM_PROVIDERS,
  getStreamProvider,
  getStreamProviderMeta,
  setStreamProvider,
} from "../lib/streamEmbed.js";

const ICONS = {
  watchlist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H17a2 2 0 0 1 2 2v13.2l-6.2-3.4a2 2 0 0 0-1.9 0L5 19.2V5.5z"/></svg>`,
  friends: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M16 11a3.5 3.5 0 1 0-3.4-4.2M8.5 13A3.5 3.5 0 1 0 8.5 6M4 19c.4-2.6 2.4-4 4.5-4s4.1 1.4 4.5 4M13 15c1.8 0 3.6 1 4 3"/></svg>`,
  recent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.8 1.6"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 5.5 18 11M4 20l1.2-5.3L16.4 3.5a2 2 0 0 1 2.8 0l1.3 1.3a2 2 0 0 1 0 2.8L9.3 18.8 4 20Z"/></svg>`,
  privacy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3.5 5.5 6.2v5.1c0 4.2 2.7 7.2 6.5 8.7 3.8-1.5 6.5-4.5 6.5-8.7V6.2L12 3.5Z"/><path d="M9.2 12.1 11 13.9l3.8-3.8"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3.8a4.4 4.4 0 0 0-4.4 4.4v2.1c0 .9-.3 1.7-.9 2.4L5.4 14.4c-.5.6-.1 1.6.7 1.6h11.8c.8 0 1.2-1 .7-1.6l-1.3-1.7c-.6-.7-.9-1.5-.9-2.4V8.2A4.4 4.4 0 0 0 12 3.8Z"/><path d="M10 17.2a2.2 2.2 0 0 0 4 0"/></svg>`,
  stream: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9z"/></svg>`,
};

export async function MeView(root) {
  const session = await getSession();
  const user = session?.user;

  if (!user) {
    root.innerHTML = `
      <div class="me-page me-page--guest">
        <div class="me-glow" aria-hidden="true"></div>
        <div class="me-guest">
          <p class="me-brand">Lantaw</p>
          <h1>Your shelf waits</h1>
          <p class="me-guest__lead">Sign in to keep watchlists, friends, and what you last opened.</p>
          <a class="me-guest__cta" href="${linkTo("/login")}">Sign in</a>
        </div>
      </div>
    `;
    return { unmount() {} };
  }

  const resolved = await resolveUserProfile(user);
  const name = resolved.name;
  const avatar = resolved.avatar;
  const email = resolved.email || user?.email || "";
  const initial = (name || email || "?").slice(0, 1).toUpperCase();
  let activeProvider = getStreamProvider();
  const providerMeta = () => getStreamProviderMeta(activeProvider);

  root.innerHTML = `
    <div class="me-page">
      <section class="me-section" aria-label="Profile">
        <header class="me-identity">
          <div class="me-identity__avatar-wrap me-identity__avatar-wrap--static">
            ${
              avatar
                ? `<img class="me-identity__avatar" id="me-avatar-img" src="${escapeHtml(
                    avatar
                  )}" alt="" referrerpolicy="no-referrer" />`
                : `<span class="me-identity__avatar me-identity__avatar--fallback" id="me-avatar-img">${escapeHtml(
                    initial
                  )}</span>`
            }
          </div>
          <div class="me-identity__copy">
            <div class="me-identity__name-row">
              <h2 id="me-display-name">${escapeHtml(name || "Account")}</h2>
            </div>
            ${email ? `<p class="me-identity__email">${escapeHtml(email)}</p>` : ""}
          </div>
        </header>
      </section>

      <section class="me-section" aria-labelledby="me-library-title">
        <h2 class="me-section__title" id="me-library-title">Library</h2>
        <nav class="me-destinations" aria-label="Your library">
          <a class="me-dest" href="${linkTo("/watchlist")}">
            <span class="me-dest__icon">${ICONS.watchlist}</span>
            <span class="me-dest__label">Watchlist</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </a>
          <a class="me-dest" href="${linkTo("/friends")}">
            <span class="me-dest__icon">${ICONS.friends}</span>
            <span class="me-dest__label">Friends</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </a>
          <a class="me-dest" href="${linkTo("/recent")}">
            <span class="me-dest__icon">${ICONS.recent}</span>
            <span class="me-dest__label">Recent</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </a>
        </nav>
      </section>

      <section class="me-section me-shelf" aria-labelledby="me-shelf-title">
        <div class="me-shelf__head">
          <h2 class="me-section__title" id="me-shelf-title">On your shelf</h2>
          <a class="me-shelf__all" href="${linkTo("/watchlist")}">See all</a>
        </div>
        <div id="saved" class="me-shelf__body">
          ${loadingHtml({ className: "ui-loading--inline" })}
        </div>
      </section>

      <section class="me-section" aria-labelledby="me-settings-title">
        <h2 class="me-section__title" id="me-settings-title">Settings</h2>
        <nav class="me-destinations" aria-label="Settings">
          <a class="me-dest" href="${linkTo("/me/edit")}">
            <span class="me-dest__icon">${ICONS.pen}</span>
            <span class="me-dest__label">Edit profile</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </a>
          <button type="button" class="me-dest" id="me-settings-provider">
            <span class="me-dest__icon">${ICONS.stream}</span>
            <span class="me-dest__label">Server region</span>
            <span class="me-dest__meta" id="me-provider-status">${escapeHtml(
              providerMeta().label
            )}</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </button>
          ${
            notificationsSupported()
              ? `<button type="button" class="me-dest" id="me-settings-notify">
            <span class="me-dest__icon">${ICONS.bell}</span>
            <span class="me-dest__label">Notifications</span>
            <span class="me-dest__meta" id="me-notify-status">${
              notificationPermission() === "granted"
                ? "On"
                : notificationPermission() === "denied"
                  ? "Blocked"
                  : "Off"
            }</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </button>`
              : ""
          }
          <a class="me-dest" href="${linkTo("/privacy")}">
            <span class="me-dest__icon">${ICONS.privacy}</span>
            <span class="me-dest__label">Privacy</span>
            <span class="me-dest__chev" aria-hidden="true">›</span>
          </a>
        </nav>
        <div class="me-actions">
          <button type="button" class="me-signout" id="sign-out">Sign out</button>
        </div>
      </section>

      <div class="me-modal" id="provider-modal" hidden>
        <div class="me-modal__backdrop" data-close-provider></div>
        <div
          class="me-modal__dialog me-modal__dialog--providers"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-modal-title"
        >
          <h2 id="provider-modal-title">Server region</h2>
          <p class="me-modal__lead">
            Pick a region for Watch now. If a title won’t play, switch and try again.
          </p>
          <div class="me-provider-list" role="radiogroup" aria-label="Server regions">
            ${STREAM_PROVIDERS.map(
              (p) => `
              <button
                type="button"
                class="me-provider-option${
                  p.id === activeProvider ? " is-active" : ""
                }"
                role="radio"
                aria-checked="${p.id === activeProvider ? "true" : "false"}"
                data-provider="${escapeHtml(p.id)}"
              >
                <span class="me-provider-option__copy">
                  <span class="me-provider-option__label">${escapeHtml(p.label)}</span>
                  <span class="me-provider-option__hint">${escapeHtml(p.hint)}</span>
                </span>
                <span class="me-provider-option__check" aria-hidden="true"></span>
              </button>`
            ).join("")}
          </div>
          <div class="me-modal__actions me-modal__actions--single">
            <button type="button" class="me-modal__btn" data-close-provider>Done</button>
          </div>
        </div>
      </div>

      <div class="me-modal" id="signout-modal" hidden>
        <div class="me-modal__backdrop" data-close-signout></div>
        <div
          class="me-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-modal-title"
        >
          <h2 id="signout-modal-title">Sign out?</h2>
          <p class="me-modal__lead">
            You’ll need to sign in again to use your watchlist and friends.
          </p>
          <div class="me-modal__actions">
            <button type="button" class="me-modal__btn" data-close-signout>Cancel</button>
            <button type="button" class="me-modal__btn me-modal__btn--accent" id="signout-confirm">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const providerModal = root.querySelector("#provider-modal");
  const signOutModal = root.querySelector("#signout-modal");
  const providerStatus = root.querySelector("#me-provider-status");

  const anyMeModalOpen = () =>
    Boolean(
      (providerModal && !providerModal.hidden) ||
        (signOutModal && !signOutModal.hidden)
    );

  const syncProviderUi = () => {
    const meta = providerMeta();
    if (providerStatus) providerStatus.textContent = meta.label;
    providerModal?.querySelectorAll("[data-provider]").forEach((btn) => {
      const on = btn.getAttribute("data-provider") === activeProvider;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  };

  const openProviderModal = () => {
    activeProvider = getStreamProvider();
    syncProviderUi();
    providerModal.hidden = false;
    document.body.classList.add("me-modal-open");
  };

  const closeProviderModal = () => {
    providerModal.hidden = true;
    if (!anyMeModalOpen()) document.body.classList.remove("me-modal-open");
  };

  root.querySelector("#me-settings-provider")?.addEventListener("click", openProviderModal);
  providerModal?.querySelectorAll("[data-close-provider]").forEach((el) => {
    el.addEventListener("click", closeProviderModal);
  });
  providerModal?.querySelectorAll("[data-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeProvider = setStreamProvider(btn.getAttribute("data-provider"));
      syncProviderUi();
    });
  });
  root.querySelector("#me-settings-notify")?.addEventListener("click", async () => {
    const statusEl = root.querySelector("#me-notify-status");
    const perm = await enableNotifications();
    if (statusEl) {
      statusEl.textContent =
        perm === "granted" ? "On" : perm === "denied" ? "Blocked" : "Off";
    }
    if (perm === "granted") {
      await showNotice({
        title: "Notifications on",
        message:
          "Chrome can alert you for friend requests, chats, Watch together, and calls — even when LANTAW is closed (after push is set up on the server).",
      });
    } else if (perm === "denied") {
      await showNotice({
        title: "Notifications blocked",
        message:
          "Allow notifications for this site in Chrome settings (lock icon → Site settings).",
      });
    }
  });
  const openSignOutModal = () => {
    signOutModal.hidden = false;
    document.body.classList.add("me-modal-open");
  };
  const closeSignOutModal = () => {
    signOutModal.hidden = true;
    if (!anyMeModalOpen()) document.body.classList.remove("me-modal-open");
  };

  root.querySelector("#sign-out")?.addEventListener("click", openSignOutModal);
  signOutModal.querySelectorAll("[data-close-signout]").forEach((el) => {
    el.addEventListener("click", closeSignOutModal);
  });
  root.querySelector("#signout-confirm")?.addEventListener("click", async () => {
    const btn = root.querySelector("#signout-confirm");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing out…";
    }
    try {
      await signOut();
      closeSignOutModal();
      location.hash = "#/login";
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Sign out";
      }
      alert(err.message || "Could not sign out");
    }
  });

  const saved = root.querySelector("#saved");
  try {
    const items = await listWatchlist();
    if (!items.length) {
      saved.innerHTML = `
        <div class="me-shelf__empty">
          <p>Nothing saved yet</p>
          <span>Open a title and tap save — it lands here.</span>
        </div>`;
    } else {
      saved.innerHTML = `
        <div class="me-rail" role="list">
          ${items
            .slice(0, 12)
            .map(
              (item) => `
            <a class="me-rail__item" role="listitem" href="${linkTo(
              `/movie/${item.tmdb_id}`
            )}">
              ${
                item.poster
                  ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
                  : `<div class="me-rail__ph" aria-hidden="true"></div>`
              }
              <span>${escapeHtml(item.title)}</span>
            </a>`
            )
            .join("")}
        </div>`;
    }
  } catch (err) {
    saved.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }

  return { unmount() {} };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
