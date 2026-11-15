import { getMovieDetail, getTvDetail } from "../services/movieService.js";
import { addRecentMovie } from "../services/recentService.js";
import { getUser } from "../services/authService.js";
import { linkTo } from "../router/index.js";
import {
  addToWatchlist,
  isInWatchlist,
  removeByTmdbId,
} from "../services/watchlistService.js";
import { attachStreamAdGuard } from "../lib/streamGuard.js";
import {
  STREAM_PROVIDERS,
  bindStreamControls,
  buildStreamUrl,
  getStreamProvider,
  getStreamProviderMeta,
  getTvDefaults,
  renderStreamPlayer,
  setStreamProvider,
} from "../lib/streamEmbed.js";
import { loadingHtml } from "../components/Loading.js";
import {
  closeMiniPlayer,
  consumeMiniExpand,
  dockMiniPlayer,
  takeMiniPlayer,
} from "../lib/miniPlayer.js?v=156";

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
  let playerOpen = false;
  let minimizePlayer = () => {};

  root.innerHTML = loadingHtml();

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

    const year = movie.releaseDate
      ? String(movie.releaseDate).slice(0, 4)
      : "";
    const runtime = movie.runtime ? `${movie.runtime} min` : "";
    const rating =
      movie.rating != null && !Number.isNaN(Number(movie.rating))
        ? Number(movie.rating).toFixed(1)
        : "";
    const plot = movie.omdb?.plot || movie.overview || "";
    const safeBackdrop = escapeAttr(movie.backdrop || "");
    const safePoster = escapeAttr(movie.poster || "");

    root.innerHTML = `
      <article class="detail">
        ${
          movie.backdrop
            ? `<div class="detail__hero" style="background-image:url('${safeBackdrop}')" aria-hidden="true"></div>`
            : ""
        }

        <header class="detail__head">
          ${
            movie.poster
              ? `<img class="detail__poster" src="${safePoster}" alt="" />`
              : `<div class="detail__poster detail__poster--empty" aria-hidden="true"></div>`
          }
          <div class="detail__intro">
            <p class="detail__eyebrow">${
              mediaType === "tv" ? "TV Show" : "Movie"
            }</p>
            <h1>${escapeHtml(movie.title)}</h1>
            <ul class="detail__facts" aria-label="Title facts">
              ${year ? `<li>${escapeHtml(year)}</li>` : ""}
              ${runtime ? `<li>${escapeHtml(runtime)}</li>` : ""}
              ${
                rating
                  ? `<li><span class="detail__score">${escapeHtml(
                      rating
                    )}</span> TMDB</li>`
                  : ""
              }
            </ul>
            ${
              genres
                ? `<p class="detail__genres">${escapeHtml(genres)}</p>`
                : ""
            }
          </div>
        </header>

        <div class="detail__actions" id="actions"></div>

        <div class="detail__player" id="player" hidden></div>

        ${
          plot
            ? `<section class="detail__block">
                <h2>Overview</h2>
                <p class="detail__plot">${escapeHtml(plot)}</p>
              </section>`
            : ""
        }

        <div class="detail__omdb" id="omdb-ratings" hidden></div>

        ${
          movie.omdb?.director || movie.omdb?.actors
            ? `<section class="detail__block">
                <h2>Credits</h2>
                <dl class="detail__credits">
                  ${
                    movie.omdb.director
                      ? `<div><dt>Director</dt><dd>${escapeHtml(
                          movie.omdb.director
                        )}</dd></div>`
                      : ""
                  }
                  ${
                    movie.omdb.actors
                      ? `<div><dt>Cast</dt><dd>${escapeHtml(
                          movie.omdb.actors
                        )}</dd></div>`
                      : ""
                  }
                </dl>
              </section>`
            : ""
        }
      </article>
    `;

    const actions = root.querySelector("#actions");
    const player = root.querySelector("#player");
    const omdbBox = root.querySelector("#omdb-ratings");

    if (movie.omdb?.ratings?.length) {
      omdbBox.hidden = false;
      omdbBox.innerHTML = `
        <section class="detail__block">
          <h2>Ratings</h2>
          <div class="omdb-ratings">
            ${movie.omdb.ratings
              .map(
                (r) => `
              <div class="omdb-ratings__item">
                <span>${escapeHtml(shortRatingSource(r.Source))}</span>
                <strong>${escapeHtml(r.Value)}</strong>
              </div>`
              )
              .join("")}
          </div>
        </section>
      `;
    } else if (movie.omdb?.imdbRating) {
      omdbBox.hidden = false;
      omdbBox.innerHTML = `
        <section class="detail__block">
          <h2>Ratings</h2>
          <div class="omdb-ratings">
            <div class="omdb-ratings__item">
              <span>IMDb</span>
              <strong>${escapeHtml(movie.omdb.imdbRating)}/10</strong>
            </div>
          </div>
        </section>
      `;
    }

    let pushedPlayerState = false;
    let ignoreNextPop = false;
    const streamKey = `${mediaType}:${id}`;
    const returnHref = linkTo(mediaType === "tv" ? `/tv/${id}` : `/movie/${id}`);

    const liveStreamFrame = () => {
      const iframe = player.querySelector("#stream-iframe");
      if (!iframe) return null;
      const src = iframe.getAttribute("src") || "";
      if (!src || src === "about:blank") return null;
      return iframe;
    };

    const onPopState = () => {
      if (ignoreNextPop) {
        ignoreNextPop = false;
        pushedPlayerState = false;
        return;
      }
      if (!playerOpen) return;
      minimizePlayer();
      pushedPlayerState = false;
    };
    const onMiniExpand = () => {
      if (!consumeMiniExpand(streamKey)) return;
      openStream();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("lantaw-mini-expand", onMiniExpand);
    cleanupPlayerHistory = () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("lantaw-mini-expand", onMiniExpand);
    };

    const closePlayerSafely = () => {
      if (!playerOpen) return;
      // Explicit Close stops playback. Back shrinks it to the corner instead.
      const iframe = player.querySelector("#stream-iframe");
      if (iframe) iframe.src = "about:blank";
      closeMiniPlayer();
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

    minimizePlayer = () => {
      if (!playerOpen) return;
      const iframe = liveStreamFrame();
      cleanupStreamGuard();
      cleanupStreamGuard = () => {};
      if (iframe) {
        dockMiniPlayer({
          iframe,
          title: movie.title || "Now playing",
          href: returnHref,
          key: streamKey,
        });
      }
      player.hidden = true;
      player.innerHTML = "";
      playerOpen = false;
    };

    const minimizeFromBack = () => {
      if (!playerOpen) return;
      minimizePlayer();
      if (pushedPlayerState) {
        ignoreNextPop = true;
        pushedPlayerState = false;
        history.back();
      }
    };

    const mountStreamGuard = () => {
      cleanupStreamGuard();
      cleanupStreamGuard = attachStreamAdGuard(
        player.querySelector(".detail__player-frame--embed"),
        { onSafeExit: minimizeFromBack }
      );
    };

    const readEpisodeSelection = () => {
      const defaults = getTvDefaults(movie);
      const seasonEl = player.querySelector("#stream-season");
      const episodeEl = player.querySelector("#stream-episode");
      return {
        season: Math.max(
          1,
          Number(seasonEl?.value) || defaults.season
        ),
        episode: Math.max(
          1,
          Number(episodeEl?.value) || defaults.episode
        ),
      };
    };

    const providerModalHtml = () => {
      const active = getStreamProvider();
      return `
        <div class="detail__provider-modal" id="player-provider-modal" hidden>
          <div class="detail__provider-modal__backdrop" data-close-player-provider></div>
          <div
            class="detail__provider-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-provider-title"
          >
            <h2 id="player-provider-title">Try another server</h2>
            <p class="detail__provider-modal__lead">
              Not playing? Switch region for this title. Your choice is saved for next time.
            </p>
            <div class="me-provider-list" role="radiogroup" aria-label="Server regions">
              ${STREAM_PROVIDERS.map(
                (p) => `
                <button
                  type="button"
                  class="me-provider-option${p.id === active ? " is-active" : ""}"
                  role="radio"
                  aria-checked="${p.id === active ? "true" : "false"}"
                  data-player-provider="${escapeHtml(p.id)}"
                >
                  <span class="me-provider-option__copy">
                    <span class="me-provider-option__label">${escapeHtml(p.label)}</span>
                    <span class="me-provider-option__hint">${escapeHtml(p.hint)}</span>
                  </span>
                  <span class="me-provider-option__check" aria-hidden="true"></span>
                </button>`
              ).join("")}
            </div>
            <div class="detail__provider-modal__actions">
              <button type="button" class="detail__icon-btn" data-close-player-provider>Cancel</button>
            </div>
          </div>
        </div>
      `;
    };

    const syncPlayerProviderUi = () => {
      const active = getStreamProvider();
      player.querySelectorAll("[data-player-provider]").forEach((btn) => {
        const on = btn.getAttribute("data-player-provider") === active;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-checked", on ? "true" : "false");
      });
    };

    const closePlayerProviderModal = () => {
      const modal = player.querySelector("#player-provider-modal");
      if (modal) modal.hidden = true;
    };

    const openPlayerProviderModal = () => {
      syncPlayerProviderUi();
      const modal = player.querySelector("#player-provider-modal");
      if (modal) modal.hidden = false;
    };

    const switchStreamProvider = (providerId) => {
      const next = setStreamProvider(providerId);
      const { season, episode } = readEpisodeSelection();
      const iframe = player.querySelector("#stream-iframe");
      if (iframe) {
        iframe.removeAttribute("data-src");
        iframe.src = buildStreamUrl({
          mediaType,
          tmdbId: movie.id,
          season,
          episode,
          provider: next,
          autoplay: true,
        });
        const allowSandbox = getStreamProviderMeta(next).allowSandbox;
        if (allowSandbox) {
          iframe.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms allow-presentation"
          );
        } else {
          iframe.removeAttribute("sandbox");
        }
        iframe.setAttribute(
          "allow",
          "autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock"
        );
      }
      syncPlayerProviderUi();
      closePlayerProviderModal();
      mountStreamGuard();
    };

    const bindPlayerProviderModal = () => {
      player
        .querySelectorAll("[data-close-player-provider]")
        .forEach((el) => el.addEventListener("click", closePlayerProviderModal));
      player.querySelectorAll("[data-player-provider]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-player-provider");
          if (!id || id === getStreamProvider()) {
            closePlayerProviderModal();
            return;
          }
          switchStreamProvider(id);
        });
      });
      player
        .querySelector("#player-provider-open")
        ?.addEventListener("click", openPlayerProviderModal);
    };

    const showPlayer = (html, afterMount, { allowProviderSwitch = false } = {}) => {
      cleanupStreamGuard();
      cleanupStreamGuard = () => {};
      player.hidden = false;
      playerOpen = true;
      player.innerHTML = `
        <div class="detail__player-head">
          <p class="detail__player-label">Now playing</p>
          <div class="detail__player-head-actions">
            ${
              allowProviderSwitch
                ? `<button class="detail__icon-btn" id="player-provider-open" type="button" aria-label="Try another server" title="Try another server">
              <span aria-hidden="true">⇄</span>
              <span id="player-provider-label">Try another server</span>
            </button>`
                : ""
            }
            <button class="detail__icon-btn" id="player-close" type="button" aria-label="Close player">
              <span aria-hidden="true">✕</span>
              <span>Close</span>
            </button>
          </div>
        </div>
        ${html}
        ${allowProviderSwitch ? providerModalHtml() : ""}
      `;

      const closeBtn = player.querySelector("#player-close");
      closeBtn?.addEventListener("click", () => closePlayerSafely());
      if (allowProviderSwitch) bindPlayerProviderModal();

      if (!pushedPlayerState) {
        history.pushState({ detailPlayer: true }, "");
        pushedPlayerState = true;
      }

      afterMount?.();
      player.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const openStream = () => {
      const reused = takeMiniPlayer(streamKey);
      if (!reused) closeMiniPlayer();
      showPlayer(
        renderStreamPlayer(movie, mediaType),
        () => {
          if (reused) {
            const slot = player.querySelector("#stream-iframe");
            reused.id = "stream-iframe";
            slot?.replaceWith(reused);
          }
          mountStreamGuard();
          bindStreamControls(player, movie, mediaType, {
            onReload: () => mountStreamGuard(),
          });
        },
        { allowProviderSwitch: true }
      );
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

    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "detail__chip";
    shareBtn.innerHTML = `<span aria-hidden="true">↗</span><span>Share</span>`;
    shareBtn.addEventListener("click", async () => {
      const user = await getUser();
      if (!user) {
        location.hash = linkTo("/login");
        return;
      }
      const item = {
        id: Number(id),
        mediaType,
        title: movie.title || "Untitled",
        poster: movie.poster || null,
      };
      addRecentMovie(item);
      try {
        sessionStorage.setItem("lantaw-share-pending", JSON.stringify(item));
      } catch {
        /* ignore */
      }
      location.hash = linkTo("/friends");
    });
    tools.appendChild(shareBtn);

    const togetherBtn = document.createElement("button");
    togetherBtn.type = "button";
    togetherBtn.className = "detail__chip detail__chip--together";
    togetherBtn.innerHTML = `<span aria-hidden="true">◎</span><span>Watch together</span>`;
    togetherBtn.addEventListener("click", async () => {
      const user = await getUser();
      if (!user) {
        location.hash = linkTo("/login");
        return;
      }
      const item = {
        id: Number(id),
        mediaType,
        title: movie.title || "Untitled",
        poster: movie.poster || null,
      };
      addRecentMovie(item);
      try {
        sessionStorage.setItem("lantaw-shorts-watch", JSON.stringify(item));
      } catch {
        /* ignore */
      }
      location.hash = linkTo("/friends");
    });
    tools.appendChild(togetherBtn);

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
    if (consumeMiniExpand(streamKey)) openStream();
  } catch (err) {
    root.innerHTML = `
      <p class="muted">${escapeHtml(err.message)}</p>
    `;
  }

  return {
    unmount() {
      if (playerOpen) minimizePlayer();
      cleanupStreamGuard();
      cleanupPlayerHistory();
    },
  };
}

function shortRatingSource(source = "") {
  const s = String(source);
  if (/internet movie database/i.test(s)) return "IMDb";
  if (/rotten tomatoes/i.test(s)) return "Rotten Tomatoes";
  if (/metacritic/i.test(s)) return "Metacritic";
  return s;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
