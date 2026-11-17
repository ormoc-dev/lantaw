import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";
import { listFriendNotes } from "./friendNoteService.js";

function clip(text, n = 80) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= n) return value;
  return `${value.slice(0, n - 1)}…`;
}

function titlePath(mediaType, tmdbId) {
  if (!tmdbId) return null;
  return mediaType === "tv" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
}

/**
 * Facebook-style activity: mentions, replies, likes on your comments, plus friend notes.
 * Missing tables return the pieces that still exist.
 */
export async function listActivityNotices({ friendIds = [], friendships = [] } = {}) {
  const user = await getUser();
  if (!user) return [];

  const sb = getSupabase();
  const items = [];

  const { data: mine, error: mineError } = await sb
    .from("title_comments")
    .select("id, body, tmdb_id, media_type")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const mineRows = mineError ? [] : mine || [];
  const mineById = {};
  for (const row of mineRows) mineById[row.id] = row;
  const ids = mineRows.map((row) => row.id);

  let replies = [];
  let likes = [];
  if (ids.length) {
    const [replyRes, likeRes] = await Promise.all([
      sb
        .from("title_comments")
        .select(
          "id, user_id, parent_id, body, author_name, author_avatar, created_at, tmdb_id, media_type"
        )
        .in("parent_id", ids)
        .neq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      sb
        .from("title_comment_likes")
        .select("comment_id, user_id, created_at")
        .in("comment_id", ids)
        .neq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (!replyRes.error) replies = replyRes.data || [];
    if (!likeRes.error) likes = likeRes.data || [];
  }

  let mentions = [];
  {
    const { data, error } = await sb
      .from("title_comments")
      .select(
        "id, user_id, body, author_name, author_avatar, created_at, tmdb_id, media_type"
      )
      .neq("user_id", user.id)
      .ilike("body", `%](${user.id})%`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error) mentions = data || [];
  }

  const actorIds = [
    ...new Set([
      ...likes.map((row) => row.user_id),
      ...replies.map((row) => row.user_id),
      ...mentions.map((row) => row.user_id),
    ]),
  ];
  const profiles = {};
  if (actorIds.length) {
    const { data } = await sb
      .from("profiles")
      .select("id, display_name, avatar_url, email")
      .in("id", actorIds);
    for (const profile of data || []) profiles[profile.id] = profile;
  }

  const nameOf = (id, fallback) =>
    fallback ||
    profiles[id]?.display_name ||
    profiles[id]?.email?.split("@")[0] ||
    "Someone";

  for (const mention of mentions) {
    items.push({
      id: `mention:${mention.id}`,
      kind: "mention",
      at: mention.created_at,
      actorName: nameOf(mention.user_id, mention.author_name),
      actorAvatar:
        mention.author_avatar || profiles[mention.user_id]?.avatar_url || null,
      action: "mentioned you",
      preview: clip(
        String(mention.body || "").replace(
          /@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi,
          "@$1"
        )
      ),
      quote: "",
      href: titlePath(mention.media_type, mention.tmdb_id),
    });
  }

  for (const reply of replies) {
    const parent = mineById[reply.parent_id];
    items.push({
      id: `reply:${reply.id}`,
      kind: "reply",
      at: reply.created_at,
      actorName: nameOf(reply.user_id, reply.author_name),
      actorAvatar: reply.author_avatar || profiles[reply.user_id]?.avatar_url || null,
      action: "replied to your comment",
      preview: clip(reply.body),
      quote: clip(parent?.body || "", 60),
      href: titlePath(reply.media_type, reply.tmdb_id),
    });
  }

  for (const like of likes) {
    const parent = mineById[like.comment_id];
    items.push({
      id: `like:${like.comment_id}:${like.user_id}`,
      kind: "like",
      at: like.created_at,
      actorName: nameOf(like.user_id),
      actorAvatar: profiles[like.user_id]?.avatar_url || null,
      action: "liked your comment",
      preview: clip(parent?.body || ""),
      quote: "",
      href: titlePath(parent?.media_type, parent?.tmdb_id),
    });
  }

  const noteMap = await listFriendNotes([user.id, ...friendIds]).catch(() => ({}));
  const friendByUser = {};
  for (const friendship of friendships) {
    if (friendship.other?.id) friendByUser[friendship.other.id] = friendship;
  }
  for (const [userId, note] of Object.entries(noteMap)) {
    if (userId === user.id || !note?.body) continue;
    const friend = friendByUser[userId];
    items.push({
      id: `note:${userId}:${note.updated_at}`,
      kind: "note",
      at: note.updated_at,
      actorName:
        friend?.other?.display_name || friend?.other?.email?.split("@")[0] || "A friend",
      actorAvatar: friend?.other?.avatar_url || null,
      action: "shared a note",
      preview: clip(note.body, 60),
      quote: "",
      href: null,
      chatId: friend?.id || null,
    });
  }

  return items
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 40);
}
