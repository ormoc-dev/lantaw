import { getTrendingMovies } from "../services/movieService.js";
import { linkTo } from "../router/index.js";

export async function ShortsView(root) {
  root.innerHTML = `
    <div class="page-pad">
      <header class="page-head">
        <h1>Shorts</h1>
        <p class="muted">Quick hits from what’s trending now.</p>
      </header>
      <div class="shorts-feed" id="feed">
        <p class="muted">Loading…</p>
      </div>
    </div>
  `;

  const feed = root.querySelector("#feed");

  try {
    const { results } = await getTrendingMovies();
    feed.innerHTML = "";
    results.slice(0, 12).forEach((m) => {
      const card = document.createElement("a");
      card.className = "shorts-card";
      card.href = linkTo(`/movie/${m.id}`);
      card.innerHTML = `
        <div class="shorts-card__media" style="${
          m.backdrop || m.poster
            ? `background-image:url('${m.backdrop || m.poster}')`
            : ""
        }"></div>
        <div class="shorts-card__body">
          <strong>${escapeHtml(m.title)}</strong>
          <span>${m.rating ? m.rating.toFixed(1) : "—"} · ${
            m.releaseDate?.slice(0, 4) || "—"
          }</span>
          <p>${escapeHtml(truncate(m.overview, 110))}</p>
        </div>
      `;
      feed.appendChild(card);
    });
  } catch (err) {
    feed.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }

  return { unmount() {} };
}

function truncate(str = "", n = 100) {
  if (str.length <= n) return str;
  return `${str.slice(0, n).trim()}…`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
