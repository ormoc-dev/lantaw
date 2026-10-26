/**
 * Browser apps cannot read .env files.
 * Supabase publishable/anon key is safe in the client (RLS protects data).
 * Never put the database password or service_role key here.
 */

export const env = {
  supabaseUrl: "https://xzsynwcpzljzgaghetem.supabase.co",
  supabaseAnonKey: "sb_publishable_id6kL1SjDSem3f1BBBMZHA_mGhyeXhu",

  // Production (Netlify). Local XAMPP uses http://localhost/movie/ automatically.
  siteUrl: "https://lantaw.netlify.app",
  localSiteUrl: "http://localhost/movie",

  tmdbApiKey: "0da320d23d1a48a9bfc19aa7f2316470",
  tmdbBaseUrl: "https://api.themoviedb.org/3",
  tmdbImageBase: "https://image.tmdb.org/t/p",

  // OMDb key from activation email — not the VERIFYKEY in the URL
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
