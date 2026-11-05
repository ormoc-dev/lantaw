/**
 * Send Web Push to a user's Chrome / PWA subscriptions.
 * Invoked by the signed-in client after friend/chat/watch/call events
 * so the recipient still gets an alert when LANTAW is fully closed.
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *   (service role is available as SUPABASE_SERVICE_ROLE_KEY)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type PushBody = {
  targetUserId?: string;
  kind?: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@lantaw.app";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    if (!vapidPublic || !vapidPrivate) {
      return json({ error: "VAPID keys not configured" }, 500);
    }
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Supabase env missing" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const payload = (await req.json()) as PushBody;
    const targetUserId = String(payload.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId required" }, 400);
    if (targetUserId === user.id) {
      return json({ ok: true, skipped: "self" });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: rows, error: subErr } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", targetUserId);

    if (subErr) return json({ error: subErr.message }, 500);
    if (!rows?.length) return json({ ok: true, sent: 0 });

    const notification = {
      title: String(payload.title || "LANTAW").slice(0, 80),
      body: String(payload.body || "").slice(0, 180),
      tag: payload.tag || undefined,
      url: payload.url || "#/friends",
      kind: payload.kind || "generic",
      actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
      requireInteraction: Boolean(payload.requireInteraction),
      data: {
        ...(payload.data || {}),
        url: payload.url || "#/friends",
        kind: payload.kind || "generic",
      },
    };

    let sent = 0;
    const stale: string[] = [];
    for (const row of rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          JSON.stringify(notification),
          { TTL: 60 * 60 * 12, urgency: payload.kind === "call" ? "high" : "normal" }
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) stale.push(row.id);
      }
    }

    if (stale.length) {
      await admin.from("push_subscriptions").delete().in("id", stale);
    }

    return json({ ok: true, sent, pruned: stale.length });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Push failed" },
      500
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
