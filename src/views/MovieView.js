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
  let cleanupPlayerHistory = () => {};

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
            <div class="detail__omdb" id="omdb-ratings"></div>
            <p>${escapeHtml(
              movie.omdb?.plot || movie.overview || ""
            )}</p>
            ${
              movie.omdb?.director || movie.omdb?.actors
                ? `<p class="muted detail__credits-line">${
                    movie.omdb.director
                      ? `<strong>Director:</strong> ${escapeHtml(
                          movie.omdb.director
                        )}`
                      : ""
                  }${
                    movie.omdb.director && movie.omdb.actors ? " · " : ""
                  }${
                    movie.omdb.actors
                      ? `<strong>Actors:</strong> ${escapeHtml(
                          movie.omdb.actors
                        )}`
                      : ""
                  }</p>`
                : ""
            }
            <div class="detail__actions" id="actions"></div>
            <div class="detail__player" id="player" hidden></div>
          </div>
        </div>
      </article>
    `;

    const actions = root.querySelector("#actions");
    const player = root.querySelector("#player");
    const omdbBox = root.querySelector("#omdb-ratings");

    if (movie.omdb?.ratings?.length) {
      omdbBox.innerHTML = `
        <div class="omdb-ratings">
          ${movie.omdb.ratings
            .map(
              (r) => `
            <div class="omdb-ratings__item">
              <span>${escapeHtml(r.Source)}</span>
              <strong>${escapeHtml(r.Value)}</strong>
            </div>`
            )
            .join("")}
        </div>
      `;
    } else if (movie.omdb?.imdbRating) {
      omdbBox.innerHTML = `
        <div class="omdb-ratings">
          <div class="omdb-ratings__item">
            <span>Internet Movie Database</span>
            <strong>${escapeHtml(movie.omdb.imdbRating)}/10</strong>
          </div>
        </div>
      `;
    }

    let playerOpen = false;
    let pushedPlayerState = false;
    let ignoreNextPop = false;
    const onPopState = () => {
      if (ignoreNextPop) {
        ignoreNextPop = false;
        pushedPlayerState = false;
        return;
      }
      if (!playerOpen) return;
      hidePlayer();
      pushedPlayerState = false;
    };
    window.addEventListener("popstate", onPopState);
    cleanupPlayerHistory = () => {
      window.removeEventListener("popstate", onPopState);
    };

    const hidePlayer = () => {
      if (!playerOpen) return;
      player.hidden = true;
      player.innerHTML = "";
      playerOpen = false;
    };

    const showPlayer = (html, afterMount) => {
      player.hidden = false;
      playerOpen = true;
      player.innerHTML = `
        <div class="detail__player-head">
          <button class="btn btn--ghost" id="player-close" type="button">Close player</button>
        </div>
        ${html}
      `;

      const closeBtn = player.querySelector("#player-close");
      closeBtn?.addEventListener("click", () => {
        hidePlayer();
        if (pushedPlayerState) {
          ignoreNextPop = true;
          history.back();
        }
      });

      if (!pushedPlayerState) {
        history.pushState({ detailPlayer: true }, "");
        pushedPlayerState = true;
      }

      afterMount?.();
      player.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const streamBtn = document.createElement("button");
    streamBtn.type = "button";
    streamBtn.className = "btn btn--primary";
    streamBtn.textContent = "Watch now";
    streamBtn.addEventListener("click", () => {
      showPlayer(renderStreamPlayer(movie, mediaType), () => {
        bindStreamControls(player, movie, mediaType);
      });
    });
    actions.appendChild(streamBtn);

    if (trailerKey) {
      const trailerBtn = document.createElement("button");
      trailerBtn.type = "button";
      trailerBtn.className = "btn btn--ghost";
      trailerBtn.textContent = "Watch trailer";
      trailerBtn.addEventListener("click", () => {
        showPlayer(`
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
        `);
      });
      actions.appendChild(trailerBtn);
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

  return {
    unmount() {
      cleanupPlayerHistory();
    },
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getTvDefaults(movie) {
  const firstSeason = Array.isArray(movie.seasons) && movie.seasons.length
    ? movie.seasons[0]
    : { seasonNumber: 1, episodeCount: 1, name: "Season 1" };

  return {
    season: Math.max(1, Number(firstSeason.seasonNumber) || 1),
    episode: 1,
  };
}

function buildStreamUrl({ mediaType, tmdbId, season = 1, episode = 1, anilistId }) {
  if (mediaType === "tv") {
    return `https://zoryva.me/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(
      season
    )}/${encodeURIComponent(episode)}?color=%23ff0a43`;
  }
  if (mediaType === "anime") {
    return `https://zoryva.me/embed/anime/${encodeURIComponent(
      anilistId || tmdbId
    )}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}?color=%23ff0a43`;
  }
  return `https://zoryva.me/embed/movie/${encodeURIComponent(tmdbId)}?color=%23ff0a43`;
}

