import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";
import {
  getWatchParty,
  notifyFriendsBadge,
  updateWatchPartyStatus,
} from "./friendsService.js";
import { linkTo } from "../router/index.js";
import { showNotice } from "../lib/appModal.js";

let myId = null;
let channel = null;
let ui = null;
let pending = null;
let busy = false;

function el(sel) {
  return ui?.root?.querySelector(sel) || null;
}

function hideInvite() {
  pending = null;
  if (ui?.root) ui.root.hidden = true;
}

function ensureUi() {
  if (ui?.root?.isConnected) return ui;

  const root = document.createElement("div");
  root.className = "vc wt-invite";
  root.hidden = true;
  root.innerHTML = `
    <div class="vc__incoming-card wt-invite__card">
      <p class="vc__kicker">Watch together</p>
      <div class="wt-invite__poster" data-wt-poster-wrap hidden>
        <img data-wt-poster alt="" />
      </div>
      <strong data-wt-peer>Friend</strong>
      <p class="wt-invite__title" data-wt-title></p>
      <div class="vc__incoming-actions">
        <button type="button" class="btn btn--primary" data-wt-accept>Accept</button>
        <button type="button" class="btn btn--ghost" data-wt-decline>Decline</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelector("[data-wt-accept]")?.addEventListener("click", () => {
    acceptWatchInvite().catch((err) =>
      showNotice({
        title: "Couldn’t join",
        message: err.message || "Could not accept the invite.",
      })
    );
  });
  root.querySelector("[data-wt-decline]")?.addEventListener("click", () => {
    declineWatchInvite().catch(() => {});
  });

  ui = { root };
  return ui;
}

function currentWatchPartyId() {
  const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  const m = path.match(/^\/watch-party\/([^/]+)/);
  return m?.[1] || null;
}

function paintInvite(party) {
  ensureUi();
  const hostName =
    party.host?.display_name || party.host?.email || "Friend";
  const title = party.title || "a title";
  const peer = el("[data-wt-peer]");
  const titleEl = el("[data-wt-title]");
  const posterWrap = el("[data-wt-poster-wrap]");
  const poster = el("[data-wt-poster]");

  if (peer) peer.textContent = hostName;
  if (titleEl) titleEl.textContent = title;

  if (party.poster && poster && posterWrap) {
    poster.src = party.poster;
    posterWrap.hidden = false;
  } else if (posterWrap) {
    posterWrap.hidden = true;
  }

  ui.root.hidden = false;
}

async function showInvite(partyId) {
  if (!partyId || busy) return;
  if (pending?.id === partyId && ui?.root && !ui.root.hidden) return;
  if (currentWatchPartyId() === partyId) return;

  try {
    const party = await getWatchParty(partyId);
    if (!party || party.status !== "invited" || !party.isGuest) {
      if (pending?.id === partyId) hideInvite();
      return;
    }
    pending = party;
    paintInvite(party);
  } catch {
    /* ignore */
  }
}

function dismissIfGone(row) {
  if (!pending?.id) return;
  if (row?.id && row.id !== pending.id) return;
  if (!row || row.status !== "invited") {
    hideInvite();
  }
}

export async function acceptWatchInvite() {
  if (!pending?.id || busy) return;
  busy = true;
  const id = pending.id;
  try {
    await updateWatchPartyStatus(id, "active");
    hideInvite();
    notifyFriendsBadge();
    location.hash = linkTo(`/watch-party/${id}`);
  } finally {
    busy = false;
  }
}

export async function declineWatchInvite() {
  if (!pending?.id || busy) return;
  busy = true;
  const id = pending.id;
  try {
    await updateWatchPartyStatus(id, "declined");
    hideInvite();
    notifyFriendsBadge();
  } catch (err) {
    showNotice({
      title: "Couldn’t decline",
      message: err.message || "Try again.",
    });
  } finally {
    busy = false;
  }
}

async function scanPendingInvites() {
  const user = await getUser();
  if (!user) return;
  const { data, error } = await getSupabase()
    .from("watch_parties")
    .select("id")
    .eq("guest_id", user.id)
    .eq("status", "invited")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return;
  await showInvite(data[0].id);
}

export async function startWatchInviteInbox() {
  ensureUi();
  const user = await getUser();
  if (!user) {
    await stopWatchInviteInbox();
    return;
  }
  if (channel && myId === user.id) {
    await scanPendingInvites();
    return;
  }

  await stopWatchInviteInbox();
  myId = user.id;
  ensureUi();

  channel = getSupabase()
    .channel(`lantaw-watch-invite:${user.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "watch_parties" },
      (payload) => {
        const row = payload?.new || payload?.old;
        if (!row) return;

        if (payload.eventType === "DELETE") {
          if (pending?.id === row.id) hideInvite();
          return;
        }

        if (row.guest_id === myId && row.status === "invited") {
          showInvite(row.id);
          return;
        }

        dismissIfGone(row);
      }
    )
    .subscribe();

  await scanPendingInvites();
}

export async function stopWatchInviteInbox() {
  hideInvite();
  if (channel) {
    try {
      await getSupabase().removeChannel(channel);
    } catch {
      /* ignore */
    }
  }
  channel = null;
  myId = null;
  busy = false;
}
