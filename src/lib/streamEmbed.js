/** Shared stream embed helpers for detail + watch-party pages.
 * Movies/TV use the user-selected provider (Me → Settings → Stream provider).
 * Anime stays on zoryva.
 *
 * CineSrc:      https://cinesrc.st/embed/movie/{tmdbId}
 * VidCore:      https://vidcore.org/embed/movie/{tmdbId}
 * Braflix:      https://braflix.dev/embed/movie/{tmdbId}
 */

const STORAGE_KEY = "lantaw-stream-provider";
const ACCENT_HEX = "ff0a43";
const ACCENT_QS = `%23${ACCENT_HEX}`;

/** @typedef {"cinesrc"|"vidcore"|"braflix"} StreamProviderId */

/** @type {Array<{id: StreamProviderId, label: string, origin: string, hint: string, remoteSync: boolean, allowSandbox: boolean}>} */
export const STREAM_PROVIDERS = [
  {
    id: "cinesrc",
    label: "Philippines",
    origin: "https://cinesrc.st",
    hint: "Recommended · best for Watch together",
    remoteSync: true,
    allowSandbox: true,
  },
  {
    id: "vidcore",
    label: "Singapore",
    origin: "https://vidcore.org",
    hint: "Backup server",
    remoteSync: false,
    allowSandbox: true,
  },
  {
    id: "braflix",
    label: "Thailand",
    origin: "https://braflix.dev",
    hint: "Multi-source backup",
    remoteSync: false,
    allowSandbox: true,
  },
];

export const DEFAULT_STREAM_PROVIDER = "cinesrc";

/** @deprecated Use getStreamProvider() — kept as the default fallback id. */
export const MOVIE_TV_PROVIDER = DEFAULT_STREAM_PROVIDER;

export const CINESRC_ORIGIN = "https://cinesrc.st";
export const VIDCORE_ORIGIN = "https://vidcore.org";
export const BRAFLIX_ORIGIN = "https://braflix.dev";

function isProviderId(value) {
  return STREAM_PROVIDERS.some((p) => p.id === value);
}

export function getStreamProviderMeta(provider = getStreamProvider()) {
  return (
    STREAM_PROVIDERS.find((p) => p.id === provider) ||
    STREAM_PROVIDERS.find((p) => p.id === DEFAULT_STREAM_PROVIDER)
  );
}

/** Active movie/TV embed provider (persisted in localStorage). */
export function getStreamProvider() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isProviderId(saved)) return saved;
  } catch {
    /* private mode */
  }
  return DEFAULT_STREAM_PROVIDER;
}

export function setStreamProvider(providerId) {
  const id = isProviderId(providerId) ? providerId : DEFAULT_STREAM_PROVIDER;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
  return id;
}

export function movieTvOrigin(provider = getStreamProvider()) {
  return getStreamProviderMeta(provider).origin;
}

/** Only CineSrc exposes seek/play/time via postMessage today. */
export function providerSupportsRemoteSync(provider = getStreamProvider()) {
  return Boolean(getStreamProviderMeta(provider).remoteSync);
}

export function getTvDefaults(movie) {
  const firstSeason =
    Array.isArray(movie.seasons) && movie.seasons.length
      ? movie.seasons[0]
      : { seasonNumber: 1, episodeCount: 1, name: "Season 1" };

  return {
    season: Math.max(1, Number(firstSeason.seasonNumber) || 1),
    episode: 1,
  };
}

/** Identity of what's playing — ignore sync token / start time. */
export function streamContentKey({
  mediaType,
  tmdbId,
  season = 1,
  episode = 1,
}) {
  if (mediaType === "tv" || mediaType === "anime") {
    return `${mediaType}:${tmdbId}:${Math.max(1, Number(season) || 1)}:${Math.max(
      1,
      Number(episode) || 1
    )}`;
  }
  return `${mediaType || "movie"}:${tmdbId}`;
}

/** CineSrc postMessage API — seek/play without tearing down the iframe. */
export function sendCineSrcCommand(iframe, command, args = []) {
  if (!providerSupportsRemoteSync()) return false;
  if (!iframe?.contentWindow || typeof command !== "string") return false;
  try {
    iframe.contentWindow.postMessage(
      { type: "cinesrc:command", command, args },
      CINESRC_ORIGIN
    );
    return true;
  } catch {
    return false;
  }
}

