import {
  clearRecentMovies,
  getRecentMovies,
} from "../services/recentService.js";
import { linkTo } from "../router/index.js";

export async function RecentView(root) {
  const items = getRecentMovies();

  root.innerHTML = `
    <div class="page-pad recent-page">
      <header class="page-head recent-page__head">
        <div>
          <a class="back" href="${linkTo("/")}">← Back</a>
          <h1>Recently viewed</h1>
          <p class="muted">Movies you opened on this device.</p>
        </div>
        ${
          items.length
            ? `<button type="button" class="link-btn" id="clear-recent">Clear</button>`
            : ""
        }
      </header>
      <div class="recent-list" id="list"></div>
    </div>
  `;

  const list = root.querySelector("#list");
  const clearBtn = root.querySelector("#clear-recent");

  if (!items.length) {
    list.innerHTML = `<p class="muted">No recent movies yet. Open a title to see it here.</p>`;
  } else {
    items.forEach((m) => {
      const a = document.createElement("a");
      a.className = "recent-item";
      a.href = linkTo(m.mediaType === "tv" ? `/tv/${m.id}` : `/movie/${m.id}`);
      a.innerHTML = `
        ${
          m.poster
            ? `<img src="${m.poster}" alt="" loading="lazy" />`
            : `<div class="movie-card__placeholder">No poster</div>`
        }
        <div class="recent-item__meta">
          <strong>${escapeHtml(m.title)}</strong>
          <span>${m.releaseDate?.slice(0, 4) || "—"} · ${
            m.rating != null ? Number(m.rating).toFixed(1) : "—"
          }</span>
          <span class="recent-item__time">${formatRelative(m.viewedAt)}</span>
        </div>
      `;
      list.appendChild(a);
    });
  }

  clearBtn?.addEventListener("click", () => {
    clearRecentMovies();
    location.hash = "#/recent";
  });

  return { unmount() {} };
}

function formatRelative(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
