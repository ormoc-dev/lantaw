import { getSupabase } from "../lib/supabase.js";
import { getUser, resolveUserProfile } from "./authService.js";

const TABLE = "title_comments";
const MAX_LEN = 1000;

function normalizeMediaType(mediaType) {
  return mediaType === "tv" ? "tv" : "movie";
}

export async function listTitleComments(tmdbId, mediaType = "movie", { limit = 40 } = {}) {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select(
      "id, user_id, tmdb_id, media_type, body, author_name, author_avatar, created_at"
    )
    .eq("tmdb_id", Number(tmdbId))
    .eq("media_type", normalizeMediaType(mediaType))
    .order("created_at", { ascending: false })
    .limit(Math.min(80, Math.max(1, Number(limit) || 40)));

  if (error) throw error;
  return data || [];
}

export async function addTitleComment(tmdbId, mediaType, body) {
  const user = await getUser();
  if (!user) throw new Error("Sign in to comment");

  const text = String(body || "").trim();
  if (!text) throw new Error("Write something first");
  if (text.length > MAX_LEN) {
    throw new Error(`Keep comments under ${MAX_LEN} characters`);
  }

  const profile = await resolveUserProfile(user);
  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      user_id: user.id,
      tmdb_id: Number(tmdbId),
      media_type: normalizeMediaType(mediaType),
      body: text,
      author_name: profile.name || user.email?.split("@")[0] || "Fan",
      author_avatar: profile.avatar || null,
    })
    .select(
      "id, user_id, tmdb_id, media_type, body, author_name, author_avatar, created_at"
    )
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTitleComment(commentId) {
  const user = await getUser();
  if (!user) throw new Error("Sign in to delete comments");

  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("id", commentId)
    .eq("user_id", user.id);

  if (error) throw error;
}
