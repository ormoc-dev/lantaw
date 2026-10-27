import { linkTo } from "../router/index.js";
import { listWatchlist, removeFromWatchlist } from "../services/watchlistService.js";

export async function WatchlistView(root) {
  root.innerHTML = `
    <div class="wl-page">
      <div class="wl-glow" aria-hidden="true"></div>

      <header class="wl-head">
        <a class="wl-back" href="${linkTo("/me")}" aria-label="Back to Me">←</a>
        <div class="wl-head__copy">
          <p class="wl-kicker">Saved</p>
          <h1>Watchlist</h1>
          <p class="muted wl-count" id="wl-count">Loading…</p>
        </div>
      </header>

      <div class="wl-body" id="wl-body">
        <p class="muted">Loading…</p>
      </div>
    </div>
  `;

  const body = root.querySelector("#wl-body");
  const countEl = root.querySelector("#wl-count");

  const paintEmpty = () => {
    countEl.textContent = "Nothing saved yet";
    body.innerHTML = `
      <div class="wl-empty">
        <strong>Your shelf is empty</strong>
        <p class="muted">Open a movie or show and tap Watchlist to save it here.</p>
        <a class="btn btn--primary" href="${linkTo("/")}">Browse home</a>
      </div>
    `;
  };

  const paintGrid = (items) => {
    countEl.textContent = `${items.length} title${items.length === 1 ? "" : "s"}`;
    body.innerHTML = `
      <div class="wl-grid" id="wl-grid" role="list"></div>
    `;
    const grid = body.querySelector("#wl-grid");

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "wl-item";
      card.setAttribute("role", "listitem");
      card.innerHTML = `
        <a class="wl-item__link" href="${linkTo(`/movie/${item.tmdb_id}`)}">
          ${
            item.poster
              ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
              : `<div class="wl-item__ph" aria-hidden="true"></div>`
          }
          <span class="wl-item__title">${escapeHtml(item.title)}</span>
        </a>
        <button type="button" class="wl-item__remove" data-id="${escapeHtml(
          item.id
        )}" aria-label="Remove ${escapeHtml(item.title)}">Remove</button>
      `;

      card.querySelector(".wl-item__remove")?.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await removeFromWatchlist(item.id);
          card.remove();
          const left = grid.querySelectorAll(".wl-item").length;
          if (!left) paintEmpty();
          else countEl.textContent = `${left} title${left === 1 ? "" : "s"}`;
        } catch (err) {
          alert(err.message || "Could not remove");
          btn.disabled = false;
        }
      });

      grid.appendChild(card);
    });
  };

  try {
    const items = await listWatchlist();
    if (!items.length) paintEmpty();
    else paintGrid(items);
  } catch (err) {
    countEl.textContent = "";
    body.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
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
