import {
  deleteOwnAccount,
  getSession,
  resolveUserProfile,
  signOut,
  uploadProfileAvatar,
} from "../services/authService.js";
import { listWatchlist } from "../services/watchlistService.js";
import { loadingHtml } from "../components/Loading.js";
import { linkTo } from "../router/index.js";

const ICONS = {
  watchlist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H17a2 2 0 0 1 2 2v13.2l-6.2-3.4a2 2 0 0 0-1.9 0L5 19.2V5.5z"/></svg>`,
  friends: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M16 11a3.5 3.5 0 1 0-3.4-4.2M8.5 13A3.5 3.5 0 1 0 8.5 6M4 19c.4-2.6 2.4-4 4.5-4s4.1 1.4 4.5 4M13 15c1.8 0 3.6 1 4 3"/></svg>`,
  recent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.8 1.6"/></svg>`,
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

  root.innerHTML = `
    <div class="me-page">
      <section class="me-section" aria-label="Profile">
        <header class="me-identity">
          <button type="button" class="me-identity__avatar-wrap" id="me-avatar-btn" aria-label="Change profile photo">
            ${
              avatar
                ? `<img class="me-identity__avatar" id="me-avatar-img" src="${escapeHtml(
                    avatar
                  )}" alt="" referrerpolicy="no-referrer" />`
                : `<span class="me-identity__avatar me-identity__avatar--fallback" id="me-avatar-img">${escapeHtml(
                    initial
                  )}</span>`
            }
            <span class="me-identity__avatar-edit">Photo</span>
          </button>
          <input type="file" id="me-avatar-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
          <div class="me-identity__copy">
            <h2>${escapeHtml(name || "Account")}</h2>
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

      <section class="me-section" aria-labelledby="me-account-title">
        <h2 class="me-section__title" id="me-account-title">Account</h2>
        <div class="me-actions">
          <button type="button" class="me-signout" id="sign-out">Sign out</button>
          <button type="button" class="me-delete" id="delete-account">Delete account</button>
        </div>
      </section>

      <div class="me-modal" id="delete-modal" hidden>
        <div class="me-modal__backdrop" data-close-modal></div>
        <div
          class="me-modal__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <h2 id="delete-modal-title">Delete account</h2>
          <p class="me-modal__lead">
            This permanently removes your profile, watchlist, and chats. Type
            <strong>delete ${escapeHtml(name || "Account")}</strong> to confirm.
          </p>
          <label class="me-modal__label" for="delete-confirm-input">
            Confirmation
          </label>
          <input
            type="text"
            id="delete-confirm-input"
            class="me-modal__input"
            autocomplete="off"
            spellcheck="false"
            placeholder="delete ${escapeHtml(name || "Account")}"
          />
          <p class="me-modal__error" id="delete-modal-error" hidden></p>
          <div class="me-modal__actions">
            <button type="button" class="me-modal__btn" data-close-modal>Cancel</button>
            <button type="button" class="me-modal__btn me-modal__btn--danger" id="delete-confirm-btn" disabled>
              Delete forever
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  root.querySelector("#sign-out").addEventListener("click", async () => {
    await signOut();
    location.hash = "#/login";
  });

  const confirmPhrase = `delete ${name || "Account"}`;
  const modal = root.querySelector("#delete-modal");
  const confirmInput = root.querySelector("#delete-confirm-input");
  const confirmBtn = root.querySelector("#delete-confirm-btn");
  const modalError = root.querySelector("#delete-modal-error");

  const openDeleteModal = () => {
    modal.hidden = false;
    document.body.classList.add("me-modal-open");
    modalError.hidden = true;
    modalError.textContent = "";
    confirmInput.value = "";
    confirmBtn.disabled = true;
    requestAnimationFrame(() => confirmInput.focus());
  };

  const closeDeleteModal = () => {
    modal.hidden = true;
    document.body.classList.remove("me-modal-open");
    confirmInput.value = "";
    confirmBtn.disabled = true;
    modalError.hidden = true;
  };

  const phraseMatches = () =>
    confirmInput.value.trim().toLowerCase() === confirmPhrase.toLowerCase();

  root.querySelector("#delete-account")?.addEventListener("click", openDeleteModal);
  modal.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeDeleteModal);
  });
  confirmInput?.addEventListener("input", () => {
    confirmBtn.disabled = !phraseMatches();
    modalError.hidden = true;
  });
  confirmInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDeleteModal();
    if (e.key === "Enter" && phraseMatches()) confirmBtn.click();
  });
  confirmBtn?.addEventListener("click", async () => {
    if (!phraseMatches()) {
      modalError.textContent = `Type exactly: ${confirmPhrase}`;
      modalError.hidden = false;
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Deleting…";
    try {
      await deleteOwnAccount();
      closeDeleteModal();
      location.hash = "#/login";
    } catch (err) {
      modalError.textContent = err.message || "Could not delete account";
      modalError.hidden = false;
      confirmBtn.disabled = !phraseMatches();
      confirmBtn.textContent = "Delete forever";
    }
  });

  const avatarBtn = root.querySelector("#me-avatar-btn");
  const avatarFile = root.querySelector("#me-avatar-file");
  avatarBtn?.addEventListener("click", () => avatarFile?.click());
  avatarFile?.addEventListener("change", async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    avatarBtn.disabled = true;
    avatarBtn.classList.add("is-busy");
    try {
      const url = await uploadProfileAvatar(file);
      const wrap = root.querySelector(".me-identity__avatar-wrap");
      const existing = root.querySelector("#me-avatar-img");
      if (existing?.tagName === "IMG") {
        existing.src = url;
      } else if (wrap) {
        existing?.remove();
        const img = document.createElement("img");
        img.className = "me-identity__avatar";
        img.id = "me-avatar-img";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.src = url;
        wrap.insertBefore(img, wrap.querySelector(".me-identity__avatar-edit"));
      }
    } catch (err) {
      alert(err.message || "Could not update photo");
    } finally {
      avatarBtn.disabled = false;
      avatarBtn.classList.remove("is-busy");
      avatarFile.value = "";
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
