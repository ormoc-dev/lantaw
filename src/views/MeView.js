import {
  displayNameFromUser,
  getSession,
  signOut,
} from "../services/authService.js";
import { listWatchlist } from "../services/watchlistService.js";
import { linkTo } from "../router/index.js";

export async function MeView(root) {
  const session = await getSession();
  const user = session?.user;
  const name = displayNameFromUser(user);
  const avatar = user?.user_metadata?.avatar_url;
  const email = user?.email || "";

  root.innerHTML = `
    <div class="page-pad">
      <header class="me-head">
        ${
          avatar
            ? `<img class="me-head__avatar" src="${avatar}" alt="" width="72" height="72" />`
            : `<div class="me-head__avatar me-head__avatar--fallback">${escapeHtml(
                (name || "?").slice(0, 1).toUpperCase()
              )}</div>`
        }
        <div>
          <h1>${escapeHtml(name || "Account")}</h1>
          <p class="muted">${escapeHtml(email)}</p>
        </div>
      </header>

      <div class="me-actions">
        <a class="btn btn--ghost" href="${linkTo("/watchlist")}">My watchlist</a>
        <button type="button" class="btn btn--ghost" id="sign-out">Sign out</button>
      </div>

      <section class="me-section">
        <h2>Saved recently</h2>
        <div id="saved"><p class="muted">Loading…</p></div>
      </section>
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
      saved.innerHTML = `<p class="muted">No saved movies yet.</p>`;
    } else {
      saved.innerHTML = `<ul class="me-watch">
        ${items
          .slice(0, 8)
          .map(
            (item) => `
          <li>
            <a href="${linkTo(`/movie/${item.tmdb_id}`)}">${escapeHtml(
              item.title
            )}</a>
          </li>`
          )
          .join("")}
      </ul>`;
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
    .replaceAll(">", "&gt;");
}
