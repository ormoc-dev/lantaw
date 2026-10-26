import { getSupabase } from "../lib/supabase.js";
import { env } from "../config/env.js";
import { getBasePath } from "../config/base.js";

function appRedirectUrl() {
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    return `${env.siteUrl.replace(/\/$/, "")}/`;
  }
  const base = getBasePath();
  return `${window.location.origin}${base || ""}/`;
}

export async function getSession() {
  const { data, error } = await getSupabase().auth.getSession();
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
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
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
