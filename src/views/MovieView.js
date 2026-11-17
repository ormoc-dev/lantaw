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
  addTitleComment,
  deleteTitleComment,
  listTitleComments,
  toggleTitleCommentLike,
} from "../services/commentService.js";
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
  clearWatchingNow,
  publishWatchingNow,
} from "../services/watchingService.js";

const SERVER_SWITCH_LOADING_MS = 12_000;

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
  let stopPlayer = () => {};
  let clearServerSwitchLoading = () => {};

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
        <div class="detail__player" id="player" hidden></div>

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

        ${
          plot || movie.omdb?.ratings?.length || movie.omdb?.imdbRating || movie.omdb?.director || movie.omdb?.actors
            ? `<section class="detail__block detail__overview-block">
                <h2>Overview</h2>
                ${
                  plot
                    ? `<button
                  type="button"
                  class="detail__plot is-collapsed"
                  id="detail-plot"
                  aria-expanded="false"
                  aria-controls="detail-overview-more"
                >${escapeHtml(plot)}</button>`
                    : `<button
                  type="button"
                  class="detail__plot detail__plot--toggle is-collapsed"
                  id="detail-plot"
                  aria-expanded="false"
                  aria-controls="detail-overview-more"
                >Show details</button>`
                }
                <div class="detail__overview-more" id="detail-overview-more" hidden>
                  <div class="detail__omdb" id="omdb-ratings" hidden></div>
                  ${
                    movie.omdb?.director || movie.omdb?.actors
                      ? `<div class="detail__overview-credits">
                          <h3>Credits</h3>
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
                        </div>`
                      : ""
                  }
                </div>
              </section>`
            : ""
        }

        <section class="detail__block detail__comments" aria-labelledby="detail-comments-title">
          <h2 class="detail__comments-title" id="detail-comments-title">
            <span id="comments-count">Comments</span>
          </h2>
          <div id="comments-compose" class="detail__comments-compose"></div>
          <div id="comments-list" class="detail__comments-list">
            ${loadingHtml({ className: "ui-loading--inline", size: "sm" })}
          </div>
        </section>
      </article>
    `;

    const actions = root.querySelector("#actions");
    const player = root.querySelector("#player");
    const omdbBox = root.querySelector("#omdb-ratings");
    const overviewMore = root.querySelector("#detail-overview-more");
    const setPlayingLayout = (on) => {
      root.querySelector(".detail")?.classList.toggle("detail--playing", on);
    };

    const setOverviewExpanded = (open) => {
      const btn = root.querySelector("#detail-plot");
      if (btn) {
        btn.classList.toggle("is-collapsed", !open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        if (btn.classList.contains("detail__plot--toggle")) {
          btn.textContent = open ? "Hide details" : "Show details";
        }
      }
      if (overviewMore) overviewMore.hidden = !open;
    };

    root.querySelector("#detail-plot")?.addEventListener("click", () => {
      const btn = root.querySelector("#detail-plot");
      const open = btn?.getAttribute("aria-expanded") !== "true";
      setOverviewExpanded(open);
    });

    if (omdbBox && movie.omdb?.ratings?.length) {
      omdbBox.hidden = false;
      omdbBox.innerHTML = `
        <h3>Ratings</h3>
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
      `;
    } else if (omdbBox && movie.omdb?.imdbRating) {
      omdbBox.hidden = false;
      omdbBox.innerHTML = `
        <h3>Ratings</h3>
        <div class="omdb-ratings">
          <div class="omdb-ratings__item">
            <span>IMDb</span>
            <strong>${escapeHtml(movie.omdb.imdbRating)}/10</strong>
          </div>
        </div>
      `;
    }

    const hasOverviewMore =
      (omdbBox && !omdbBox.hidden) ||
      Boolean(overviewMore?.querySelector(".detail__overview-credits"));
    if (overviewMore && !hasOverviewMore) overviewMore.remove();

    let pushedPlayerState = false;
    let ignoreNextPop = false;

    const onPopState = () => {
      if (ignoreNextPop) {
        ignoreNextPop = false;
        pushedPlayerState = false;
        return;
      }
      if (!playerOpen) return;
      stopPlayer();
      pushedPlayerState = false;
    };
    window.addEventListener("popstate", onPopState);
    cleanupPlayerHistory = () => {
      window.removeEventListener("popstate", onPopState);
    };

    const closePlayerSafely = () => {
      if (!playerOpen) return;
      stopPlayer();
      if (pushedPlayerState) {
        ignoreNextPop = true;
        pushedPlayerState = false;
        history.back();
      }
    };

    stopPlayer = () => {
      if (!playerOpen) return;
      clearServerSwitchLoading();
      const iframe = player.querySelector("#stream-iframe");
      if (iframe) iframe.src = "about:blank";
      clearWatchingNow().catch(() => {});
      cleanupStreamGuard();
      cleanupStreamGuard = () => {};
      player.hidden = true;
      player.innerHTML = "";
      playerOpen = false;
      setPlayingLayout(false);
    };

    // Closing the tab / leaving the page must drop “Watching now” for friends.
    const clearWatchingOnLeave = () => {
      if (!playerOpen) return;
      clearWatchingNow().catch(() => {});
    };
    window.addEventListener("pagehide", clearWatchingOnLeave);
    window.addEventListener("beforeunload", clearWatchingOnLeave);
    const previousCleanupHistory = cleanupPlayerHistory;
    cleanupPlayerHistory = () => {
      window.removeEventListener("pagehide", clearWatchingOnLeave);
      window.removeEventListener("beforeunload", clearWatchingOnLeave);
      previousCleanupHistory?.();
    };

    const mountStreamGuard = ({ alreadyPlaying = false } = {}) => {
      cleanupStreamGuard();
      // Quiet first-tap catcher + deferred src (see streamGuard) — blocks the
      // common "Watch now → embed opens a tab" popup chain. Close stays below.
      cleanupStreamGuard = attachStreamAdGuard(
        player.querySelector(".detail__player-frame--embed"),
        {
          onSafeExit: closePlayerSafely,
          skipShield: true,
          ghostShield: !alreadyPlaying,
          showExit: false,
        }
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

    let serverSwitchTimer = 0;
    let serverSwitchLoadHandler = null;

    clearServerSwitchLoading = () => {
      if (serverSwitchTimer) {
        clearTimeout(serverSwitchTimer);
        serverSwitchTimer = 0;
      }
      const iframe = player.querySelector("#stream-iframe");
      if (iframe && serverSwitchLoadHandler) {
        iframe.removeEventListener("load", serverSwitchLoadHandler);
        serverSwitchLoadHandler = null;
      }
      player
        .querySelector(".detail__player-frame--embed")
        ?.classList.remove("is-switching-server");
      player.querySelector("#player-server-loading")?.remove();
      player
        .querySelectorAll("[data-player-provider]")
        .forEach((btn) => {
          btn.disabled = false;
        });
    };

    const showServerSwitchLoading = (regionLabel) => {
      clearServerSwitchLoading();
      const frame = player.querySelector(".detail__player-frame--embed");
      if (!frame) return;
      frame.classList.add("is-switching-server");
      const overlay = document.createElement("div");
      overlay.id = "player-server-loading";
      overlay.className = "detail__server-loading";
      overlay.innerHTML = loadingHtml({
        label: `Switching to ${regionLabel}…`,
        className: "detail__server-loading__inner",
      });
      frame.appendChild(overlay);
      player
        .querySelectorAll("[data-player-provider]")
        .forEach((btn) => {
          btn.disabled = true;
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
      const regionLabel = getStreamProviderMeta(next).label;
      const { season, episode } = readEpisodeSelection();
      const iframe = player.querySelector("#stream-iframe");
      showServerSwitchLoading(regionLabel);
      closePlayerProviderModal();
      if (iframe) {
        iframe.removeAttribute("data-src");
        const allowSandbox = getStreamProviderMeta(next).allowSandbox;
        if (allowSandbox) {
          iframe.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock"
          );
        } else {
          iframe.removeAttribute("sandbox");
        }
        iframe.setAttribute("referrerpolicy", "no-referrer");
        iframe.setAttribute(
          "allow",
          "autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock"
        );
        serverSwitchLoadHandler = () => {
          if (serverSwitchTimer) {
            clearTimeout(serverSwitchTimer);
            serverSwitchTimer = 0;
          }
          serverSwitchLoadHandler = null;
          // Keep the spinner briefly so the embed can paint.
          serverSwitchTimer = window.setTimeout(() => {
            clearServerSwitchLoading();
          }, 450);
        };
        iframe.addEventListener("load", serverSwitchLoadHandler, { once: true });
        serverSwitchTimer = window.setTimeout(() => {
          clearServerSwitchLoading();
        }, SERVER_SWITCH_LOADING_MS);
        const nextUrl = buildStreamUrl({
          mediaType,
          tmdbId: movie.id,
          season,
          episode,
          provider: next,
          autoplay: true,
        });
        // Break user-gesture chaining from the server-switch click.
        iframe.src = "about:blank";
        window.setTimeout(() => {
          if (iframe.isConnected) iframe.src = nextUrl;
        }, 0);
      } else {
        clearServerSwitchLoading();
      }
      syncPlayerProviderUi();
      mountStreamGuard({ alreadyPlaying: false });
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
      setPlayingLayout(true);
      player.innerHTML = `
        ${html}
        <div class="detail__player-head detail__player-head--below">
          <p class="detail__player-label">Now playing</p>
          <div class="detail__player-head-actions">
            ${
              allowProviderSwitch
                ? `<button class="detail__icon-btn" id="player-provider-open" type="button" aria-label="Choose server if not working" title="Choose server if not working">
              <span aria-hidden="true">⇄</span>
              <span id="player-provider-label" class="detail__icon-btn__text">
                <span class="detail__icon-btn__full">Choose server if not working</span>
                <span class="detail__icon-btn__short">Choose server if not working</span>
              </span>
            </button>`
                : ""
            }
            <button class="detail__icon-btn" id="player-close" type="button" aria-label="Close player">
              <span aria-hidden="true">✕</span>
              <span class="detail__icon-btn__full">Close</span>
            </button>
          </div>
        </div>
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
      const view = document.getElementById("view");
      if (view) view.scrollTo({ top: 0, behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
      player.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const openStream = () => {
      showPlayer(
        renderStreamPlayer(movie, mediaType, {
          // Fresh loads stay blank until the ghost shield tap (blocks popup chain).
          deferSrc: true,
          autoplay: true,
        }),
        () => {
          mountStreamGuard({ alreadyPlaying: false });
          bindStreamControls(player, movie, mediaType, {
            onReload: () => mountStreamGuard({ alreadyPlaying: false }),
            autoplay: true,
          });
          publishWatchingNow({
            mediaType,
            tmdbId: Number(id),
            title: movie.title || "Untitled",
            poster: movie.poster || null,
          }).catch(() => {});
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

    const commentsList = root.querySelector("#comments-list");
    const commentsCompose = root.querySelector("#comments-compose");
    const commentsCount = root.querySelector("#comments-count");
    let comments = [];
    let meId = null;
    let replyToId = null;

    const formatCommentTime = (iso) => {
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return "";
      const diff = Math.max(0, Date.now() - t);
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 7) return `${days}d ago`;
      return new Date(iso).toLocaleDateString();
    };

    const avatarHtml = (name, avatarUrl) => {
      const initial = String(name || "F").slice(0, 1).toUpperCase();
      if (avatarUrl) {
        return `<img class="detail__comment-avatar" src="${escapeAttr(
          avatarUrl
        )}" alt="" referrerpolicy="no-referrer" />`;
      }
      return `<span class="detail__comment-avatar detail__comment-avatar--fallback" aria-hidden="true">${escapeHtml(
        initial
      )}</span>`;
    };

    const commentCard = (c, { reply = false } = {}) => {
      const name = c.author_name || "Fan";
      const mine = meId && c.user_id === meId;
      const liked = Boolean(c.liked);
      const likes = Number(c.like_count) || 0;
      const replyForm =
        !reply && replyToId === c.id
          ? `<form class="detail__comment-reply-form" data-reply-form="${escapeAttr(c.id)}">
              <textarea rows="2" maxlength="1000" placeholder="Write a reply…" aria-label="Reply" required></textarea>
              <div class="detail__comment-reply-actions">
                <button type="button" class="detail__comments-cancel" data-reply-cancel>Cancel</button>
                <button type="submit" class="detail__comments-submit">Reply</button>
              </div>
            </form>`
          : "";
      return `
        <article class="detail__comment${reply ? " detail__comment--reply" : ""}" data-comment-id="${escapeAttr(c.id)}">
          ${avatarHtml(name, c.author_avatar)}
          <div class="detail__comment-body">
            <div class="detail__comment-top">
              <div class="detail__comment-meta">
                <strong>${escapeHtml(name)}</strong>
                <time datetime="${escapeAttr(c.created_at)}">${escapeHtml(
                  formatCommentTime(c.created_at)
                )}</time>
              </div>
              ${
                mine
                  ? `<button
                      type="button"
                      class="detail__comment-delete"
                      data-delete-comment="${escapeAttr(c.id)}"
                      aria-label="Delete comment"
                      title="Delete"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>`
                  : ""
              }
            </div>
            <p>${escapeHtml(c.body)}</p>
            <div class="detail__comment-actions">
              <button
                type="button"
                class="detail__comment-like${liked ? " is-liked" : ""}"
                data-like-comment="${escapeAttr(c.id)}"
                aria-pressed="${liked ? "true" : "false"}"
                aria-label="${liked ? "Unlike" : "Like"}"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 20s-7-4.4-7-9.1C5 8 6.8 6.2 9.2 6.2c1.3 0 2.4.6 2.8 1.6.4-1 1.5-1.6 2.8-1.6C17.2 6.2 19 8 19 10.9 19 15.6 12 20 12 20Z" fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                </svg>
                <span>${likes ? escapeHtml(String(likes)) : "Like"}</span>
              </button>
              <button type="button" class="detail__comment-reply" data-reply-comment="${escapeAttr(
                reply ? c.parent_id || c.id : c.id
              )}">Reply</button>
            </div>
            ${replyForm}
          </div>
        </article>`;
    };

    const renderComments = () => {
      const roots = comments.filter((c) => !c.parent_id);
      const repliesOf = (parentId) =>
        comments
          .filter((c) => c.parent_id === parentId)
          .slice()
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
      if (commentsCount) {
        const n = comments.length;
        commentsCount.textContent = n === 1 ? "1 Comment" : `${n} Comments`;
      }
      if (!commentsList) return;
      if (!roots.length) {
        commentsList.innerHTML = `
          <p class="detail__comments-empty">No comments yet. Be the first.</p>`;
        return;
      }
      commentsList.innerHTML = roots
        .map((c) => {
          const replies = repliesOf(c.id);
          return `
            <div class="detail__comment-thread">
              ${commentCard(c)}
              ${
                replies.length
                  ? `<div class="detail__comment-replies">${replies
                      .map((reply) => commentCard(reply, { reply: true }))
                      .join("")}</div>`
                  : ""
              }
            </div>`;
        })
        .join("");
    };

    const paintCompose = async (user) => {
      if (!commentsCompose) return;
      if (!user) {
        commentsCompose.innerHTML = `
          <a class="detail__comments-signin" href="${linkTo("/login")}">
            Add a comment…
          </a>`;
        return;
      }

      commentsCompose.innerHTML = `
        <form class="detail__comments-form" id="comments-form" autocomplete="off">
          <div class="detail__comments-form-main">
            <textarea
              id="comment-input"
              rows="1"
              maxlength="1000"
              placeholder="Add a comment…"
              aria-label="Add a comment"
            ></textarea>
            <div class="detail__comments-form-actions" hidden>
              <span class="detail__comments-hint" id="comment-hint"></span>
              <div class="detail__comments-form-btns">
                <button type="button" class="detail__comments-cancel" id="comment-cancel">Cancel</button>
                <button type="submit" class="detail__comments-submit" id="comment-send" disabled>Comment</button>
              </div>
            </div>
          </div>
        </form>`;

      const form = commentsCompose.querySelector("#comments-form");
      const input = commentsCompose.querySelector("#comment-input");
      const actions = commentsCompose.querySelector(".detail__comments-form-actions");
      const sendBtn = commentsCompose.querySelector("#comment-send");
      const cancelBtn = commentsCompose.querySelector("#comment-cancel");
      const hint = commentsCompose.querySelector("#comment-hint");

      const syncCompose = () => {
        const hasText = Boolean(String(input?.value || "").trim());
        if (sendBtn) sendBtn.disabled = !hasText;
        input?.classList.toggle("is-expanded", Boolean(actions && !actions.hidden));
      };

      const openCompose = () => {
        if (actions) actions.hidden = false;
        if (input) {
          input.rows = 2;
          input.classList.add("is-expanded");
        }
        syncCompose();
      };

      const closeCompose = () => {
        if (input) {
          input.value = "";
          input.rows = 1;
          input.blur();
          input.classList.remove("is-expanded");
        }
        if (actions) actions.hidden = true;
        if (hint) hint.textContent = "";
        syncCompose();
      };

      input?.addEventListener("focus", openCompose);
      input?.addEventListener("input", syncCompose);
      cancelBtn?.addEventListener("click", closeCompose);

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = String(input?.value || "").trim();
        if (!text) {
          input?.focus();
          return;
        }
        if (sendBtn) {
          sendBtn.disabled = true;
          sendBtn.textContent = "Posting…";
        }
        if (hint) hint.textContent = "";
        try {
          const created = await addTitleComment(Number(id), mediaType, text);
          comments = [created, ...comments];
          closeCompose();
          renderComments();
        } catch (err) {
          if (hint) hint.textContent = err.message || "Could not post";
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = "Comment";
          }
          openCompose();
        }
      });
    };

    const requireCommentUser = () => {
      if (meId) return true;
      location.hash = linkTo("/login");
      return false;
    };

    commentsList?.addEventListener("click", async (e) => {
      const likeBtn = e.target.closest("[data-like-comment]");
      if (likeBtn) {
        if (!requireCommentUser()) return;
        const commentId = likeBtn.getAttribute("data-like-comment");
        const current = comments.find((c) => c.id === commentId);
        if (!current || likeBtn.disabled) return;
        const wasLiked = Boolean(current.liked);
        likeBtn.disabled = true;
        current.liked = !wasLiked;
        current.like_count = Math.max(
          0,
          (Number(current.like_count) || 0) + (wasLiked ? -1 : 1)
        );
        renderComments();
        try {
          const next = await toggleTitleCommentLike(commentId, wasLiked);
          current.liked = next;
          renderComments();
        } catch (err) {
          current.liked = wasLiked;
          current.like_count = Math.max(
            0,
            (Number(current.like_count) || 0) + (wasLiked ? 1 : -1)
          );
          renderComments();
          alert(err.message || "Could not update like");
        }
        return;
      }

      const replyBtn = e.target.closest("[data-reply-comment]");
      if (replyBtn) {
        if (!requireCommentUser()) return;
        const parentId = replyBtn.getAttribute("data-reply-comment");
        replyToId = replyToId === parentId ? null : parentId;
        renderComments();
        commentsList.querySelector("[data-reply-form] textarea")?.focus();
        return;
      }

      if (e.target.closest("[data-reply-cancel]")) {
        replyToId = null;
        renderComments();
        return;
      }

      const btn = e.target.closest("[data-delete-comment]");
      if (!btn) return;
      const commentId = btn.getAttribute("data-delete-comment");
      if (!commentId) return;
      btn.disabled = true;
      try {
        await deleteTitleComment(commentId);
        comments = comments.filter(
          (c) => c.id !== commentId && c.parent_id !== commentId
        );
        if (replyToId === commentId) replyToId = null;
        renderComments();
      } catch (err) {
        btn.disabled = false;
        alert(err.message || "Could not delete");
      }
    });

    commentsList?.addEventListener("submit", async (e) => {
      const form = e.target.closest("[data-reply-form]");
      if (!form) return;
      e.preventDefault();
      if (!requireCommentUser()) return;
      const parentId = form.getAttribute("data-reply-form");
      const input = form.querySelector("textarea");
      const text = String(input?.value || "").trim();
      if (!text || !parentId) return;
      const sendBtn = form.querySelector("[type='submit']");
      if (sendBtn) sendBtn.disabled = true;
      try {
        const created = await addTitleComment(
          Number(id),
          mediaType,
          text,
          parentId
        );
        comments = [...comments, created];
        replyToId = null;
        renderComments();
      } catch (err) {
        if (sendBtn) sendBtn.disabled = false;
        alert(err.message || "Could not reply");
      }
    });

    try {
      const user = await getUser();
      meId = user?.id || null;
      await paintCompose(user);
      comments = await listTitleComments(Number(id), mediaType);
      renderComments();
    } catch (err) {
      if (commentsList) {
        commentsList.innerHTML = `<p class="muted">${escapeHtml(
          err.message || "Could not load comments"
        )}</p>`;
      }
    }
  } catch (err) {
    root.innerHTML = `
      <p class="muted">${escapeHtml(err.message)}</p>
    `;
  }

  return {
    unmount() {
      clearServerSwitchLoading();
      if (playerOpen) stopPlayer();
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
