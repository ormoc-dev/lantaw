const KEY = "movie.recentViews";
const MAX = 30;

export function getRecentMovies() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecentMovie(movie) {
  if (!movie?.id) return;
  const next = {
    id: movie.id,
    mediaType: movie.mediaType || "movie",
    title: movie.title || "Untitled",
    poster: movie.poster || null,
    rating: movie.rating ?? null,
    releaseDate: movie.releaseDate || null,
    viewedAt: Date.now(),
  };

  const list = getRecentMovies().filter((m) => m.id !== next.id);
  list.unshift(next);
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function clearRecentMovies() {
  localStorage.removeItem(KEY);
}
