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

function trailerEmbedUrl(key, { muted = false, autoplay = true } = {}) {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: muted ? "1" : "0",
    playsinline: "1",
    controls: "0",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    fs: "0",
    loop: "1",
    playlist: key,
    enablejsapi: "1",
    origin: location.origin,
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(key)}?${params}`;
}

function ytCommand(iframe, func, args = []) {
  try {
    iframe?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  } catch {
    /* ignore */
  }
}

export async function ShortsView(root) {
  root.classList.add("view--shorts");
  document.body.classList.add("is-shorts");

  root.innerHTML = `
    <div class="shorts-page">
      <header class="shorts-page__head">
        <h1>Shorts</h1>
      </header>
      <div class="shorts-feed" id="feed" aria-label="Shorts feed">
        ${loadingHtml()}
      </div>
    </div>
  `;

  const feed = root.querySelector("#feed");
  let observer = null;
  let activeReel = null;
  // Sound on by default
  let muted = false;
  let unmounted = false;
  let userUnlockedAudio = false;
  let mostVisibleReel = null;

  const syncReelHeights = () => {
    if (!feed) return;
    const h = Math.max(240, Math.round(feed.clientHeight));
    feed.querySelectorAll(".shorts-reel").forEach((reel) => {
      reel.style.height = `${h}px`;
      reel.style.minHeight = `${h}px`;
    });
  };

  const syncMuteButtons = () => {
    feed.querySelectorAll("[data-mute]").forEach((btn) => {
      btn.innerHTML = muted ? ICON_MUTE : ICON_UNMUTE;
      btn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      btn.classList.toggle("is-muted", muted);
    });
  };

  const stopReel = (reel) => {
    if (!reel) return;
    const stage = reel.querySelector(".shorts-reel__stage");
    const iframe = stage?.querySelector("iframe.is-active");
    if (iframe) {
      ytCommand(iframe, "pauseVideo");
      iframe.classList.remove("is-active");
      window.setTimeout(() => {
        if (!reel.classList.contains("is-playing") && iframe.isConnected) {
          iframe.remove();
        }
      }, 400);
    }
    reel.classList.remove("is-playing", "is-loading");
    if (activeReel === reel) activeReel = null;
  };

  const ensureIframe = (reel, { autoplay = true } = {}) => {
    const key = reel.dataset.trailerKey;
    const stage = reel.querySelector(".shorts-reel__stage");
    if (!key || !stage) return null;

    let iframe = stage.querySelector("iframe");
    const nextSrc = trailerEmbedUrl(key, { muted, autoplay });
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.title = `${reel.dataset.title || "Trailer"} trailer`;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.setAttribute("playsinline", "");
      iframe.setAttribute("loading", "eager");
      stage.appendChild(iframe);
    }
    // Warm preload used autoplay=0 — promote to playing src only when needed
    if (iframe.dataset.src !== nextSrc) {
      iframe.dataset.src = nextSrc;
      iframe.src = nextSrc;
    }
    return iframe;
  };

  const preloadNeighbor = (reel) => {
    const next = reel?.nextElementSibling;
    if (!next?.classList?.contains("shorts-reel")) return;
    if (!next.dataset.trailerKey) return;
    const stage = next.querySelector(".shorts-reel__stage");
    if (!stage || stage.querySelector("iframe")) return;
    const iframe = document.createElement("iframe");
    iframe.title = "preload";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.setAttribute("playsinline", "");
    iframe.setAttribute("loading", "eager");
    iframe.classList.add("is-preload");
    const key = next.dataset.trailerKey;
    const src = trailerEmbedUrl(key, { muted, autoplay: false });
    iframe.dataset.src = src;
    iframe.src = src;
    stage.appendChild(iframe);
  };

  const applySound = (iframe) => {
    if (!iframe) return;
    if (muted) ytCommand(iframe, "mute");
    else {
      ytCommand(iframe, "unMute");
      ytCommand(iframe, "setVolume", [100]);
    }
    ytCommand(iframe, "playVideo");
  };

  const unlockAudio = () => {
    userUnlockedAudio = true;
    muted = false;
    syncMuteButtons();
    applySound(activeReel?.querySelector("iframe"));
  };

  const playReel = (reel) => {
    if (!reel || unmounted) return;
    const key = reel.dataset.trailerKey;
    if (!key) {
      reel.classList.add("is-loading");
      return;
    }
    if (activeReel && activeReel !== reel) stopReel(activeReel);

    reel.classList.add("is-loading");
    const iframe = ensureIframe(reel, { autoplay: true });
    if (!iframe) return;

    iframe.classList.add("is-active");
    iframe.classList.remove("is-preload");
    reel.classList.add("is-playing");
    activeReel = reel;
    syncMuteButtons();

    const kick = () => {
      if (activeReel !== reel) return;
      applySound(iframe);
      reel.classList.remove("is-loading");
    };
    iframe.addEventListener("load", kick, { once: true });
    [80, 250, 500, 900].forEach((ms) => window.setTimeout(kick, ms));

    preloadNeighbor(reel);
  };

  const setLiked = (btn, liked) => {
    btn.classList.toggle("is-liked", liked);
    btn.innerHTML = liked ? ICON_HEART_FILL : ICON_HEART;
    btn.setAttribute("aria-label", liked ? "Unlike" : "Like");
  };

  const mountReel = (m) => {
    const reel = document.createElement("article");
    reel.className = "shorts-reel is-loading";
    reel.dataset.id = String(m.id);
    reel.dataset.mediaType = m.mediaType || "movie";
    reel.dataset.title = m.title || "";
    if (m.poster) reel.dataset.poster = m.poster;

    const cover = m.backdrop || m.poster || "";
    reel.innerHTML = `
      <div
        class="shorts-reel__stage"
        style="${cover ? `background-image:url('${escapeAttr(cover)}')` : ""}"
      >
        <div class="shorts-reel__spinner" aria-hidden="true"></div>
      </div>
      <div class="shorts-reel__shade" aria-hidden="true"></div>
      <div class="shorts-reel__meta">
        <strong>${escapeHtml(m.title)}</strong>
        <span>${m.rating ? m.rating.toFixed(1) : "—"} · ${
          m.releaseDate?.slice(0, 4) || "—"
        }</span>
        <p>${escapeHtml(truncate(m.overview, 56))}</p>
        <a class="shorts-reel__open" href="${linkTo(
          `/${m.mediaType === "tv" ? "tv" : "movie"}/${m.id}`
        )}">Open title</a>
      </div>
      <div class="shorts-reel__actions">
        <button type="button" class="shorts-reel__btn" data-like aria-label="Like">
          ${ICON_HEART}
        </button>
        <button type="button" class="shorts-reel__btn" data-watch aria-label="Watch together">
          ${ICON_WATCH}
        </button>
        <button type="button" class="shorts-reel__btn" data-mute aria-label="Mute">
          ${ICON_UNMUTE}
        </button>
      </div>
    `;
    feed.appendChild(reel);
    observer?.observe(reel);
    return reel;
  };

  const attachTrailer = (reel, key) => {
    if (!reel || unmounted) return;
    if (!key) {
      reel.classList.remove("is-loading");
      const stage = reel.querySelector(".shorts-reel__stage");
      if (stage && !stage.querySelector(".shorts-reel__no-trailer")) {
        stage.insertAdjacentHTML(
          "beforeend",
          `<div class="shorts-reel__no-trailer"><span>No trailer</span></div>`
        );
      }
      return;
    }
    reel.dataset.trailerKey = key;
    if (mostVisibleReel === reel || activeReel === reel || !activeReel) {
      playReel(reel);
    } else {
      reel.classList.remove("is-loading");
      // Warm next if this is the neighbor of the playing reel
      if (activeReel?.nextElementSibling === reel) preloadNeighbor(activeReel);
    }
  };

  try {
    const { results } = await getTrendingMovies();
    if (unmounted) return { unmount };
    const items = (results || []).slice(0, 14);

    feed.innerHTML = "";
    if (!items.length) {
      feed.innerHTML = `<p class="muted shorts-feed__empty">No shorts right now. Try again later.</p>`;
      return { unmount };
    }

    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio >= 0.55) {
            if (
              !mostVisibleReel ||
              e.intersectionRatio >=
                (mostVisibleReel._ratio || 0)
            ) {
              mostVisibleReel = e.target;
              mostVisibleReel._ratio = e.intersectionRatio;
            }
          }
        });
        const visible = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio >= 0.55)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const best = visible[0]?.target;
        if (best) {
          mostVisibleReel = best;
          if (best !== activeReel) playReel(best);
        }
        entries.forEach((e) => {
          if (!e.isIntersecting && e.target === activeReel) stopReel(e.target);
        });
      },
      {
        root: feed,
        threshold: [0.35, 0.55, 0.75, 0.9],
      }
    );

    // Paint posters immediately — trailers resolve in parallel per reel
    const reels = items.map((m) => mountReel(m));
    syncReelHeights();
    window.addEventListener("resize", syncReelHeights);
    mostVisibleReel = reels[0] || null;

    // Resolve first trailer immediately, then the rest in parallel (cached)
    void getTrailerKey(items[0].id, items[0].mediaType || "movie").then((key) =>
      attachTrailer(reels[0], key)
    );
    items.slice(1).forEach((m, i) => {
      void getTrailerKey(m.id, m.mediaType || "movie").then((key) =>
        attachTrailer(reels[i + 1], key)
      );
    });

    // Likes in background — don't block first play
    reels.forEach((reel) => {
      const id = Number(reel.dataset.id);
      isInWatchlist(id)
        .then((liked) => {
          if (unmounted || !liked) return;
          const btn = reel.querySelector("[data-like]");
          if (btn) setLiked(btn, true);
        })
        .catch(() => {});
    });

    const onFirstGesture = () => {
      if (!userUnlockedAudio) unlockAudio();
    };
    feed.addEventListener("pointerdown", onFirstGesture, { passive: true });
    feed.addEventListener("touchstart", onFirstGesture, { passive: true });

    requestAnimationFrame(() => {
      syncReelHeights();
      if (reels[0]?.dataset.trailerKey) playReel(reels[0]);
    });

    feed.addEventListener("click", async (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const likeBtn = t.closest("[data-like]");
      if (likeBtn) {
        e.preventDefault();
        e.stopPropagation();
        unlockAudio();
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
        if (!muted) userUnlockedAudio = true;
        syncMuteButtons();
        applySound(activeReel?.querySelector("iframe"));
      }
    });
  } catch (err) {
    feed.innerHTML = `<p class="muted shorts-feed__empty">${escapeHtml(err.message)}</p>`;
  }

  function unmount() {
    unmounted = true;
    window.removeEventListener("resize", syncReelHeights);
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
