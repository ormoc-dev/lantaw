import { getSupabase } from "../lib/supabase.js";
import { extractMentionIds } from "../lib/mentions.js";
import { getUser, resolveUserProfile } from "./authService.js";
import { dispatchRemotePush } from "./pushService.js";

const TABLE = "title_comments";
const LIKES = "title_comment_likes";
const MAX_LEN = 1000;
const COMMENT_FIELDS =
  "id, user_id, tmdb_id, media_type, parent_id, body, author_name, author_avatar, created_at";
const TOKEN_STRIP = /@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi;

function normalizeMediaType(mediaType) {
  return mediaType === "tv" ? "tv" : "movie";
}

async function attachLikes(rows) {
  const comments = rows || [];
  if (!comments.length) return [];
  const user = await getUser();
  const ids = comments.map((c) => c.id);
  const { data, error } = await getSupabase()
    .from(LIKES)
    .select("comment_id, user_id")
    .in("comment_id", ids);

  if (error) {
    if (/title_comment_likes|schema cache|does not exist/i.test(error.message || "")) {
      return comments.map((c) => ({ ...c, like_count: 0, liked: false }));
    }
    throw error;
  }

  const byComment = new Map();
  for (const row of data || []) {
    if (!byComment.has(row.comment_id)) byComment.set(row.comment_id, []);
    byComment.get(row.comment_id).push(row.user_id);
  }

  return comments.map((c) => {
    const users = byComment.get(c.id) || [];
    return {
      ...c,
      parent_id: c.parent_id || null,
      like_count: users.length,
      liked: Boolean(user && users.includes(user.id)),
    };
  });
}

export async function listTitleComments(tmdbId, mediaType = "movie", { limit = 80 } = {}) {
  const sb = getSupabase();
  const query = (fields) =>
    sb
      .from(TABLE)
      .select(fields)
      .eq("tmdb_id", Number(tmdbId))
      .eq("media_type", normalizeMediaType(mediaType))
      .order("created_at", { ascending: false })
      .limit(Math.min(120, Math.max(1, Number(limit) || 80)));

  let { data, error } = await query(COMMENT_FIELDS);
  if (error && /parent_id|schema cache|column/i.test(error.message || "")) {
    ({ data, error } = await query(
      "id, user_id, tmdb_id, media_type, body, author_name, author_avatar, created_at"
    ));
  }
  if (error) throw error;
  return attachLikes(data || []);
}

export async function addTitleComment(tmdbId, mediaType, body, parentId = null) {
  const user = await getUser();
  if (!user) throw new Error("Sign in to comment");

  const text = String(body || "").trim();
  if (!text) throw new Error("Write something first");
  if (text.length > MAX_LEN) {
    throw new Error(`Keep comments under ${MAX_LEN} characters`);
  }

  const profile = await resolveUserProfile(user);
  const row = {
    user_id: user.id,
    tmdb_id: Number(tmdbId),
    media_type: normalizeMediaType(mediaType),
    body: text,
    author_name: profile.name || user.email?.split("@")[0] || "Fan",
    author_avatar: profile.avatar || null,
  };
  if (parentId) row.parent_id = parentId;

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert(row)
    .select(COMMENT_FIELDS)
    .single();

  if (error) {
    if (parentId && /parent_id|schema cache|column/i.test(error.message || "")) {
      throw new Error(
        "Replies need a DB update — run supabase/migrations/202603300010_title_comment_replies_likes.sql"
      );
    }
    throw error;
  }

  const created = {
    ...data,
    parent_id: data.parent_id || parentId || null,
    like_count: 0,
    liked: false,
  };

  const mentioned = extractMentionIds(text).filter((id) => id && id !== user.id);
  if (mentioned.length) {
    const path =
      created.media_type === "tv"
        ? `/tv/${created.tmdb_id}`
        : `/movie/${created.tmdb_id}`;
    const preview = text.replace(TOKEN_STRIP, "@$1").slice(0, 80);
    const payloadBase = {
      commentId: created.id,
      fromId: user.id,
      authorName: created.author_name,
      authorAvatar: created.author_avatar,
      body: text,
      mediaType: created.media_type,
      tmdbId: created.tmdb_id,
    };
    for (const targetUserId of mentioned) {
      pingMentionBroadcast(targetUserId, payloadBase).catch(() => {});
      dispatchRemotePush({
        targetUserId,
        kind: "mention",
        title: "Mentioned you",
        body: `${created.author_name || "A friend"} mentioned you: ${preview}`,
        url: `#${path}`,
        tag: `mention-${created.id}-${targetUserId}`,
      }).catch(() => {});
    }
  }

  return created;
}

/** Live ping so the mentioned friend gets an in-app toast while LANTAW is open. */
async function pingMentionBroadcast(targetUserId, payload) {
  if (!targetUserId) return;
  const sb = getSupabase();
  const ch = sb.channel(`lantaw-mention:${targetUserId}`);
  try {
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 1200);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(timer);
          resolve();
        }
      });
    });
    await ch.send({
      type: "broadcast",
      event: "mention",
      payload: payload || {},
    });
  } finally {
    try {
      await sb.removeChannel(ch);
    } catch {
      /* ignore */
    }
  }
}

/** Toggle the signed-in user's like. Returns the next liked state. */
export async function toggleTitleCommentLike(commentId, liked) {
  const user = await getUser();
  if (!user) throw new Error("Sign in to like comments");

  const sb = getSupabase();
  if (liked) {
    const { error } = await sb
      .from(LIKES)
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", user.id);
    if (error) throw error;
    return false;
  }

  const { error } = await sb.from(LIKES).insert({
    comment_id: commentId,
    user_id: user.id,
  });
  if (error) {
    if (/title_comment_likes|schema cache|does not exist/i.test(error.message || "")) {
      throw new Error(
        "Likes need a DB update — run supabase/migrations/202603300010_title_comment_replies_likes.sql"
      );
    }
    if (/duplicate|unique/i.test(error.message || "")) return true;
    throw error;
  }
  return true;
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
