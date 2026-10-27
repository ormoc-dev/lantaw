import { getSupabase } from "../lib/supabase.js";
import { getBasePath } from "../config/base.js";

const AUTH_ERROR_KEY = "lantaw-auth-error";

/**
 * Always return to the exact origin + app base the user started from.
 * Hardcoding localhost vs Netlify breaks PKCE (code verifier is origin-bound).
 */
function appRedirectUrl() {
  const base = getBasePath();
  return `${window.location.origin}${base}/`;
}

function cleanAuthParamsFromUrl(hash = "#/") {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function consumeAuthError() {
  try {
    const msg = sessionStorage.getItem(AUTH_ERROR_KEY);
    if (msg) sessionStorage.removeItem(AUTH_ERROR_KEY);
    return msg;
  } catch {
    return null;
  }
}

function stashAuthError(message) {
  try {
    sessionStorage.setItem(AUTH_ERROR_KEY, message);
  } catch {
    /* ignore */
  }
}

export async function getSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Finish Google/email OAuth before the router decides login vs home.
 * PKCE returns ?code=... — getSession() alone is not enough until exchanged.
 */
export async function recoverSession() {
  const supabase = getSupabase();
  const params = new URLSearchParams(window.location.search);

  if (params.get("error") || params.get("error_description")) {
    const desc =
      params.get("error_description") || params.get("error") || "Sign-in failed";
    stashAuthError(decodeURIComponent(String(desc).replace(/\+/g, " ")));
    return null;
  }

  const isRecovery =
    params.get("recovery") === "1" || params.get("type") === "recovery";

  const code = params.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("OAuth code exchange failed:", error.message);
      // Session may already exist if a prior attempt stored it
      const { data: fallback } = await supabase.auth.getSession();
      if (fallback?.session) {
        cleanAuthParamsFromUrl(isRecovery ? "#/reset-password" : "#/");
        return fallback.session;
      }
      stashAuthError(
        error.message ||
          "Google signed you in at Supabase, but this browser could not open the app session. Use the same URL you started from (localhost vs Netlify), and add it under Supabase → Authentication → URL Configuration → Redirect URLs."
      );
      cleanAuthParamsFromUrl("#/login");
      return null;
    }
    cleanAuthParamsFromUrl(isRecovery ? "#/reset-password" : "#/");
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
      skipBrowserRedirect: false,
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

/** Sends Supabase's reset-password email. Redirect must be allowlisted. */
export async function requestPasswordReset(email) {
  const base = getBasePath();
  const redirectTo = `${window.location.origin}${base}/?recovery=1`;
  const { data, error } = await getSupabase().auth.resetPasswordForEmail(
    email.trim(),
    { redirectTo }
  );
  if (error) throw error;
  return data;
}

export async function updatePassword(password) {
  const { data, error } = await getSupabase().auth.updateUser({ password });
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

/** Google often uses `picture`; email apps may use `avatar_url`. */
export function avatarFromUser(user) {
  if (!user) return null;
  const meta = user.user_metadata || {};
  return (
    meta.avatar_url ||
    meta.picture ||
    meta.avatar ||
    meta.profile_image ||
    null
  );
}

/**
 * Resolve display name + avatar from auth metadata and profiles table.
 * Also backfills profiles.avatar_url / display_name when missing.
 */
export async function resolveUserProfile(user) {
  if (!user) return { name: "", avatar: null, email: "" };

  let profile = null;
  try {
    profile = await getProfile();
  } catch (_) {
    profile = null;
  }

  const name =
    profile?.display_name ||
    displayNameFromUser(user) ||
    user.email ||
    "Me";
  const avatar = profile?.avatar_url || avatarFromUser(user) || null;
  const email = profile?.email || user.email || "";

  const patch = {};
  if (avatar && profile && profile.avatar_url !== avatar) patch.avatar_url = avatar;
  if (!profile?.avatar_url && avatar) patch.avatar_url = avatar;
  if (!profile?.display_name && name) patch.display_name = name;
  if (!profile?.email && user.email) patch.email = user.email;

  if (profile && Object.keys(patch).length) {
    try {
      await getSupabase().from("profiles").update(patch).eq("id", user.id);
    } catch (_) {
      /* non-blocking */
    }
  }

  return { name, avatar, email, profile };
}
