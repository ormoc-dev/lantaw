import { getCategoryById } from "../config/categories.js";
import {
  getCategoryItems,
  searchMovies,
} from "../services/movieService.js";
import { CategoryChips } from "../components/CategoryChips.js";
import { HomeSearchBar } from "../components/HomeSearchBar.js";
import { HomeSticky } from "../components/HomeSticky.js";
import { MediaGrid } from "../components/MediaGrid.js";
import { CategoryRow } from "../components/CategoryRow.js";
import {
  MovieStudiosRail,
  TvNetworksRail,
} from "../components/BrandRails.js";
import { FeaturedHero } from "../components/FeaturedHero.js";
import { loadingHtml } from "../components/Loading.js";
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
  body.innerHTML = loadingHtml({ className: "home-loading" });

  const searchBar = HomeSearchBar({
    onSearch: async (q) => {
      if (!q) {
        location.hash = linkTo(category.path);
        return;
      }
      body.innerHTML = loadingHtml({ className: "home-loading" });
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
    const data = await getCategoryItems(category.id);
    const results = data.results || [];
    const sections = data.sections || [];
    body.innerHTML = "";

    if (results.length) {
      body.appendChild(
        FeaturedHero({
          items: results.filter((r) => r.backdrop || r.poster).slice(0, 5),
        })
      );
    }

    const head = document.createElement("header");
    head.className = "category-page__head";
    head.innerHTML = `
      <h1>${escapeHtml(category.title)}</h1>
      <p class="muted">${escapeHtml(category.description)}</p>
    `;
    body.appendChild(head);

    if (sections.length) {
      for (const section of sections) {
        // Movie Studios sit directly above Popular TV shows
        if (category.id === "recommend" && section.id === "popular-tv") {
          body.appendChild(MovieStudiosRail());
        }

        body.appendChild(
          CategoryRow({
            id: section.id,
            title: section.title,
            movies: section.items,
          })
        );

        // TV Networks sit directly under Top 10 Today · United States
        if (category.id === "recommend" && section.id === "top10-us") {
          body.appendChild(TvNetworksRail());
        }
      }
    } else {
      body.appendChild(
        MediaGrid({
          items: results,
          emptyText: `No titles in ${category.title} yet.`,
        })
      );
    }
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
