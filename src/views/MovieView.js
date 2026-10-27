import { getMovieDetail, getTvDetail } from "../services/movieService.js";
import { addRecentMovie } from "../services/recentService.js";
import { linkTo } from "../router/index.js";
import {
  addToWatchlist,
  isInWatchlist,
  removeByTmdbId,
} from "../services/watchlistService.js";
import { attachStreamAdGuard } from "../lib/streamGuard.js";
import {
  bindStreamControls,
  renderStreamPlayer,
} from "../lib/streamEmbed.js";

export async function MovieView(root, params = {}) {
  return renderMediaDetail(root, params, "movie");
}

export async function TvView(root, params = {}) {
  return renderMediaDetail(root, params, "tv");
}

function legacyPartyRedirect() {
  const hash = location.hash.replace(/^#/, "");
  const qi = hash.indexOf("?");
  if (qi < 0) return false;
  const partyId = new URLSearchParams(hash.slice(qi + 1)).get("party");
  if (!partyId) return false;
  location.hash = linkTo(`/watch-party/${partyId}`);
  return true;
}

async function renderMediaDetail(root, params, mediaType) {
  if (legacyPartyRedirect()) {
    return { unmount() {} };
  }

  const id = params.id;
  let cleanupPlayerHistory = () => {};
  let cleanupStreamGuard = () => {};

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

    const closePlayerSafely = () => {
      if (!playerOpen) return;
      // Blank the embed first so its ← / unload hooks can't open ads.
      const iframe = player.querySelector("#stream-iframe");
      if (iframe) iframe.src = "about:blank";
      cleanupStreamGuard();
      cleanupStreamGuard = () => {};
      player.hidden = true;
      player.innerHTML = "";
      playerOpen = false;
      if (pushedPlayerState) {
        ignoreNextPop = true;
        pushedPlayerState = false;
        history.back();
      }
    };

    const hidePlayer = () => {
      if (!playerOpen) return;
      const iframe = player.querySelector("#stream-iframe");
      if (iframe) iframe.src = "about:blank";
      cleanupStreamGuard();
      cleanupStreamGuard = () => {};
      player.hidden = true;
      player.innerHTML = "";
      playerOpen = false;
    };

    const mountStreamGuard = () => {
      cleanupStreamGuard();
      cleanupStreamGuard = attachStreamAdGuard(
        player.querySelector(".detail__player-frame--embed"),
        { onSafeExit: closePlayerSafely }
      );
    };

    const showPlayer = (html, afterMount) => {
      cleanupStreamGuard();
      cleanupStreamGuard = () => {};
      player.hidden = false;
      playerOpen = true;
      player.innerHTML = `
        <div class="detail__player-head">
          <p class="detail__player-label">Now playing</p>
          <button class="detail__icon-btn" id="player-close" type="button" aria-label="Close player">
            <span aria-hidden="true">✕</span>
            <span>Close</span>
          </button>
        </div>
        ${html}
      `;

      const closeBtn = player.querySelector("#player-close");
      closeBtn?.addEventListener("click", () => closePlayerSafely());

      if (!pushedPlayerState) {
        history.pushState({ detailPlayer: true }, "");
        pushedPlayerState = true;
      }

      afterMount?.();
      player.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const openStream = () => {
      showPlayer(renderStreamPlayer(movie, mediaType), () => {
        mountStreamGuard();
        bindStreamControls(player, movie, mediaType, {
          onReload: () => mountStreamGuard(),
        });
      });
    };

    actions.classList.add("detail__actions");
    actions.innerHTML = `
      <button type="button" class="btn btn--primary detail__watch-btn" id="watch-now">
        Watch now
      </button>
      <div class="detail__tools" id="detail-tools"></div>
    `;

    const tools = actions.querySelector("#detail-tools");
    actions.querySelector("#watch-now")?.addEventListener("click", () => openStream());

    if (trailerKey) {
      const trailerBtn = document.createElement("button");
      trailerBtn.type = "button";
      trailerBtn.className = "detail__chip";
      trailerBtn.innerHTML = `<span aria-hidden="true">▶</span><span>Trailer</span>`;
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
      tools.appendChild(trailerBtn);
    }

    const watchBtn = document.createElement("button");
    watchBtn.type = "button";
    watchBtn.className = "detail__chip";
    const syncLabel = () => {
      watchBtn.classList.toggle("is-active", saved);
      watchBtn.innerHTML = saved
        ? `<span aria-hidden="true">★</span><span>In watchlist</span>`
        : `<span aria-hidden="true">☆</span><span>Watchlist</span>`;
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
    tools.appendChild(watchBtn);
  } catch (err) {
    root.innerHTML = `
      <a class="back" href="${linkTo("/")}">← Back</a>
      <p class="muted">${escapeHtml(err.message)}</p>
    `;
  }

  return {
    unmount() {
      cleanupStreamGuard();
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
