import {
  getGenres,
  getMoviesByGenre,
  searchMovies,
} from "../services/movieService.js";
import { MovieCard } from "../components/MovieCard.js";

export async function DiscoverView(root) {
  root.innerHTML = `
    <div class="page-pad">
      <header class="page-head">
        <h1>Discover</h1>
        <p class="muted">Search or browse by genre.</p>
      </header>

      <form class="discover-search" id="search-form">
        <input type="search" name="q" placeholder="Search movies…" autocomplete="off" />
        <button type="submit" class="btn btn--primary">Search</button>
      </form>

      <div class="category-chips" id="genres"></div>
      <div class="grid discover-grid" id="grid">
        <p class="muted">Pick a genre or search.</p>
      </div>
    </div>
  `;

  const form = root.querySelector("#search-form");
  const genresEl = root.querySelector("#genres");
  const grid = root.querySelector("#grid");

  async function renderMovies(movies) {
    grid.innerHTML = "";
    if (!movies.length) {
      grid.innerHTML = `<p class="muted">No results.</p>`;
      return;
    }
    movies.forEach((m) => grid.appendChild(MovieCard(m)));
  }

  try {
    const genres = await getGenres();
    genres.forEach((g, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-chip";
      btn.textContent = g.name;
      btn.addEventListener("click", async () => {
        genresEl.querySelectorAll(".category-chip").forEach((el) => {
          el.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        grid.innerHTML = `<p class="muted">Loading…</p>`;
        const { results } = await getMoviesByGenre(g.id);
        renderMovies(results);
      });
      genresEl.appendChild(btn);
      if (idx === 0) btn.click();
    });
  } catch (err) {
    genresEl.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return;
    genresEl.querySelectorAll(".category-chip").forEach((el) => {
      el.classList.remove("is-active");
    });
    grid.innerHTML = `<p class="muted">Searching…</p>`;
    try {
      const { results } = await searchMovies(q);
      renderMovies(results);
    } catch (err) {
      grid.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    }
  });

  return { unmount() {} };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