/** Jump an already-loaded CineSrc player — avoids full media refetch. */
export function seekCineSrcPlayer(iframe, timeSec = 0) {
  if (!providerSupportsRemoteSync()) return false;
  const t = Math.max(0, Math.floor(Number(timeSec) || 0));
  const okSeek = sendCineSrcCommand(iframe, "seek", [t]);
  sendCineSrcCommand(iframe, "play");
  return okSeek;
}

function buildCineSrcUrl({ mediaType, id, s, e, play, seek }) {
  if (mediaType === "tv") {
    return `${CINESRC_ORIGIN}/embed/tv/${id}?s=${s}&e=${e}&color=${ACCENT_QS}&back=close${play}${seek}`;
  }
  return `${CINESRC_ORIGIN}/embed/movie/${id}?color=${ACCENT_QS}&back=close${play}${seek}`;
}

/** Shared path-style embeds: /embed/movie/{id} and /embed/tv/{id}/{s}/{e} */
function buildPathEmbedUrl(origin, { mediaType, id, s, e, params }) {
  const qs = params?.toString() ? `?${params.toString()}` : "";
  if (mediaType === "tv") {
    return `${origin}/embed/tv/${id}/${s}/${e}${qs}`;
  }
  return `${origin}/embed/movie/${id}${qs}`;
}

function buildVidCoreUrl({ mediaType, id, s, e, autoplay }) {
  const params = new URLSearchParams();
  params.set("theme", ACCENT_HEX);
  if (autoplay) params.set("autoplay", "true");
  return buildPathEmbedUrl(VIDCORE_ORIGIN, { mediaType, id, s, e, params });
}

function buildBraflixUrl({ mediaType, id, s, e, autoplay, startAt }) {
  const params = new URLSearchParams();
  params.set("primaryColor", ACCENT_HEX);
  params.set("color", ACCENT_HEX);
  if (autoplay) params.set("autoplay", "true");
  if (startAt > 0) params.set("startAt", String(startAt));
  return buildPathEmbedUrl(BRAFLIX_ORIGIN, { mediaType, id, s, e, params });
}

export function buildStreamUrl({
  mediaType,
  tmdbId,
  season = 1,
  episode = 1,
  anilistId,
  autoplay = false,
  startAt = 0,
  provider = getStreamProvider(),
}) {
  const id = encodeURIComponent(tmdbId);
  const s = encodeURIComponent(Math.max(1, Number(season) || 1));
  const e = encodeURIComponent(Math.max(1, Number(episode) || 1));
  const play = autoplay ? "&autoplay=true" : "";
  const t = Math.max(0, Math.floor(Number(startAt) || 0));
  // Prefer postMessage seek when the iframe is already up. URL `t=` is only for
  // the first load (guest join mid-stream) — remounting with a new `t=` refetches.
  const seek =
    t > 0 && mediaType !== "anime" && provider === "cinesrc"
      ? `&t=${encodeURIComponent(t)}&continueprompt=false`
      : "";

  if (mediaType === "anime") {
    return `https://zoryva.me/embed/anime/${encodeURIComponent(
      anilistId || tmdbId
    )}/${s}/${e}?color=${ACCENT_QS}${play}`;
  }

  if (provider === "cinesrc") {
    return buildCineSrcUrl({ mediaType, id, s, e, play, seek });
  }
  if (provider === "vidcore") {
    return buildVidCoreUrl({ mediaType, id, s, e, autoplay });
  }
  if (provider === "braflix") {
    return buildBraflixUrl({ mediaType, id, s, e, autoplay, startAt: t });
  }
  return buildCineSrcUrl({ mediaType, id, s, e, play, seek });
}

