import { assertEnv } from "../config/env.js";
import { checkTmdbConnection } from "../lib/tmdb.js";
import { getHomeCatalog, searchMovies } from "../services/movieService.js";
import { CategoryChips } from "../components/CategoryChips.js";
import { HomeSearchBar } from "../components/HomeSearchBar.js";
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

  page.append(searchBar, CategoryChips({ activeId: "" }), body);
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
    return { unmount() {} };
  }

  const tmdb = await checkTmdbConnection();
  if (!tmdb.ok) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>TMDB unavailable</h2>
        <p class="muted">${escapeHtml(tmdb.message)}</p>
      </div>
    `;
    return { unmount() {} };
  }

  try {
    const catalog = await getHomeCatalog();
    body.innerHTML = "";

    if (catalog.hero) {
      body.appendChild(FeaturedHero({ item: catalog.hero }));
    }

    const intro = document.createElement("p");
    intro.className = "muted home-category-hint";
    intro.textContent = "Pick a category above to browse full lists.";
    body.appendChild(intro);
  } catch (err) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>Couldn’t load movies</h2>
        <p class="muted">${escapeHtml(err.message)}</p>
      </div>
    `;
  }

  return { unmount() {} };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