function renderStreamPlayer(movie, mediaType) {
  if (mediaType === "tv") {
    const defaults = getTvDefaults(movie);
    const options = (movie.seasons || [])
      .map(
        (season) =>
          `<option value="${season.seasonNumber}" data-episode-count="${season.episodeCount}">${escapeHtml(
            season.name
          )}</option>`
      )
      .join("");

    const seasonSelect = options
      ? `<select id="stream-season">${options}</select>`
      : `<input id="stream-season" type="number" min="1" value="${defaults.season}" />`;

    const streamUrl = buildStreamUrl({
      mediaType,
      tmdbId: movie.id,
      season: defaults.season,
      episode: defaults.episode,
    });

    return `
      <div class="stream-controls">
        <label>Season ${seasonSelect}</label>
        <label>Episode <input id="stream-episode" type="number" min="1" value="${defaults.episode}" /></label>
        <button class="btn btn--ghost" id="stream-reload" type="button">Load episode</button>
      </div>
      <div class="detail__player-frame detail__player-frame--embed">
        <iframe
          id="stream-iframe"
          src="${streamUrl}"
          title="Streaming player"
          frameborder="0"
          style="border: 0; border-radius: 12px;"
          allow="autoplay; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-presentation"
          referrerpolicy="no-referrer"
          allowfullscreen
        ></iframe>
      </div>
    `;
  }

  const streamUrl = buildStreamUrl({ mediaType, tmdbId: movie.id });
  return `
    <div class="detail__player-frame detail__player-frame--embed">
      <iframe
        id="stream-iframe"
        src="${streamUrl}"
        title="Streaming player"
        frameborder="0"
        style="border: 0; border-radius: 12px;"
        allow="autoplay; fullscreen; picture-in-picture"
        sandbox="allow-scripts allow-presentation"
        referrerpolicy="no-referrer"
        allowfullscreen
      ></iframe>
    </div>
  `;
}

function bindStreamControls(player, movie, mediaType) {
  if (mediaType !== "tv") return;

  const seasonEl = player.querySelector("#stream-season");
  const episodeEl = player.querySelector("#stream-episode");
  const reloadBtn = player.querySelector("#stream-reload");
  const iframe = player.querySelector("#stream-iframe");

  if (!seasonEl || !episodeEl || !reloadBtn || !iframe) return;

  const clampEpisode = () => {
    if (seasonEl.tagName !== "SELECT") return;
    const selected = seasonEl.selectedOptions?.[0];
    const max = Number(selected?.dataset?.episodeCount || 1);
    const current = Number(episodeEl.value) || 1;
    if (current < 1) episodeEl.value = "1";
    if (current > max) episodeEl.value = String(max);
    episodeEl.max = String(max);
  };

  seasonEl.addEventListener("change", clampEpisode);
  clampEpisode();

  reloadBtn.addEventListener("click", () => {
    const season = Math.max(1, Number(seasonEl.value) || 1);
    const episode = Math.max(1, Number(episodeEl.value) || 1);
    iframe.src = buildStreamUrl({
      mediaType,
      tmdbId: movie.id,
      season,
      episode,
    });
  });
}
