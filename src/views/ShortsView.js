import { getTrailerKey, getTrendingMovies } from "../services/movieService.js";
import { addRecentMovie } from "../services/recentService.js";
import { getUser } from "../services/authService.js";
import {
  addToWatchlist,
  isInWatchlist,
  removeByTmdbId,
} from "../services/watchlistService.js";
import { loadingHtml } from "../components/Loading.js";
import { linkTo } from "../router/index.js";
import { showNotice } from "../lib/appModal.js";

const ICON_HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4 10.6 19.1C5.4 14.4 2 11.3 2 7.5A4.5 4.5 0 0 1 6.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 15.5 3 4.5 4.5 0 0 1 20 7.5c0 3.8-3.4 6.9-8.6 11.6L12 20.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const ICON_HEART_FILL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4 10.6 19.1C5.4 14.4 2 11.3 2 7.5A4.5 4.5 0 0 1 6.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 15.5 3 4.5 4.5 0 0 1 20 7.5c0 3.8-3.4 6.9-8.6 11.6L12 20.4Z" fill="currentColor"/></svg>`;
const ICON_WATCH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.2 9.4v5.2L14.8 12l-4.6-2.6Z" fill="currentColor"/></svg>`;
const ICON_MUTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3.2L12 18.5V5.5L7.2 10H4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m16 9 5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_UNMUTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3.2L12 18.5V5.5L7.2 10H4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16.2 8.2a4.8 4.8 0 0 1 0 7.6M18.8 5.5a8.2 8.2 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

