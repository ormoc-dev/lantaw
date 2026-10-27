import { assertEnv } from "../config/env.js";
import { checkTmdbConnection } from "../lib/tmdb.js";
import { getHomeCatalog, searchMovies } from "../services/movieService.js";
import { CategoryChips } from "../components/CategoryChips.js";
import { HomeSearchBar } from "../components/HomeSearchBar.js";
import { HomeSticky } from "../components/HomeSticky.js";
import { FeaturedHero } from "../components/FeaturedHero.js";
import { loadingHtml } from "../components/Loading.js";
import { MediaGrid } from "../components/MediaGrid.js";
import { linkTo } from "../router/index.js";

export async function HomeView(root) {
  const page = document.createElement("div");
  page.className = "home";

  const body = document.createElement("div");
  body.id = "home-body";
  body.innerHTML = loadingHtml({ className: "home-loading" });

  const searchBar = HomeSearchBar({
    onSearch: async (q) => {
      if (!q) {
        location.hash = "#/";
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

    if (catalog.heroes?.length) {
      body.appendChild(FeaturedHero({ items: catalog.heroes }));
    } else if (catalog.hero) {
      body.appendChild(FeaturedHero({ item: catalog.hero }));
    }

    for (const section of catalog.sections || []) {
      const el = document.createElement("section");
      el.className = "category-page__body home-section";
      el.innerHTML = `
        <header class="category-page__head home-section__head">
          <div>
            <h1>${escapeHtml(section.title)}</h1>
            <p class="muted">${escapeHtml(section.description || "")}</p>
          </div>
          <a class="link-btn" href="${linkTo(section.path)}">See all</a>
        </header>
      `;
      el.appendChild(
        MediaGrid({
          items: section.items || [],
          emptyText: `No ${section.title.toLowerCase()} titles yet.`,
        })
      );
      body.appendChild(el);
    }
  } catch (err) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>Couldn’t load movies</h2>
        <p class="muted">${escapeHtml(err.message)}</p>
      </div>
    `;
  }

  return {
    unmount() {
      body.querySelector(".home-hero")?._unmountFeatured?.();
      top.unmount();
    },
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
