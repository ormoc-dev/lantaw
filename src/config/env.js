/**
 * Live client config (browser cannot read .env at runtime).
 * Keep in sync with .env.example.
 *
 * Supabase publishable/anon key is safe in the client (RLS protects data).
 * Never put the database password or service_role key here.
 */

export const env = {
  // VITE_SUPABASE_URL
  supabaseUrl: "https://xzsynwcpzljzgaghetem.supabase.co",
  // VITE_SUPABASE_ANON_KEY
  supabaseAnonKey: "sb_publishable_id6kL1SjDSem3f1BBBMZHA_mGhyeXhu",

  // Public site URL (Vercel). Auth redirects use window.location at runtime (PKCE).
  // VITE_SITE_URL
  siteUrl: "https://lantaw-us.vercel.app",

  // VITE_TMDB_API_KEY / VITE_TMDB_BASE_URL / VITE_TMDB_IMAGE_BASE
  tmdbApiKey: "0da320d23d1a48a9bfc19aa7f2316470",
  tmdbBaseUrl: "https://api.themoviedb.org/3",
  tmdbImageBase: "https://image.tmdb.org/t/p",

  // VITE_OMDB_API_KEY — from activation email, not VERIFYKEY
  // https://www.omdbapi.com/apikey.aspx
  omdbApiKey: "419c2d70",
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