function trailerEmbedUrl(key, { muted = true } = {}) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    playsinline: "1",
    controls: "0",
    rel: "0",
    modestbranding: "1",
    loop: "1",
    playlist: key,
    enablejsapi: "1",
    origin: location.origin,
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(key)}?${params}`;
}

export async function ShortsView(root) {
  root.classList.add("view--shorts");
  document.body.classList.add("is-shorts");

  root.innerHTML = `
    <div class="shorts-page">
      <header class="shorts-page__head">
        <h1>Shorts</h1>
        <p class="muted">Trailers that play as you scroll</p>
      </header>
      <div class="shorts-feed" id="feed" aria-label="Shorts feed">
        ${loadingHtml()}
      </div>
    </div>
  `;

  const feed = root.querySelector("#feed");
  let observer = null;
  let activeReel = null;
  let muted = true;
  let unmounted = false;

  const stopReel = (reel) => {
    if (!reel) return;
    const stage = reel.querySelector(".shorts-reel__stage");
    const iframe = stage?.querySelector("iframe");
    if (iframe) iframe.remove();
    reel.classList.remove("is-playing");
    if (activeReel === reel) activeReel = null;
  };

  const playReel = (reel) => {
    if (!reel || unmounted) return;
    const key = reel.dataset.trailerKey;
    if (!key) return;
    if (activeReel && activeReel !== reel) stopReel(activeReel);

    const stage = reel.querySelector(".shorts-reel__stage");
    if (!stage) return;
    let iframe = stage.querySelector("iframe");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.title = `${reel.dataset.title || "Trailer"} trailer`;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.setAttribute("playsinline", "");
      stage.appendChild(iframe);
    }
    const nextSrc = trailerEmbedUrl(key, { muted });
    if (iframe.dataset.src !== nextSrc) {
      iframe.dataset.src = nextSrc;
      iframe.src = nextSrc;
    }
    reel.classList.add("is-playing");
    activeReel = reel;
    syncMuteButtons();
  };

  const syncMuteButtons = () => {
    feed.querySelectorAll("[data-mute]").forEach((btn) => {
      btn.innerHTML = muted ? ICON_MUTE : ICON_UNMUTE;
      btn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      btn.classList.toggle("is-muted", muted);
    });
  };

  const setLiked = (btn, liked) => {
    btn.classList.toggle("is-liked", liked);
    btn.innerHTML = liked ? ICON_HEART_FILL : ICON_HEART;
    btn.setAttribute("aria-label", liked ? "Unlike" : "Like");
  };

  try {
    const { results } = await getTrendingMovies();
    if (unmounted) return { unmount };
    const items = (results || []).slice(0, 16);

    const withTrailers = await Promise.all(
      items.map(async (m) => {
        const trailerKey = await getTrailerKey(m.id, m.mediaType || "movie");
        return { ...m, trailerKey };
      })
    );

    // Prefer titles that have a trailer; keep a few poster-only as fallback
    const playable = withTrailers.filter((m) => m.trailerKey);
    const feedItems = (playable.length ? playable : withTrailers).slice(0, 12);

    feed.innerHTML = "";
    if (!feedItems.length) {
      feed.innerHTML = `<p class="muted shorts-feed__empty">No shorts right now. Try again later.</p>`;
      return { unmount };
    }

    const likedFlags = await Promise.all(
      feedItems.map((m) => isInWatchlist(Number(m.id)).catch(() => false))
    );

    feedItems.forEach((m, i) => {
      const liked = likedFlags[i];
      const reel = document.createElement("article");
      reel.className = "shorts-reel";
      reel.dataset.id = String(m.id);
      reel.dataset.mediaType = m.mediaType || "movie";
      reel.dataset.title = m.title || "";
      if (m.poster) reel.dataset.poster = m.poster;
      if (m.trailerKey) reel.dataset.trailerKey = m.trailerKey;

      const cover = m.backdrop || m.poster || "";
      reel.innerHTML = `
        <div
          class="shorts-reel__stage"
          style="${cover ? `background-image:url('${escapeAttr(cover)}')` : ""}"
        >
          ${
            m.trailerKey
              ? ""
              : `<div class="shorts-reel__no-trailer"><span>No trailer</span></div>`
          }
        </div>
        <div class="shorts-reel__shade" aria-hidden="true"></div>
        <div class="shorts-reel__meta">
          <strong>${escapeHtml(m.title)}</strong>
          <span>${m.rating ? m.rating.toFixed(1) : "—"} · ${
            m.releaseDate?.slice(0, 4) || "—"
          }</span>
          <p>${escapeHtml(truncate(m.overview, 72))}</p>
          <a class="shorts-reel__open" href="${linkTo(
            `/${m.mediaType === "tv" ? "tv" : "movie"}/${m.id}`
          )}">Open title</a>
        </div>
        <div class="shorts-reel__actions">
          <button type="button" class="shorts-reel__btn ${
            liked ? "is-liked" : ""
          }" data-like aria-label="${liked ? "Unlike" : "Like"}">
            ${liked ? ICON_HEART_FILL : ICON_HEART}
          </button>
          <button type="button" class="shorts-reel__btn" data-watch aria-label="Watch together">
            ${ICON_WATCH}
          </button>
          <button type="button" class="shorts-reel__btn is-muted" data-mute aria-label="Unmute">
            ${ICON_MUTE}
          </button>
        </div>
      `;
      feed.appendChild(reel);
    });

    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio >= 0.55)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const best = visible[0]?.target;
        if (best && best !== activeReel) playReel(best);
        entries.forEach((e) => {
          if (!e.isIntersecting && e.target === activeReel) stopReel(e.target);
        });
      },
      {
        root: feed,
        threshold: [0.35, 0.55, 0.75, 0.9],
      }
    );

    feed.querySelectorAll(".shorts-reel").forEach((reel) => observer.observe(reel));

    // Kick first visible reel
    requestAnimationFrame(() => {
      const first = feed.querySelector(".shorts-reel[data-trailer-key]");
      if (first) playReel(first);
    });

    feed.addEventListener("click", async (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const likeBtn = t.closest("[data-like]");
      if (likeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const reel = likeBtn.closest(".shorts-reel");
        const id = Number(reel?.dataset.id);
        if (!id) return;
        const user = await getUser();
        if (!user) {
          location.hash = linkTo("/login");
          return;
        }
        const wasLiked = likeBtn.classList.contains("is-liked");
        setLiked(likeBtn, !wasLiked);
        try {
          if (wasLiked) await removeByTmdbId(id);
          else {
            await addToWatchlist({
              tmdbId: id,
              title: reel.dataset.title || "Untitled",
              poster: reel.dataset.poster || null,
            });
          }
        } catch (err) {
          setLiked(likeBtn, wasLiked);
          await showNotice({
            title: "Couldn’t update",
            message: err.message || "Try again in a moment.",
          });
        }
        return;
      }

      const watchBtn = t.closest("[data-watch]");
      if (watchBtn) {
        e.preventDefault();
        e.stopPropagation();
        const reel = watchBtn.closest(".shorts-reel");
        if (!reel) return;
        const user = await getUser();
        if (!user) {
          location.hash = linkTo("/login");
          return;
        }
        const item = {
          id: Number(reel.dataset.id),
          mediaType: reel.dataset.mediaType || "movie",
          title: reel.dataset.title || "Untitled",
          poster: reel.dataset.poster || null,
        };
        addRecentMovie(item);
        try {
          sessionStorage.setItem("lantaw-shorts-watch", JSON.stringify(item));
        } catch {
          /* ignore */
        }
        location.hash = linkTo("/friends");
        return;
      }

      const muteBtn = t.closest("[data-mute]");
      if (muteBtn) {
        e.preventDefault();
        e.stopPropagation();
        muted = !muted;
        syncMuteButtons();
        if (activeReel) {
          // Reload embed with new mute state so YouTube picks it up
          const key = activeReel.dataset.trailerKey;
          const iframe = activeReel.querySelector("iframe");
          if (key && iframe) {
            const nextSrc = trailerEmbedUrl(key, { muted });
            iframe.dataset.src = nextSrc;
            iframe.src = nextSrc;
          }
        }
      }
    });
  } catch (err) {
    feed.innerHTML = `<p class="muted shorts-feed__empty">${escapeHtml(err.message)}</p>`;
  }

  function unmount() {
    unmounted = true;
    observer?.disconnect();
    observer = null;
    if (activeReel) stopReel(activeReel);
    root.classList.remove("view--shorts");
    document.body.classList.remove("is-shorts");
  }

  return { unmount };
}

function truncate(str = "", n = 100) {
  if (str.length <= n) return str;
  return `${str.slice(0, n).trim()}…`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str = "") {
  return escapeHtml(str).replaceAll("'", "&#39;");
}
