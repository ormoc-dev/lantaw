import { env } from "../config/env.js";

const TTL_MS = 15 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 1;
const STORAGE_KEY = "lantaw-tmdb-v1";
const MAX_STORE_ENTRIES = 48;
const MAX_STORE_VALUE = 160_000;

const memCache = new Map();
const inflight = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStore() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStore(all) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

function pruneStore(all) {
  const now = Date.now();
  const entries = Object.entries(all).filter(([, hit]) => hit?.expires > now);
  entries.sort((a, b) => (b[1].expires || 0) - (a[1].expires || 0));
  return Object.fromEntries(entries.slice(0, MAX_STORE_ENTRIES));
}

function getCached(key) {
  const mem = memCache.get(key);
  if (mem && mem.freshUntil > Date.now()) {
    return { data: mem.data, fresh: true };
  }
  if (mem && mem.staleUntil > Date.now()) {
    return { data: mem.data, fresh: false };
  }

  const hit = readStore()[key];
  if (!hit?.data) return null;
  if (hit.freshUntil > Date.now()) {
    memCache.set(key, {
      data: hit.data,
      freshUntil: hit.freshUntil,
      staleUntil: hit.staleUntil,
    });
    return { data: hit.data, fresh: true };
  }
  if (hit.staleUntil > Date.now()) {
    memCache.set(key, {
      data: hit.data,
      freshUntil: 0,
      staleUntil: hit.staleUntil,
    });
    return { data: hit.data, fresh: false };
  }
  return null;
}

function setCached(key, data) {
  const now = Date.now();
  const entry = {
    data,
    freshUntil: now + TTL_MS,
    staleUntil: now + STALE_MS,
  };
  memCache.set(key, entry);

  try {
    const raw = JSON.stringify(data);
    if (raw.length > MAX_STORE_VALUE) return;
    const all = pruneStore(readStore());
    all[key] = {
      data,
      freshUntil: entry.freshUntil,
      staleUntil: entry.staleUntil,
      expires: entry.staleUntil,
    };
    writeStore(all);
  } catch {
    /* ignore */
  }
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`TMDB ${res.status}: ${body || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

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

  const cacheKey = url.toString();
  const cached = getCached(cacheKey);
  if (cached?.fresh) return cached.data;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const pending = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const data = await fetchJson(cacheKey, headers);
        setCached(cacheKey, data);
        return data;
      } catch (err) {
        lastErr = err;
        const status = err?.status;
        // Don't retry hard client errors except timeouts / network / 429 / 5xx
        if (status && status < 500 && status !== 429) break;
        if (attempt < MAX_RETRIES) await sleep(400 * (attempt + 1));
      }
    }
    // Weak signal: serve stale cache rather than a blank page
    if (cached?.data) return cached.data;
    throw lastErr || new Error("TMDB request failed");
  })();

  inflight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(cacheKey);
  }
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
  trendingTv: (timeWindow = "week") => tmdbFetch(`/trending/tv/${timeWindow}`),
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
  topRatedTv: (page = 1) => tmdbFetch("/tv/top_rated", { page }),
  network: (id) => tmdbFetch(`/network/${id}`),
  company: (id) => tmdbFetch(`/company/${id}`),
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
