import { MovieCard } from "./MovieCard.js";

export function CategoryRow({ id, title, movies }) {
  const section = document.createElement("section");
  section.className = "category-row";
  section.id = id ? `cat-${id}` : undefined;

  const head = document.createElement("div");
  head.className = "category-row__head";
  head.innerHTML = `<h2>${escapeHtml(title)}</h2>`;

  const rail = document.createElement("div");
  rail.className = "category-row__rail";
  rail.setAttribute("role", "list");

  if (!movies?.length) {
    rail.innerHTML = `<p class="muted">No titles in this category.</p>`;
  } else {
    movies.forEach((movie) => {
      const item = document.createElement("div");
      item.className = "category-row__item";
      item.setAttribute("role", "listitem");
      item.appendChild(MovieCard(movie));
      rail.appendChild(item);
    });
  }

  section.append(head, rail);
  return section;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
