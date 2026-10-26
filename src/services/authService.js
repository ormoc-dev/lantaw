import { getSupabase } from "../lib/supabase.js";
import { env } from "../config/env.js";
import { getBasePath } from "../config/base.js";

function appRedirectUrl() {
  // Land on home hash after Google — hash router needs #/
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    return `${env.siteUrl.replace(/\/$/, "")}/#/`;
  }
  const base = getBasePath();
  return `${window.location.origin}${base || ""}/#/`;
}

function cleanAuthParamsFromUrl(hash = "#/") {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  window.history.replaceState({}, "", `${url.pathname}${url.hash}`);
}

export async function getSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Finish Google/email OAuth before the router decides login vs home.
 * PKCE returns ?code=... — getSession() alone is not enough.
 */
export async function recoverSession() {
  const supabase = getSupabase();
  const params = new URLSearchParams(window.location.search);

  if (params.get("error")) {
    // Leave query for LoginView to read, then it cleans up
    return null;
  }

  const code = params.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("OAuth code exchange failed:", error.message);
      return null;
    }
    cleanAuthParamsFromUrl("#/");
    return data.session;
  }

  // Implicit leftover tokens in hash (rare with PKCE)
  if (window.location.hash.includes("access_token=")) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session) {
      cleanAuthParamsFromUrl("#/");
      return data.session;
    }
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function signInWithGoogle() {
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: appRedirectUrl(),
      scopes: "openid email profile",
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUp({ email, password, displayName }) {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        display_name: displayName?.trim() || undefined,
      },
      emailRedirectTo: appRedirectUrl(),
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export function onAuthChange(callback) {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function getProfile() {
  const user = await getUser();
  if (!user) return null;

  const { data, error } = await getSupabase()
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function displayNameFromUser(user) {
  if (!user) return "";
  const meta = user.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    meta.display_name ||
    user.email ||
    "Signed in"
  );
}
