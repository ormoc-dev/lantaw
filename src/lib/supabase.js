import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env } from "../config/env.js";

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;

export function getSupabase() {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // recoverSession() exchanges ?code= — avoid double-consume with client init
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
  }
  return client;
}

/** Lightweight ping — hits Auth (no table required). */
export async function checkSupabaseConnection() {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.auth.getSession();
    if (error) {
      return { ok: false, message: error.message };
    }
    return { ok: true, message: "Supabase connected" };
  } catch (err) {
    return { ok: false, message: err?.message || "Supabase connection failed" };
  }
}
