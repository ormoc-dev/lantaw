import { getMovieDetail, getTvDetail } from "../services/movieService.js";
import { addRecentMovie } from "../services/recentService.js";
import { getUser } from "../services/authService.js";
import { linkTo } from "../router/index.js";
import {
  addToWatchlist,
  isInWatchlist,
  removeByTmdbId,
} from "../services/watchlistService.js";
import {
  listFriendships,
  sendMessage,
} from "../services/friendsService.js";
import { shareMessageBody } from "../lib/shareMessage.js";
import { showNotice } from "../lib/appModal.js";
import { attachStreamAdGuard } from "../lib/streamGuard.js";
import {
  bindStreamControls,
  renderStreamPlayer,
} from "../lib/streamEmbed.js";
import { loadingHtml } from "../components/Loading.js";

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
      await openShareToChat(item);
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
  } catch (err) {
    root.innerHTML = `
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

function shortRatingSource(source = "") {
  const s = String(source);
  if (/internet movie database/i.test(s)) return "IMDb";
  if (/rotten tomatoes/i.test(s)) return "Rotten Tomatoes";
  if (/metacritic/i.test(s)) return "Metacritic";
  return s;
}

function shareAvatarHtml(p) {
  const name = p?.display_name || p?.email || "?";
  const initial = name.slice(0, 1).toUpperCase();
  if (p?.avatar_url) {
    return `<img class="fp-avatar fp-avatar--sm" src="${escapeAttr(
      p.avatar_url
    )}" alt="" referrerpolicy="no-referrer" />`;
  }
  return `<span class="fp-avatar fp-avatar--fallback fp-avatar--sm">${escapeHtml(
    initial
  )}</span>`;
}

/**
 * Pick a friend and post a share card into their chat.
 * @param {{ id: number, mediaType: string, title: string, poster: string|null }} item
 */
async function openShareToChat(item) {
  let friends = [];
  try {
    const rows = await listFriendships();
    friends = rows.filter((f) => f.status === "accepted");
  } catch (err) {
    await showNotice({
      title: "Share",
      message: err.message || "Could not load friends.",
    });
    return;
  }

  if (!friends.length) {
    await showNotice({
      title: "Share",
      message: "Add a friend first to share titles in chat.",
    });
    return;
  }

  return new Promise((resolve) => {
    let host = document.getElementById("app-modal-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "app-modal-host";
      document.body.appendChild(host);
    }

    const wrap = document.createElement("div");
    wrap.className = "me-modal app-modal share-pick";
    wrap.innerHTML = `
      <div class="me-modal__backdrop" data-share-cancel></div>
      <div
        class="me-modal__dialog share-pick__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-pick-title"
      >
        <h2 id="share-pick-title">Share in chat</h2>
        <p class="me-modal__lead">Send <strong>${escapeHtml(
          item.title || "this title"
        )}</strong> to a friend. They’ll see Watch together under the card.</p>
        <div class="share-pick__list" role="list">
          ${friends
            .map(
              (f) => `
            <button type="button" class="share-pick__row" data-share-friend="${escapeAttr(
              f.id
            )}" role="listitem">
              ${shareAvatarHtml(f.other)}
              <span class="share-pick__name">${escapeHtml(
                f.other?.display_name || f.other?.email || "Friend"
              )}</span>
            </button>`
            )
            .join("")}
        </div>
        <div class="me-modal__actions me-modal__actions--single">
          <button type="button" class="me-modal__btn" data-share-cancel>Cancel</button>
        </div>
      </div>
    `;

    const finish = () => {
      document.body.classList.remove("me-modal-open");
      wrap.remove();
      window.removeEventListener("keydown", onKey);
      resolve();
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    };

    wrap.querySelectorAll("[data-share-cancel]").forEach((el) => {
      el.addEventListener("click", finish);
    });

    wrap.querySelectorAll("[data-share-friend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const friendshipId = btn.getAttribute("data-share-friend");
        if (!friendshipId) return;
        wrap.querySelectorAll("[data-share-friend]").forEach((b) => {
          b.disabled = true;
        });
        try {
          await sendMessage(friendshipId, shareMessageBody(item));
          finish();
          location.hash = linkTo(`/friends?chat=${encodeURIComponent(friendshipId)}`);
        } catch (err) {
          wrap.querySelectorAll("[data-share-friend]").forEach((b) => {
            b.disabled = false;
          });
          await showNotice({
            title: "Share",
            message: err.message || "Could not send.",
          });
        }
      });
    });

    window.addEventListener("keydown", onKey);
    host.appendChild(wrap);
    document.body.classList.add("me-modal-open");
  });
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
