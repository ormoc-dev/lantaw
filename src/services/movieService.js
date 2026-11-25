import { tmdb, posterUrl, backdropUrl } from "../lib/tmdb.js?v=151";
import { getOmdbByImdbId, getOmdbByTitle } from "../lib/omdb.js";
import { idbGet, idbSet } from "../lib/idbCache.js";

function mapTitle(m) {
  return {
    id: m.id,
    mediaType: m.media_type || (m.title ? "movie" : "tv"),
    title: m.title || m.name || "Untitled",
    overview: m.overview,
    releaseDate: m.release_date || m.first_air_date || null,
    rating: m.vote_average,
    voteCount: m.vote_count ?? 0,
    poster: posterUrl(m.poster_path),
    backdrop: backdropUrl(m.backdrop_path),
    genreIds: m.genre_ids || [],
    originalLanguage: m.original_language || null,
    originCountry: Array.isArray(m.origin_country) ? m.origin_country : [],
    raw: m,
  };
}

/** Japanese/Korean animation (anime / aeni) — keep off the US Top 10 shelf. */
function isAnimeTitle(item) {
  const genres = item?.genreIds || item?.raw?.genre_ids || [];
  if (!genres.includes(16)) return false;
  const lang =
    item?.originalLanguage || item?.raw?.original_language || "";
  return lang === "ja" || lang === "ko" || lang === "zh";
}

/** US-origin catalog titles only (no anime). */
function isUsCatalogTitle(item) {
  if (!item?.id || isAnimeTitle(item)) return false;
  const countries = item.originCountry?.length
    ? item.originCountry
    : item.raw?.origin_country || [];
  if (Array.isArray(countries) && countries.length) {
    return countries.includes("US");
  }
  const lang =
    item?.originalLanguage || item?.raw?.original_language || "";
  // List payloads often omit country on movies — allow English only, block foreign langs.
  if (["ja", "ko", "zh", "th", "hi", "tl", "id", "es", "pt", "fr", "de", "it", "tr"].includes(lang)) {
    return false;
  }
  return lang === "en";
}

export function mapList(data, mediaType) {
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || [])
      .filter((item) => {
        const type = item.media_type || mediaType;
        return type === "movie" || type === "tv";
      })
      .map((item) => {
        const mapped = mapTitle(item);
        if (mediaType) mapped.mediaType = mediaType;
        return mapped;
      }),
  };
}

/** Alias for brand / discover callers */
export const mapListFromRaw = mapList;

export async function getPopularMovies(page = 1) {
  return mapList(await tmdb.popular(page), "movie");
}

/** Category grids — TMDB is 20/page. Keep shelves full without over-fetching. */
const CATEGORY_LIST_LIMIT = 60;
/** Horizontal recommend rails: enough titles to scroll past the 4 on screen. */
const RECOMMEND_ROW_LIMIT = 50;
const CATEGORY_CACHE_TTL = 10 * 60 * 1000;
const categoryMem = new Map();

async function collectPages(fetchPage, limit = CATEGORY_LIST_LIMIT) {
  const pageCount = Math.max(1, Math.ceil(limit / 20));
  const batches = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => fetchPage(i + 1))
  );
  const seen = new Set();
  const results = [];
  for (const batch of batches) {
    for (const item of batch?.results || []) {
      if (!item?.id) continue;
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
      if (results.length >= limit) {
        return { results };
      }
    }
  }
  return { results };
}

export async function getTrendingMovies() {
  return mapList(await tmdb.trending("week"), "movie");
}

const trailerKeyCache = new Map();

/** Best YouTube trailer/teaser key for Shorts autoplay. */
export async function getTrailerKey(id, mediaType = "movie") {
  if (!id) return null;
  const cacheKey = `${mediaType}:${id}`;
  if (trailerKeyCache.has(cacheKey)) return trailerKeyCache.get(cacheKey);

  const pending = (async () => {
    try {
      const data =
        mediaType === "tv" ? await tmdb.tvVideos(id) : await tmdb.videos(id);
      const yt = (data.results || []).filter((v) => v.site === "YouTube" && v.key);
      const pick =
        yt.find((v) => v.type === "Trailer") ||
        yt.find((v) => v.type === "Teaser") ||
        yt.find((v) => v.type === "Clip") ||
        yt[0];
      return pick?.key || null;
    } catch {
      return null;
    }
  })();

  trailerKeyCache.set(cacheKey, pending);
  const key = await pending;
  trailerKeyCache.set(cacheKey, Promise.resolve(key));
  return key;
}

