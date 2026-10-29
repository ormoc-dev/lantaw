import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";

/** Ephemeral online set via Supabase Realtime Presence (no DB table). */
const CHANNEL = "lantaw-presence";

let channel = null;
let myId = null;
const onlineIds = new Set();
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

/** Subscribe to presence changes. Returns unsubscribe. */
export function onPresenceChange(fn) {
  listeners.add(fn);
  fn(new Set(onlineIds));
  return () => listeners.delete(fn);
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
      } catch {
        /* presence track failed — stay offline locally */
      }
    });

  return channel;
}

export async function stopPresence() {
  const sb = getSupabase();
  const ch = channel;
  channel = null;
  myId = null;
  onlineIds.clear();
  emit();
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
