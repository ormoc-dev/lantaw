import { getUser } from "../services/authService.js";
import { getMovieDetail, getTvDetail } from "../services/movieService.js";
import {
  getWatchParty,
  listWatchPartyMessages,
  sendWatchPartyMessage,
  subscribeWatchParty,
  updateWatchPartyPlayback,
  updateWatchPartyStatus,
} from "../services/friendsService.js";
import { linkTo } from "../router/index.js";
import { attachStreamAdGuard } from "../lib/streamGuard.js";
import {
  bindStreamControls,
  renderStreamPlayer,
} from "../lib/streamEmbed.js";

/**
 * Dedicated watch-together room.
 * Host controls Play / Pause / episode — guest only follows + chats.
 */
export async function WatchPartyView(root, params = {}) {
  const partyId = params.id;
  let cleanupStreamGuard = () => {};
  let unsub = null;
  let party = null;
  let movie = null;
  let lastAppliedKey = "";
  const knownMsgIds = new Set();

  root.innerHTML = `
    <a class="back" href="${linkTo("/friends")}">← Friends</a>
    <p class="muted">Loading room…</p>
  `;

  if (!partyId) {
    root.innerHTML = `<p class="muted">Missing watch party.</p>`;
    return { unmount() {} };
  }

  const me = await getUser();
  if (!me) {
    root.innerHTML = `<p class="muted">Sign in to join this room.</p>`;
    return { unmount() {} };
  }

  try {
    party = await getWatchParty(partyId);
  } catch (err) {
    root.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    return { unmount() {} };
  }

  if (!party) {
    root.innerHTML = `<p class="muted">Watch party not found.</p>`;
    return { unmount() {} };
  }

  const mediaType = party.media_type === "tv" ? "tv" : "movie";
  try {
    movie =
      mediaType === "tv"
        ? await getTvDetail(party.tmdb_id)
        : await getMovieDetail(party.tmdb_id);
  } catch (err) {
    root.innerHTML = `<p class="muted">Couldn’t load title. ${escapeHtml(
      err.message
    )}</p>`;
    return { unmount() {} };
  }

  const other = party.isHost ? party.guest : party.host;
  const otherName =
    other?.display_name || other?.email || (party.isHost ? "guest" : "host");

  root.innerHTML = `
    <section class="wparty">
      <a class="back" href="${linkTo("/friends")}">← Friends</a>
      <header class="wparty__head">
        <p class="fp-kicker">Watch together</p>
        <h1>${escapeHtml(party.title || movie.title || "Room")}</h1>
        <p class="muted wparty__meta">
          ${
            party.isHost
              ? `You’re the host · with ${escapeHtml(otherName)}`
              : `Hosted by ${escapeHtml(otherName)} · you just watch`
          }
        </p>
      </header>

      <div class="wparty__banner" id="wp-banner"></div>

      <div class="wparty__player" id="wp-player">
        <div class="wparty__waiting" id="wp-waiting">
          <strong id="wp-waiting-title">Waiting…</strong>
          <span class="muted" id="wp-waiting-copy"></span>
        </div>
      </div>

      <div class="wparty__calls" aria-label="Call controls">
        <button type="button" class="wt__call-btn" disabled>
          <span class="wt__call-label">Mic</span>
          <span class="wt__call-soon">Coming soon</span>
        </button>
        <button type="button" class="wt__call-btn" disabled>
          <span class="wt__call-label">Video</span>
          <span class="wt__call-soon">Coming soon</span>
        </button>
      </div>

      <div class="wparty__chat">
        <div class="wt__chat-head">
          <strong>Room chat</strong>
          <span class="muted">Talk while you watch</span>
        </div>
        <div class="wt__comments" id="wp-comments" aria-live="polite"></div>
        <form class="wt__compose" id="wp-compose" autocomplete="off">
          <input
            type="text"
            name="body"
            maxlength="280"
            placeholder="Write a message…"
            aria-label="Room chat"
          />
          <button type="submit" class="btn btn--primary">Send</button>
        </form>
      </div>
    </section>
  `;

  const banner = root.querySelector("#wp-banner");
  const playerEl = root.querySelector("#wp-player");
  const waiting = root.querySelector("#wp-waiting");
  const waitingTitle = root.querySelector("#wp-waiting-title");
  const waitingCopy = root.querySelector("#wp-waiting-copy");
  const comments = root.querySelector("#wp-comments");
  const form = root.querySelector("#wp-compose");

  const setWaiting = (title, copy) => {
    waiting.hidden = false;
    waitingTitle.textContent = title;
    waitingCopy.textContent = copy || "";
    const frame = playerEl.querySelector(".detail__player-frame");
    if (frame) frame.hidden = true;
    playerEl.querySelector(".stream-controls")?.remove();
  };

  const clearStream = () => {
    cleanupStreamGuard();
    cleanupStreamGuard = () => {};
    const iframe = playerEl.querySelector("#stream-iframe");
    if (iframe) iframe.src = "about:blank";
  };

  const mountPlayer = (opts = {}) => {
    clearStream();
    waiting.hidden = true;
    const html = renderStreamPlayer(movie, mediaType, {
      ...opts,
      readOnly: !party.isHost,
    });
    // Keep waiting node, replace the rest
    playerEl.querySelector(".detail__player-frame")?.remove();
    playerEl.querySelector(".stream-controls")?.remove();
    playerEl.querySelector(".wparty__paused")?.remove();
    waiting.insertAdjacentHTML("afterend", html);

    const frame = playerEl.querySelector(".detail__player-frame--embed");
    if (frame) {
      cleanupStreamGuard = attachStreamAdGuard(frame, {
        onSafeExit: () => {
          clearStream();
          setWaiting(
            "Player closed",
            party.isHost
              ? "Press Play when you’re ready again."
              : "Waiting for the host to press Play."
          );
        },
      });
    }

    if (party.isHost && mediaType === "tv") {
      bindStreamControls(playerEl, movie, mediaType, {
        onEpisodeChange: async ({ season, episode }) => {
          try {
            await updateWatchPartyPlayback(partyId, {
              state: "playing",
              season,
              episode,
              bumpSync: true,
            });
          } catch (err) {
            alert(err.message);
          }
        },
      });
    }
  };

  const showPaused = () => {
    clearStream();
    playerEl.querySelector(".detail__player-frame")?.remove();
    playerEl.querySelector(".stream-controls")?.remove();
    playerEl.querySelector(".wparty__paused")?.remove();
    waiting.hidden = true;
    const cover = document.createElement("div");
    cover.className = "wparty__paused";
    cover.innerHTML = `
      <strong>Paused by host</strong>
      <span class="muted">${
        party.isHost
          ? "Press Play to resume for both of you."
          : "Hang tight — the host will resume."
      }</span>
    `;
    waiting.after(cover);
  };

  const applyPlayback = (row = party, { force = false } = {}) => {
    if (!row || row.status !== "active") return;
    const state = row.playback_state || "idle";
    const token = Number(row.playback_sync_token || 0);
    const key = `${state}:${token}:${row.playback_season || ""}:${
      row.playback_episode || ""
    }`;
    if (!force && key === lastAppliedKey) return;
    lastAppliedKey = key;

    if (state === "playing") {
      mountPlayer({
        season: row.playback_season || undefined,
        episode: row.playback_episode || undefined,
      });
      return;
    }
    if (state === "paused") {
      showPaused();
      return;
    }
    setWaiting(
      party.isHost ? "Ready when you are" : "Waiting for host",
      party.isHost
        ? "Press Play — your friend will start with you."
        : `${otherName} will press Play. You don’t need to do anything.`
    );
  };

  const paintBanner = () => {
    if (!party) return;

    if (party.status === "ended" || party.status === "declined") {
      banner.className = "wparty__banner wparty__banner--ended";
      banner.innerHTML = `
        <strong>Room closed</strong>
        <span class="muted">${
          party.status === "declined" ? "Invite was declined." : "Session ended."
        }</span>
        <a class="fp-btn" href="${linkTo("/friends")}">Back to Friends</a>
      `;
      clearStream();
      setWaiting("Session ended", "");
      return;
    }

    if (party.status === "invited") {
      banner.className = "wparty__banner wparty__banner--wait";
      if (party.isHost) {
        banner.innerHTML = `
          <div class="wt__pulse" aria-hidden="true"></div>
          <div class="wt__banner-copy">
            <strong>Waiting for ${escapeHtml(otherName)}</strong>
            <span class="muted">They’ll land in this room when they accept. Then you press Play.</span>
          </div>
          <button type="button" class="fp-btn" id="wp-cancel">Cancel</button>
        `;
        banner.querySelector("#wp-cancel")?.addEventListener("click", async () => {
          try {
            await updateWatchPartyStatus(partyId, "ended");
          } catch (err) {
            alert(err.message);
          }
        });
        setWaiting(
          "Waiting for guest",
          "Play unlocks after they accept."
        );
      } else {
        banner.innerHTML = `
          <div class="wt__banner-copy">
            <strong>${escapeHtml(otherName)} invited you</strong>
            <span class="muted">Accept to enter the room. The host starts the movie — you just watch.</span>
          </div>
          <div class="wt__banner-actions">
            <button type="button" class="fp-btn fp-btn--solid" id="wp-accept">Accept</button>
            <button type="button" class="fp-btn" id="wp-decline">Decline</button>
          </div>
        `;
        banner.querySelector("#wp-accept")?.addEventListener("click", async () => {
          try {
            await updateWatchPartyStatus(partyId, "active");
          } catch (err) {
            alert(err.message);
          }
        });
        banner.querySelector("#wp-decline")?.addEventListener("click", async () => {
          try {
            await updateWatchPartyStatus(partyId, "declined");
          } catch (err) {
            alert(err.message);
          }
        });
        setWaiting("Invite pending", "Accept to join the room.");
      }
      return;
    }

    // active
    if (party.isHost) {
      const state = party.playback_state || "idle";
      banner.className = "wparty__banner wparty__banner--live";
      banner.innerHTML = `
        <span class="wt__live-dot" aria-hidden="true"></span>
        <div class="wt__banner-copy">
          <strong>You’re hosting</strong>
          <span class="muted">Only you control Play — ${escapeHtml(
            otherName
          )} follows automatically.</span>
        </div>
        <div class="wt__banner-actions">
          <button type="button" class="btn btn--primary" id="wp-play">${
            state === "paused" ? "Resume" : state === "playing" ? "Sync" : "Play"
          }</button>
          <button type="button" class="fp-btn" id="wp-pause" ${
            state === "playing" ? "" : "hidden"
          }>Pause</button>
          <button type="button" class="fp-btn" id="wp-end">End</button>
        </div>
      `;
      banner.querySelector("#wp-play")?.addEventListener("click", async () => {
        try {
          await updateWatchPartyPlayback(partyId, {
            state: "playing",
            bumpSync: true,
            season: party.playback_season,
            episode: party.playback_episode,
          });
        } catch (err) {
          alert(err.message);
        }
      });
      banner.querySelector("#wp-pause")?.addEventListener("click", async () => {
        try {
          await updateWatchPartyPlayback(partyId, {
            state: "paused",
            bumpSync: false,
          });
        } catch (err) {
          alert(err.message);
        }
      });
      banner.querySelector("#wp-end")?.addEventListener("click", async () => {
        try {
          await updateWatchPartyStatus(partyId, "ended");
        } catch (err) {
          alert(err.message);
        }
      });
    } else {
      banner.className = "wparty__banner wparty__banner--live";
      banner.innerHTML = `
        <span class="wt__live-dot" aria-hidden="true"></span>
        <div class="wt__banner-copy">
          <strong>Watching with ${escapeHtml(otherName)}</strong>
          <span class="muted">Host controls the movie — you don’t need to press Play.</span>
        </div>
        <button type="button" class="fp-btn" id="wp-leave">Leave</button>
      `;
      banner.querySelector("#wp-leave")?.addEventListener("click", async () => {
        try {
          await updateWatchPartyStatus(partyId, "ended");
        } catch (err) {
          alert(err.message);
        }
      });
    }
    applyPlayback(party);
  };

  function spawnComment(msg, { mine = false, name = "Friend" } = {}) {
    if (!msg?.id || knownMsgIds.has(msg.id)) return;
    knownMsgIds.add(msg.id);
    const el = document.createElement("div");
    el.className = `wt__float ${mine ? "is-me" : ""} is-in`;
    el.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(msg.body)}</span>
      <time>${formatTime(msg.created_at)}</time>
    `;
    comments.appendChild(el);
    while (comments.children.length > 80) comments.firstElementChild?.remove();
    comments.scrollTop = comments.scrollHeight;
  }

  function displayNameFor(senderId) {
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
      if (!rows.length) {
        comments.innerHTML = `<p class="muted wt__chat-empty">No messages yet.</p>`;
        return;
      }
      for (const m of rows) {
        spawnComment(m, {
          mine: m.sender_id === me.id,
          name: displayNameFor(m.sender_id),
        });
      }
    } catch (_) {
      comments.innerHTML = `<p class="muted wt__chat-empty">Chat unavailable.</p>`;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = String(form.body.value || "").trim();
    if (!text) return;
    if (party.status !== "active" && party.status !== "invited") return;
    form.body.value = "";
    comments.querySelector(".wt__chat-empty")?.remove();
    try {
      const msg = await sendWatchPartyMessage(partyId, text);
      spawnComment(msg, { mine: true, name: "You" });
    } catch (err) {
      alert(err.message || "Could not send");
    }
  });

  paintBanner();
  await hydrateComments();

  unsub = subscribeWatchParty(partyId, {
    onParty: async (payload) => {
      const row = payload?.new;
      if (!row) {
        try {
          party = await getWatchParty(partyId);
        } catch (_) {
          return;
        }
      } else {
        party = {
          ...party,
          ...row,
          isHost: row.host_id === me.id,
          isGuest: row.guest_id === me.id,
        };
      }
      paintBanner();
    },
    onMessage: (payload) => {
      const msg = payload?.new;
      if (!msg) return;
      comments.querySelector(".wt__chat-empty")?.remove();
      spawnComment(msg, {
        mine: msg.sender_id === me.id,
        name: displayNameFor(msg.sender_id),
      });
    },
  });

  return {
    unmount() {
      unsub?.();
      clearStream();
    },
  };
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
