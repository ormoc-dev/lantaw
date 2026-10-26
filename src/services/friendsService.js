import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";

const CHAT_READ_KEY = "lantaw-chat-read";
export const FRIENDS_BADGE_EVENT = "lantaw:friends-badge";

async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error("Sign in to use Friends");
  return user;
}

function loadChatReadMap() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_READ_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveChatReadMap(map) {
  localStorage.setItem(CHAT_READ_KEY, JSON.stringify(map));
}

/** Mark a friendship thread as read up to `at` (ISO) or now. */
export function markChatRead(friendshipId, at = new Date().toISOString()) {
  if (!friendshipId) return;
  const map = loadChatReadMap();
  const prev = map[friendshipId];
  if (!prev || String(at) > String(prev)) {
    map[friendshipId] = at;
    saveChatReadMap(map);
  }
  notifyFriendsBadge();
}

export function notifyFriendsBadge() {
  window.dispatchEvent(new CustomEvent(FRIENDS_BADGE_EVENT));
}

async function profilesByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", unique);
  if (error) throw error;
  const map = {};
  for (const p of data || []) map[p.id] = p;
  return map;
}

function decorate(row, myId, profiles) {
  const otherId = row.requester_id === myId ? row.addressee_id : row.requester_id;
  return {
    ...row,
    otherId,
    other: profiles[otherId] || null,
    isIncoming: row.addressee_id === myId && row.status === "pending",
    isOutgoing: row.requester_id === myId && row.status === "pending",
  };
}

export async function searchProfileByEmail(email) {
  await requireUser();
  const q = String(email || "").trim().toLowerCase();
  if (!q) return null;

  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .ilike("email", q)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function sendFriendRequest(addresseeId) {
  const user = await requireUser();
  if (addresseeId === user.id) throw new Error("You can’t add yourself");

  const { data, error } = await getSupabase()
    .from("friendships")
    .insert({
      requester_id: user.id,
      addressee_id: addresseeId,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Friend request already exists");
    throw error;
  }
  notifyFriendsBadge();
  return data;
}

export async function listFriendships() {
  const user = await requireUser();

  const { data, error } = await getSupabase()
    .from("friendships")
    .select("id, status, requester_id, addressee_id, created_at")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];
  const profiles = await profilesByIds(
    rows.flatMap((r) => [r.requester_id, r.addressee_id])
  );
  return rows.map((row) => decorate(row, user.id, profiles));
}

export async function respondToFriendRequest(friendshipId, accept) {
  await requireUser();
  const { data, error } = await getSupabase()
    .from("friendships")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", friendshipId)
    .select()
    .single();

  if (error) throw error;
  notifyFriendsBadge();
  return data;
}

export async function removeFriendship(friendshipId) {
  await requireUser();
  const { error } = await getSupabase()
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) throw error;
  notifyFriendsBadge();
}

export async function listMessages(friendshipId) {
  await requireUser();
  const { data, error } = await getSupabase()
    .from("friend_messages")
    .select("id, friendship_id, sender_id, body, created_at")
    .eq("friendship_id", friendshipId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw error;
  return data || [];
}

export async function sendMessage(friendshipId, body) {
  const user = await requireUser();
  const text = String(body || "").trim();
  if (!text) throw new Error("Message can’t be empty");

  const { data, error } = await getSupabase()
    .from("friend_messages")
    .insert({
      friendship_id: friendshipId,
      sender_id: user.id,
      body: text,
    })
    .select()
    .single();

  if (error) throw error;
  notifyFriendsBadge();
  return data;
}

export async function createWatchParty({
  friendshipId,
  guestId,
  mediaType,
  tmdbId,
  title,
  poster,
}) {
  const user = await requireUser();

  const { data, error } = await getSupabase()
    .from("watch_parties")
    .insert({
      host_id: user.id,
      guest_id: guestId,
      friendship_id: friendshipId,
      media_type: mediaType || "movie",
      tmdb_id: tmdbId,
      title,
      poster: poster || null,
      status: "invited",
    })
    .select()
    .single();

  if (error) throw error;
  notifyFriendsBadge();
  return data;
}

export async function listWatchParties() {
  const user = await requireUser();
  const { data, error } = await getSupabase()
    .from("watch_parties")
    .select("*")
    .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw error;
  return data || [];
}

export async function updateWatchPartyStatus(partyId, status) {
  await requireUser();
  const { data, error } = await getSupabase()
    .from("watch_parties")
    .update({ status })
    .eq("id", partyId)
    .select()
    .single();

  if (error) throw error;
  notifyFriendsBadge();
  return data;
}

/**
 * Badge counts for the Friends button / tabs.
 * Chat unread uses local last-read timestamps (no DB read column).
 */
export async function getFriendsActivityCounts() {
  const empty = { requests: 0, chats: 0, invites: 0, total: 0, chatIds: [] };
  const user = await getUser();
  if (!user) return empty;

  try {
    const sb = getSupabase();

    const [reqRes, inviteRes, friendsRes] = await Promise.all([
      sb
        .from("friendships")
        .select("id", { count: "exact", head: true })
        .eq("addressee_id", user.id)
        .eq("status", "pending"),
      sb
        .from("watch_parties")
        .select("id", { count: "exact", head: true })
        .eq("guest_id", user.id)
        .eq("status", "invited"),
      sb
        .from("friendships")
        .select("id")
        .eq("status", "accepted")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
    ]);

    const requests = reqRes.count || 0;
    const invites = inviteRes.count || 0;
    const friendIds = (friendsRes.data || []).map((r) => r.id);

    let chats = 0;
    const chatIds = [];
    if (friendIds.length) {
      const { data: msgs } = await sb
        .from("friend_messages")
        .select("friendship_id, created_at, sender_id")
        .neq("sender_id", user.id)
        .in("friendship_id", friendIds)
        .order("created_at", { ascending: false })
        .limit(300);

      const lastRead = loadChatReadMap();
      const seen = new Set();
      for (const m of msgs || []) {
        if (seen.has(m.friendship_id)) continue;
        seen.add(m.friendship_id);
        const readAt = lastRead[m.friendship_id];
        if (!readAt || m.created_at > readAt) {
          chats += 1;
          chatIds.push(m.friendship_id);
        }
      }
    }

    return {
      requests,
      chats,
      invites,
      total: requests + chats + invites,
      chatIds,
    };
  } catch {
    return empty;
  }
}

/** Realtime + poll hook for badge updates. Returns unsubscribe. */
export function subscribeFriendsActivity(onChange) {
  let channel = null;
  try {
    const sb = getSupabase();
    channel = sb
      .channel(`friends-activity-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        () => onChange()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friend_messages" },
        () => onChange()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watch_parties" },
        () => onChange()
      )
      .subscribe();
  } catch {
    /* ignore */
  }

  const onBadgeEvent = () => onChange();
  window.addEventListener(FRIENDS_BADGE_EVENT, onBadgeEvent);
  const poll = setInterval(onChange, 45000);

  return () => {
    window.removeEventListener(FRIENDS_BADGE_EVENT, onBadgeEvent);
    clearInterval(poll);
    if (channel) {
      try {
        getSupabase().removeChannel(channel);
      } catch {
        /* ignore */
      }
    }
  };
}
