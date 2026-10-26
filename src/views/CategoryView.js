import { getCategoryById } from "../config/categories.js";
import {
  getCategoryItems,
  searchMovies,
} from "../services/movieService.js";
import { CategoryChips } from "../components/CategoryChips.js";
import { HomeSearchBar } from "../components/HomeSearchBar.js";
import { HomeSticky } from "../components/HomeSticky.js";
import { MediaGrid } from "../components/MediaGrid.js";
import { FeaturedHero } from "../components/FeaturedHero.js";
import { linkTo } from "../router/index.js";

/**
 * Separate page for one category (Recommend, Filipino, Movies, TV Show, Anime).
 */
export async function CategoryView(root, { categoryId } = {}) {
  const category = getCategoryById(categoryId);
  if (!category) {
    root.innerHTML = `<p class="muted">Unknown category. <a href="${linkTo(
      "/"
    )}">Go home</a></p>`;
    return { unmount() {} };
  }

  const page = document.createElement("div");
  page.className = "home category-page";

  const body = document.createElement("div");
  body.className = "category-page__body";
  body.id = "home-body";
  body.innerHTML = `<p class="muted home-loading">Loading ${escapeHtml(
    category.title
  )}…</p>`;

  const searchBar = HomeSearchBar({
    onSearch: async (q) => {
      if (!q) {
        location.hash = linkTo(category.path);
        return;
      }
      body.innerHTML = `<p class="muted home-loading">Searching…</p>`;
      try {
        const { results } = await searchMovies(q);
        body.innerHTML = "";
        const head = document.createElement("div");
        head.className = "home-search-results__head";
        head.innerHTML = `
          <h2>Results for “${escapeHtml(q)}”</h2>
          <a class="link-btn" href="${linkTo(category.path)}">Back</a>
        `;
        body.append(
          head,
          MediaGrid({ items: results, emptyText: "No results." })
        );
      } catch (err) {
        body.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }
    },
  });

  const top = HomeSticky([
    searchBar,
    CategoryChips({ activeId: category.id }),
  ]);
  page.append(top.sticky, top.spacer, body);
  root.innerHTML = "";
  root.appendChild(page);

  try {
    const { results } = await getCategoryItems(category.id);
    body.innerHTML = "";

    const head = document.createElement("header");
    head.className = "category-page__head";
    head.innerHTML = `
      <h1>${escapeHtml(category.title)}</h1>
      <p class="muted">${escapeHtml(category.description)}</p>
    `;
    body.appendChild(head);

    if (results[0]) {
      body.appendChild(FeaturedHero({ item: results[0] }));
    }

    body.appendChild(
      MediaGrid({
        items: results,
        emptyText: `No titles in ${category.title} yet.`,
      })
    );
  } catch (err) {
    body.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }

  return { unmount: () => top.unmount() };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
