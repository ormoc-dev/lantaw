import { getTopRatedMovies } from "../services/movieService.js";
import { MovieCard } from "../components/MovieCard.js";
import { loadingHtml } from "../components/Loading.js";

export async function RankingsView(root) {
  root.innerHTML = `
    <div class="page-pad">
      <header class="page-head">
        <h1>Rankings</h1>
        <p class="muted">Highest rated titles on TMDB.</p>
      </header>
      <ol class="rank-list" id="list">
        <li>${loadingHtml()}</li>
      </ol>
    </div>
  `;

  const list = root.querySelector("#list");

  try {
    const { results } = await getTopRatedMovies();
    list.innerHTML = "";
    results.forEach((m, i) => {
      const li = document.createElement("li");
      li.className = "rank-list__item";
      li.innerHTML = `<span class="rank-list__num">${i + 1}</span>`;
      const wrap = document.createElement("div");
      wrap.className = "rank-list__card";
      wrap.appendChild(MovieCard(m));
      li.appendChild(wrap);
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = `<li class="muted">${escapeHtml(err.message)}</li>`;
  }

  return { unmount() {} };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
