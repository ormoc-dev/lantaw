import { MovieCard } from "./MovieCard.js";

/**
 * @param {{ id?: string, title: string, movies?: object[], moreMovies?: object[], seeMoreLabel?: string }} opts
 */
export function CategoryRow({
  id,
  title,
  movies,
  moreMovies = [],
  seeMoreLabel = "See more",
}) {
  const section = document.createElement("section");
  section.className = "category-row";
  section.id = id ? `cat-${id}` : undefined;

  const head = document.createElement("div");
  head.className = "category-row__head";
  head.innerHTML = `<h2>${escapeHtml(title)}</h2>`;

  const rail = document.createElement("div");
  rail.className = "category-row__rail";
  rail.setAttribute("role", "list");

  const appendMovies = (list) => {
    (list || []).forEach((movie) => {
      const item = document.createElement("div");
      item.className = "category-row__item";
      item.setAttribute("role", "listitem");
      item.appendChild(MovieCard(movie));
      rail.appendChild(item);
    });
  };

  if (!movies?.length) {
    rail.innerHTML = `<p class="muted">No titles in this category.</p>`;
  } else {
    appendMovies(movies);
  }

  if (moreMovies?.length) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "category-row__more";
    moreBtn.textContent = seeMoreLabel;
    moreBtn.addEventListener("click", () => {
      appendMovies(moreMovies);
      moreBtn.remove();
      // Nudge the rail so the new titles are obvious
      requestAnimationFrame(() => {
        rail.scrollBy({
          left: Math.min(rail.clientWidth * 0.65, 280),
          behavior: "smooth",
        });
      });
    });
    head.appendChild(moreBtn);
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
