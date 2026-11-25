import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";

async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error("Sign in to view profiles");
  return user;
}

async function assertAcceptedFriend(targetUserId) {
  const user = await requireUser();
  if (user.id === targetUserId) return user;

  const sb = getSupabase();
  const [a, b] = await Promise.all([
    sb
      .from("friendships")
      .select("id")
      .eq("status", "accepted")
      .eq("requester_id", user.id)
      .eq("addressee_id", targetUserId)
      .maybeSingle(),
    sb
      .from("friendships")
      .select("id")
      .eq("status", "accepted")
      .eq("requester_id", targetUserId)
      .eq("addressee_id", user.id)
      .maybeSingle(),
  ]);

  if (a.error) throw a.error;
  if (b.error) throw b.error;
  if (!a.data && !b.data) throw new Error("Only friends can view this profile");
  return user;
}

/** Avoid bumping the same title in the activity feed on every back/forward. */
const VIEW_COOLDOWN_MS = 30 * 60 * 1000;
const viewCooldownMem = new Map();

function viewCooldownKey(userId, mediaType, tmdbId) {
  return `${userId}:${mediaType}:${tmdbId}`;
}

function readViewCooldown(key) {
  const hit = viewCooldownMem.get(key);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(`lantaw-view-cd:${key}`);
    const ts = raw ? Number(raw) : 0;
    if (ts) viewCooldownMem.set(key, ts);
    return ts || 0;
  } catch {
    return 0;
  }
}

function writeViewCooldown(key, ts) {
  viewCooldownMem.set(key, ts);
  try {
    sessionStorage.setItem(`lantaw-view-cd:${key}`, String(ts));
  } catch {
    /* quota */
  }
}

/** Upsert a viewed title for the signed-in user (friends can see these). */
export async function recordTitleView({
  mediaType,
  tmdbId,
  title,
  poster,
} = {}) {
  const user = await getUser();
  if (!user || !tmdbId || !title) return null;

  const media = mediaType === "tv" ? "tv" : "movie";
  const id = Number(tmdbId);
  const cdKey = viewCooldownKey(user.id, media, id);
  const last = readViewCooldown(cdKey);
  const now = Date.now();
  // Same title again within 30m (e.g. open → back → open) — don't spam the feed.
  if (last && now - last < VIEW_COOLDOWN_MS) return null;

  const row = {
    user_id: user.id,
    media_type: media,
    tmdb_id: id,
    title: String(title).slice(0, 200),
    poster: poster || null,
    viewed_at: new Date().toISOString(),
  };

  const { error } = await getSupabase()
    .from("title_views")
    .upsert(row, { onConflict: "user_id,media_type,tmdb_id" });

  if (error) {
    if (/title_views|schema cache|does not exist/i.test(error.message || "")) {
      return null;
    }
    throw error;
  }
  writeViewCooldown(cdKey, now);
  return row;
}

export async function listFriendTitleViews(userId, { limit = 24 } = {}) {
  await assertAcceptedFriend(userId);
  const { data, error } = await getSupabase()
    .from("title_views")
    .select("media_type, tmdb_id, title, poster, viewed_at")
    .eq("user_id", userId)
    .order("viewed_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (/title_views|schema cache|does not exist/i.test(error.message || "")) {
      return [];
    }
    throw error;
  }
  return data || [];
}

export async function listFriendPeers(userId) {
  await assertAcceptedFriend(userId);
  const { data, error } = await getSupabase().rpc("friend_profile_peers", {
    target: userId,
  });

  if (error) {
    if (
      /friend_profile_peers|schema cache|does not exist/i.test(
        error.message || ""
      )
    ) {
      return [];
    }
    throw error;
  }
  return data || [];
}

export async function getFriendWatchingNow(userId) {
  await assertAcceptedFriend(userId);
  const { data, error } = await getSupabase()
    .from("watching_now")
    .select("media_type, tmdb_id, title, poster, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (/watching_now|schema cache|does not exist/i.test(error.message || "")) {
      return null;
    }
    throw error;
  }
  if (!data?.updated_at) return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (!Number.isFinite(age) || age > 6 * 60 * 1000) return null;
  return data;
}

/** Full peek card for an accepted friend. */
export async function getFriendProfile(userId) {
  await assertAcceptedFriend(userId);

  const { data: profile, error } = await getSupabase()
    .from("profiles")
    .select("id, email, display_name, avatar_url, last_seen_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) throw new Error("Profile not found");

  const [watching, history, peers] = await Promise.all([
    getFriendWatchingNow(userId).catch(() => null),
    listFriendTitleViews(userId).catch(() => []),
    listFriendPeers(userId).catch(() => []),
  ]);

  return { profile, watching, history, peers };
}
