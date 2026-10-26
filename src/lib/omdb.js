import { env } from "../config/env.js";

/**
 * OMDb — metadata + multi-source ratings (not full movie streams).
 * Docs: https://www.omdbapi.com/
 */
export async function omdbFetch(params = {}) {
  if (!env.omdbApiKey || env.omdbApiKey.includes("YOUR_OMDB")) {
    return null;
  }

  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", env.omdbApiKey);
  url.searchParams.set("plot", "full");

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`OMDb ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.Response === "False") {
    return null;
  }
  return data;
}

export function mapOmdb(data) {
  if (!data) return null;
  return {
    imdbId: data.imdbID || null,
    rated: data.Rated || null,
    runtime: data.Runtime || null,
    director: data.Director || null,
    writer: data.Writer || null,
    actors: data.Actors || null,
    plot: data.Plot || null,
    awards: data.Awards || null,
    boxOffice: data.BoxOffice || null,
    imdbRating: data.imdbRating || null,
    imdbVotes: data.imdbVotes || null,
    metascore: data.Metascore || null,
    ratings: Array.isArray(data.Ratings) ? data.Ratings : [],
    poster: data.Poster && data.Poster !== "N/A" ? data.Poster : null,
  };
}

export async function getOmdbByImdbId(imdbId) {
  if (!imdbId) return null;
  return mapOmdb(await omdbFetch({ i: imdbId }));
}

export async function getOmdbByTitle(title, year) {
  if (!title) return null;
  return mapOmdb(
    await omdbFetch({
      t: title,
      y: year || undefined,
      type: "movie",
    })
  );
}
