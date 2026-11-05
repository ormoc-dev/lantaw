import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";
import {
  ensureNotifyPermission,
  notificationPermission,
  showAppNotification,
} from "../lib/appNotify.js";
import { parseGifMessage } from "../lib/giphy.js";
import { parseShareMessage } from "../lib/shareMessage.js";
import {
  acceptWatchInvite,
  declineWatchInvite,
} from "./watchInviteService.js";
import {
  acceptIncomingCall,
  declineIncomingCall,
} from "./callService.js";
import { linkTo } from "../router/index.js";

let myId = null;
let channel = null;
let swBound = false;
const recentTags = new Map();

function rememberTag(tag, ms = 45_000) {
  if (!tag) return false;
  const now = Date.now();
  const prev = recentTags.get(tag) || 0;
  if (now - prev < ms) return true;
  recentTags.set(tag, now);
  if (recentTags.size > 80) {
    for (const [k, t] of recentTags) {
      if (now - t > ms) recentTags.delete(k);
    }
  }
  return false;
}

function hashPath() {
  return (location.hash.replace(/^#/, "") || "/").split("?")[0];
}

function activeChatId() {
  if (hashPath() !== "/friends") return null;
  const qs = (location.hash.replace(/^#/, "") || "").split("?")[1] || "";
  return new URLSearchParams(qs).get("chat") || null;
}

function previewBody(body) {
  if (parseGifMessage(body)) return "Sent a GIF";
  const share = parseShareMessage(body);
  if (share) return `Shared ${share.title || "a title"}`;
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "New message";
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

async function profileName(userId) {
  if (!userId) return "Friend";
  try {
    const { data } = await getSupabase()
      .from("profiles")
      .select("display_name, email")
      .eq("id", userId)
      .maybeSingle();
    return data?.display_name || data?.email || "Friend";
  } catch {
    return "Friend";
  }
}

function goHash(url) {
  if (!url) {
    location.hash = linkTo("/friends");
    return;
  }
  const raw = String(url);
  if (raw.startsWith("#")) {
    location.hash = raw;
    return;
  }
  if (raw.startsWith("/")) {
    location.hash = `#${raw}`;
    return;
  }
  location.hash = linkTo("/friends");
}

/** Open/focus the app and run Accept / Decline from the notification. */
function bindServiceWorkerActions() {
  if (swBound || !("serviceWorker" in navigator)) return;
  swBound = true;
  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "lantaw-notify-action") return;
    const { action, data } = msg;
    const kind = data?.kind;

    if (action === "accept-watch" || (kind === "watch" && action === "accept-watch")) {
      acceptWatchInvite().catch(() => {});
      return;
    }
    if (action === "decline-watch") {
      declineWatchInvite().catch(() => {});
      return;
    }
    if (action === "accept-call") {
      acceptIncomingCall().catch(() => {});
      return;
    }
    if (action === "decline-call") {
      declineIncomingCall().catch(() => {});
      return;
    }

    if (data?.chatId) {
      location.hash = linkTo(
        `/friends?chat=${encodeURIComponent(data.chatId)}`
      );
      return;
    }
    goHash(data?.url);
  });
}

export async function notifyFriendRequest({ fromId, friendshipId }) {
  const tag = `fr-${friendshipId || fromId}`;
  if (rememberTag(tag, 120_000)) return;
  const name = await profileName(fromId);
  await showAppNotification({
    kind: "friend",
    title: "Friend request",
    body: `${name} sent you a friend request`,
    tag,
    url: "#/friends",
    force: true,
  });
}

export async function notifyChatMessage({ friendshipId, senderId, body, messageId }) {
  if (!friendshipId || senderId === myId) return;
  if (activeChatId() === friendshipId && document.visibilityState === "visible") {
    return;
  }
  const tag = `chat-${messageId || `${friendshipId}-${body?.slice?.(0, 24) || ""}`}`;
  if (rememberTag(tag, 20_000)) return;
  const name = await profileName(senderId);
  await showAppNotification({
    kind: "chat",
    title: name,
    body: previewBody(body),
    tag: `chat-${friendshipId}`,
    url: `#/friends?chat=${encodeURIComponent(friendshipId)}`,
    data: { chatId: friendshipId },
    force: true,
  });
}

export async function notifyWatchInvite({ partyId, hostName, title, poster }) {
  if (!partyId) return;
  const tag = `wt-${partyId}`;
  if (rememberTag(tag, 60_000)) return;
  await showAppNotification({
    kind: "watch",
    title: "Watch together",
    body: `${hostName || "Friend"} invited you to ${title || "a title"}`,
    tag,
    url: "#/friends",
    requireInteraction: true,
    actions: [
      { action: "accept-watch", title: "Accept" },
      { action: "decline-watch", title: "Decline" },
    ],
    data: { partyId, poster: poster || null },
  });
}

export async function notifyVideoCall({ friendshipId, peerName }) {
  const tag = `call-${friendshipId || "incoming"}`;
  if (rememberTag(tag, 8_000)) return;
  await showAppNotification({
    kind: "call",
    title: "Incoming video call",
    body: `${peerName || "Friend"} is calling…`,
    tag,
    url: "#/friends",
    requireInteraction: true,
    actions: [
      { action: "accept-call", title: "Accept" },
      { action: "decline-call", title: "Decline" },
    ],
    data: { friendshipId },
  });
}

export async function startNotifyInbox() {
  bindServiceWorkerActions();
  const user = await getUser();
  if (!user) {
    await stopNotifyInbox();
    return;
  }

  // Soft-enable if already granted; otherwise wait for Me / Friends gesture
  if (notificationPermission() === "default") {
    /* keep listening setup after grant */
  } else if (notificationPermission() === "granted") {
    /* ok */
  }

  if (channel && myId === user.id) return;

  await stopNotifyInbox();
  myId = user.id;
  bindServiceWorkerActions();

  channel = getSupabase()
    .channel(`lantaw-notify:${user.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "friendships" },
      (payload) => {
        const row = payload?.new;
        if (!row || row.addressee_id !== myId) return;
        if (row.status !== "pending") return;
        notifyFriendRequest({
          fromId: row.requester_id,
          friendshipId: row.id,
        }).catch(() => {});
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "friend_messages" },
      (payload) => {
        const row = payload?.new;
        if (!row || row.sender_id === myId) return;
        notifyChatMessage({
          friendshipId: row.friendship_id,
          senderId: row.sender_id,
          body: row.body,
          messageId: row.id,
        }).catch(() => {});
      }
    )
    .subscribe();
}

export async function stopNotifyInbox() {
  if (channel) {
    try {
      await getSupabase().removeChannel(channel);
    } catch {
      /* ignore */
    }
  }
  channel = null;
  myId = null;
}

/** Enable Chrome notifications from Settings / Friends. */
export async function enableNotifications() {
  const perm = await ensureNotifyPermission();
  if (perm === "granted") {
    await startNotifyInbox();
  }
  return perm;
}

export { notificationPermission };
