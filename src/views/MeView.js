import {
  getSession,
  resolveUserProfile,
  signOut,
} from "../services/authService.js";
import { listWatchlist } from "../services/watchlistService.js";
import { linkTo } from "../router/index.js";

export async function MeView(root) {
  const session = await getSession();
  const user = session?.user;
  const resolved = await resolveUserProfile(user);
  const name = resolved.name;
  const avatar = resolved.avatar;
  const email = resolved.email || user?.email || "";
  const initial = (name || email || "?").slice(0, 1).toUpperCase();

  root.innerHTML = `
    <div class="page-pad me-page">
      <header class="me-hero">
        <p class="me-kicker">Account</p>
        <div class="me-profile">
          ${
            avatar
              ? `<img class="me-profile__avatar" src="${escapeHtml(
                  avatar
                )}" alt="${escapeHtml(name || "Profile")}" referrerpolicy="no-referrer" />`
              : `<span class="me-profile__avatar me-profile__avatar--fallback">${escapeHtml(
                  initial
                )}</span>`
          }
          <div class="me-profile__text">
            <h1>${escapeHtml(name || "Account")}</h1>
            <p>${escapeHtml(email)}</p>
          </div>
        </div>
      </header>

      <nav class="me-links" aria-label="Account actions">
        <a class="me-link" href="${linkTo("/watchlist")}">
          <span>My watchlist</span>
          <span aria-hidden="true">→</span>
        </a>
        <a class="me-link" href="${linkTo("/friends")}">
          <span>Friends</span>
          <span aria-hidden="true">→</span>
        </a>
        <a class="me-link" href="${linkTo("/recent")}">
          <span>Recently viewed</span>
          <span aria-hidden="true">→</span>
        </a>
      </nav>

      <section class="me-block">
        <div class="me-block__head">
          <h2>Saved recently</h2>
          <a class="link-btn" href="${linkTo("/watchlist")}">See all</a>
        </div>
        <div id="saved"><p class="muted">Loading…</p></div>
      </section>

      <button type="button" class="me-signout" id="sign-out">Sign out</button>
    </div>
  `;

  root.querySelector("#sign-out").addEventListener("click", async () => {
    await signOut();
    location.hash = "#/login";
  });

  const saved = root.querySelector("#saved");
  try {
    const items = await listWatchlist();
    if (!items.length) {
      saved.innerHTML = `
        <div class="me-empty">
          <strong>Nothing saved yet</strong>
          <p class="muted">Add titles from a movie or TV page.</p>
        </div>`;
    } else {
      saved.innerHTML = `
        <div class="me-saved">
          ${items
            .slice(0, 8)
            .map(
              (item) => `
            <a class="me-saved__item" href="${linkTo(`/movie/${item.tmdb_id}`)}">
              ${
                item.poster
                  ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
                  : `<div class="me-saved__ph"></div>`
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
