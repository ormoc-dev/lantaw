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
import { showConfirm, showNotice } from "../lib/appModal.js";
import {
  featuredGifs,
  gifMessageBody,
  hasGifApi,
  parseGifMessage,
  registerGifShare,
  searchGifs,
} from "../lib/giphy.js";

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
  let lastMountedKey = "";
  /** Last sync token the watcher already loaded — ignore heartbeats / UI noise */
  let lastFollowedToken = -1;
  let mountInFlightKey = "";
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
    // Host can use live iframe time; watcher always adopts the host clock from the room row
    if (party?.isHost && lastKnownTimeSec > 0) {
      return Math.floor(lastKnownTimeSec);
    }
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
      <div class="wparty__stage">
        <a class="wparty__back" href="${linkTo("/friends")}" aria-label="Back to Friends">←</a>
        <div class="wparty__player" id="wp-player">
          <p class="muted wparty__waiting" id="wp-waiting">
            <span id="wp-waiting-title">Waiting…</span>
            <span id="wp-waiting-copy"></span>
          </p>
        </div>
      </div>

      <div class="wparty__info">
        <div class="wparty__titles">
          <div class="wparty__titles-main">
            <h1>${escapeHtml(party.title || movie.title || "Room")}</h1>
            <p class="muted wparty__meta" id="wp-meta"></p>
          </div>
          <button
            type="button"
            class="wparty__hint"
            id="wp-sync-hint"
            hidden
            aria-label="Watch tip"
            aria-expanded="false"
            aria-controls="wp-sync-tip"
            title="Watch tip"
          >i</button>
          <p class="wparty__sync-tip" id="wp-sync-tip" hidden role="tooltip">
            Only the host Syncs. Watchers follow that moment automatically.
          </p>
        </div>
        <div class="wparty__controls" id="wp-banner"></div>
      </div>

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
        <div class="wparty__composer" id="wp-composer">
          <div
            class="wparty__gifs"
            id="wp-gifs"
            hidden
            role="listbox"
            aria-label="GIF suggestions"
          ></div>
          <form class="wparty__compose" id="wp-compose" autocomplete="off">
            <button
              type="button"
              class="wparty__gif-btn"
              id="wp-gif-btn"
              aria-label="GIFs"
              aria-pressed="false"
              title="GIFs"
            >GIF</button>
            <input
              type="text"
              name="body"
              maxlength="280"
              placeholder="Aa"
              aria-label="Type a message"
              enterkeyhint="send"
              inputmode="text"
              autocomplete="off"
            />
            <button type="submit" class="wparty__send" id="wp-send" aria-label="Send">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3.4 11.2 20.2 3.8c.7-.3 1.4.4 1.1 1.1L13.9 21.7c-.3.8-1.5.7-1.7-.1l-1.7-7.1-7.1-1.7c-.8-.2-.9-1.4-.1-1.7Z" fill="currentColor"/>
              </svg>
            </button>
          </form>
        </div>
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
  const syncHint = root.querySelector("#wp-sync-hint");
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

  const hasPlayerShell = () =>
    Boolean(playerEl.querySelector("#stream-iframe"));

  const hasLivePlayer = () => {
    const iframe = playerEl.querySelector("#stream-iframe");
    const src = iframe?.getAttribute("src") || "";
    return Boolean(src && src !== "about:blank");
  };

  const closeSyncTip = () => {
    if (syncTip) syncTip.hidden = true;
    syncHint?.setAttribute("aria-expanded", "false");
    syncHint?.classList.remove("is-open");
  };

  const setSyncTipVisible = (visible) => {
    // Only show the info icon while playing — tip opens on tap
    if (syncHint) syncHint.hidden = !visible;
    if (!visible) closeSyncTip();
  };

  syncHint?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!syncTip || syncHint.hidden) return;
    const open = syncTip.hidden;
    syncTip.hidden = !open;
    syncHint.setAttribute("aria-expanded", open ? "true" : "false");
    syncHint.classList.toggle("is-open", open);
  });

  const onDocClickCloseTip = (e) => {
    if (!syncTip || syncTip.hidden) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#wp-sync-hint") || t.closest("#wp-sync-tip")) return;
    closeSyncTip();
  };
  document.addEventListener("click", onDocClickCloseTip);

  const playbackKey = (row) =>
    `${row.playback_state || "idle"}:${Number(row.playback_sync_token || 0)}:${
      row.playback_season || ""
    }:${row.playback_episode || ""}`;

  const syncTokenOf = (row) => Number(row?.playback_sync_token || 0);

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
            lastMountedKey = "";
            mountInFlightKey = "";
            lastFollowedToken = -1;
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
    lastMountedKey = "";
    mountInFlightKey = "";
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
    const key = opts.syncKey || playbackKey(party);
    // Same sync identity already loaded (or loading) → never tear down / refetch
    if (
      !opts.force &&
      key &&
      (key === lastMountedKey || key === mountInFlightKey)
    ) {
      lastAppliedKey = key;
      lastMountedKey = key;
      return;
    }

    // Claim before DOM work so overlapping realtime events can't double-fetch
    mountInFlightKey = key;
    lastMountedKey = key;
    lastAppliedKey = key;
    if (party.isGuest) {
      lastFollowedToken = syncTokenOf(party);
    }

    clearStream();
    stripPlayerDom();
    waiting.hidden = true;
    setSyncTipVisible(true);
    const startAt = Math.max(0, Number(opts.startAt) || 0);
    if (party.isHost) {
      if (startAt <= 0) lastKnownTimeSec = 0;
      else lastKnownTimeSec = Math.max(lastKnownTimeSec, startAt);
    } else {
      lastKnownTimeSec = 0;
    }
    const html = renderStreamPlayer(movie, mediaType, {
      ...opts,
      startAt,
      autoplay: true,
      deferSrc: false,
      // Episode picker lives in the host toolbar, not above the iframe
      omitControls: true,
      readOnly: !party.isHost,
    });
    waiting.insertAdjacentHTML("afterend", html);
    mountInFlightKey = "";

    const frame = playerEl.querySelector(".detail__player-frame--embed");
    if (frame) {
      // Host Start/Sync is the only control. Watcher auto-follows — no tap, no shield.
      cleanupStreamGuard = attachStreamAdGuard(frame, {
        skipShield: true,
        showExit: false,
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
    const token = syncTokenOf(row);

    if (state === "playing") {
      // Host loads only via Start / Sync / Continue / episode Load (force).
      if (party.isHost && !force) {
        lastAppliedKey = key;
        if (!hasLivePlayer() && !hasPlayerShell()) {
          setSyncTipVisible(false);
          setWaiting(
            "Tap Sync to load",
            "Watchers will follow automatically"
          );
        }
        return;
      }

      // Watcher: fetch ONLY when host bumps Sync (new token) or episode changes.
      // Never gate on hasLivePlayer() — it flickers and re-fetched on every heartbeat.
      if (party.isGuest && !force) {
        if (key === lastMountedKey || key === mountInFlightKey) {
          lastAppliedKey = key;
          return;
        }
        // Already following this Sync token (iframe may still be buffering)
        if (token === lastFollowedToken && lastFollowedToken >= 0) {
          lastAppliedKey = key;
          lastMountedKey = key;
          return;
        }
      } else if (!force && (key === lastMountedKey || key === mountInFlightKey)) {
        lastAppliedKey = key;
        return;
      }

      mountPlayer({
        season: row.playback_season || undefined,
        episode: row.playback_episode || undefined,
        startAt: estimatePositionSec(row),
        syncKey: key,
        force: Boolean(force),
      });
      return;
    }

    lastAppliedKey = key;
    lastMountedKey = "";
    mountInFlightKey = "";
    if (party.isGuest) lastFollowedToken = -1;
    setSyncTipVisible(false);
    if (state === "paused") {
      setWaiting(
        "Paused",
        party.isHost
          ? "Tap Continue — watchers will follow"
          : "Waiting for host to continue"
      );
      return;
    }
    setWaiting(
      party.isHost ? "Tap Start" : "Waiting for host",
      party.isHost
        ? `${otherName} will follow automatically`
        : "You’ll jump to wherever they start"
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
        setWaiting("Waiting for guest", "then tap Start");
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
      const playLabel =
        state === "paused" ? "Continue" : state === "playing" ? "Sync" : "Start";
      const playHint =
        state === "paused"
          ? "Continue — watchers jump to your spot automatically"
          : state === "playing"
            ? "Sync everyone to your current moment — watchers follow you"
            : "Start the video — watchers follow automatically";
      banner.innerHTML = `
        <div class="wparty__playback" role="group" aria-label="Watch together controls">
          <button
            type="button"
            class="btn btn--primary"
            id="wp-play"
            title="${escapeHtml(playHint)}"
            aria-label="${escapeHtml(playHint)}"
          >${escapeHtml(playLabel)}</button>
          <button
            type="button"
            class="fp-btn"
            id="wp-pause"
            title="Pause the video for everyone"
            aria-label="Pause for everyone"
            ${state === "playing" ? "" : "hidden"}
          >Pause</button>
          <button
            type="button"
            class="fp-btn"
            id="wp-end"
            title="Close this watch party for everyone"
            aria-label="End watch party"
          >End</button>
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
          // Only host Start / Sync / Continue fetches media; watchers adopt via realtime.
          mountPlayer({
            season: pick.season,
            episode: pick.episode,
            startAt: positionSec,
            force: true,
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
          lastMountedKey = lastAppliedKey;
          mountInFlightKey = "";
          paintBanner();
        } catch (err) {
          setSyncTipVisible(false);
          setWaiting(
            "Couldn’t start",
            err.message || "Try Start again"
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
          lastMountedKey = "";
          mountInFlightKey = "";
          lastFollowedToken = -1;
          paintBanner();
          applyPlayback(party);
        } catch (err) {
          alert(err.message);
        }
      });
      banner.querySelector("#wp-end")?.addEventListener("click", async () => {
        const ok = await showConfirm({
          title: "End watch party?",
          message:
            "This closes the room for everyone and clears the chat. You can’t undo this.",
          confirmLabel: "End party",
          cancelLabel: "Keep watching",
          danger: true,
        });
        if (!ok) return;
        try {
          // Deletes the room + chat so it won’t linger in the Friends lobby.
          await finishPartyAndLeave();
        } catch (err) {
          alert(err.message);
        }
      });
    } else {
      if (metaEl) {
        metaEl.textContent = `Watching · following ${otherName}`;
      }
      banner.innerHTML = `
        <div class="wparty__playback" role="group" aria-label="Watch together controls">
          <button
            type="button"
            class="fp-btn"
            id="wp-leave"
            title="Leave this watch party"
            aria-label="Leave watch party"
          >Leave</button>
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
    // Playback is applied separately — never remount the stream from a banner paint
    // (chat reactions / heartbeats used to re-enter here and refetch the video).
  };

  const REACTIONS = ["👍", "❤️", "😂", "😮", "🔥"];
  /** @type {Map<string, Array<{id?: string, user_id: string, emoji: string}>>} */
  const msgReactions = new Map();

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

  const paintMsgReactions = (msgId) => {
    applyReactionsToDom([
      { id: msgId, reactions: msgReactions.get(msgId) || [] },
    ]);
  };

  /** Instant local toggle — UI updates before the network round-trip. */
  const toggleLocalReaction = (msgId, emoji) => {
    const prev = [...(msgReactions.get(msgId) || [])];
    const idx = prev.findIndex(
      (r) => r.user_id === me.id && r.emoji === emoji
    );
    let next;
    if (idx >= 0) {
      next = prev.filter((_, i) => i !== idx);
    } else {
      next = [
        ...prev,
        {
          id: `local-${Date.now()}`,
          user_id: me.id,
          emoji,
          message_id: msgId,
        },
      ];
    }
    msgReactions.set(msgId, next);
    paintMsgReactions(msgId);
    return { previous: prev, next };
  };

  const applyReactionEvent = (payload) => {
    const eventType = payload?.eventType || payload?.event;
    if (eventType === "INSERT" && payload?.new) {
      const row = payload.new;
      const msgId = row.message_id;
      if (!msgId) return false;
      const list = msgReactions.get(msgId) || [];
      const dup = list.some(
        (r) =>
          r.id === row.id ||
          (r.user_id === row.user_id && r.emoji === row.emoji)
      );
      if (!dup) {
        msgReactions.set(msgId, [
          ...list.filter(
            (r) =>
              !(
                String(r.id || "").startsWith("local-") &&
                r.user_id === row.user_id &&
                r.emoji === row.emoji
              )
          ),
          row,
        ]);
        paintMsgReactions(msgId);
      } else {
        // Replace optimistic local id with server row
        msgReactions.set(
          msgId,
          list.map((r) =>
            r.user_id === row.user_id && r.emoji === row.emoji ? row : r
          )
        );
        paintMsgReactions(msgId);
      }
      return true;
    }
    if (eventType === "DELETE") {
      const old = payload?.old || {};
      const msgId = old.message_id;
      if (msgId) {
        const list = (msgReactions.get(msgId) || []).filter(
          (r) =>
            r.id !== old.id &&
            !(r.user_id === old.user_id && r.emoji === old.emoji)
        );
        msgReactions.set(msgId, list);
        paintMsgReactions(msgId);
        return true;
      }
      if (old.id) {
        for (const [id, list] of msgReactions) {
          const filtered = list.filter((r) => r.id !== old.id);
          if (filtered.length !== list.length) {
            msgReactions.set(id, filtered);
            paintMsgReactions(id);
            return true;
          }
        }
      }
    }
    return false;
  };

  function spawnComment(
    msg,
    { mine = false, name = "Friend", skipScroll = false } = {}
  ) {
    if (!msg?.id || knownMsgIds.has(msg.id)) return;
    knownMsgIds.add(msg.id);
    msgReactions.set(
      msg.id,
      Array.isArray(msg.reactions) ? [...msg.reactions] : []
    );
    if (!mine) setTypingVisible(false);
    const profile = profileFor(msg.sender_id);
    const av = avatarHtml(profile, mine ? myName : name);
    const el = document.createElement("div");
    el.className = `wparty__msg ${mine ? "is-me" : ""}`;
    el.dataset.msgId = msg.id;
    const gifUrl = parseGifMessage(msg.body);
    el.innerHTML = `
      ${mine ? "" : av}
      <div class="fp-bubble wparty__bubble ${mine ? "is-me" : ""}${
        gifUrl ? " is-gif" : ""
      }" data-msg-id="${escapeHtml(msg.id)}">
        ${
          mine
            ? ""
            : `<span class="wparty__bubble-name">${escapeHtml(name)}</span>`
        }
        ${
          gifUrl
            ? `<img class="fp-bubble__gif wparty__gif" src="${escapeHtml(
                gifUrl
              )}" alt="GIF" loading="lazy" decoding="async" />`
            : `<p class="fp-bubble__text">${escapeHtml(msg.body)}</p>`
        }
        <time>${formatTime(msg.created_at)}</time>
        ${reactionsHtml(msg.id, msgReactions.get(msg.id) || [])}
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
      if (first?.dataset?.msgId) {
        knownMsgIds.delete(first.dataset.msgId);
        msgReactions.delete(first.dataset.msgId);
      }
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
      if (Array.isArray(m.reactions)) {
        msgReactions.set(m.id, [...m.reactions]);
      }
      const bubble = comments.querySelector(
        `.fp-bubble[data-msg-id="${CSS.escape(m.id)}"]`
      );
      if (!bubble) continue;
      const next = reactionsHtml(m.id, msgReactions.get(m.id) || []);
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
        msgReactions.clear();
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
  const composeSend = form.querySelector("#wp-send");
  const composeSpacer = root.querySelector("#wp-compose-spacer");
  const composer = root.querySelector("#wp-composer");
  const gifBtn = root.querySelector("#wp-gif-btn");
  const gifStrip = root.querySelector("#wp-gifs");
  const wpartyShell = root.querySelector(".wparty");
  let inputFocused = false;
  let kbPollTimer = null;
  let gifOpen = false;
  let gifTimer = 0;
  let gifReq = 0;
  let sendingGif = false;

  const hideGifStrip = () => {
    gifOpen = false;
    gifBtn?.setAttribute("aria-pressed", "false");
    gifBtn?.classList.remove("is-on");
    if (gifStrip) {
      gifStrip.hidden = true;
      gifStrip.innerHTML = "";
    }
  };

  const paintGifStrip = (items, query = "") => {
    if (!gifStrip) return;
    const label = String(query || "").trim()
      ? `Results for “${String(query).trim()}”`
      : "Trending GIFs";
    if (!items?.length) {
      gifStrip.innerHTML = `
        <div class="wparty__gifs-head">
          <strong>${escapeHtml(label)}</strong>
          <button type="button" class="wparty__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
        </div>
        <p class="wparty__gifs-empty">No GIFs found</p>`;
      gifStrip.hidden = false;
      return;
    }
    gifStrip.innerHTML = `
      <div class="wparty__gifs-head">
        <strong>${escapeHtml(label)}</strong>
        <span class="wparty__gifs-via">GIPHY</span>
        <button type="button" class="wparty__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
      </div>
      <div class="wparty__gifs-rail" role="presentation">
        ${items
          .map(
            (g) => `
          <button
            type="button"
            class="wparty__gif-pick"
            role="option"
            data-gif-url="${escapeHtml(g.url)}"
            data-gif-id="${escapeHtml(g.id)}"
            title="${escapeHtml(g.title)}"
            aria-label="${escapeHtml(g.title)}"
          >
            <img src="${escapeHtml(g.preview)}" alt="" loading="lazy" decoding="async" />
          </button>`
          )
          .join("")}
      </div>`;
    gifStrip.hidden = false;
    gifOpen = true;
    gifBtn?.setAttribute("aria-pressed", "true");
    gifBtn?.classList.add("is-on");
  };

  const loadGifs = async (query) => {
    if (!hasGifApi() || !gifStrip) return;
    const req = ++gifReq;
    const q = String(query || "").trim();
    gifStrip.hidden = false;
    gifStrip.innerHTML = `
      <div class="wparty__gifs-head">
        <strong>${q ? `Results for “${escapeHtml(q)}”` : "Trending GIFs"}</strong>
        <button type="button" class="wparty__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
      </div>
      <p class="wparty__gifs-empty">Searching…</p>`;
    gifOpen = true;
    gifBtn?.setAttribute("aria-pressed", "true");
    gifBtn?.classList.add("is-on");
    try {
      const items = await searchGifs(q);
      if (req !== gifReq) return;
      paintGifStrip(items, q);
    } catch {
      if (req !== gifReq) return;
      gifStrip.innerHTML = `
        <div class="wparty__gifs-head">
          <strong>GIFs</strong>
          <button type="button" class="wparty__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
        </div>
        <p class="wparty__gifs-empty">Couldn’t load GIFs</p>`;
    }
  };

  const scheduleGifSuggest = () => {
    if (!hasGifApi()) return;
    clearTimeout(gifTimer);
    const q = String(composeInput?.value || "").trim();
    if (!q) {
      if (gifOpen) loadGifs("");
      else hideGifStrip();
      return;
    }
    if (q.length < 2 || q.length > 40 || /\s{2,}/.test(q) || q.split(/\s+/).length > 4) {
      if (gifOpen) hideGifStrip();
      return;
    }
    gifTimer = setTimeout(() => loadGifs(q), 320);
  };

  const lockPageScroll = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (root.scrollTop) root.scrollTop = 0;
  };

  const keyboardInset = () => {
    const vv = window.visualViewport;
    if (!vv) return 0;
    // Space covered by the keyboard (layout bottom → visual bottom)
    return Math.max(
      0,
      Math.round(window.innerHeight - vv.height - vv.offsetTop)
    );
  };

  // Prefer overlay keyboard so visualViewport reports the real inset
  try {
    if (navigator.virtualKeyboard) {
      navigator.virtualKeyboard.overlaysContent = true;
    }
  } catch {
    /* unsupported */
  }

  const syncSendReady = () => {
    if (!composeSend) return;
    const hasText = Boolean(String(composeInput?.value || "").trim());
    composeSend.disabled = !hasText;
    composeSend.classList.toggle("is-ready", hasText);
  };
  syncSendReady();

  // Pin compose above the mobile keyboard so typing stays visible.
  const syncWpartyKb = () => {
    const vv = window.visualViewport;
    const layoutH = window.innerHeight;
    const inset = keyboardInset();
    const shrunk = vv ? layoutH - vv.height > 50 : false;
    const kbOpen =
      inset > 40 ||
      shrunk ||
      (inputFocused && vv && vv.height / layoutH < 0.92) ||
      (inputFocused && inset > 0);

    document.body.classList.toggle("is-wparty-kb", kbOpen || inputFocused);

    if (!kbOpen && !inputFocused) {
      // Never resize .wparty while a stream is up — height changes reload the iframe
      document.documentElement.style.removeProperty("--wparty-kb-bottom");
      document.documentElement.style.removeProperty("--wparty-compose-h");
      form?.style.removeProperty("bottom");
      composer?.style.removeProperty("bottom");
      if (composeSpacer) composeSpacer.hidden = true;
      return;
    }

    // Pin compose only — do not change shell/player height (that refetches CineSrc)
    const bottom = Math.max(inset, inputFocused && inset < 40 ? 0 : inset);
    document.documentElement.style.setProperty(
      "--wparty-kb-bottom",
      `${bottom}px`
    );
    // Inline bottom as a hard fallback (some WebViews ignore the CSS var)
    if (composer) composer.style.bottom = `${bottom}px`;
    else if (form) form.style.bottom = `${bottom}px`;

    const composeH =
      Math.ceil(
        composer?.getBoundingClientRect().height ||
          form?.getBoundingClientRect().height ||
          0
      ) || 52;
    document.documentElement.style.setProperty(
      "--wparty-compose-h",
      `${composeH}px`
    );
    if (composeSpacer) composeSpacer.hidden = false;

    lockPageScroll();
    requestAnimationFrame(() => {
      comments.scrollTop = comments.scrollHeight;
    });
  };

  const startKbPoll = () => {
    clearInterval(kbPollTimer);
    let ticks = 0;
    kbPollTimer = setInterval(() => {
      syncWpartyKb();
      ticks += 1;
      if (ticks >= 20 || (!inputFocused && keyboardInset() < 40)) {
        clearInterval(kbPollTimer);
        kbPollTimer = null;
      }
    }, 50);
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
      const msgId = reactBtn.dataset.react;
      const emoji = reactBtn.dataset.emoji;
      if (!msgId || !emoji) return;
      // Close the picker immediately and paint the chip before any network wait
      const tools = reactBtn.closest(".fp-bubble")?.querySelector(
        ".fp-bubble__tools"
      );
      if (tools) tools.hidden = true;
      const { previous } = toggleLocalReaction(msgId, emoji);
      try {
        await toggleWatchPartyReaction(msgId, emoji);
      } catch (err) {
        msgReactions.set(msgId, previous);
        paintMsgReactions(msgId);
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

  const sendWpChat = async (rawBody) => {
    if (sendingGif) return;
    const text = String(rawBody ?? form.body?.value ?? "").trim();
    if (!text) return;
    if (party.status !== "active" && party.status !== "invited") return;
    sendingGif = true;
    stopTypingPing();
    clearTimeout(gifTimer);
    hideGifStrip();
    if (form.body) form.body.value = "";
    syncSendReady();
    comments.querySelector(".wparty__chat-empty")?.remove();
    try {
      const msg = await sendWatchPartyMessage(partyId, text);
      spawnComment(msg, { mine: true, name: "You" });
    } catch (err) {
      if (!parseGifMessage(text) && form.body) form.body.value = text;
      alert(err.message || "Could not send");
    } finally {
      sendingGif = false;
      syncSendReady();
      composeInput?.focus({ preventScroll: true });
      syncWpartyKb();
    }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendWpChat();
  });

  gifBtn?.addEventListener("click", async () => {
    if (!hasGifApi()) {
      showNotice({
        title: "GIFs",
        message:
          "Add VITE_GIPHY_API_KEY to your .env — create a free key at https://developers.giphy.com/dashboard/ then run npm run sync-env.",
      });
      return;
    }
    if (gifOpen) {
      hideGifStrip();
      return;
    }
    const q = String(composeInput?.value || "").trim();
    await loadGifs(q.length >= 2 ? q : "");
  });

  gifStrip?.addEventListener("click", (e) => {
    if (e.target.closest("[data-gif-close]")) {
      e.preventDefault();
      hideGifStrip();
      return;
    }
    const pick = e.target.closest("[data-gif-url]");
    if (!pick) return;
    e.preventDefault();
    const url = pick.getAttribute("data-gif-url");
    if (!url) return;
    registerGifShare(
      pick.getAttribute("data-gif-id") || "",
      String(composeInput?.value || "").trim()
    );
    sendWpChat(gifMessageBody(url));
  });

  composeInput?.addEventListener("input", () => {
    syncSendReady();
    if (String(composeInput.value || "").trim()) pulseTyping();
    else stopTypingPing();
    scheduleGifSuggest();
  });

  composeInput?.addEventListener("focus", () => {
    inputFocused = true;
    // Lift immediately so the bar isn’t trapped under the rising keyboard
    document.body.classList.add("is-wparty-kb");
    lockPageScroll();
    syncWpartyKb();
    startKbPoll();
    [80, 160, 280, 450, 700].forEach((ms) => {
      window.setTimeout(() => {
        if (!inputFocused) return;
        syncWpartyKb();
        lockPageScroll();
        comments.scrollTop = comments.scrollHeight;
      }, ms);
    });
  });

  composeInput?.addEventListener("blur", () => {
    inputFocused = false;
    stopTypingPing();
    window.setTimeout(() => {
      if (inputFocused) return;
      syncWpartyKb();
    }, 120);
  });

  window.visualViewport?.addEventListener("resize", syncWpartyKb);
  window.visualViewport?.addEventListener("scroll", syncWpartyKb);
  window.addEventListener("resize", syncWpartyKb);

  // Mobile freezes/reloads embeds when switching apps. We can't keep the
  // iframe playing in the background, but we can resume at the right time.
  let backgroundedAt = 0;
  const persistHostPosition = () => {
    if (!party?.isHost || party.status !== "active") return;
    if ((party.playback_state || "idle") !== "playing") return;
    const pos = estimatePositionSec(party);
    if (pos <= 0) return;
    lastKnownTimeSec = pos;
    updateWatchPartyPlayback(partyId, {
      state: "playing",
      bumpSync: false,
      positionSec: pos,
      season: party.playback_season,
      episode: party.playback_episode,
    })
      .then((updated) => {
        if (!updated) return;
        party = {
          ...party,
          ...updated,
          isHost: true,
          isGuest: false,
        };
      })
      .catch(() => {});
  };

  const resumeAfterBackground = () => {
    if (!party || party.status !== "active") return;
    if ((party.playback_state || "idle") !== "playing") return;
    // Watcher: never refetch on tab focus — only host Sync bumps the token.
    // Host: remount only if the iframe was destroyed while away.
    if (party.isGuest) return;
    if (hasPlayerShell()) return;
    const startAt = estimatePositionSec(party);
    const key = playbackKey(party);
    mountPlayer({
      season: party.playback_season || undefined,
      episode: party.playback_episode || undefined,
      startAt,
      syncKey: key,
      force: true,
    });
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      backgroundedAt = Date.now();
      persistHostPosition();
      return;
    }
    const awayMs = backgroundedAt ? Date.now() - backgroundedAt : 0;
    backgroundedAt = 0;
    // Brief blurs (notification shade) — leave the player alone
    if (awayMs < 1200) return;
    resumeAfterBackground();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", persistHostPosition);

  // Soft heartbeat so a return-from-background seek has a fresher checkpoint
  const positionHeartbeat = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    persistHostPosition();
  }, 45000);

  paintBanner();
  // Host: idle/waiting until they press Start (applyPlayback no-ops mount).
  // Watcher: one adopt when host is already playing — further fetches need a new Sync token.
  // Do not remount this view on auth INITIAL_SESSION (router guards that) or the embed refetches.
  applyPlayback(party);
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
        applyPlayback(party);
        return;
      }
      const prevStatus = party?.status;
      const prevKey = playbackKey(party);
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
      const nextKey = playbackKey(party);
      const statusChanged = prevStatus !== party.status;
      const playbackChanged = prevKey !== nextKey;
      // Position heartbeats must not remount. Watcher only reacts to sync-token changes.
      if (playbackChanged) {
        paintBanner();
        applyPlayback(party);
      } else if (statusChanged) {
        paintBanner();
        applyPlayback(party);
      } else if (metaEl && party.status === "active") {
        metaEl.textContent = party.isHost
          ? `Host · ${otherName} follows`
          : `Watching · following ${otherName}`;
      }
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
    onReaction: (payload) => {
      // Reactions must never touch playback — patch chips only
      const msgId =
        payload?.new?.message_id || payload?.old?.message_id || null;
      if (msgId && !knownMsgIds.has(msgId) && !msgReactions.has(msgId)) {
        return;
      }
      if (!applyReactionEvent(payload)) {
        hydrateComments({ reactionsOnly: true });
      }
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
      clearInterval(kbPollTimer);
      kbPollTimer = null;
      clearInterval(positionHeartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onDocClickCloseTip);
      window.removeEventListener("pagehide", persistHostPosition);
      partySub?.stop?.();
      unsubTime?.();
      window.visualViewport?.removeEventListener("resize", syncWpartyKb);
      window.visualViewport?.removeEventListener("scroll", syncWpartyKb);
      window.removeEventListener("resize", syncWpartyKb);
      document.body.classList.remove("is-wparty-kb");
      wpartyShell?.style.removeProperty("height");
      wpartyShell?.style.removeProperty("max-height");
      form?.style.removeProperty("bottom");
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
