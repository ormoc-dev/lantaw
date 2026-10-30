/** Shared stream embed helpers for detail + watch-party pages.
 * Movies/TV → CineSrc (cinesrc.st). Anime stays on zoryva.
 * Docs: https://cinesrc.st/docs
 */

const ACCENT = "%23ff0a43";

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

export function buildStreamUrl({
  mediaType,
  tmdbId,
  season = 1,
  episode = 1,
  anilistId,
  autoplay = false,
  startAt = 0,
}) {
  const id = encodeURIComponent(tmdbId);
  const s = encodeURIComponent(Math.max(1, Number(season) || 1));
  const e = encodeURIComponent(Math.max(1, Number(episode) || 1));
  const play = autoplay ? "&autoplay=true" : "";
  const t = Math.max(0, Math.floor(Number(startAt) || 0));
  // CineSrc: jump both watchers to the same timestamp (skip Continue prompt)
  const seek =
    t > 0 && mediaType !== "anime"
      ? `&t=${encodeURIComponent(t)}&continueprompt=false`
      : "";

  if (mediaType === "tv") {
    return `https://cinesrc.st/embed/tv/${id}?s=${s}&e=${e}&color=${ACCENT}&back=close${play}${seek}`;
  }
  if (mediaType === "anime") {
    return `https://zoryva.me/embed/anime/${encodeURIComponent(
      anilistId || tmdbId
    )}/${s}/${e}?color=${ACCENT}${play}`;
  }
  return `https://cinesrc.st/embed/movie/${id}?color=${ACCENT}&back=close${play}${seek}`;
}

function iframeAttrs(streamUrl, { deferSrc = false } = {}) {
  // No allow-popups — block third-party pop-unders. First-click shield in streamGuard.
  // deferSrc: keep about:blank until the user taps Sync / unlock (no media fetch yet).
  const srcAttr = deferSrc
    ? `src="about:blank" data-src="${streamUrl}"`
    : `src="${streamUrl}"`;
  return `
          id="stream-iframe"
          ${srcAttr}
          title="Streaming player"
          frameborder="0"
          style="border: 0; border-radius: 12px;"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allowfullscreen
  `.trim();
}

/** Season / episode picker used by detail + watch-party host toolbar. */
export function renderTvEpisodeControls(movie, opts = {}) {
  const defaults = getTvDefaults(movie);
  const seasonNum = Math.max(1, Number(opts.season) || defaults.season);
  const episodeNum = Math.max(1, Number(opts.episode) || defaults.episode);
  const disabled = Boolean(opts.disabled);
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
    ? `<select id="stream-season" ${disabled ? "disabled" : ""}>${options}</select>`
    : `<input id="stream-season" type="number" min="1" value="${seasonNum}" ${
        disabled ? "disabled" : ""
      } />`;

  return `
    <div class="stream-controls">
      <label>Season ${seasonSelect}</label>
      <label>Episode <input id="stream-episode" type="number" min="1" value="${episodeNum}" ${
        disabled ? "disabled" : ""
      } /></label>
      <button class="btn btn--ghost" id="stream-reload" type="button" ${
        disabled ? "disabled" : ""
      }>Load</button>
    </div>
  `;
}

export function renderStreamPlayer(movie, mediaType, opts = {}) {
  const readOnly = Boolean(opts.readOnly);
  const autoplay = Boolean(opts.autoplay);
  const omitControls = Boolean(opts.omitControls);
  const deferSrc = Boolean(opts.deferSrc);
  const startAt = Math.max(0, Number(opts.startAt) || 0);

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
    });

    return `
      ${
        readOnly || omitControls
          ? ""
          : renderTvEpisodeControls(movie, {
              season: seasonNum,
              episode: episodeNum,
            })
      }
      <div class="detail__player-frame detail__player-frame--embed">
        <iframe
          ${iframeAttrs(streamUrl, { deferSrc })}
        ></iframe>
      </div>
    `;
  }

  const streamUrl = buildStreamUrl({
    mediaType,
    tmdbId: movie.id,
    autoplay,
    startAt,
  });
  return `
    <div class="detail__player-frame detail__player-frame--embed">
      <iframe
        ${iframeAttrs(streamUrl, { deferSrc })}
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

  const seasonEl = player.querySelector("#stream-season");
  const episodeEl = player.querySelector("#stream-episode");
  const reloadBtn = player.querySelector("#stream-reload");
  const iframe = player.querySelector("#stream-iframe");

  if (!seasonEl || !episodeEl || !reloadBtn) return;

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
    if (iframe) {
      iframe.src = buildStreamUrl({
        mediaType,
        tmdbId: movie.id,
        season,
        episode,
        autoplay,
      });
    }
    onReload?.();
    onEpisodeChange?.({ season, episode });
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
