
export const env = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  siteUrl: process.env.SITE_URL,
  tmdbApiKey: process.env.TMDB_API_KEY,
  tmdbBaseUrl: process.env.TMDB_BASE_URL,
  tmdbImageBase: process.env.TMDB_IMAGE_BASE,
  omdbApiKey: process.env.OMDB_API_KEY,
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
