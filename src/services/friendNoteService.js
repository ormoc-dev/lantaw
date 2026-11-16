import { getSupabase } from "../lib/supabase.js";
import { idbDel, idbGet, idbSet } from "../lib/idbCache.js";
import { getUser } from "./authService.js";

const TABLE = "friend_notes";
const MAX_LEN = 60;
const TTL_MS = 24 * 60 * 60 * 1000;

function fresh(row) {
  if (!row?.body || !row.updated_at) return false;
  const age = Date.now() - new Date(row.updated_at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= TTL_MS;
}

function localKey(userId) {
  return `friend-note:${userId}`;
}

function unavailable(error) {
  return /friend_notes|schema cache|does not exist|permission denied/i.test(
    error?.message || ""
  );
}

async function readLocal(userId) {
  if (!userId) return null;
  const row = await idbGet(localKey(userId));
  if (!fresh(row)) {
    if (row) await idbDel(localKey(userId));
    return null;
  }
  return row;
}

async function writeLocal(userId, body) {
  if (!body) {
    await idbDel(localKey(userId));
    return null;
  }
  const row = {
    user_id: userId,
    body,
    updated_at: new Date().toISOString(),
  };
  await idbSet(localKey(userId), row);
  return row;
}

/** Notes for the signed-in user and the given friend ids. Expired notes are deleted. */
export async function listFriendNotes(userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const sb = getSupabase();
  await sb.rpc("purge_expired_friend_notes");
  const { data, error } = await sb
    .from(TABLE)
    .select("user_id, body, updated_at")
    .in("user_id", ids);

  const map = {};
  if (!error) {
    for (const row of data || []) {
      if (fresh(row)) map[row.user_id] = row;
    }
  } else if (!unavailable(error)) {
    throw error;
  }

  const me = await getUser();
  if (me && ids.includes(me.id)) {
    const local = await readLocal(me.id);
    const remote = map[me.id];
    if (
      local &&
      (!remote ||
        new Date(local.updated_at).getTime() >= new Date(remote.updated_at).getTime())
    ) {
      map[me.id] = local;
    }
  }
  return map;
}

/** Save or clear the signed-in user's note. Empty text deletes it. */
export async function saveFriendNote(body) {
  const user = await getUser();
  if (!user) throw new Error("Sign in to share a note");

  const text = String(body || "").trim().slice(0, MAX_LEN);
  const local = await writeLocal(user.id, text);
  const sb = getSupabase();

  if (!text) {
    const { error } = await sb.from(TABLE).delete().eq("user_id", user.id);
    if (error && !unavailable(error)) throw new Error("Couldn’t remove your note. Try again.");
    return null;
  }

  const { data, error } = await sb
    .from(TABLE)
    .upsert(
      {
        user_id: user.id,
        body: text,
        updated_at: local.updated_at,
      },
      { onConflict: "user_id" }
    )
    .select("user_id, body, updated_at")
    .single();

  if (error) {
    if (unavailable(error)) return local;
    throw new Error("Couldn’t share your note. Try again.");
  }
  if (data?.body) await writeLocal(user.id, data.body);
  return data || local;
}
