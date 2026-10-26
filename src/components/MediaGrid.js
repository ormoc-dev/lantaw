import { MovieCard } from "./MovieCard.js";

/**
 * Responsive grid of movie/TV cards.
 * @param {{ items: object[], emptyText?: string }} options
 */
export function MediaGrid({ items = [], emptyText = "Nothing here yet." } = {}) {
  const grid = document.createElement("div");
  grid.className = "grid media-grid";

  if (!items.length) {
    grid.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`;
    return grid;
  }

  items.forEach((item) => grid.appendChild(MovieCard(item)));
  return grid;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
