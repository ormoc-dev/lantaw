import { getMovieDetail, getTvDetail } from "../services/movieService.js";
import { addRecentMovie } from "../services/recentService.js";
import { linkTo } from "../router/index.js";
import {
  addToWatchlist,
  isInWatchlist,
  removeByTmdbId,
} from "../services/watchlistService.js";

export async function MovieView(root, params = {}) {
  return renderMediaDetail(root, params, "movie");
}

export async function TvView(root, params = {}) {
  return renderMediaDetail(root, params, "tv");
}

async function renderMediaDetail(root, params, mediaType) {
  const id = params.id;

  root.innerHTML = `
    <a class="back" href="${linkTo("/")}">← Back</a>
    <p class="muted">Loading…</p>
  `;

  if (!id) {
    root.innerHTML = `<p class="muted">Missing id.</p>`;
    return { unmount() {} };
  }

  try {
    const movie =
      mediaType === "tv" ? await getTvDetail(id) : await getMovieDetail(id);
    addRecentMovie(movie);
    const genres = (movie.genres || []).map((g) => g.name).join(" · ");
    let saved = await isInWatchlist(Number(id));
    const trailerKey = movie.trailer?.key;

    root.innerHTML = `
      <a class="back" href="${linkTo("/")}">← Back</a>
      <article class="detail">
        ${
          movie.backdrop
            ? `<div class="detail__hero" style="background-image:url('${movie.backdrop}')"></div>`
            : ""
        }
        <div class="detail__body">
          ${
            movie.poster
              ? `<img class="detail__poster" src="${movie.poster}" alt="" />`
              : ""
          }
          <div>
            <h1>${escapeHtml(movie.title)}</h1>
            <p class="muted">${movie.releaseDate || "—"} · ${
              movie.runtime ? `${movie.runtime} min` : "—"
            } · ${movie.rating?.toFixed?.(1) ?? "—"}</p>
            <p class="muted">${escapeHtml(genres)}</p>
            <p>${escapeHtml(movie.overview || "")}</p>
            <div class="detail__actions" id="actions"></div>
            <div class="detail__player" id="player" hidden></div>
          </div>
        </div>
      </article>
    `;

    const actions = root.querySelector("#actions");
    const player = root.querySelector("#player");

    if (trailerKey) {
      const trailerBtn = document.createElement("button");
      trailerBtn.type = "button";
      trailerBtn.className = "btn btn--primary";
      trailerBtn.textContent = "Watch trailer";
      trailerBtn.addEventListener("click", () => {
        player.hidden = false;
        player.innerHTML = `
          <div class="detail__player-frame">
            <iframe
              src="https://www.youtube.com/embed/${escapeHtml(
                trailerKey
              )}?autoplay=1&rel=0"
              title="Trailer"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          </div>
          <a
            class="link-btn"
            href="https://www.youtube.com/watch?v=${encodeURIComponent(
              trailerKey
            )}"
            target="_blank"
            rel="noopener noreferrer"
          >Open on YouTube</a>
        `;
        player.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      actions.appendChild(trailerBtn);
    } else {
      const note = document.createElement("p");
      note.className = "muted detail__no-trailer";
      note.textContent = "No trailer available.";
      actions.appendChild(note);
    }

    const watchBtn = document.createElement("button");
    watchBtn.type = "button";
    watchBtn.className = "btn btn--ghost";
    const syncLabel = () => {
      watchBtn.textContent = saved ? "Remove from watchlist" : "Add to watchlist";
    };
    syncLabel();
    watchBtn.addEventListener("click", async () => {
      watchBtn.disabled = true;
      try {
        if (saved) {
          await removeByTmdbId(Number(id));
          saved = false;
        } else {
          await addToWatchlist({
            tmdbId: Number(id),
            title: movie.title,
            poster: movie.poster,
          });
          saved = true;
        }
        syncLabel();
      } catch (err) {
        alert(err.message);
      } finally {
        watchBtn.disabled = false;
      }
    });
    actions.appendChild(watchBtn);
  } catch (err) {
    root.innerHTML = `
      <a class="back" href="${linkTo("/")}">← Back</a>
      <p class="muted">${escapeHtml(err.message)}</p>
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