export async function getTopRatedMovies(page = 1) {
  return mapList(await tmdb.topRated(page), "movie");
}

export async function getNowPlayingMovies(page = 1) {
  return mapList(await tmdb.nowPlaying(page), "movie");
}

export async function getUpcomingMovies(page = 1) {
  return mapList(await tmdb.upcoming(page), "movie");
}

export async function getGenres() {
  const data = await tmdb.genres();
  return data.genres || [];
}

export async function getMoviesByGenre(genreId, page = 1) {
  return mapList(await tmdb.byGenre(genreId, page), "movie");
}

function itemKey(item) {
  return `${item?.mediaType || "movie"}:${item?.id}`;
}

/** Drop junk / unrated / posterless titles so shelves stay real. */
function isRealTitle(item, { minVotes = 40 } = {}) {
  return Boolean(
    item?.id &&
      item?.title &&
      item.title !== "Untitled" &&
      item.poster &&
      Number(item.rating) > 0 &&
      Number(item.voteCount || 0) >= minVotes
  );
}

function compareByRating(a, b) {
  const ratingDiff = (b.rating || 0) - (a.rating || 0);
  if (ratingDiff !== 0) return ratingDiff;
  return (b.voteCount || 0) - (a.voteCount || 0);
}

/** Filter to real titles, then highest rating first. */
function rankByRating(list, { limit, minVotes = 40 } = {}) {
  const source = Array.isArray(list) ? list : [];
  let ranked = source
    .filter((item) => isRealTitle(item, { minVotes }))
    .sort(compareByRating);

  // If the vote floor leaves a thin shelf, relax once so rows still fill.
  if (
    typeof limit === "number" &&
    ranked.length < Math.min(limit, 8) &&
    minVotes > 5
  ) {
    ranked = source
      .filter((item) => isRealTitle(item, { minVotes: 5 }))
      .sort(compareByRating);
  }

  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

/** Merge lists, drop duplicates, sort highest rating first. */
function mergeByRating(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.id) continue;
      const key = itemKey(item);
      const prev = byKey.get(key);
      if (!prev || (item.rating || 0) > (prev.rating || 0)) {
        byKey.set(key, item);
      }
    }
  }
  return rankByRating([...byKey.values()]);
}

/**
 * Fill a shelf from a ranked pool, skipping titles already used higher up
 * so Recommend rows don't feel redundant.
 */
