import { tmdb, posterUrl, backdropUrl } from "../lib/tmdb.js";

function mapMovie(m) {
  return {
    id: m.id,
    title: m.title,
    overview: m.overview,
    releaseDate: m.release_date,
    rating: m.vote_average,
    poster: posterUrl(m.poster_path),
    backdrop: backdropUrl(m.backdrop_path),
    genreIds: m.genre_ids || [],
    raw: m,
  };
}

function mapList(data) {
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(mapMovie),
  };
}

export async function getPopularMovies(page = 1) {
  return mapList(await tmdb.popular(page));
}

export async function getTrendingMovies() {
  return mapList(await tmdb.trending("week"));
}

export async function getTopRatedMovies(page = 1) {
  return mapList(await tmdb.topRated(page));
}

export async function getNowPlayingMovies(page = 1) {
  return mapList(await tmdb.nowPlaying(page));
}

export async function getUpcomingMovies(page = 1) {
  return mapList(await tmdb.upcoming(page));
}

export async function getGenres() {
  const data = await tmdb.genres();
  return data.genres || [];
}

export async function getMoviesByGenre(genreId, page = 1) {
  return mapList(await tmdb.byGenre(genreId, page));
}

/** Curated + genre rows for the home screen */
export async function getHomeCatalog() {
  const [trending, popular, topRated, nowPlaying, upcoming, genres] =
    await Promise.all([
      getTrendingMovies(),
      getPopularMovies(),
      getTopRatedMovies(),
      getNowPlayingMovies(),
      getUpcomingMovies(),
      getGenres(),
    ]);

  const featuredGenres = genres.slice(0, 12);
  const genreRows = await Promise.all(
    featuredGenres.map(async (g) => {
      const list = await getMoviesByGenre(g.id);
      return { id: `genre-${g.id}`, title: g.name, movies: list.results };
    })
  );

  return {
    hero: trending.results[0] || popular.results[0] || null,
    rows: [
      { id: "trending", title: "Trending", movies: trending.results },
      { id: "popular", title: "Popular", movies: popular.results },
      { id: "top-rated", title: "Top rated", movies: topRated.results },
      { id: "now-playing", title: "Now playing", movies: nowPlaying.results },
      { id: "upcoming", title: "Upcoming", movies: upcoming.results },
      ...genreRows.filter((r) => r.movies.length),
    ],
  };
}

export async function searchMovies(query, page = 1) {
  return mapList(await tmdb.search(query, page));
}

export async function getMovieDetail(id) {
  const [movie, credits, videos] = await Promise.all([
    tmdb.movie(id),
    tmdb.credits(id),
    tmdb.videos(id),
  ]);

  return {
    ...mapMovie(movie),
    runtime: movie.runtime,
    genres: movie.genres || [],
    cast: (credits.cast || []).slice(0, 12),
    trailer: (videos.results || []).find(
      (v) => v.site === "YouTube" && v.type === "Trailer"
    ),
  };
}
