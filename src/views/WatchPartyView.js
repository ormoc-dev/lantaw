import { getUser } from "../services/authService.js";
import { getMovieDetail, getTvDetail } from "../services/movieService.js";
import {
  endWatchParty,
  getWatchParty,
  listWatchPartyMessages,
  sendWatchPartyMessage,
  subscribeWatchParty,
  toggleWatchPartyReaction,
  updateWatchPartyPlayback,
  updateWatchPartyStatus,
} from "../services/friendsService.js";
import { linkTo } from "../router/index.js";
import { attachStreamAdGuard } from "../lib/streamGuard.js";
import {
  bindStreamControls,
  getTvDefaults,
  renderStreamPlayer,
  renderTvEpisodeControls,
} from "../lib/streamEmbed.js";
import { loadingHtml } from "../components/Loading.js";

/**
 * Dedicated watch-together room.
 * Host controls Play / Pause / episode — guest only follows + chats.
 */
export async function WatchPartyView(root, params = {}) {
  const partyId = params.id;
  let cleanupStreamGuard = () => {};
  let unsubTime = null;
  let partySub = null;
  let party = null;
  let movie = null;
  let lastAppliedKey = "";
  let lastKnownTimeSec = 0;
  let soloAfterGuestLeft = false;
  let typingHideTimer = null;
  let typingPingTimer = null;
  let amTyping = false;
  const knownMsgIds = new Set();

  root.classList.add("view--watch-party");
  document.body.classList.add("is-watch-party");

  const teardownChrome = () => {
    root.classList.remove("view--watch-party");
    document.body.classList.remove("is-watch-party");
  };

  const estimatePositionSec = (row = party) => {
    if (lastKnownTimeSec > 0) return Math.floor(lastKnownTimeSec);
    const base = Math.max(0, Number(row?.playback_position_sec) || 0);
    if (row?.playback_state === "playing" && row?.playback_started_at) {
      const elapsed =
        (Date.now() - new Date(row.playback_started_at).getTime()) / 1000;
      if (Number.isFinite(elapsed) && elapsed > 0) {
        return Math.floor(base + elapsed);
      }
    }
    return Math.floor(base);
  };

  root.innerHTML = `
    <section class="wparty">
      ${loadingHtml({ className: "wparty__loading" })}
    </section>
  `;

  if (!partyId) {
    root.innerHTML = `<p class="muted">Missing watch party.</p>`;
    return {
      unmount() {
        teardownChrome();
      },
    };
  }

  const me = await getUser();
  if (!me) {
    root.innerHTML = `<p class="muted">Sign in to join this room.</p>`;
    return {
      unmount() {
        teardownChrome();
      },
    };
  }

  try {
    party = await getWatchParty(partyId);
  } catch (err) {
    root.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    return {
      unmount() {
        teardownChrome();
      },
    };
  }

  if (!party) {
    root.innerHTML = `<p class="muted">Watch party not found.</p>`;
    return {
      unmount() {
        teardownChrome();
      },
    };
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
    return {
      unmount() {
        teardownChrome();
      },
    };
  }

  const other = party.isHost ? party.guest : party.host;
  const meProfile = party.isHost ? party.host : party.guest;
  const otherName =
    other?.display_name || other?.email || (party.isHost ? "guest" : "host");
  const myName =
    meProfile?.display_name || meProfile?.email || me.email || "You";

  const avatarHtml = (profile, name = "?") => {
    const letter = String(name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";
    if (profile?.avatar_url) {
      return `<img class="fp-avatar fp-avatar--xs wparty__msg-avatar" src="${escapeHtml(
        profile.avatar_url
      )}" alt="" width="22" height="22" />`;
    }
    return `<span class="fp-avatar fp-avatar--fallback fp-avatar--xs wparty__msg-avatar" aria-hidden="true">${escapeHtml(
      letter
    )}</span>`;
  };

  const profileFor = (senderId) => {
    if (senderId === me.id) return meProfile;
    if (senderId === party.host_id) return party.host;
    return party.guest;
  };

  root.innerHTML = `
    <section class="wparty">
      <header class="wparty__bar">
        <a class="wparty__back" href="${linkTo("/friends")}" aria-label="Back to Friends">←</a>
        <div class="wparty__titles">
          <h1>${escapeHtml(party.title || movie.title || "Room")}</h1>
          <p class="muted wparty__meta" id="wp-meta"></p>
        </div>
      </header>

      <div class="wparty__controls" id="wp-banner"></div>

      <div class="wparty__player" id="wp-player">
        <p class="muted wparty__waiting" id="wp-waiting">
          <span id="wp-waiting-title">Waiting…</span>
          <span id="wp-waiting-copy"></span>
        </p>
      </div>

      <p class="wparty__sync-tip" id="wp-sync-tip" hidden>
        Behind? Ask in chat — host presses Sync.
      </p>

      <div class="wparty__chat">
        <header class="wparty__chat-head">
          <div class="wparty__chat-who">
            ${avatarHtml(other, otherName)}
            <div class="wparty__chat-who-text">
              <strong>Room chat</strong>
              <span class="muted">with ${escapeHtml(otherName)}</span>
            </div>
          </div>
        </header>
        <div class="wparty__messages" id="wp-comments" aria-live="polite"></div>
        <p class="wparty__typing" id="wp-typing" hidden aria-live="polite">
          <span class="wparty__typing-dots" aria-hidden="true"></span>
          <span id="wp-typing-label"></span>
        </p>
        <div class="wparty__compose-spacer" id="wp-compose-spacer" hidden></div>
        <form class="wparty__compose" id="wp-compose" autocomplete="off">
          <input
            type="text"
            name="body"
            maxlength="280"
            placeholder="Type a message…"
            aria-label="Type a message"
            enterkeyhint="send"
            inputmode="text"
          />
          <button type="submit" class="btn btn--primary">Send</button>
        </form>
      </div>
    </section>
  `;

  const metaEl = root.querySelector("#wp-meta");

  const banner = root.querySelector("#wp-banner");
  const playerEl = root.querySelector("#wp-player");
  const waiting = root.querySelector("#wp-waiting");
  const waitingTitle = root.querySelector("#wp-waiting-title");
  const waitingCopy = root.querySelector("#wp-waiting-copy");
  const syncTip = root.querySelector("#wp-sync-tip");
  const comments = root.querySelector("#wp-comments");
  const typingEl = root.querySelector("#wp-typing");
  const typingLabel = root.querySelector("#wp-typing-label");
  const form = root.querySelector("#wp-compose");

  const setTypingVisible = (visible, name = otherName) => {
    if (!typingEl || !typingLabel) return;
    if (!visible) {
      typingEl.hidden = true;
      typingLabel.textContent = "";
      return;
    }
    typingLabel.textContent = `${name} is typing…`;
    typingEl.hidden = false;
  };

  const hasLivePlayer = () => {
    const iframe = playerEl.querySelector("#stream-iframe");
    const src = iframe?.getAttribute("src") || "";
    return Boolean(src && src !== "about:blank");
  };

  const setSyncTipVisible = (visible) => {
    if (syncTip) syncTip.hidden = !visible;
  };

  const playbackKey = (row) =>
    `${row.playback_state || "idle"}:${Number(row.playback_sync_token || 0)}:${
      row.playback_season || ""
    }:${row.playback_episode || ""}`;

  const readEpisodePick = () => {
    const defaults = mediaType === "tv" ? getTvDefaults(movie) : null;
    const seasonEl = root.querySelector("#stream-season");
    const episodeEl = root.querySelector("#stream-episode");
    return {
      season: Math.max(
        1,
        Number(seasonEl?.value || party.playback_season || defaults?.season) || 1
      ),
      episode: Math.max(
        1,
        Number(episodeEl?.value || party.playback_episode || defaults?.episode) ||
          1
      ),
    };
  };

  const clearEpisodeRow = () => {
    const ep = banner.querySelector("#wp-episode");
    if (!ep) return;
    ep.innerHTML = "";
    ep.hidden = true;
  };

  const paintEpisodeRow = () => {
    const ep = banner.querySelector("#wp-episode");
    if (!ep || !party.isHost || mediaType !== "tv" || party.status !== "active") {
      clearEpisodeRow();
      return;
    }
    const pick = readEpisodePick();
    ep.hidden = false;
    ep.innerHTML = renderTvEpisodeControls(movie, {
      season: party.playback_season || pick.season,
      episode: party.playback_episode || pick.episode,
    });
    bindStreamControls(root.querySelector(".wparty") || root, movie, mediaType, {
      autoplay: true,
        onEpisodeChange: async ({ season, episode }) => {
          try {
            lastKnownTimeSec = 0;
            const updated = await updateWatchPartyPlayback(partyId, {
              state: "playing",
              season,
              episode,
              bumpSync: true,
              positionSec: 0,
            });
            party = {
              ...party,
              ...updated,
              isHost: true,
              isGuest: false,
            };
            lastAppliedKey = "";
            applyPlayback(party, { force: true });
          } catch (err) {
            alert(err.message);
          }
        },
    });
  };

  const stripPlayerDom = () => {
    playerEl.querySelector(".detail__player-frame")?.remove();
    playerEl.querySelector(".stream-controls")?.remove();
    playerEl.querySelector(".wparty__paused")?.remove();
  };

  const setWaiting = (title, copy) => {
    clearStream();
    stripPlayerDom();
    waiting.hidden = false;
    waitingTitle.textContent = title;
    waitingCopy.textContent = copy ? ` · ${copy}` : "";
  };

  const clearStream = () => {
    cleanupStreamGuard();
    cleanupStreamGuard = () => {};
    unsubTime?.();
    unsubTime = null;
    const iframe = playerEl.querySelector("#stream-iframe");
    if (iframe) iframe.src = "about:blank";
  };

  const bindHostTimeTracking = () => {
    unsubTime?.();
    unsubTime = null;
    if (!party.isHost) return;
    const onMessage = (event) => {
      if (event.origin !== "https://cinesrc.st") return;
      const type = event.data?.type;
      if (type === "cinesrc:timeupdate" || type === "cinesrc:seeked") {
        const t = Number(event.data?.currentTime);
        if (Number.isFinite(t) && t >= 0) lastKnownTimeSec = t;
      }
    };
    window.addEventListener("message", onMessage);
    unsubTime = () => window.removeEventListener("message", onMessage);
  };

  const mountPlayer = (opts = {}) => {
    clearStream();
    stripPlayerDom();
    waiting.hidden = true;
    setSyncTipVisible(true);
    const startAt = Math.max(0, Number(opts.startAt) || 0);
    if (startAt <= 0) lastKnownTimeSec = 0;
    const html = renderStreamPlayer(movie, mediaType, {
      ...opts,
      startAt,
      autoplay: true,
      // Episode picker lives in the host toolbar, not above the iframe
      omitControls: true,
      readOnly: !party.isHost,
    });
    waiting.insertAdjacentHTML("afterend", html);

    const frame = playerEl.querySelector(".detail__player-frame--embed");
    if (frame) {
      // Host Play is a user gesture → skip shield so stream starts immediately.
      // Guest loads from realtime (no gesture) → one tap unlocks + starts playback.
      cleanupStreamGuard = attachStreamAdGuard(frame, {
        skipShield: Boolean(party.isHost),
        shieldLabel: "Host started — tap to play",
        shieldHint: "One tap syncs you with the room",
        exitCorner: "end",
        exitLabel: "Close",
        onSafeExit: () => {
          clearStream();
          stripPlayerDom();
          setSyncTipVisible(false);
          setWaiting(
            "Player closed",
            party.isHost
              ? "Press Play when you’re ready again."
              : "Waiting for the host to press Play."
          );
        },
      });
    }

    bindHostTimeTracking();

    if (party.isHost && mediaType === "tv") {
      paintEpisodeRow();
    }
  };

  const applyPlayback = (row = party, { force = false } = {}) => {
    if (!row || row.status !== "active") return;
    const state = row.playback_state || "idle";
    const key = playbackKey(row);
    if (!force && key === lastAppliedKey) return;
    lastAppliedKey = key;

    if (state === "playing") {
      mountPlayer({
        season: row.playback_season || undefined,
        episode: row.playback_episode || undefined,
        startAt: Number(row.playback_position_sec) || 0,
      });
      return;
    }
    setSyncTipVisible(false);
    if (state === "paused") {
      setWaiting(
        "Paused",
        party.isHost ? "Press Play to resume" : "Host will resume"
      );
      return;
    }
    setWaiting(
      party.isHost ? "Press Play to start" : "Waiting for host",
      party.isHost ? `${otherName} follows you` : ""
    );
  };

  const wipeRoomChat = () => {
    knownMsgIds.clear();
    if (comments) {
      comments.innerHTML = `<p class="muted wparty__chat-empty">Room chat cleared.</p>`;
    }
  };

  const finishPartyAndLeave = async () => {
    soloAfterGuestLeft = false;
    clearStream();
    stripPlayerDom();
    wipeRoomChat();
    await endWatchParty(partyId);
    location.hash = linkTo("/friends");
  };

  const paintBanner = () => {
    if (!party) return;

    if (party.status === "ended" || party.status === "declined") {
      // Guest left while host was watching → host keeps the stream (solo).
      // Host End clears locally first, so no live player → full session end.
      if (
        party.status === "ended" &&
        party.isHost &&
        (soloAfterGuestLeft || hasLivePlayer())
      ) {
        soloAfterGuestLeft = true;
        if (metaEl) metaEl.textContent = `${otherName} left · watching solo`;
        banner.className = "wparty__controls";
        banner.innerHTML = `
          <div class="wparty__playback">
            <button type="button" class="fp-btn" id="wp-done">Done</button>
          </div>
        `;
        banner.querySelector("#wp-done")?.addEventListener("click", async () => {
          try {
            await finishPartyAndLeave();
          } catch (err) {
            alert(err.message);
          }
        });
        setSyncTipVisible(false);
        return;
      }
      if (metaEl) {
        metaEl.textContent =
          party.status === "declined" ? "Invite declined" : "Session ended";
      }
      banner.className = "wparty__controls";
      banner.innerHTML = `<a class="fp-btn" href="${linkTo("/friends")}">Back to Friends</a>`;
      setSyncTipVisible(false);
      clearStream();
      wipeRoomChat();
      setWaiting("Session ended", "");
      return;
    }

    if (party.status === "invited") {
      setSyncTipVisible(false);
      banner.className = "wparty__controls";
      if (party.isHost) {
        if (metaEl) metaEl.textContent = `Host · waiting for ${otherName}`;
        banner.innerHTML = `<button type="button" class="fp-btn" id="wp-cancel">Cancel</button>`;
        banner.querySelector("#wp-cancel")?.addEventListener("click", async () => {
          try {
            await finishPartyAndLeave();
          } catch (err) {
            alert(err.message);
          }
        });
        setWaiting("Waiting for guest", "then press Play");
      } else {
        if (metaEl) metaEl.textContent = `${otherName} invited you`;
        banner.innerHTML = `
          <button type="button" class="btn btn--primary" id="wp-accept">Accept</button>
          <button type="button" class="fp-btn" id="wp-decline">Decline</button>
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
        setWaiting("Accept to join", "");
      }
      return;
    }

    // active — host toolbar (playback + episode); guest only Leave
    banner.className = "wparty__controls";
    if (party.isHost) {
      const state = party.playback_state || "idle";
      if (metaEl) metaEl.textContent = `Host · ${otherName} follows`;
      banner.innerHTML = `
        <div class="wparty__playback" role="group" aria-label="Playback">
          <button type="button" class="btn btn--primary" id="wp-play">${
            state === "paused" ? "Resume" : state === "playing" ? "Sync" : "Play"
          }</button>
          <button type="button" class="fp-btn" id="wp-pause" ${
            state === "playing" ? "" : "hidden"
          }>Pause</button>
          <button type="button" class="fp-btn" id="wp-end">End</button>
        </div>
        <div class="wparty__episode" id="wp-episode" hidden></div>
      `;
      if (mediaType === "tv") paintEpisodeRow();
      banner.querySelector("#wp-play")?.addEventListener("click", async () => {
        const playBtn = banner.querySelector("#wp-play");
        if (playBtn) playBtn.disabled = true;
        const pick = readEpisodePick();
        // Sync / Resume: jump both to the host's current spot so you stay together.
        const positionSec =
          state === "playing" || state === "paused"
            ? estimatePositionSec(party)
            : 0;
        try {
          // Start under the Play click gesture so the host stream begins immediately.
          mountPlayer({
            season: pick.season,
            episode: pick.episode,
            startAt: positionSec,
          });
          const updated = await updateWatchPartyPlayback(partyId, {
            state: "playing",
            bumpSync: true,
            season: pick.season,
            episode: pick.episode,
            positionSec,
          });
          party = {
            ...party,
            ...updated,
            isHost: true,
            isGuest: false,
          };
          lastAppliedKey = playbackKey(party);
          paintBanner();
        } catch (err) {
          setSyncTipVisible(false);
          setWaiting(
            "Couldn’t start",
            err.message || "Try Play again"
          );
          if (playBtn) playBtn.disabled = false;
        }
      });
      banner.querySelector("#wp-pause")?.addEventListener("click", async () => {
        try {
          const updated = await updateWatchPartyPlayback(partyId, {
            state: "paused",
            bumpSync: false,
            positionSec: estimatePositionSec(party),
          });
          party = {
            ...party,
            ...updated,
            isHost: true,
            isGuest: false,
          };
          paintBanner();
        } catch (err) {
          alert(err.message);
        }
      });
      banner.querySelector("#wp-end")?.addEventListener("click", async () => {
        try {
          // Deletes the room + chat so it won’t linger in the Friends lobby.
          await finishPartyAndLeave();
        } catch (err) {
          alert(err.message);
        }
      });
    } else {
      if (metaEl) metaEl.textContent = `Watching · ${otherName} controls`;
      banner.innerHTML = `
        <div class="wparty__playback">
          <button type="button" class="fp-btn" id="wp-leave">Leave</button>
        </div>
      `;
      banner.querySelector("#wp-leave")?.addEventListener("click", async () => {
        try {
          // Guest leave: host can keep watching solo; room stays until host Ends.
          await updateWatchPartyStatus(partyId, "ended");
        } catch (err) {
          alert(err.message);
        }
      });
    }
    applyPlayback(party);
  };

  const REACTIONS = ["👍", "❤️", "😂", "😮", "🔥"];

  const groupReactions = (reactions = []) => {
    const map = new Map();
    for (const r of reactions) {
      const key = r.emoji;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r.user_id);
    }
    return [...map.entries()].map(([emoji, users]) => ({ emoji, users }));
  };

  const reactionsHtml = (msgId, reactions = []) => {
    const groups = groupReactions(reactions);
    if (!groups.length) return "";
    return `<div class="fp-bubble__reactions" data-react-chips>
      ${groups
        .map(
          (g) => `
        <button
          type="button"
          class="fp-react-chip ${g.users.includes(me.id) ? "is-mine" : ""}"
          data-react="${escapeHtml(msgId)}"
          data-emoji="${escapeHtml(g.emoji)}"
        >${escapeHtml(g.emoji)} <span>${g.users.length}</span></button>`
        )
        .join("")}
    </div>`;
  };

  function spawnComment(
    msg,
    { mine = false, name = "Friend", skipScroll = false } = {}
  ) {
    if (!msg?.id || knownMsgIds.has(msg.id)) return;
    knownMsgIds.add(msg.id);
    if (!mine) setTypingVisible(false);
    const profile = profileFor(msg.sender_id);
    const av = avatarHtml(profile, mine ? myName : name);
    const el = document.createElement("div");
    el.className = `wparty__msg ${mine ? "is-me" : ""}`;
    el.dataset.msgId = msg.id;
    el.innerHTML = `
      ${mine ? "" : av}
      <div class="fp-bubble wparty__bubble ${mine ? "is-me" : ""}" data-msg-id="${escapeHtml(
        msg.id
      )}">
        ${mine ? "" : `<span class="wparty__bubble-name">${escapeHtml(name)}</span>`}
        <p class="fp-bubble__text">${escapeHtml(msg.body)}</p>
        <time>${formatTime(msg.created_at)}</time>
        ${reactionsHtml(msg.id, msg.reactions || [])}
        <div class="fp-bubble__tools" hidden>
          <div class="fp-react-bar">
            ${REACTIONS.map(
              (e) =>
                `<button type="button" class="fp-react-pick" data-react="${escapeHtml(
                  msg.id
                )}" data-emoji="${escapeHtml(e)}" aria-label="React ${e}">${e}</button>`
            ).join("")}
          </div>
        </div>
      </div>
      ${mine ? av : ""}
    `;
    comments.appendChild(el);
    while (comments.querySelectorAll(".wparty__msg").length > 80) {
      const first = comments.querySelector(".wparty__msg");
      if (first?.dataset?.msgId) knownMsgIds.delete(first.dataset.msgId);
      first?.remove();
    }
    if (!skipScroll) comments.scrollTop = comments.scrollHeight;
  }

  function displayNameFor(senderId) {
    if (senderId === me.id) return "You";
    if (senderId === party.host_id) {
      return party.host?.display_name || party.host?.email || "Host";
    }
    return party.guest?.display_name || party.guest?.email || "Friend";
  }

  function applyReactionsToDom(rows = []) {
    for (const m of rows) {
      if (!m?.id) continue;
      const bubble = comments.querySelector(
        `.fp-bubble[data-msg-id="${CSS.escape(m.id)}"]`
      );
      if (!bubble) continue;
      const next = reactionsHtml(m.id, m.reactions || []);
      const chips = bubble.querySelector("[data-react-chips]");
      if (chips) {
        if (next) chips.outerHTML = next;
        else chips.remove();
      } else if (next) {
        const time = bubble.querySelector("time");
        if (time) time.insertAdjacentHTML("afterend", next);
        else bubble.insertAdjacentHTML("beforeend", next);
      }
    }
  }

  let hydrateGen = 0;
  let hydrateBusy = false;
  let hydrateQueued = false;

  async function hydrateComments({ reactionsOnly = false } = {}) {
    if (hydrateBusy) {
      hydrateQueued = true;
      return;
    }
    hydrateBusy = true;
    try {
      do {
        hydrateQueued = false;
        const gen = ++hydrateGen;
        const stickBottom =
          comments.scrollHeight - comments.scrollTop - comments.clientHeight <
          80;
        const prevScrollTop = comments.scrollTop;
        const rows = await listWatchPartyMessages(partyId);
        if (gen !== hydrateGen) continue;

        if (reactionsOnly && comments.querySelector(".wparty__msg")) {
          applyReactionsToDom(rows);
          continue;
        }

        comments.innerHTML = "";
        knownMsgIds.clear();
        if (!rows.length) {
          comments.innerHTML = `<p class="muted wparty__chat-empty">Say hi while you watch.</p>`;
          continue;
        }
        for (const m of rows) {
          spawnComment(m, {
            mine: m.sender_id === me.id,
            name: displayNameFor(m.sender_id),
            skipScroll: true,
          });
        }
        if (stickBottom) comments.scrollTop = comments.scrollHeight;
        else comments.scrollTop = prevScrollTop;
      } while (hydrateQueued);
    } catch (_) {
      if (!comments.querySelector(".wparty__msg")) {
        comments.innerHTML = `<p class="muted wparty__chat-empty">Chat unavailable.</p>`;
      }
    } finally {
      hydrateBusy = false;
    }
  }

  const composeInput = form.querySelector('input[name="body"]');
  const composeSpacer = root.querySelector("#wp-compose-spacer");
  const wpartyShell = root.querySelector(".wparty");
  let wpartyLockH = 0;

  const lockPageScroll = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (root.scrollTop) root.scrollTop = 0;
  };

  // Pin compose to the visible viewport above the keyboard so you can see typing.
  const syncWpartyKb = () => {
    const vv = window.visualViewport;
    const layoutH = window.innerHeight;
    const visibleH = vv ? vv.height : layoutH;
    const offsetTop = vv ? vv.offsetTop : 0;
    const covered = Math.max(0, Math.round(layoutH - (offsetTop + visibleH)));
    const kbOpen = covered > 80 || offsetTop > 40;

    document.body.classList.toggle("is-wparty-kb", kbOpen);

    if (!kbOpen) {
      wpartyLockH = 0;
      wpartyShell?.style.removeProperty("height");
      wpartyShell?.style.removeProperty("max-height");
      document.documentElement.style.removeProperty("--wparty-kb-bottom");
      document.documentElement.style.removeProperty("--wparty-compose-h");
      if (composeSpacer) composeSpacer.hidden = true;
      return;
    }

    if (!wpartyLockH && wpartyShell) {
      wpartyLockH =
        Math.round(wpartyShell.getBoundingClientRect().height) || layoutH;
    }
    if (wpartyShell && wpartyLockH) {
      wpartyShell.style.height = `${wpartyLockH}px`;
      wpartyShell.style.maxHeight = `${wpartyLockH}px`;
    }

    // Sit the input on top of the keyboard (visual viewport bottom).
    document.documentElement.style.setProperty(
      "--wparty-kb-bottom",
      `${covered}px`
    );

    const composeH = Math.ceil(form.getBoundingClientRect().height) || 48;
    document.documentElement.style.setProperty(
      "--wparty-compose-h",
      `${composeH}px`
    );
    if (composeSpacer) composeSpacer.hidden = false;

    lockPageScroll();
  };

  const stopTypingPing = () => {
    window.clearTimeout(typingPingTimer);
    typingPingTimer = null;
    if (!amTyping) return;
    amTyping = false;
    partySub?.sendTyping?.({
      typing: false,
      userId: me.id,
      name: myName,
    });
  };

  const pulseTyping = () => {
    if (party.status !== "active" && party.status !== "invited") return;
    partySub?.sendTyping?.({
      typing: true,
      userId: me.id,
      name: myName,
    });
    amTyping = true;
    window.clearTimeout(typingPingTimer);
    typingPingTimer = window.setTimeout(stopTypingPing, 1400);
  };

  comments.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const reactBtn = t.closest("[data-react]");
    if (reactBtn) {
      e.preventDefault();
      e.stopPropagation();
      try {
        await toggleWatchPartyReaction(
          reactBtn.dataset.react,
          reactBtn.dataset.emoji
        );
        // Patch chips only — full remount raced with realtime and reshuffled chat
        await hydrateComments({ reactionsOnly: true });
      } catch (err) {
        alert(err.message || "Could not react");
      }
      return;
    }

    const bubble = t.closest(".fp-bubble[data-msg-id]");
    if (!bubble || !comments.contains(bubble)) return;
    comments.querySelectorAll(".fp-bubble__tools").forEach((el) => {
      if (el.parentElement !== bubble) el.hidden = true;
    });
    const tools = bubble.querySelector(".fp-bubble__tools");
    if (tools) tools.hidden = !tools.hidden;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = String(form.body.value || "").trim();
    if (!text) return;
    if (party.status !== "active" && party.status !== "invited") return;
    stopTypingPing();
    form.body.value = "";
    comments.querySelector(".wparty__chat-empty")?.remove();
    try {
      const msg = await sendWatchPartyMessage(partyId, text);
      spawnComment(msg, { mine: true, name: "You" });
    } catch (err) {
      alert(err.message || "Could not send");
    }
    composeInput?.focus({ preventScroll: true });
    syncWpartyKb();
  });

  composeInput?.addEventListener("input", () => {
    if (String(composeInput.value || "").trim()) pulseTyping();
    else stopTypingPing();
  });

  composeInput?.addEventListener("focus", () => {
    // Freeze height before the keyboard animation resizes the viewport.
    if (wpartyShell && !wpartyLockH) {
      wpartyLockH = Math.round(wpartyShell.getBoundingClientRect().height);
    }
    lockPageScroll();
    [40, 120, 240, 400].forEach((ms) => {
      window.setTimeout(() => {
        syncWpartyKb();
        lockPageScroll();
      }, ms);
    });
  });

  composeInput?.addEventListener("blur", () => {
    stopTypingPing();
    window.setTimeout(syncWpartyKb, 80);
  });

  window.visualViewport?.addEventListener("resize", syncWpartyKb);
  window.visualViewport?.addEventListener("scroll", syncWpartyKb);
  window.addEventListener("resize", syncWpartyKb);

  paintBanner();
  await hydrateComments();

  partySub = subscribeWatchParty(partyId, {
    onParty: async (payload) => {
      // Host End deletes the party (and cascades room chat).
      if (payload?.eventType === "DELETE" || (payload?.old && !payload?.new)) {
        party = {
          ...party,
          status: "ended",
          isHost: party?.host_id === me.id,
          isGuest: party?.guest_id === me.id,
        };
        soloAfterGuestLeft = false;
        wipeRoomChat();
        paintBanner();
        return;
      }
      const row = payload?.new;
      if (!row) {
        try {
          party = await getWatchParty(partyId);
          if (!party) {
            wipeRoomChat();
            party = { status: "ended", isHost: false, isGuest: true };
            paintBanner();
            return;
          }
        } catch (_) {
          wipeRoomChat();
          party = { status: "ended", isHost: false, isGuest: true };
          paintBanner();
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
      comments.querySelector(".wparty__chat-empty")?.remove();
      spawnComment(
        { ...msg, reactions: msg.reactions || [] },
        {
          mine: msg.sender_id === me.id,
          name: displayNameFor(msg.sender_id),
        }
      );
    },
    onReaction: () => {
      hydrateComments({ reactionsOnly: true });
    },
    onTyping: (payload) => {
      if (!payload || payload.userId === me.id) return;
      window.clearTimeout(typingHideTimer);
      if (payload.typing) {
        setTypingVisible(
          true,
          payload.name || otherName || "Friend"
        );
        typingHideTimer = window.setTimeout(
          () => setTypingVisible(false),
          2200
        );
      } else {
        setTypingVisible(false);
      }
    },
  });

  return {
    unmount() {
      stopTypingPing();
      window.clearTimeout(typingHideTimer);
      partySub?.stop?.();
      unsubTime?.();
      window.visualViewport?.removeEventListener("resize", syncWpartyKb);
      window.visualViewport?.removeEventListener("scroll", syncWpartyKb);
      window.removeEventListener("resize", syncWpartyKb);
      document.body.classList.remove("is-wparty-kb");
      wpartyShell?.style.removeProperty("height");
      wpartyShell?.style.removeProperty("max-height");
      document.documentElement.style.removeProperty("--wparty-kb-bottom");
      document.documentElement.style.removeProperty("--wparty-compose-h");
      if (composeSpacer) composeSpacer.hidden = true;
      clearStream();
      teardownChrome();
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
