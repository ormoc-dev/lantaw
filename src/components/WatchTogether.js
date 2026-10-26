import { getUser } from "../services/authService.js";
import {
  getWatchParty,
  listWatchPartyMessages,
  sendWatchPartyMessage,
  subscribeWatchParty,
  updateWatchPartyStatus,
} from "../services/friendsService.js";

/**
 * Watch-together chrome: waiting banner, accept/decline, TikTok-style live comments.
 * @param {{
 *   partyId: string,
 *   root: HTMLElement,
 *   onStartPlayback: () => void,
 *   onEnded?: () => void,
 * }} opts
 */
export async function mountWatchTogether({
  partyId,
  root,
  onStartPlayback,
  onEnded,
}) {
  const me = await getUser();
  if (!me || !partyId || !root) {
    return { unmount() {} };
  }

  let party = null;
  let unsub = null;
  let started = false;
  const knownMsgIds = new Set();

  const shell = document.createElement("div");
  shell.className = "wt";
  shell.innerHTML = `
    <div class="wt__banner" id="wt-banner" hidden></div>
    <div class="wt__stage" id="wt-stage" hidden>
      <div class="wt__comments" id="wt-comments" aria-live="polite"></div>
      <form class="wt__compose" id="wt-compose" autocomplete="off">
        <input
          type="text"
          name="body"
          maxlength="280"
          placeholder="Say something…"
          aria-label="Watch together comment"
        />
        <button type="submit" class="btn btn--primary">Send</button>
      </form>
    </div>
  `;
  root.prepend(shell);

  const banner = shell.querySelector("#wt-banner");
  const stage = shell.querySelector("#wt-stage");
  const comments = shell.querySelector("#wt-comments");
  const form = shell.querySelector("#wt-compose");

  const otherName = () => {
    if (!party) return "friend";
    const other = party.isHost ? party.guest : party.host;
    return other?.display_name || other?.email || "friend";
  };

  const paintBanner = () => {
    if (!party) {
      banner.hidden = true;
      return;
    }

    if (party.status === "ended" || party.status === "declined") {
      banner.hidden = false;
      banner.className = "wt__banner wt__banner--ended";
      banner.innerHTML = `
        <strong>Watch together ended</strong>
        <span class="muted">${
          party.status === "declined" ? "Invite was declined." : "Session closed."
        }</span>
        <button type="button" class="fp-btn" id="wt-dismiss">Dismiss</button>
      `;
      stage.hidden = true;
      banner.querySelector("#wt-dismiss")?.addEventListener("click", () => {
        shell.remove();
        onEnded?.();
      });
      return;
    }

    if (party.status === "invited") {
      banner.hidden = false;
      banner.className = "wt__banner wt__banner--wait";
      if (party.isHost) {
        banner.innerHTML = `
          <div class="wt__pulse" aria-hidden="true"></div>
          <div class="wt__banner-copy">
            <strong>Waiting for ${escapeHtml(otherName())}</strong>
            <span class="muted">They’ll join this screen when they accept. Playback starts automatically.</span>
          </div>
          <button type="button" class="fp-btn" id="wt-cancel">Cancel</button>
        `;
        banner.querySelector("#wt-cancel")?.addEventListener("click", async () => {
          try {
            await updateWatchPartyStatus(party.id, "ended");
          } catch (err) {
            alert(err.message);
          }
        });
      } else {
        banner.innerHTML = `
          <div class="wt__banner-copy">
            <strong>${escapeHtml(otherName())} invited you</strong>
            <span class="muted">Accept to watch ${escapeHtml(party.title || "together")} live.</span>
          </div>
          <div class="wt__banner-actions">
            <button type="button" class="fp-btn fp-btn--solid" id="wt-accept">Accept</button>
            <button type="button" class="fp-btn" id="wt-decline">Decline</button>
          </div>
        `;
        banner.querySelector("#wt-accept")?.addEventListener("click", async () => {
          try {
            await updateWatchPartyStatus(party.id, "active");
          } catch (err) {
            alert(err.message);
          }
        });
        banner.querySelector("#wt-decline")?.addEventListener("click", async () => {
          try {
            await updateWatchPartyStatus(party.id, "declined");
          } catch (err) {
            alert(err.message);
          }
        });
      }
      stage.hidden = true;
      return;
    }

    if (party.status === "active") {
      banner.hidden = false;
      banner.className = "wt__banner wt__banner--live";
      banner.innerHTML = `
        <span class="wt__live-dot" aria-hidden="true"></span>
        <div class="wt__banner-copy">
          <strong>Watching with ${escapeHtml(otherName())}</strong>
          <span class="muted">Chat live below the video</span>
        </div>
        <button type="button" class="fp-btn" id="wt-end">End</button>
      `;
      banner.querySelector("#wt-end")?.addEventListener("click", async () => {
        try {
          await updateWatchPartyStatus(party.id, "ended");
        } catch (err) {
          alert(err.message);
        }
      });
      stage.hidden = false;
      startPlaybackOnce();
    }
  };

  function startPlaybackOnce() {
    if (started) return;
    started = true;
    onStartPlayback?.();
  }

  function spawnComment(msg, { mine = false, name = "Friend" } = {}) {
    if (!msg?.id || knownMsgIds.has(msg.id)) return;
    knownMsgIds.add(msg.id);

    const el = document.createElement("div");
    el.className = `wt__float ${mine ? "is-me" : ""}`;
    el.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(msg.body)}</span>
    `;
    comments.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));

    // Keep the stack short (TikTok-style)
    while (comments.children.length > 8) {
      comments.firstElementChild?.remove();
    }

    window.setTimeout(() => {
      el.classList.add("is-out");
      window.setTimeout(() => el.remove(), 450);
    }, 5200);
  }

  function displayNameFor(senderId) {
    if (!party) return "Friend";
    if (senderId === me.id) return "You";
    if (senderId === party.host_id) {
      return party.host?.display_name || party.host?.email || "Host";
    }
    return party.guest?.display_name || party.guest?.email || "Friend";
  }

  async function hydrateComments() {
    try {
      const rows = await listWatchPartyMessages(partyId);
      comments.innerHTML = "";
      knownMsgIds.clear();
      for (const m of rows.slice(-6)) {
        spawnComment(m, {
          mine: m.sender_id === me.id,
          name: displayNameFor(m.sender_id),
        });
      }
    } catch (_) {
      /* table may not exist yet */
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.body;
    const text = String(input.value || "").trim();
    if (!text || party?.status !== "active") return;
    input.value = "";
    try {
      const msg = await sendWatchPartyMessage(partyId, text);
      spawnComment(msg, { mine: true, name: "You" });
    } catch (err) {
      alert(err.message || "Could not send");
    }
  });

  async function refreshParty(next) {
    party = next || (await getWatchParty(partyId));
    if (!party) {
      banner.hidden = false;
      banner.textContent = "Watch party not found.";
      return;
    }
    paintBanner();
    if (party.status === "active") {
      await hydrateComments();
    }
  }

  try {
    await refreshParty();
  } catch (err) {
    banner.hidden = false;
    banner.className = "wt__banner wt__banner--ended";
    banner.innerHTML = `<strong>Watch together unavailable</strong><span class="muted">${escapeHtml(
      err.message
    )}</span>`;
    return {
      unmount() {
        shell.remove();
      },
    };
  }

  unsub = subscribeWatchParty(partyId, {
    onParty: async (payload) => {
      const row = payload?.new;
      if (!row) {
        await refreshParty();
        return;
      }
      party = {
        ...party,
        ...row,
        isHost: row.host_id === me.id,
        isGuest: row.guest_id === me.id,
      };
      paintBanner();
      if (row.status === "active") {
        await hydrateComments();
      }
      if (row.status === "ended" || row.status === "declined") {
        onEnded?.();
      }
    },
    onMessage: (payload) => {
      const msg = payload?.new;
      if (!msg) return;
      spawnComment(msg, {
        mine: msg.sender_id === me.id,
        name: displayNameFor(msg.sender_id),
      });
    },
  });

  return {
    getParty: () => party,
    unmount() {
      unsub?.();
      shell.remove();
    },
  };
}

export function getPartyIdFromHash() {
  const hash = location.hash.replace(/^#/, "");
  const qi = hash.indexOf("?");
  if (qi < 0) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get("party");
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
