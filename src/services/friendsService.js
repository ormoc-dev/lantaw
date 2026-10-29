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

/** Escape PostgREST filter wildcards in user input. */
function sanitizeSearch(query) {
  return String(query || "")
    .trim()
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 64);
}

/**
 * Suggest profiles by display name or email (partial match).
 * Excludes the current user.
 */
export async function searchProfiles(query, { limit = 8 } = {}) {
  const user = await requireUser();
  const safe = sanitizeSearch(query);
  if (safe.length < 1) return [];

  const pattern = `%${safe}%`;
  const sb = getSupabase();
  const select = "id, email, display_name, avatar_url";

  const [byName, byEmail] = await Promise.all([
    sb
      .from("profiles")
      .select(select)
      .ilike("display_name", pattern)
      .neq("id", user.id)
      .limit(limit),
    sb
      .from("profiles")
      .select(select)
      .ilike("email", pattern)
      .neq("id", user.id)
      .limit(limit),
  ]);

  if (byName.error) throw byName.error;
  if (byEmail.error) throw byEmail.error;

  const map = new Map();
  for (const row of [...(byName.data || []), ...(byEmail.data || [])]) {
    if (row?.id) map.set(row.id, row);
  }
  return [...map.values()].slice(0, limit);
}

/**
 * Browse people to add — excludes self and anyone already in a friendship row.
 */
export async function listSuggestedProfiles({ limit = 24, excludeIds = [] } = {}) {
  const user = await requireUser();
  const blocked = new Set(
    [user.id, ...excludeIds].filter(Boolean).map(String)
  );

  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .neq("id", user.id)
    .order("display_name", { ascending: true })
    .limit(Math.min(80, Math.max(limit * 3, limit)));

  if (error) throw error;

  return (data || [])
    .filter((row) => row?.id && !blocked.has(String(row.id)))
    .slice(0, limit);
}

