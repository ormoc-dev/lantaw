import { getSupabase } from "../lib/supabase.js";
import { idbGet, idbSet } from "../lib/idbCache.js";
import { tmdb, posterUrl } from "../lib/tmdb.js";
import { getUser } from "./authService.js";
import { listFriendships } from "./friendsService.js";
import { listFriendNotes } from "./friendNoteService.js";
import {
  listFriendsWatching,
  watchingTitlePath,
} from "./watchingService.js";

function clip(text, n = 80) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= n) return value;
  return `${value.slice(0, n - 1)}…`;
}

function titlePath(mediaType, tmdbId) {
  if (!tmdbId) return null;
  return mediaType === "tv" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
}

function titleKey(mediaType, tmdbId) {
  return `${mediaType === "tv" ? "tv" : "movie"}:${tmdbId}`;
}

function actorFrom(profile, fallbackId) {
  return {
    id: profile?.id || fallbackId || null,
    display_name: profile?.display_name || profile?.email || "Friend",
    avatar_url: profile?.avatar_url || null,
    email: profile?.email || null,
  };
}

function cacheKey(userId) {
  return `friends-activity:${userId}`;
}

/** Cached feed for instant Home paint (stale-while-revalidate). */
export async function peekFriendActivityFeed() {
  const user = await getUser();
  if (!user) return null;
  try {
    const cached = await idbGet(cacheKey(user.id));
    if (!cached?.items || !Array.isArray(cached.items)) return null;
    if (Date.now() - Number(cached.at || 0) > 30 * 60 * 1000) return null;
    return cached.items;
  } catch {
    return null;
  }
}

async function resolveTitleMeta(need = []) {
  const unique = [];
  const seen = new Set();
  for (const row of need) {
    if (!row?.tmdb_id) continue;
    const key = titleKey(row.media_type, row.tmdb_id);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      key,
      media_type: row.media_type === "tv" ? "tv" : "movie",
      tmdb_id: row.tmdb_id,
    });
  }

  const out = {};
  await Promise.all(
    unique.slice(0, 12).map(async ({ key, media_type, tmdb_id }) => {
      try {
        const cached = await idbGet(`detail:${media_type}:${tmdb_id}`);
        if (cached?.data?.title) {
          out[key] = {
            title: cached.data.title,
            poster: cached.data.poster || null,
          };
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const raw =
          media_type === "tv" ? await tmdb.tv(tmdb_id) : await tmdb.movie(tmdb_id);
        out[key] = {
          title: raw?.title || raw?.name || "",
          poster: posterUrl(raw?.poster_path),
        };
      } catch {
        /* soft fail */
      }
    })
  );
  return out;
}

