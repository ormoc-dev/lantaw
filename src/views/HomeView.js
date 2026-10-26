import { assertEnv } from "../config/env.js";
import { checkTmdbConnection } from "../lib/tmdb.js";
import { getHomeCatalog } from "../services/movieService.js";
import { CategoryRow } from "../components/CategoryRow.js";
import { AuthBar } from "../components/AuthBar.js";
import { linkTo } from "../router/index.js";

export async function HomeView(root) {
  root.innerHTML = `
    <div class="home">
      <header class="home-top">
        <div class="home-top__brand">
          <a class="brand brand--link" href="${linkTo("/")}">Movie</a>
        </div>
        <div class="home-top__actions" id="top">
          <nav class="home-top__nav">
            <a href="${linkTo("/watchlist")}">Watchlist</a>
          </nav>
        </div>
      </header>

      <div id="home-body">
        <p class="muted home-loading">Loading categories…</p>
      </div>
    </div>
  `;

  const auth = await AuthBar(root.querySelector("#top"));
  const body = root.querySelector("#home-body");
  const missing = assertEnv();

  if (missing.includes("tmdbApiKey")) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>Add your TMDB key</h2>
        <p class="muted">Edit <code>src/config/env.js</code> and set <code>tmdbApiKey</code>.</p>
      </div>
    `;
    return {
      unmount() {
        auth.unmount();
      },
    };
  }

  const tmdb = await checkTmdbConnection();
  if (!tmdb.ok) {
    body.innerHTML = `
      <div class="home-empty">
        <h2>TMDB unavailable</h2>
        <p class="muted">${escapeHtml(tmdb.message)}</p>
      </div>
    `;
    return {
      unmount() {
        auth.unmount();
      },
    };
  }

  try {
    const catalog = await getHomeCatalog();
    body.innerHTML = "";

    if (catalog.hero) {
      const hero = document.createElement("section");
      hero.className = "home-hero";
      const bg = catalog.hero.backdrop || catalog.hero.poster || "";
      hero.innerHTML = `
        <div class="home-hero__bg" style="${
          bg ? `background-image:url('${bg}')` : ""
        }"></div>
        <div class="home-hero__content">
          <p class="home-hero__eyebrow">Featured</p>
          <h2>${escapeHtml(catalog.hero.title)}</h2>
          <p class="home-hero__overview">${escapeHtml(
            truncate(catalog.hero.overview, 160)
          )}</p>
          <a class="btn btn--primary home-hero__cta" href="${linkTo(
            `/movie/${catalog.hero.id}`
          )}">View details</a>
        </div>
      `;
      body.appendChild(hero);
    }

    const chips = document.createElement("nav");
    chips.className = "category-chips";
    chips.setAttribute("aria-label", "Categories");
    catalog.rows.forEach((row) => {
      const a = document.createElement("a");
      a.className = "category-chip";
      a.href = `#cat-${row.id}`;
      a.textContent = row.title;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(`cat-${row.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      chips.appendChild(a);
    });
    body.appendChild(chips);

    const catalogEl = document.createElement("div");
    catalogEl.className = "home-catalog";
    catalog.rows.forEach((row) => {
      catalogEl.appendChild(
        CategoryRow({ id: row.id, title: row.title, movies: row.movies })
      );
    });
    body.appendChild(catalogEl);
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
      auth.unmount();
    },
  };
}

function truncate(str = "", n = 140) {
  if (str.length <= n) return str;
  return `${str.slice(0, n).trim()}…`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
