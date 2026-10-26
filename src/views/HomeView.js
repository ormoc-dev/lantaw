import { assertEnv } from "../config/env.js";
import { checkTmdbConnection } from "../lib/tmdb.js";
import { getHomeCatalog, searchMovies } from "../services/movieService.js";
import { CategoryChips } from "../components/CategoryChips.js";
import { HomeSearchBar } from "../components/HomeSearchBar.js";
import { HomeSticky } from "../components/HomeSticky.js";
import { FeaturedHero } from "../components/FeaturedHero.js";
import { MediaGrid } from "../components/MediaGrid.js";
import { linkTo } from "../router/index.js";

export async function HomeView(root) {
  const page = document.createElement("div");
  page.className = "home";

  const body = document.createElement("div");
  body.id = "home-body";
  body.innerHTML = `<p class="muted home-loading">Loading…</p>`;

  const searchBar = HomeSearchBar({
    onSearch: async (q) => {
      if (!q) {
        location.hash = "#/";
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
          <a class="link-btn" href="${linkTo("/")}">Clear</a>
        `;
        body.append(
          head,
          MediaGrid({ items: results, emptyText: "No movies found." })
        );
      } catch (err) {
        body.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }
    },
  });

  const top = HomeSticky([searchBar, CategoryChips({ activeId: "" })]);
  page.append(top.sticky, top.spacer, body);
  root.innerHTML = "";
  root.appendChild(page);

  const missing = assertEnv();
  if (missing.includes("tmdbApiKey")) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>Add your TMDB key</h2>
        <p class="muted">Edit <code>src/config/env.js</code> and set <code>tmdbApiKey</code>.</p>
      </div>
    `;
    return { unmount: () => top.unmount() };
  }

  const tmdb = await checkTmdbConnection();
  if (!tmdb.ok) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>TMDB unavailable</h2>
        <p class="muted">${escapeHtml(tmdb.message)}</p>
      </div>
    `;
    return { unmount: () => top.unmount() };
  }

  try {
    const catalog = await getHomeCatalog();
    body.innerHTML = "";

    if (catalog.hero) {
      body.appendChild(FeaturedHero({ item: catalog.hero }));
    }

    const recommendSection = document.createElement("section");
    recommendSection.className = "category-page__body";
    recommendSection.innerHTML = `
      <header class="category-page__head">
        <h1>Recommend</h1>
        <p class="muted">Trending picks for you right now.</p>
      </header>
    `;
    recommendSection.appendChild(
      MediaGrid({
        items: catalog.recommend || [],
        emptyText: "No recommended titles yet.",
      })
    );
    body.appendChild(recommendSection);
  } catch (err) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>Couldn’t load movies</h2>
        <p class="muted">${escapeHtml(err.message)}</p>
      </div>
    `;
  }

  return { unmount: () => top.unmount() };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