function takeUnique(pool, used, limit = RECOMMEND_ROW_LIMIT) {
  const out = [];
  for (const item of pool || []) {
    if (!item?.id) continue;
    const key = itemKey(item);
    if (used.has(key)) continue;
    used.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Recommend page rows:
 * Top 10 Today · US, Trending, Popular movies/TV, New on air, Popular anime.
 * (TV Networks + Movie Studios are logo rails above the list.)
 */
export async function getRecommended() {
  // Pull extra candidates so cross-row dedupe still leaves full shelves.
  const poolLimit = Math.max(RECOMMEND_ROW_LIMIT * 3, 100);

  // Truly parallel — never `await` inside the Promise.all array.
  const [
    trendingToday,
    trendingNow,
    popularMovies,
    popularTv,
    nowPlaying,
    anime,
    kdrama,
    vivaOne,
    usMovies,
    usTv,
  ] = await Promise.all([
    collectPages(
      (page) => tmdb.trendingAll("day", page).then((data) => mapList(data)),
      poolLimit
    ),
    collectPages(
      (page) => tmdb.trendingAll("week", page).then((data) => mapList(data)),
      poolLimit
    ),
    collectPages((page) => getPopularMovies(page), poolLimit),
    collectPages((page) => getTvShows(page), poolLimit),
    collectPages((page) => getNowPlayingMovies(page), poolLimit),
    getAnime({ limit: poolLimit }),
    getKdrama({ limit: poolLimit }),
    getVivaOne({ limit: poolLimit }),
    collectPages(
      (page) =>
        tmdb
          .discoverMovies({
            with_origin_country: "US",
            sort_by: "popularity.desc",
            page,
          })
          .then((data) => mapList(data, "movie")),
      poolLimit
    ),
    collectPages(
      (page) =>
        tmdb
          .discoverTv({
            with_origin_country: "US",
            sort_by: "popularity.desc",
            page,
          })
          .then((data) => mapList(data, "tv")),
      poolLimit
    ),
  ]);

  // Top 10 US: US-origin only, no anime (trending today + US discover).
  const usTopPool = mergeByRating(
    (trendingToday.results || []).filter(isUsCatalogTitle),
    (usMovies.results || []).filter(isUsCatalogTitle),
    (usTv.results || []).filter(isUsCatalogTitle)
  );

  const used = new Set();
  const sections = [
    {
      id: "top10-us",
      title: "Top 10 Today · United States",
      items: takeUnique(
        rankByRating(usTopPool, {
          limit: poolLimit,
          minVotes: 80,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "trending-now",
      title: "Trending now",
      items: takeUnique(
        rankByRating(trendingNow.results, {
          limit: poolLimit,
          minVotes: 80,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "popular-movies",
      title: "Popular movies",
      items: takeUnique(
        rankByRating(popularMovies.results, {
          limit: poolLimit,
          minVotes: 100,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "popular-tv",
      title: "Popular TV shows",
      items: takeUnique(
        rankByRating(popularTv.results, {
          limit: poolLimit,
          minVotes: 80,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "now-playing",
      title: "New on air movies",
      items: takeUnique(
        rankByRating(nowPlaying.results, {
          limit: poolLimit,
          minVotes: 40,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "popular-anime",
      title: "Popular anime",
      items: takeUnique(
        rankByRating(anime.results, {
          limit: poolLimit,
          minVotes: 40,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "popular-kdrama",
      title: "Popular Kdrama",
      items: takeUnique(
        rankByRating(kdrama.results, {
          limit: poolLimit,
          minVotes: 40,
        }),
        used,
        RECOMMEND_ROW_LIMIT
      ),
    },
    {
      id: "popular-viva-one",
      title: "Popular Viva One",
      items: takeUnique(vivaOne.results || [], used, RECOMMEND_ROW_LIMIT),
    },
  ].filter((s) => s.items.length);

  // Flat list for hero / home preview (prefer today's top + trending)
  const results = mergeByRating(
    sections[0]?.items,
    trendingNow.results,
    popularMovies.results,
    popularTv.results
  );

  return { results, sections };
}

export async function getFilipino({ limit = CATEGORY_LIST_LIMIT } = {}) {
  const pageCount = Math.max(1, Math.ceil(limit / 20));
  const jobs = [];
  for (let page = 1; page <= pageCount; page += 1) {
    jobs.push(
      tmdb.discoverMovies({
        with_origin_country: "PH",
        sort_by: "vote_average.desc",
        "vote_count.gte": 20,
        page,
      }),
      tmdb.discoverTv({
        with_origin_country: "PH",
        sort_by: "vote_average.desc",
        "vote_count.gte": 20,
        page,
      })
    );
  }
  const raw = await Promise.all(jobs);
  const merged = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i += 1) {
    const mediaType = i % 2 === 0 ? "movie" : "tv";
    for (const item of mapList(raw[i], mediaType).results) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return { results: rankByRating(merged, { limit, minVotes: 20 }) };
}

export async function getTvShows(page = 1) {
  return mapList(await tmdb.popularTv(page), "tv");
}

export async function getAnime({ limit = CATEGORY_LIST_LIMIT } = {}) {
  const pageCount = Math.max(1, Math.ceil(limit / 20));
  const jobs = [];
  for (let page = 1; page <= pageCount; page += 1) {
    jobs.push(
      tmdb.discoverMovies({
        with_genres: 16,
        with_original_language: "ja",
        sort_by: "vote_average.desc",
        "vote_count.gte": 40,
        page,
      }),
      tmdb.discoverTv({
        with_genres: 16,
        with_original_language: "ja",
        sort_by: "vote_average.desc",
        "vote_count.gte": 40,
        page,
      })
    );
  }
  const raw = await Promise.all(jobs);
  const merged = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i += 1) {
    const mediaType = i % 2 === 0 ? "movie" : "tv";
    for (const item of mapList(raw[i], mediaType).results) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return { results: rankByRating(merged, { limit, minVotes: 40 }) };
}

/** Korean dramas — KR TV in Korean, Drama genre (skip variety / talk). */
export async function getKdrama({ limit = CATEGORY_LIST_LIMIT } = {}) {
  const pageCount = Math.max(1, Math.ceil(limit / 20));
  const jobs = [];
  for (let page = 1; page <= pageCount; page += 1) {
    jobs.push(
      tmdb.discoverTv({
        with_original_language: "ko",
        with_origin_country: "KR",
        with_genres: 18,
        without_genres: "10764,10767,10763",
        sort_by: "vote_average.desc",
        "vote_count.gte": 40,
        page,
      })
    );
  }
  const raw = await Promise.all(jobs);
  const merged = [];
  const seen = new Set();
  for (const batch of raw) {
    for (const item of mapList(batch, "tv").results) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return { results: rankByRating(merged, { limit, minVotes: 40 }) };
}

/** Vivamax originals (TMDB company 149142) */
export async function getVivamax({ limit = CATEGORY_LIST_LIMIT } = {}) {
  const pageCount = Math.max(1, Math.ceil(limit / 20));
  const jobs = [];
  for (let page = 1; page <= pageCount; page += 1) {
    jobs.push(
      tmdb.discoverMovies({
        with_companies: 149142,
        include_adult: true,
        sort_by: "vote_average.desc",
        "vote_count.gte": 5,
        page,
      }),
      tmdb.discoverTv({
        with_companies: 149142,
        include_adult: true,
        sort_by: "vote_average.desc",
        "vote_count.gte": 5,
        page,
      })
    );
  }
  const raw = await Promise.all(jobs);
  const merged = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i += 1) {
    const mediaType = i % 2 === 0 ? "movie" : "tv";
    for (const item of mapList(raw[i], mediaType).results) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return { results: rankByRating(merged, { limit, minVotes: 5 }) };
}

/**
 * Viva One catalog:
 * - TV network 6976
 * - companies 204985 (Viva One PH) + 208474 (Vivaone)
 * Network alone is tiny on TMDB; companies add the movies / extras.
 * Keep the vote floor low — many Pinoy titles have few TMDB votes.
 */
export async function getVivaOne({ limit = 200 } = {}) {
  const pageCount = Math.max(1, Math.ceil(Math.min(limit, 200) / 20));
  const companies = "204985|208474";
  const jobs = [];
  for (let page = 1; page <= pageCount; page += 1) {
    jobs.push(
      tmdb.discoverTv({
        with_networks: 6976,
        sort_by: "popularity.desc",
        page,
      }),
      tmdb.discoverTv({
        with_companies: companies,
        sort_by: "popularity.desc",
        page,
      }),
      tmdb.discoverMovies({
        with_companies: companies,
        sort_by: "popularity.desc",
        page,
      })
    );
  }
  const raw = await Promise.all(jobs);
  const merged = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i += 1) {
    // jobs cycle: network-tv, company-tv, company-movie
    const kind = i % 3;
    const mediaType = kind === 2 ? "movie" : "tv";
    for (const item of mapList(raw[i], mediaType).results) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      if (!item?.poster || !item?.title || item.title === "Untitled") continue;
      seen.add(key);
      merged.push(item);
    }
  }
  // Prefer rated titles first, but keep unrated posters so the shelf stays full.
  merged.sort((a, b) => {
    const ar = Number(a.rating) > 0 ? Number(a.rating) : -1;
    const br = Number(b.rating) > 0 ? Number(b.rating) : -1;
    if (br !== ar) return br - ar;
    return (b.voteCount || 0) - (a.voteCount || 0);
  });
  return { results: merged.slice(0, limit) };
}

const CATEGORY_CACHE_VER = "v7";

function categoryCacheKey(categoryId) {
  return `lantaw-cat-${CATEGORY_CACHE_VER}-${categoryId}`;
}

function categoryIdbKey(categoryId) {
  return `cat:${CATEGORY_CACHE_VER}:${categoryId}`;
}

function readCategoryCache(categoryId) {
  const hit = categoryMem.get(categoryId);
  if (hit?.data) return hit.data;
  try {
    const raw = sessionStorage.getItem(categoryCacheKey(categoryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    categoryMem.set(categoryId, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCategoryCache(categoryId, data) {
  const entry = { expires: Date.now() + CATEGORY_CACHE_TTL, data };
  categoryMem.set(categoryId, entry);
  try {
    sessionStorage.setItem(categoryCacheKey(categoryId), JSON.stringify(entry));
  } catch {
    /* quota */
  }
  idbSet(categoryIdbKey(categoryId), entry);
}

const CATALOG_IDS = [
  "recommend",
  "filipino",
  "vivamax",
  "viva-one",
  "movies",
  "tv-show",
  "anime",
  "kdrama",
];

/** Warm in-memory shelves from IndexedDB before the first paint. */
export async function hydrateCatalogCache() {
  await Promise.all(
    CATALOG_IDS.map(async (id) => {
      if (categoryMem.has(id)) return;
      const entry = await idbGet(categoryIdbKey(id));
      if (entry?.data) categoryMem.set(id, entry);
    })
  );
}

/** Instant paint from last visit (may be slightly stale). */
export function peekCategoryItems(categoryId) {
  return readCategoryCache(categoryId);
}

async function loadCategoryItems(categoryId) {
  switch (categoryId) {
    case "recommend":
      return getRecommended();
    case "filipino":
      return getFilipino();
    case "vivamax":
      return getVivamax();
    case "viva-one":
      return getVivaOne();
    case "movies": {
      const data = await collectPages(
        (page) => getPopularMovies(page),
        CATEGORY_LIST_LIMIT
      );
      return {
        results: rankByRating(data.results, {
          limit: CATEGORY_LIST_LIMIT,
          minVotes: 100,
        }),
      };
    }
    case "tv-show": {
      const data = await collectPages(
        (page) => getTvShows(page),
        CATEGORY_LIST_LIMIT
      );
      return {
        results: rankByRating(data.results, {
          limit: CATEGORY_LIST_LIMIT,
          minVotes: 80,
        }),
      };
    }
    case "anime":
      return getAnime();
    case "kdrama":
      return getKdrama();
    default:
      return { results: [] };
  }
}

/** Load titles for one category page (cached ~10 min). */
export async function getCategoryItems(categoryId) {
  const cached = readCategoryCache(categoryId);
  try {
    const data = await loadCategoryItems(categoryId);
    if (data?.results?.length || data?.sections?.length) {
      writeCategoryCache(categoryId, data);
    }
    return data;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

const HOME_PREVIEW = 12;

function previewList(results = [], heroes = [], limit = HOME_PREVIEW) {
  const blocked = new Set(
    (Array.isArray(heroes) ? heroes : heroes ? [heroes] : [])
      .filter(Boolean)
      .map(itemKey)
  );
  return results
    .filter((item) => item?.id && !blocked.has(itemKey(item)))
    .slice(0, limit);
}

function pickHeroes(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.id) continue;
      // Prefer titles with a backdrop for the banner
      if (!item.backdrop && !item.poster) continue;
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/** Home: hero carousel + separate sections per category */
export async function getHomeCatalog() {
  const [recommend, filipino, vivamax, vivaOne, moviesRaw, tvRaw, anime, kdrama] =
    await Promise.all([
      getRecommended(),
      getFilipino(),
      getVivamax(),
      getVivaOne(),
      getPopularMovies(),
      getTvShows(),
      getAnime(),
      getKdrama(),
    ]);

  const movies = {
    results: rankByRating(moviesRaw.results, {
      limit: CATEGORY_LIST_LIMIT,
      minVotes: 100,
    }),
  };
  const tv = {
    results: rankByRating(tvRaw.results, {
      limit: CATEGORY_LIST_LIMIT,
      minVotes: 80,
    }),
  };

  const heroes = pickHeroes(
    recommend.results,
    movies.results,
    tv.results,
    anime.results,
    kdrama.results,
    filipino.results
  );
  const hero = heroes[0] || null;

  return {
    hero,
    heroes,
    sections: [
      {
        id: "recommend",
        title: "Recommend",
        description: "Top picks, trending titles, and what’s popular now.",
        path: "/recommend",
        items: previewList(recommend.results, heroes),
      },
      {
        id: "filipino",
        title: "Filipino",
        description: "Movies and shows from the Philippines.",
        path: "/filipino",
        items: previewList(filipino.results, heroes),
      },
      {
        id: "movies",
        title: "Movies",
        description: "Popular movies worldwide.",
        path: "/movies",
        items: previewList(movies.results, heroes),
      },
      {
        id: "tv-show",
        title: "TV Show",
        description: "Popular TV series to binge.",
        path: "/tv-show",
        items: previewList(tv.results, heroes),
      },
      {
        id: "anime",
        title: "Anime",
        description: "Japanese animation movies and series.",
        path: "/anime",
        items: previewList(anime.results, heroes),
      },
      {
        id: "kdrama",
        title: "Kdrama",
        description: "Korean dramas and series.",
        path: "/kdrama",
        items: previewList(kdrama.results, heroes),
      },
      {
        id: "vivamax",
        title: "Vivamax",
        description: "Bold Filipino originals from Vivamax.",
        path: "/vivamax",
        items: previewList(vivamax.results, heroes),
      },
      {
        id: "viva-one",
        title: "Viva One",
        description: "Pinoy originals and series from Viva One.",
        path: "/viva-one",
        items: previewList(vivaOne.results, heroes),
      },
    ],
  };
}

export async function searchMovies(query, page = 1) {
  return mapList(await tmdb.search(query, page), "movie");
}

async function attachOmdb(detail, { imdbId, title, year }) {
  try {
    let omdb = await getOmdbByImdbId(imdbId);
    if (!omdb) omdb = await getOmdbByTitle(title, year);
    return { ...detail, omdb };
  } catch {
    return { ...detail, omdb: null };
  }
}

async function cachedDetail(key, load) {
  const cached = await idbGet(key);
  const fresh = load()
    .then((detail) => {
      if (detail?.id) idbSet(key, { at: Date.now(), data: detail });
      return detail;
    })
    .catch((err) => {
      if (cached?.data) return cached.data;
      throw err;
    });
  if (cached?.data?.id) {
    fresh.catch(() => {});
    return cached.data;
  }
  return fresh;
}

export async function getMovieDetail(id) {
  return cachedDetail(`detail:movie:${id}`, () => fetchMovieDetail(id));
}

async function fetchMovieDetail(id) {
  const [movie, credits, videos, external] = await Promise.all([
    tmdb.movie(id),
    tmdb.credits(id),
    tmdb.videos(id),
    tmdb.movieExternalIds(id).catch(() => ({})),
  ]);

  const detail = {
    ...mapTitle({ ...movie, media_type: "movie" }),
    runtime: movie.runtime,
    genres: movie.genres || [],
    cast: (credits.cast || []).slice(0, 12),
    trailer: (videos.results || []).find(
      (v) => v.site === "YouTube" && v.type === "Trailer"
    ),
    imdbId: external.imdb_id || movie.imdb_id || null,
  };

  return attachOmdb(detail, {
    imdbId: detail.imdbId,
    title: detail.title,
    year: detail.releaseDate?.slice(0, 4),
  });
}

export async function getTvDetail(id) {
  return cachedDetail(`detail:tv:${id}`, () => fetchTvDetail(id));
}

async function fetchTvDetail(id) {
  const [show, credits, videos, external] = await Promise.all([
    tmdb.tv(id),
    tmdb.tvCredits(id),
    tmdb.tvVideos(id),
    tmdb.tvExternalIds(id).catch(() => ({})),
  ]);

  const detail = {
    ...mapTitle({ ...show, media_type: "tv" }),
    runtime: show.episode_run_time?.[0] || null,
    genres: show.genres || [],
    seasons: (show.seasons || [])
      .filter((season) => Number(season.season_number) > 0)
      .map((season) => ({
        seasonNumber: Number(season.season_number),
        name: season.name || `Season ${season.season_number}`,
        episodeCount: Number(season.episode_count) || 1,
      })),
    cast: (credits.cast || []).slice(0, 12),
    trailer: (videos.results || []).find(
      (v) => v.site === "YouTube" && v.type === "Trailer"
    ),
    imdbId: external.imdb_id || null,
  };

  return attachOmdb(detail, {
    imdbId: detail.imdbId,
    title: detail.title,
    year: detail.releaseDate?.slice(0, 4),
  });
}
