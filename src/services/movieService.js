import { tmdb, posterUrl, backdropUrl } from "../lib/tmdb.js";

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

function mapList(data, mediaType) {
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

export async function getPopularMovies(page = 1) {
  return mapList(await tmdb.popular(page), "movie");
}

export async function getTrendingMovies() {
  return mapList(await tmdb.trending("week"), "movie");
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

export async function getRecommended() {
  return mapList(await tmdb.trendingAll("week"));
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

/** Load titles for one category page */
export async function getCategoryItems(categoryId) {
  switch (categoryId) {
    case "recommend":
      return getRecommended();
    case "filipino":
      return getFilipino();
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

/** Home preview: featured + light samples per category */
export async function getHomeCatalog() {
  const [recommend, movies] = await Promise.all([
    getRecommended(),
    getPopularMovies(),
  ]);

  return {
    hero: recommend.results[0] || movies.results[0] || null,
  };
}

export async function searchMovies(query, page = 1) {
  return mapList(await tmdb.search(query, page), "movie");
}

export async function getMovieDetail(id) {
  const [movie, credits, videos] = await Promise.all([
    tmdb.movie(id),
    tmdb.credits(id),
    tmdb.videos(id),
  ]);

  return {
    ...mapTitle({ ...movie, media_type: "movie" }),
    runtime: movie.runtime,
    genres: movie.genres || [],
    cast: (credits.cast || []).slice(0, 12),
    trailer: (videos.results || []).find(
      (v) => v.site === "YouTube" && v.type === "Trailer"
    ),
  };
}

export async function getTvDetail(id) {
  const [show, credits, videos] = await Promise.all([
    tmdb.tv(id),
    tmdb.tvCredits(id),
    tmdb.tvVideos(id),
  ]);

  return {
    ...mapTitle({ ...show, media_type: "tv" }),
    runtime: show.episode_run_time?.[0] || null,
    genres: show.genres || [],
    cast: (credits.cast || []).slice(0, 12),
    trailer: (videos.results || []).find(
      (v) => v.site === "YouTube" && v.type === "Trailer"
    ),
  };
}
