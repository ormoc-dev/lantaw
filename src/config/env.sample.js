/**
 * Sample only — copy values live in .env, then run: npm run sync-env
 * That regenerates env.js (gitignored). Do not put real secrets here.
 */

export const env = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  siteUrl: "http://localhost",
  tmdbApiKey: "YOUR_TMDB_API_KEY",
  tmdbBaseUrl: "https://api.themoviedb.org/3",
  tmdbImageBase: "https://image.tmdb.org/t/p",
  omdbApiKey: "YOUR_OMDB_API_KEY",
  // https://developers.giphy.com/dashboard/
  giphyApiKey: "YOUR_GIPHY_API_KEY",
};

export function assertEnv() {
  const missing = [];
  if (!env.supabaseUrl || env.supabaseUrl.includes("YOUR_PROJECT")) {
    missing.push("supabaseUrl");
  }
  if (!env.supabaseAnonKey || env.supabaseAnonKey.includes("YOUR_SUPABASE")) {
    missing.push("supabaseAnonKey");
  }
  if (!env.tmdbApiKey || env.tmdbApiKey.includes("YOUR_TMDB")) {
    missing.push("tmdbApiKey");
  }
  return missing;
}