function iframeAttrs(streamUrl, { deferSrc = false, provider = getStreamProvider() } = {}) {
  // No allow-popups / allow-top-navigation — blocks tab pop-unders from the embed.
  // deferSrc: keep about:blank until unlock so Watch now's user-gesture can't chain ads.
  const srcAttr = deferSrc
    ? `src="about:blank" data-src="${escapeAttr(streamUrl)}"`
    : `src="${escapeAttr(streamUrl)}"`;
  const allowSandbox = getStreamProviderMeta(provider).allowSandbox;
  // Intentionally omit allow-popups and allow-top-navigation*.
  const sandboxAttr = allowSandbox
    ? `sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock"`
    : "";
  return `
          id="stream-iframe"
          ${srcAttr}
          title="Streaming player"
          frameborder="0"
          style="border: 0; border-radius: 12px;"
          referrerpolicy="no-referrer"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock"
          allowfullscreen
          ${sandboxAttr}
  `.trim();
}

function escapeAttr(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function episodeCountForSeason(movie, seasonNum) {
  const match = (movie.seasons || []).find(
    (season) => Number(season.seasonNumber) === Number(seasonNum)
  );
  return Math.max(1, Number(match?.episodeCount) || 1);
}

function renderEpisodeChips(episodeCount, selectedEpisode = 1, disabled = false) {
  const max = Math.max(1, Number(episodeCount) || 1);
  const current = Math.min(max, Math.max(1, Number(selectedEpisode) || 1));
  let html = "";
  for (let i = 1; i <= max; i += 1) {
    html += `<button
      type="button"
      class="stream-ep${i === current ? " is-active" : ""}"
      data-episode="${i}"
      role="option"
      aria-selected="${i === current ? "true" : "false"}"
      ${disabled ? "disabled" : ""}
    >${i}</button>`;
  }
  return html;
}

/** Season / episode picker used by detail + watch-party host toolbar. */
export function renderTvEpisodeControls(movie, opts = {}) {
  const defaults = getTvDefaults(movie);
  const seasonNum = Math.max(1, Number(opts.season) || defaults.season);
  const episodeNum = Math.max(1, Number(opts.episode) || defaults.episode);
  const disabled = Boolean(opts.disabled);
  const episodeCount = episodeCountForSeason(movie, seasonNum);
  const options = (movie.seasons || [])
    .map(
      (season) =>
        `<option value="${season.seasonNumber}" data-episode-count="${
          season.episodeCount
        }" ${season.seasonNumber === seasonNum ? "selected" : ""}>${escapeHtml(
          season.name
        )}</option>`
    )
    .join("");

  const seasonSelect = options
    ? `<select id="stream-season" aria-label="Season" ${
        disabled ? "disabled" : ""
      }>${options}</select>`
    : `<input id="stream-season" type="number" min="1" aria-label="Season" value="${seasonNum}" ${
        disabled ? "disabled" : ""
      } />`;

  return `
    <div class="stream-controls">
      <div class="stream-controls__season">
        <span class="stream-controls__label">Season</span>
        <div class="stream-controls__select-wrap">${seasonSelect}</div>
      </div>
      <div class="stream-controls__episodes">
        <div class="stream-controls__eps-head">
          <span class="stream-controls__label">Episodes</span>
          <span class="stream-controls__count" id="stream-episode-count">${episodeCount} ep</span>
        </div>
        <input type="hidden" id="stream-episode" value="${Math.min(
          episodeCount,
          Math.max(1, episodeNum)
        )}" />
        <div
          class="stream-controls__eps"
          id="stream-episode-list"
          role="listbox"
          aria-label="Episodes"
        >${renderEpisodeChips(episodeCount, episodeNum, disabled)}</div>
      </div>
    </div>
  `;
}

export function renderStreamPlayer(movie, mediaType, opts = {}) {
  const readOnly = Boolean(opts.readOnly);
  const autoplay = Boolean(opts.autoplay);
  const omitControls = Boolean(opts.omitControls);
  const deferSrc = Boolean(opts.deferSrc);
  const startAt = Math.max(0, Number(opts.startAt) || 0);
  const provider = opts.provider || getStreamProvider();

  if (mediaType === "tv") {
    const defaults = getTvDefaults(movie);
    const seasonNum = Math.max(1, Number(opts.season) || defaults.season);
    const episodeNum = Math.max(1, Number(opts.episode) || defaults.episode);

    const streamUrl = buildStreamUrl({
      mediaType,
      tmdbId: movie.id,
      season: seasonNum,
      episode: episodeNum,
      autoplay,
      startAt,
      provider,
    });

    return `
      <div class="detail__player-frame detail__player-frame--embed">
        <iframe
          ${iframeAttrs(streamUrl, { deferSrc, provider })}
        ></iframe>
      </div>
      ${
        readOnly || omitControls
          ? ""
          : renderTvEpisodeControls(movie, {
              season: seasonNum,
              episode: episodeNum,
            })
      }
    `;
  }

  const streamUrl = buildStreamUrl({
    mediaType,
    tmdbId: movie.id,
    autoplay,
    startAt,
    provider,
  });
  return `
    <div class="detail__player-frame detail__player-frame--embed">
      <iframe
        ${iframeAttrs(streamUrl, { deferSrc, provider })}
      ></iframe>
    </div>
  `;
}

export function bindStreamControls(player, movie, mediaType, hooks = {}) {
  if (mediaType !== "tv") return;
  const onReload = typeof hooks === "function" ? hooks : hooks.onReload;
  const onEpisodeChange =
    typeof hooks === "function" ? null : hooks.onEpisodeChange;
  const autoplay =
    typeof hooks === "function" ? false : Boolean(hooks.autoplay);
  const provider =
    typeof hooks === "function"
      ? getStreamProvider()
      : hooks.provider || getStreamProvider();

  const seasonEl = player.querySelector("#stream-season");
  const episodeEl = player.querySelector("#stream-episode");
  const episodeList = player.querySelector("#stream-episode-list");
  const episodeCountEl = player.querySelector("#stream-episode-count");
  const iframe = player.querySelector("#stream-iframe");

  if (!seasonEl || !episodeEl || !episodeList) return;

  const loadEpisode = (season, episode) => {
    if (iframe) {
      const nextUrl = buildStreamUrl({
        mediaType,
        tmdbId: movie.id,
        season,
        episode,
        autoplay,
        provider,
      });
      iframe.removeAttribute("data-src");
      iframe.src = "about:blank";
      window.setTimeout(() => {
        if (iframe.isConnected) iframe.src = nextUrl;
      }, 0);
    }
    onReload?.();
    onEpisodeChange?.({ season, episode });
  };

  const setActiveEpisode = (episode, { load = false } = {}) => {
    const season = Math.max(1, Number(seasonEl.value) || 1);
    const max =
      seasonEl.tagName === "SELECT"
        ? Math.max(
            1,
            Number(seasonEl.selectedOptions?.[0]?.dataset?.episodeCount || 1)
          )
        : episodeCountForSeason(movie, season);
    const next = Math.min(max, Math.max(1, Number(episode) || 1));
    episodeEl.value = String(next);
    episodeList.querySelectorAll(".stream-ep").forEach((btn) => {
      const on = Number(btn.dataset.episode) === next;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const activeBtn = episodeList.querySelector(`.stream-ep[data-episode="${next}"]`);
    activeBtn?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
    if (load) loadEpisode(season, next);
  };

  const refillEpisodes = ({ load = false } = {}) => {
    const season = Math.max(1, Number(seasonEl.value) || 1);
    const max =
      seasonEl.tagName === "SELECT"
        ? Math.max(
            1,
            Number(seasonEl.selectedOptions?.[0]?.dataset?.episodeCount || 1)
          )
        : episodeCountForSeason(movie, season);
    const current = Math.min(max, Math.max(1, Number(episodeEl.value) || 1));
    if (episodeCountEl) episodeCountEl.textContent = `${max} ep`;
    episodeList.innerHTML = renderEpisodeChips(max, current, false);
    episodeEl.value = String(current);
    if (load) loadEpisode(season, current);
  };

  seasonEl.addEventListener("change", () => {
    episodeEl.value = "1";
    refillEpisodes({ load: true });
  });

  episodeList.addEventListener("click", (e) => {
    const btn = e.target.closest(".stream-ep");
    if (!btn || btn.disabled) return;
    setActiveEpisode(btn.dataset.episode, { load: true });
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
