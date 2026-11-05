import { env } from "../config/env.js";
import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";
import { ensureNotifyPermission, notificationPermission } from "../lib/appNotify.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function hasVapidPublicKey() {
  const key = String(env.vapidPublicKey || "").trim();
  return Boolean(key) && !key.includes("YOUR_");
}

async function getRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/**
 * Subscribe this device to Web Push and store it for closed-app alerts.
 */
export async function subscribeWebPush() {
  if (!hasVapidPublicKey()) return { ok: false, reason: "no-vapid" };
  if (!("PushManager" in window)) return { ok: false, reason: "unsupported" };

  const perm = await ensureNotifyPermission();
  if (perm !== "granted") return { ok: false, reason: perm };

  const user = await getUser();
  if (!user) return { ok: false, reason: "auth" };

  const reg = await getRegistration();
  if (!reg?.pushManager) return { ok: false, reason: "no-sw" };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: "bad-subscription" };
  }

  const { error } = await getSupabase().from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: String(navigator.userAgent || "").slice(0, 240),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    if (/push_subscriptions|schema cache|does not exist/i.test(error.message || "")) {
      return { ok: false, reason: "migration" };
    }
    throw error;
  }
  return { ok: true };
}

/** Ask Chrome to wake this device even when LANTAW is closed. */
export async function ensurePushSubscription() {
  if (notificationPermission() !== "granted") return { ok: false };
  try {
    return await subscribeWebPush();
  } catch (err) {
    console.warn("Push subscribe failed:", err?.message || err);
    return { ok: false, reason: "error" };
  }
}

/**
 * Fire-and-forget remote push to another user (works when their app is closed).
 */
export async function dispatchRemotePush({
  targetUserId,
  kind,
  title,
  body,
  url,
  tag,
  actions,
  data,
  requireInteraction,
}) {
  if (!targetUserId) return;
  try {
    const sb = getSupabase();
    const { error } = await sb.functions.invoke("send-push", {
      body: {
        targetUserId,
        kind,
        title,
        body,
        url,
        tag,
        actions,
        data,
        requireInteraction,
      },
    });
    if (error) {
      console.warn("send-push:", error.message || error);
    }
  } catch (err) {
    console.warn("send-push failed:", err?.message || err);
  }
}

export async function otherUserIdInFriendship(friendshipId, myId) {
  if (!friendshipId || !myId) return null;
  const { data, error } = await getSupabase()
    .from("friendships")
    .select("requester_id, addressee_id")
    .eq("id", friendshipId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.requester_id === myId) return data.addressee_id;
  if (data.addressee_id === myId) return data.requester_id;
  return null;
}