/** @deprecated Prefer searchProfiles — kept for exact single lookup. */
export async function searchProfileByEmail(email) {
  const q = String(email || "").trim().toLowerCase();
  if (!q) return null;
  const rows = await searchProfiles(q, { limit: 10 });
  return (
    rows.find((r) => String(r.email || "").toLowerCase() === q) ||
    rows.find(
      (r) => String(r.display_name || "").toLowerCase() === q
    ) ||
    rows[0] ||
    null
  );
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
    .select(
      "id, friendship_id, sender_id, body, created_at, edited_at, reactions:friend_message_reactions(id, user_id, emoji)"
    )
    .eq("friendship_id", friendshipId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    // Fallback if migration 011 not applied yet
    if (/edited_at|friend_message_reactions|column|schema cache/i.test(error.message || "")) {
      const { data: basic, error: basicErr } = await getSupabase()
        .from("friend_messages")
        .select("id, friendship_id, sender_id, body, created_at")
        .eq("friendship_id", friendshipId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (basicErr) throw basicErr;
      return (basic || []).map((m) => ({ ...m, edited_at: null, reactions: [] }));
    }
    throw error;
  }
  return (data || []).map((m) => ({
    ...m,
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
  }));
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

export async function editMessage(messageId, body) {
  const user = await requireUser();
  const text = String(body || "").trim();
  if (!text) throw new Error("Message can’t be empty");

  const { data, error } = await getSupabase()
    .from("friend_messages")
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", user.id)
    .select("id, friendship_id, sender_id, body, created_at, edited_at")
    .maybeSingle();

  if (error) {
    if (/edited_at|policy|permission|RLS|column/i.test(error.message || "")) {
      throw new Error(
        "Edit needs a DB update — run supabase/migrations/202603260011_friend_message_edit_react.sql"
      );
    }
    throw error;
  }
  if (!data) throw new Error("Could not edit this message");
  return data;
}

/** Toggle an emoji reaction on a message (add if missing, remove if yours). */
export async function toggleMessageReaction(messageId, emoji) {
  const user = await requireUser();
  const mark = String(emoji || "").trim();
  if (!mark) throw new Error("Pick a reaction");

  const sb = getSupabase();
  const { data: existing, error: findErr } = await sb
    .from("friend_message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .eq("emoji", mark)
    .maybeSingle();

  if (findErr) {
    if (/friend_message_reactions|schema cache|does not exist/i.test(findErr.message || "")) {
      throw new Error(
        "Reactions need a DB update — run supabase/migrations/202603260011_friend_message_edit_react.sql"
      );
    }
    throw findErr;
  }

  if (existing?.id) {
    const { error } = await sb
      .from("friend_message_reactions")
      .delete()
      .eq("id", existing.id);
    if (error) throw error;
    return { removed: true, emoji: mark };
  }

  const { error } = await sb.from("friend_message_reactions").insert({
    message_id: messageId,
    user_id: user.id,
    emoji: mark,
  });
  if (error) throw error;
  return { removed: false, emoji: mark };
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

export async function deleteWatchParty(partyId) {
  await requireUser();
  // `.select()` so RLS-blocked deletes aren't a silent no-op (0 rows, no error).
  const { data, error } = await getSupabase()
    .from("watch_parties")
    .delete()
    .eq("id", partyId)
    .select("id");

  if (error) {
    if (/policy|permission|RLS/i.test(error.message || "")) {
      throw new Error(
        "Delete needs a DB update — run supabase/migrations/202603260008_watch_party_delete.sql in the Supabase SQL Editor"
      );
    }
    throw error;
  }
  if (!data?.length) {
    throw new Error(
      "Could not delete this invite. Run supabase/migrations/202603260008_watch_party_delete.sql in the Supabase SQL Editor, then try again."
    );
  }
  notifyFriendsBadge();
}

/**
 * Broadcast play/pause/sync so both party members load the stream together.
 * Requires migration 202603260007_watch_party_playback.sql
 */
export async function updateWatchPartyPlayback(
  partyId,
  {
    state,
    positionSec = 0,
    season = null,
    episode = null,
    bumpSync = true,
  } = {}
) {
  const user = await requireUser();
  if (!partyId) throw new Error("Missing watch party");
  if (!["idle", "playing", "paused"].includes(state)) {
    throw new Error("Invalid playback state");
  }

  const current = await getWatchParty(partyId);
  if (!current) throw new Error("Watch party not found");
  if (!current.isHost) {
    throw new Error("Only the host can control playback");
  }

  const nextToken = bumpSync
    ? Number(current.playback_sync_token || 0) + 1
    : Number(current.playback_sync_token || 0);

  const patch = {
    playback_state: state,
    playback_position_sec: Math.max(0, Number(positionSec) || 0),
    playback_sync_token: nextToken,
    playback_by: user.id,
  };

  if (state === "playing") {
    patch.playback_started_at = new Date().toISOString();
  }
  if (season != null) patch.playback_season = Math.max(1, Number(season) || 1);
  if (episode != null) patch.playback_episode = Math.max(1, Number(episode) || 1);

  const { data, error } = await getSupabase()
    .from("watch_parties")
    .update(patch)
    .eq("id", partyId)
    .select()
    .single();

  if (error) {
    if (/playback_/i.test(error.message || "")) {
      throw new Error(
        "Playback sync needs a DB update — run supabase/migrations/202603260007_watch_party_playback.sql"
      );
    }
    throw error;
  }
  return data;
}

export async function getWatchParty(partyId) {
  const user = await requireUser();
  const { data, error } = await getSupabase()
    .from("watch_parties")
    .select("*")
    .eq("id", partyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.host_id !== user.id && data.guest_id !== user.id) {
    throw new Error("You’re not part of this watch party");
  }

  const profiles = await profilesByIds([data.host_id, data.guest_id]);
  return {
    ...data,
    host: profiles[data.host_id] || null,
    guest: profiles[data.guest_id] || null,
    isHost: data.host_id === user.id,
    isGuest: data.guest_id === user.id,
  };
}

export function partyWatchPath(party) {
  if (!party?.id) return "/friends";
  return `/watch-party/${party.id}`;
}

export async function listWatchPartyMessages(partyId, { limit = 80 } = {}) {
  await requireUser();
  const { data, error } = await getSupabase()
    .from("watch_party_messages")
    .select("id, party_id, sender_id, body, created_at")
    .eq("party_id", partyId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function sendWatchPartyMessage(partyId, body) {
  const user = await requireUser();
  const text = String(body || "").trim();
  if (!text) throw new Error("Message can’t be empty");
  if (text.length > 280) throw new Error("Keep comments under 280 characters");

  const { data, error } = await getSupabase()
    .from("watch_party_messages")
    .insert({
      party_id: partyId,
      sender_id: user.id,
      body: text,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Subscribe to one party’s status + live comments + typing broadcast. */
export function subscribeWatchParty(
  partyId,
  { onParty, onMessage, onTyping } = {}
) {
  let channel = null;
  try {
    const sb = getSupabase();
    // Stable topic so typing broadcast reaches the other member.
    channel = sb
      .channel(`watch-party-${partyId}`, {
        config: { broadcast: { self: false } },
      })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_parties",
          filter: `id=eq.${partyId}`,
        },
        (payload) => onParty?.(payload)
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "watch_party_messages",
          filter: `party_id=eq.${partyId}`,
        },
        (payload) => onMessage?.(payload)
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        onTyping?.(payload || {});
      })
      .subscribe();
  } catch {
    /* ignore */
  }

  const sendTyping = async ({ typing = true, userId, name } = {}) => {
    if (!channel || !userId) return;
    try {
      await channel.send({
        type: "broadcast",
        event: "typing",
        payload: { typing: Boolean(typing), userId, name: name || "" },
      });
    } catch {
      /* ignore */
    }
  };

  const stop = () => {
    if (channel) {
      try {
        getSupabase().removeChannel(channel);
      } catch {
        /* ignore */
      }
      channel = null;
    }
  };

  return { stop, sendTyping };
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

/**
 * Live postgres_changes for friendships, messages, and watch parties.
 * @param {(payload: object) => void} onChange
 * @param {{ pollMs?: number, listenBadgeEvent?: boolean }} [opts]
 * @returns {() => void} unsubscribe
 */
export function subscribeFriendsRealtime(onChange, opts = {}) {
  const { pollMs = 0, listenBadgeEvent = false } = opts;
  let channel = null;
  let poll = null;
  let pollMsActive = pollMs;

  const emit = (payload) => {
    try {
      onChange(payload || {});
    } catch {
      /* ignore listener errors */
    }
  };

  const startPoll = (ms) => {
    if (poll) clearInterval(poll);
    poll = null;
    pollMsActive = ms;
    if (ms > 0) {
      poll = setInterval(() => emit({ source: "poll" }), ms);
    }
  };

  try {
    const sb = getSupabase();
    channel = sb
      .channel(`friends-live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        (payload) => emit(payload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friend_messages" },
        (payload) => emit(payload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watch_parties" },
        (payload) => emit(payload)
      )
      .subscribe((status) => {
        // If realtime never connects, poll more often so invites still appear
        if (status === "SUBSCRIBED") {
          startPoll(pollMsActive || pollMs);
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          startPoll(Math.min(pollMsActive || 12000, 8000) || 8000);
        }
      });
  } catch {
    startPoll(pollMs || 8000);
  }

  if (!channel && pollMs > 0) {
    startPoll(pollMs);
  } else if (pollMs > 0) {
    // Poll even while subscribed — invites must show without a full reload
    startPoll(pollMs);
  }

  const onBadgeEvent = () => emit({ source: "badge-event" });
  if (listenBadgeEvent) {
    window.addEventListener(FRIENDS_BADGE_EVENT, onBadgeEvent);
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      emit({ source: "visible" });
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    if (listenBadgeEvent) {
      window.removeEventListener(FRIENDS_BADGE_EVENT, onBadgeEvent);
    }
    document.removeEventListener("visibilitychange", onVisible);
    if (poll) clearInterval(poll);
    if (channel) {
      try {
        getSupabase().removeChannel(channel);
      } catch {
        /* ignore */
      }
    }
  };
}

/** Realtime + poll hook for the Friends header badge. */
export function subscribeFriendsActivity(onChange) {
  return subscribeFriendsRealtime(() => onChange(), {
    pollMs: 45000,
    listenBadgeEvent: true,
  });
}
