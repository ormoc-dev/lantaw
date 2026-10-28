import { getBrand } from "../config/brands.js";
import { tmdb } from "../lib/tmdb.js";
import {
  mapListFromRaw,
  searchMovies,
} from "../services/movieService.js";
import { CategoryChips } from "../components/CategoryChips.js";
import { HomeSearchBar } from "../components/HomeSearchBar.js";
import { HomeSticky } from "../components/HomeSticky.js";
import { MediaGrid } from "../components/MediaGrid.js";
import { loadingHtml } from "../components/Loading.js";
import { linkTo } from "../router/index.js";

async function loadBrandTitles(kind, id) {
  if (kind === "network") {
    const data = await tmdb.discoverTv({
      with_networks: id,
      sort_by: "popularity.desc",
      page: 1,
    });
    return mapListFromRaw(data, "tv").results;
  }

  const [movies, tv] = await Promise.all([
    tmdb.discoverMovies({
      with_companies: id,
      sort_by: "popularity.desc",
      page: 1,
    }),
    tmdb.discoverTv({
      with_companies: id,
      sort_by: "popularity.desc",
      page: 1,
    }),
  ]);

  return [
    ...mapListFromRaw(movies, "movie").results,
    ...mapListFromRaw(tv, "tv").results,
  ].sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

export async function BrandView(root, params = {}) {
  const kind = params.kind === "network" ? "network" : "studio";
  const id = params.id;
  const brand = getBrand(kind, id);

  const page = document.createElement("div");
  page.className = "home category-page";

  const body = document.createElement("div");
  body.className = "category-page__body";
  body.id = "home-body";
  body.innerHTML = loadingHtml({ className: "home-loading" });

  const searchBar = HomeSearchBar({
    onSearch: async (q) => {
      if (!q) {
        location.hash = linkTo(`/brand/${kind}/${id}`);
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
          <a class="link-btn" href="${linkTo(`/brand/${kind}/${id}`)}">Back</a>
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
    CategoryChips({ activeId: "recommend" }),
  ]);
  page.append(top.sticky, top.spacer, body);
  root.innerHTML = "";
  root.appendChild(page);

  try {
    const title = brand?.name || (kind === "network" ? "Network" : "Studio");
    const results = await loadBrandTitles(kind, id);
    body.innerHTML = "";
    const head = document.createElement("header");
    head.className = "category-page__head";
    head.innerHTML = `
      <a class="back" href="${linkTo("/recommend")}">← Recommend</a>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${
        kind === "network" ? "Shows from this network" : "Titles from this studio"
      }</p>
    `;
    body.appendChild(head);
    body.appendChild(
      MediaGrid({
        items: results,
        emptyText: `No titles found for ${title}.`,
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
