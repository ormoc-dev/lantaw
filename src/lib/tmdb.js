import { env } from "../config/env.js";

async function tmdbFetch(path, params = {}) {
  const url = new URL(`${env.tmdbBaseUrl}${path}`);
  const headers = { Accept: "application/json" };
  const key = env.tmdbApiKey || "";

  // Support both v3 api_key and v4 Read Access Token (eyJ…)
  if (key.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }

  for (const [keyName, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(keyName, String(value));
    }
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDB ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export function posterUrl(path, size = "w342") {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}

export function backdropUrl(path, size = "w780") {
  if (!path) return null;
  return `${env.tmdbImageBase}/${size}${path}`;
}

export const tmdb = {
  configuration: () => tmdbFetch("/configuration"),
  genres: () => tmdbFetch("/genre/movie/list"),
  popular: (page = 1) => tmdbFetch("/movie/popular", { page }),
  topRated: (page = 1) => tmdbFetch("/movie/top_rated", { page }),
  nowPlaying: (page = 1) => tmdbFetch("/movie/now_playing", { page }),
  upcoming: (page = 1) => tmdbFetch("/movie/upcoming", { page }),
  trending: (timeWindow = "week") => tmdbFetch(`/trending/movie/${timeWindow}`),
  trendingAll: (timeWindow = "week") =>
    tmdbFetch(`/trending/all/${timeWindow}`),
  byGenre: (genreId, page = 1) =>
    tmdbFetch("/discover/movie", {
      with_genres: genreId,
      page,
      sort_by: "popularity.desc",
      include_adult: false,
    }),
  discoverMovies: (params = {}) =>
    tmdbFetch("/discover/movie", {
      sort_by: "popularity.desc",
      include_adult: false,
      ...params,
    }),
  discoverTv: (params = {}) =>
    tmdbFetch("/discover/tv", {
      sort_by: "popularity.desc",
      include_adult: false,
      ...params,
    }),
  popularTv: (page = 1) => tmdbFetch("/tv/popular", { page }),
  search: (query, page = 1) =>
    tmdbFetch("/search/movie", { query, page, include_adult: false }),
  movie: (id) => tmdbFetch(`/movie/${id}`),
  tv: (id) => tmdbFetch(`/tv/${id}`),
  movieExternalIds: (id) => tmdbFetch(`/movie/${id}/external_ids`),
  tvExternalIds: (id) => tmdbFetch(`/tv/${id}/external_ids`),
  credits: (id) => tmdbFetch(`/movie/${id}/credits`),
  tvCredits: (id) => tmdbFetch(`/tv/${id}/credits`),
  videos: (id) => tmdbFetch(`/movie/${id}/videos`),
  tvVideos: (id) => tmdbFetch(`/tv/${id}/videos`),
};

export async function checkTmdbConnection() {
  try {
    const data = await tmdb.configuration();
    if (!data?.images) {
      return { ok: false, message: "Unexpected TMDB response" };
    }
    return { ok: true, message: "TMDB connected" };
  } catch (err) {
    return { ok: false, message: err?.message || "TMDB connection failed" };
  }
}
