import { tmdb, posterUrl, backdropUrl } from "../lib/tmdb.js";
import { getOmdbByImdbId, getOmdbByTitle } from "../lib/omdb.js";

function mapTitle(m) {
  return {
    id: m.id,
    mediaType: m.media_type || (m.title ? "movie" : "tv"),
    title: m.title || m.name || "Untitled",
    overview: m.overview,
    releaseDate: m.release_date || m.first_air_date || null,
    rating: m.vote_average,
    poster: posterUrl(m.poster_path),
    backdrop: backdropUrl(m.backdrop_path),
    genreIds: m.genre_ids || [],
    raw: m,
  };
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

export async function getTrendingMovies() {
  return mapList(await tmdb.trending("week"), "movie");
}

/** Best YouTube trailer/teaser key for Shorts autoplay. */
export async function getTrailerKey(id, mediaType = "movie") {
  if (!id) return null;
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
  return [...byKey.values()].sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

/**
 * Recommend page rows:
 * Top 10 Today · US, Trending, Popular movies/TV, New on air, Popular anime.
 * (TV Networks + Movie Studios are logo rails above the list.)
 */
export async function getRecommended() {
  const [trendingToday, trendingNow, popularMovies, popularTv, nowPlaying, anime] =
    await Promise.all([
      mapList(await tmdb.trendingAll("day")),
      mapList(await tmdb.trendingAll("week")),
      getPopularMovies(),
      getTvShows(),
      getNowPlayingMovies(),
      getAnime(),
    ]);

  const sections = [
    {
      id: "top10-us",
      title: "Top 10 Today · United States",
      items: (trendingToday.results || []).slice(0, 10),
    },
    {
      id: "trending-now",
      title: "Trending now",
      items: (trendingNow.results || []).slice(0, 18),
    },
    {
      id: "popular-movies",
      title: "Popular movies",
      items: (popularMovies.results || []).slice(0, 18),
    },
    {
      id: "popular-tv",
      title: "Popular TV shows",
      items: (popularTv.results || []).slice(0, 18),
    },
    {
      id: "now-playing",
      title: "New on air movies",
      items: (nowPlaying.results || []).slice(0, 18),
    },
    {
      id: "popular-anime",
      title: "Popular anime",
      items: (anime.results || []).slice(0, 18),
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

export async function getFilipino() {
  const [movies, tv] = await Promise.all([
    tmdb.discoverMovies({
      with_origin_country: "PH",
      page: 1,
    }),
    tmdb.discoverTv({
      with_origin_country: "PH",
      page: 1,
    }),
  ]);

  const merged = [
    ...mapList(movies, "movie").results,
    ...mapList(tv, "tv").results,
  ].sort((a, b) => (b.rating || 0) - (a.rating || 0));

  return { results: merged };
}

export async function getTvShows(page = 1) {
  return mapList(await tmdb.popularTv(page), "tv");
}

export async function getAnime() {
  const [movies, tv] = await Promise.all([
    tmdb.discoverMovies({
      with_genres: 16,
      with_original_language: "ja",
      page: 1,
    }),
    tmdb.discoverTv({
      with_genres: 16,
      with_original_language: "ja",
      page: 1,
    }),
  ]);

  const merged = [
    ...mapList(movies, "movie").results,
    ...mapList(tv, "tv").results,
  ].sort((a, b) => (b.rating || 0) - (a.rating || 0));

  return { results: merged };
}

/** Vivamax originals (TMDB company 149142) */
export async function getVivamax() {
  const [movies, tv] = await Promise.all([
    tmdb.discoverMovies({
      with_companies: 149142,
      include_adult: true,
      sort_by: "primary_release_date.desc",
      page: 1,
    }),
    tmdb.discoverTv({
      with_companies: 149142,
      include_adult: true,
      sort_by: "first_air_date.desc",
      page: 1,
    }),
  ]);

  const merged = [
    ...mapList(movies, "movie").results,
    ...mapList(tv, "tv").results,
  ].sort((a, b) => {
    const da = a.releaseDate || "";
    const db = b.releaseDate || "";
    if (da !== db) return db.localeCompare(da);
    return (b.rating || 0) - (a.rating || 0);
  });

  return { results: merged };
}

/** Load titles for one category page */
export async function getCategoryItems(categoryId) {
  switch (categoryId) {
    case "recommend":
      return getRecommended();
    case "filipino":
      return getFilipino();
    case "vivamax":
      return getVivamax();
    case "movies":
      return getPopularMovies();
    case "tv-show":
      return getTvShows();
    case "anime":
      return getAnime();
    default:
      return { results: [] };
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
  const [recommend, filipino, vivamax, movies, tv, anime] = await Promise.all([
    getRecommended(),
    getFilipino(),
    getVivamax(),
    getPopularMovies(),
    getTvShows(),
    getAnime(),
  ]);

  const heroes = pickHeroes(
    recommend.results,
    movies.results,
    tv.results,
    anime.results,
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
        id: "vivamax",
        title: "Vivamax",
        description: "Bold Filipino originals from Vivamax.",
        path: "/vivamax",
        items: previewList(vivamax.results, heroes),
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

export async function getMovieDetail(id) {
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
