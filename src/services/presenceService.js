import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";

/** Ephemeral online set via Supabase Realtime Presence + DB last_seen_at. */
const CHANNEL = "lantaw-presence";
const HEARTBEAT_MS = 60_000;

let channel = null;
let myId = null;
let heartbeatTimer = null;
const onlineIds = new Set();
/** @type {Map<string, string>} userId → ISO last_seen_at */
const lastSeenMap = new Map();
const listeners = new Set();

function emit() {
  const snapshot = new Set(onlineIds);
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  });
}

function syncFromState() {
  onlineIds.clear();
  if (!channel) {
    emit();
    return;
  }
  const state = channel.presenceState() || {};
  for (const id of Object.keys(state)) {
    onlineIds.add(id);
  }
  emit();
}

export function isUserOnline(userId) {
  if (!userId) return false;
  return onlineIds.has(String(userId));
}

export function getOnlineUserIds() {
  return new Set(onlineIds);
}

export function getLastSeenAt(userId) {
  if (!userId) return null;
  return lastSeenMap.get(String(userId)) || null;
}

/** Cache last_seen_at values from profile rows (Friends / suggestions). */
export function rememberLastSeen(rows = []) {
  for (const row of rows || []) {
    if (!row?.id || !row.last_seen_at) continue;
    lastSeenMap.set(String(row.id), String(row.last_seen_at));
  }
}

/**
 * Human label for offline duration.
 * @example "just now" | "5m ago" | "2h ago" | "3d ago"
 */
export function formatLastSeen(iso, now = Date.now()) {
  if (!iso) return "Offline";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Offline";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.max(1, Math.floor(sec / 3600))}h ago`;
  if (sec < 86400 * 7) return `${Math.max(1, Math.floor(sec / 86400))}d ago`;
  try {
    return new Date(t).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Offline";
  }
}

export function presenceLabelFor(userId, { onlineText = "Online" } = {}) {
  if (isUserOnline(userId)) return onlineText;
  const seen = getLastSeenAt(userId);
  if (!seen) return "Offline";
  return `Offline · ${formatLastSeen(seen)}`;
}

/** Subscribe to presence changes. Returns unsubscribe. */
export function onPresenceChange(fn) {
  listeners.add(fn);
  fn(new Set(onlineIds));
  return () => listeners.delete(fn);
}

async function touchLastSeen(userId) {
  if (!userId) return;
  const iso = new Date().toISOString();
  lastSeenMap.set(String(userId), iso);
  try {
    await getSupabase()
      .from("profiles")
      .update({ last_seen_at: iso })
      .eq("id", userId);
  } catch {
    /* column missing until migration — ignore */
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(userId) {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    touchLastSeen(userId).catch(() => {});
  }, HEARTBEAT_MS);
}

export async function startPresence() {
  const user = await getUser();
  if (!user) {
    await stopPresence();
    return null;
  }
  if (channel && myId === user.id) return channel;

  await stopPresence();
  myId = user.id;
  const sb = getSupabase();
  channel = sb.channel(CHANNEL, {
    config: { presence: { key: user.id } },
  });

  channel
    .on("presence", { event: "sync" }, () => syncFromState())
    .on("presence", { event: "join" }, () => syncFromState())
    .on("presence", { event: "leave" }, () => syncFromState())
    .subscribe(async (status) => {
      if (status !== "SUBSCRIBED" || !channel) return;
      try {
        await channel.track({
          user_id: user.id,
          online_at: new Date().toISOString(),
        });
        await touchLastSeen(user.id);
        startHeartbeat(user.id);
      } catch {
        /* presence track failed — stay offline locally */
      }
    });

  const flush = () => {
    touchLastSeen(user.id).catch(() => {});
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else if (document.visibilityState === "visible" && myId === user.id) {
      touchLastSeen(user.id).catch(() => {});
    }
  });

  return channel;
}

export async function stopPresence() {
  stopHeartbeat();
  const sb = getSupabase();
  const ch = channel;
  const uid = myId;
  channel = null;
  myId = null;
  onlineIds.clear();
  emit();
  if (uid) {
    try {
      await touchLastSeen(uid);
    } catch {
      /* ignore */
    }
  }
  if (!ch) return;
  try {
    await ch.untrack();
  } catch {
    /* ignore */
  }
  try {
    await sb.removeChannel(ch);
  } catch {
    /* ignore */
  }
}
