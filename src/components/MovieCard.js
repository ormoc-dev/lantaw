import { linkTo } from "../router/index.js";

export function MovieCard(movie) {
  const el = document.createElement("a");
  el.className = "movie-card";
  const path =
    movie.mediaType === "tv" ? `/tv/${movie.id}` : `/movie/${movie.id}`;
  el.href = linkTo(path);

  const img = movie.poster
    ? `<img src="${movie.poster}" alt="" loading="lazy" />`
    : `<div class="movie-card__placeholder">No poster</div>`;

  el.innerHTML = `
    ${img}
    <div class="movie-card__meta">
      <strong>${escapeHtml(movie.title)}</strong>
      <span>${movie.releaseDate?.slice(0, 4) || "—"} · ${
        movie.rating ? movie.rating.toFixed(1) : "—"
      }</span>
    </div>
  `;

  return el;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
