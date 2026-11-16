import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";
import { idbGet, idbSet } from "../lib/idbCache.js";

const TABLE = "watchlist";
const WL_KEY = "watchlist";

async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error("Sign in to manage your watchlist");
  return user;
}

async function rememberList(userId, rows) {
  await idbSet(WL_KEY, { at: Date.now(), userId, data: rows });
}

async function readList(userId) {
  const cached = await idbGet(WL_KEY);
  if (cached?.userId !== userId || !Array.isArray(cached.data)) return null;
  return cached.data;
}

export async function listWatchlist() {
  const user = await requireUser();
  const cached = await readList(user.id);

  const pull = async () => {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data || [];
    rememberList(user.id, rows);
    return rows;
  };

  if (cached) {
    pull().catch(() => {});
    return cached;
  }
  return pull();
}

export async function addToWatchlist({ tmdbId, title, poster }) {
  const user = await requireUser();

  const { data, error } = await getSupabase()
    .from(TABLE)
    .upsert(
      [
        {
          user_id: user.id,
          tmdb_id: tmdbId,
          title,
          poster: poster || null,
        },
      ],
      { onConflict: "user_id,tmdb_id" }
    )
    .select()
    .single();

  if (error) throw error;
  const cached = (await readList(user.id)) || [];
  const next = [
    data,
    ...cached.filter((row) => row.tmdb_id !== data.tmdb_id),
  ];
  rememberList(user.id, next);
  return data;
}

export async function removeFromWatchlist(id) {
  const user = await requireUser();

  const { error } = await getSupabase().from(TABLE).delete().eq("id", id);
  if (error) throw error;
  const cached = (await readList(user.id)) || [];
  rememberList(
    user.id,
    cached.filter((row) => row.id !== id)
  );
}

export async function removeByTmdbId(tmdbId) {
  const user = await requireUser();

  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdbId);

  if (error) throw error;
  const cached = (await readList(user.id)) || [];
  rememberList(
    user.id,
    cached.filter((row) => Number(row.tmdb_id) !== Number(tmdbId))
  );
}

export async function isInWatchlist(tmdbId) {
  const user = await getUser();
  if (!user) return false;

  const cached = await readList(user.id);
  if (cached) {
    return cached.some((row) => Number(row.tmdb_id) === Number(tmdbId));
  }

  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("id")
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}
