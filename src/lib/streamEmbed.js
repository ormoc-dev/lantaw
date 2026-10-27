/** Shared zoryva embed helpers for detail + watch-party pages. */

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
}) {
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

export function renderStreamPlayer(movie, mediaType, opts = {}) {
  const readOnly = Boolean(opts.readOnly);

  if (mediaType === "tv") {
    const defaults = getTvDefaults(movie);
    const seasonNum = Math.max(1, Number(opts.season) || defaults.season);
    const episodeNum = Math.max(1, Number(opts.episode) || defaults.episode);
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
      ? `<select id="stream-season" ${readOnly ? "disabled" : ""}>${options}</select>`
      : `<input id="stream-season" type="number" min="1" value="${seasonNum}" ${
          readOnly ? "disabled" : ""
        } />`;

    const streamUrl = buildStreamUrl({
      mediaType,
      tmdbId: movie.id,
      season: seasonNum,
      episode: episodeNum,
    });

    return `
      ${
        readOnly
          ? ""
          : `<div class="stream-controls">
        <label>Season ${seasonSelect}</label>
        <label>Episode <input id="stream-episode" type="number" min="1" value="${episodeNum}" /></label>
        <button class="btn btn--ghost" id="stream-reload" type="button">Load episode</button>
      </div>`
      }
      <div class="detail__player-frame detail__player-frame--embed">
        <iframe
          id="stream-iframe"
          src="${streamUrl}"
          title="Streaming player"
          frameborder="0"
          style="border: 0; border-radius: 12px;"
          allow="autoplay; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
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
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        referrerpolicy="no-referrer"
        allowfullscreen
      ></iframe>
    </div>
  `;
}

export function bindStreamControls(player, movie, mediaType, hooks = {}) {
  if (mediaType !== "tv") return;
  const onReload = typeof hooks === "function" ? hooks : hooks.onReload;
  const onEpisodeChange =
    typeof hooks === "function" ? null : hooks.onEpisodeChange;

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