/** Collapse noisy duplicates: one view per friend+title; drop self rows. */
function quietFilter(items, selfId, limit) {
  const out = [];
  const seenView = new Set();
  for (const item of items) {
    if (!item?.at) continue;
    if (selfId && item.actor?.id && item.actor.id === selfId) continue;
    if (item.kind === "view") {
      const key = `${item.actor?.id}:${item.href || item.title}`;
      if (seenView.has(key)) continue;
      seenView.add(key);
    }
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Friends-only social timeline for Home.
 * @returns {Promise<Array<{
 *   id: string,
 *   kind: 'watching'|'view'|'comment'|'note',
 *   at: string,
 *   actor: object,
 *   action: string,
 *   title: string,
 *   poster: string|null,
 *   preview: string,
 *   href: string|null,
 *   chatId: string|null,
 * }>>}
 */
export async function listFriendActivityFeed({ limit = 20 } = {}) {
  const user = await getUser();
  if (!user) return [];

  let friendships = [];
  try {
    friendships = (await listFriendships()).filter((f) => f.status === "accepted");
  } catch {
    return [];
  }

  if (!friendships.length) {
    await idbSet(cacheKey(user.id), { at: Date.now(), items: [] });
    return [];
  }

  const friendIds = friendships.map((f) => f.other?.id || f.otherId).filter(Boolean);
  const byUser = {};
  const chatByUser = {};
  for (const f of friendships) {
    const id = f.other?.id || f.otherId;
    if (!id) continue;
    byUser[id] = f.other || { id };
    chatByUser[id] = f.id;
  }

  const sb = getSupabase();
  const capped = Math.min(40, Math.max(8, Number(limit) || 20));

  const [watchingMap, notesMap, viewsRes, commentsRes] = await Promise.all([
    listFriendsWatching().catch(() => ({})),
    listFriendNotes(friendIds).catch(() => ({})),
    sb
      .from("title_views")
      .select("user_id, media_type, tmdb_id, title, poster, viewed_at")
      .in("user_id", friendIds)
      .order("viewed_at", { ascending: false })
      .limit(40),
    sb
      .from("title_comments")
      .select(
        "id, user_id, body, tmdb_id, media_type, parent_id, author_name, author_avatar, created_at"
      )
      .in("user_id", friendIds)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  // Fail soft per source when a table/RLS path is unavailable
  let views = [];
  if (!viewsRes.error) views = viewsRes.data || [];

  let comments = [];
  if (!commentsRes.error) {
    comments = commentsRes.data || [];
  } else if (/parent_id|column/i.test(commentsRes.error.message || "")) {
    const fallback = await sb
      .from("title_comments")
      .select(
        "id, user_id, body, tmdb_id, media_type, author_name, author_avatar, created_at"
      )
      .in("user_id", friendIds)
      .order("created_at", { ascending: false })
      .limit(40);
    if (!fallback.error) comments = fallback.data || [];
  }

  const metaByKey = {};
  for (const row of Object.values(watchingMap || {})) {
    if (!row?.tmdb_id) continue;
    metaByKey[titleKey(row.media_type, row.tmdb_id)] = {
      title: row.title || "",
      poster: row.poster || null,
    };
  }
  for (const row of views) {
    if (!row?.tmdb_id) continue;
    const key = titleKey(row.media_type, row.tmdb_id);
    if (metaByKey[key]?.title && metaByKey[key]?.poster) continue;
    metaByKey[key] = {
      title: row.title || metaByKey[key]?.title || "",
      poster: row.poster || metaByKey[key]?.poster || null,
    };
  }

  const needMeta = comments.filter((row) => {
    if (!row?.tmdb_id || row.parent_id) return false;
    const hit = metaByKey[titleKey(row.media_type, row.tmdb_id)];
    return !hit?.title || !hit?.poster;
  });
  if (needMeta.length) {
    const fetched = await resolveTitleMeta(needMeta);
    Object.assign(metaByKey, fetched);
  }

  const items = [];

  for (const [userId, row] of Object.entries(watchingMap || {})) {
    if (!friendIds.includes(userId) || userId === user.id) continue;
    const actor = actorFrom(byUser[userId], userId);
    items.push({
      id: `watching:${userId}:${row.tmdb_id}:${row.updated_at}`,
      kind: "watching",
      at: row.updated_at,
      actor,
      action: "is watching",
      title: row.title || "a title",
      poster: row.poster || null,
      preview: "",
      href: watchingTitlePath(row),
      chatId: chatByUser[userId] || null,
    });
  }

  for (const row of views) {
    if (row.user_id === user.id) continue;
    const actor = actorFrom(byUser[row.user_id], row.user_id);
    items.push({
      id: `view:${row.user_id}:${row.media_type}:${row.tmdb_id}:${row.viewed_at}`,
      kind: "view",
      at: row.viewed_at,
      actor,
      action: "viewed",
      title: row.title || "a title",
      poster: row.poster || null,
      preview: "",
      href: titlePath(row.media_type, row.tmdb_id),
      chatId: chatByUser[row.user_id] || null,
    });
  }

  for (const row of comments) {
    if (row.parent_id || row.user_id === user.id) continue;
    const meta = metaByKey[titleKey(row.media_type, row.tmdb_id)] || {};
    const actor = actorFrom(
      {
        ...(byUser[row.user_id] || {}),
        display_name:
          byUser[row.user_id]?.display_name ||
          row.author_name ||
          byUser[row.user_id]?.email,
        avatar_url: byUser[row.user_id]?.avatar_url || row.author_avatar,
      },
      row.user_id
    );
    items.push({
      id: `comment:${row.id}`,
      kind: "comment",
      at: row.created_at,
      actor,
      action: "commented on",
      title: meta.title || "",
      poster: meta.poster || null,
      preview: clip(row.body, 72),
      href: titlePath(row.media_type, row.tmdb_id),
      chatId: chatByUser[row.user_id] || null,
    });
  }

  for (const [userId, note] of Object.entries(notesMap || {})) {
    if (userId === user.id || !note?.body) continue;
    if (!friendIds.includes(userId)) continue;
    const actor = actorFrom(byUser[userId], userId);
    items.push({
      id: `note:${userId}:${note.updated_at}`,
      kind: "note",
      at: note.updated_at,
      actor,
      action: "shared a note",
      title: "",
      poster: null,
      preview: clip(note.body, 60),
      href: null,
      chatId: chatByUser[userId] || null,
    });
  }

  const ranked = quietFilter(
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    user.id,
    capped
  );

  await idbSet(cacheKey(user.id), { at: Date.now(), items: ranked });
  return ranked;
}

/**
 * Light realtime refresh for the Home friends strip.
 * Fires on watching_now / notes / comments / views, debounced.
 * @returns {() => void} unsubscribe
 */
export function subscribeFriendActivityFeed(onChange, { debounceMs = 1600 } = {}) {
  let channel = null;
  let timer = null;
  let dead = false;

  const emit = (payload) => {
    if (dead) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        onChange(payload || {});
      } catch {
        /* ignore */
      }
    }, debounceMs);
  };

  try {
    channel = getSupabase()
      .channel(
        `friends-activity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watching_now" },
        (payload) => emit({ ...payload, source: "watching_now" })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friend_notes" },
        (payload) => emit({ ...payload, source: "friend_notes" })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "title_comments" },
        (payload) => emit({ ...payload, source: "title_comments" })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "title_views" },
        (payload) => emit({ ...payload, source: "title_views" })
      )
      .subscribe();
  } catch {
    /* soft fail — visibility refresh still helps */
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      emit({ source: "visible" });
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    dead = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    if (channel) {
      try {
        getSupabase().removeChannel(channel);
      } catch {
        /* ignore */
      }
    }
  };
}
