import { env } from "../config/env.js";

async function tmdbFetch(path, params = {}) {
  const url = new URL(`${env.tmdbBaseUrl}${path}`);
  url.searchParams.set("api_key", env.tmdbApiKey);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString());
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
  byGenre: (genreId, page = 1) =>
    tmdbFetch("/discover/movie", {
      with_genres: genreId,
      page,
      sort_by: "popularity.desc",
      include_adult: false,
    }),
  search: (query, page = 1) =>
    tmdbFetch("/search/movie", { query, page, include_adult: false }),
  movie: (id) => tmdbFetch(`/movie/${id}`),
  credits: (id) => tmdbFetch(`/movie/${id}/credits`),
  videos: (id) => tmdbFetch(`/movie/${id}/videos`),
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
