import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";

/** Friends-only “watching now” presence while a stream is open. */
const STALE_MS = 45 * 60 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000;

let heartbeatTimer = null;
let activePayload = null;

function isFresh(iso, now = Date.now()) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t < STALE_MS;
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function writeWatching(payload) {
  const user = await getUser();
  if (!user || !payload?.tmdbId || !payload?.title) return null;

  const row = {
    user_id: user.id,
    media_type: payload.mediaType === "tv" ? "tv" : "movie",
    tmdb_id: Number(payload.tmdbId),
    title: String(payload.title).slice(0, 200),
    poster: payload.poster || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await getSupabase()
    .from("watching_now")
    .upsert(row, { onConflict: "user_id" });

  if (error) {
    // Table missing until migration — fail quietly.
    if (/watching_now|schema cache|does not exist/i.test(error.message || "")) {
      return null;
    }
    throw error;
  }
  return row;
}

/** Publish (or refresh) what the signed-in user is watching. */
export async function publishWatchingNow(payload) {
  activePayload = payload
    ? {
        mediaType: payload.mediaType,
        tmdbId: payload.tmdbId,
        title: payload.title,
        poster: payload.poster || null,
      }
    : null;
  if (!activePayload) {
    stopHeartbeat();
    return null;
  }

  const row = await writeWatching(activePayload).catch(() => null);
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!activePayload) return;
    writeWatching(activePayload).catch(() => {});
  }, HEARTBEAT_MS);
  return row;
}

/** Clear watching presence (Close / mini-player ✕). */
export async function clearWatchingNow() {
  activePayload = null;
  stopHeartbeat();
  const user = await getUser();
  if (!user) return;
  try {
    await getSupabase().from("watching_now").delete().eq("user_id", user.id);
  } catch {
    /* ignore */
  }
}

/**
 * Map of friend user_id → watching row (fresh only).
 * @returns {Promise<Record<string, object>>}
 */
export async function listFriendsWatching() {
  const user = await getUser();
  if (!user) return {};

  const { data, error } = await getSupabase()
    .from("watching_now")
    .select("user_id, media_type, tmdb_id, title, poster, updated_at")
    .neq("user_id", user.id)
    .gte("updated_at", new Date(Date.now() - STALE_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) {
    if (/watching_now|schema cache|does not exist/i.test(error.message || "")) {
      return {};
    }
    throw error;
  }

  const map = {};
  const now = Date.now();
  for (const row of data || []) {
    if (!row?.user_id || !isFresh(row.updated_at, now)) continue;
    map[row.user_id] = row;
  }
  return map;
}

export function watchingTitlePath(row) {
  if (!row?.tmdb_id) return "/";
  const type = row.media_type === "tv" ? "tv" : "movie";
  return `/${type}/${row.tmdb_id}`;
}
