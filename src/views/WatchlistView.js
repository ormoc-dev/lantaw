import { linkTo } from "../router/index.js";
import { listWatchlist, removeFromWatchlist } from "../services/watchlistService.js";
import { loadingHtml } from "../components/Loading.js";

const BOOKMARK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8v15.4l-6-3.3-6 3.3V4.8z"/></svg>`;

export async function WatchlistView(root) {
  root.innerHTML = `
    <div class="wl-page">
      <div class="wl-glow" aria-hidden="true"></div>

      <header class="wl-head">
        <a class="wl-back" href="${linkTo("/me")}" aria-label="Back to Me">←</a>
        <div class="wl-head__copy">
          <h1>Watchlist</h1>
          <div class="wl-count" id="wl-count">${loadingHtml({
            className: "ui-loading--inline",
            size: "sm",
          })}</div>
        </div>
      </header>

      <div class="wl-body" id="wl-body">
        ${loadingHtml()}
      </div>
    </div>
  `;

  const body = root.querySelector("#wl-body");
  const countEl = root.querySelector("#wl-count");

  const paintEmpty = () => {
    countEl.textContent = "0 saved";
    body.innerHTML = `
      <div class="wl-empty">
        <div class="wl-empty__icon" aria-hidden="true">${BOOKMARK_ICON}</div>
        <h2 class="wl-empty__title">Nothing on your shelf yet</h2>
        <p class="wl-empty__text">
          Find a movie or show you like, then tap Watchlist to keep it here.
        </p>
        <a class="btn btn--primary wl-empty__cta" href="${linkTo("/")}">Browse titles</a>
      </div>
    `;
  };

  const paintGrid = (items) => {
    countEl.textContent = `${items.length} saved`;
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
          <span class="wl-item__poster">
            ${
              item.poster
                ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" />`
                : `<span class="wl-item__ph" aria-hidden="true"></span>`
            }
          </span>
          <span class="wl-item__title">${escapeHtml(item.title)}</span>
        </a>
        <button
          type="button"
          class="wl-item__remove"
          data-id="${escapeHtml(item.id)}"
          aria-label="Remove ${escapeHtml(item.title)}"
        >
          <span aria-hidden="true">×</span>
        </button>
      `;

      card.querySelector(".wl-item__remove")?.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await removeFromWatchlist(item.id);
          card.classList.add("is-leaving");
          window.setTimeout(() => {
            card.remove();
            const left = grid.querySelectorAll(".wl-item").length;
            if (!left) paintEmpty();
            else countEl.textContent = `${left} saved`;
          }, 180);
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
    body.innerHTML = `<p class="wl-error">${escapeHtml(err.message)}</p>`;
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
