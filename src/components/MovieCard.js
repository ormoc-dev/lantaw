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

  const rating =
    movie.rating != null && !Number.isNaN(Number(movie.rating)) && Number(movie.rating) > 0
      ? Number(movie.rating).toFixed(1)
      : null;

  el.innerHTML = `
    <div class="movie-card__poster">
      ${img}
      ${
        rating
          ? `<span class="movie-card__rating" title="Rating ${rating}">
              <span class="movie-card__star" aria-hidden="true">★</span>
              <span>${rating}</span>
            </span>`
          : ""
      }
    </div>
    <div class="movie-card__meta">
      <strong>${escapeHtml(movie.title)}</strong>
      <span>${movie.releaseDate?.slice(0, 4) || "—"}</span>
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
