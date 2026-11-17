import {
  avatarFromUser,
  displayNameFromUser,
  getUser,
  resolveUserProfile,
} from "../services/authService.js";
import { addRecentMovie, getRecentMovies } from "../services/recentService.js";
import { getSupabase } from "../lib/supabase.js";
import {
  createWatchParty,
  getFriendsActivityCounts,
  listChatPreviews,
  listFriendships,
  listMessages,
  listWatchParties,
  markChatRead,
  getPeerChatReadAt,
  partyWatchPath,
  removeFriendship,
  respondToFriendRequest,
  searchProfiles,
  listSuggestedProfiles,
  notifyFriendsBadge,
  sendFriendRequest,
  sendMessage,
  editMessage,
  deleteMessageForMe,
  deleteMessageForEveryone,
  toggleMessageReaction,
  subscribeFriendsRealtime,
  endWatchParty,
  updateWatchPartyStatus,
  deleteWatchParty,
} from "../services/friendsService.js";
import {
  isUserOnline,
  onPresenceChange,
  presenceLabelFor,
  rememberLastSeen,
  startPresence,
} from "../services/presenceService.js";
import {
  listFriendsWatching,
  pruneWatchingMap,
  watchingTitlePath,
} from "../services/watchingService.js";
import { listFriendNotes, saveFriendNote } from "../services/friendNoteService.js";
import { listActivityNotices } from "../services/activityNoticeService.js";
import { getFriendProfile } from "../services/friendProfileService.js";
import { startVideoCall } from "../services/callService.js";
import { showConfirm, showNotice } from "../lib/appModal.js";
import { loadingHtml } from "../components/Loading.js";
import { peopleCardsHtml } from "../components/PeopleYouMayKnow.js?v=141";
import { linkTo } from "../router/index.js";
import { idbGet, idbSet } from "../lib/idbCache.js";
import {
  featuredGifs,
  gifMessageBody,
  hasGifApi,
  parseGifMessage,
  registerGifShare,
  searchGifs,
} from "../lib/giphy.js";
import { parseShareMessage, shareMessageBody } from "../lib/shareMessage.js";
import {
  parseReplyEnvelope,
  unwrapReplyBody,
  wrapReplyMessage,
} from "../lib/replyMessage.js";
import {
  ACTIVITY_NOTICE_EVENT,
  enableNotifications,
  notificationPermission,
} from "../services/notifyService.js";
import { wasNotifyAsked } from "../lib/appNotify.js";

export async function FriendsView(root) {
  const me = await getUser();
  if (!me) {
    root.innerHTML = `<p class="muted">Sign in to use Friends.</p>`;
    return { unmount() {} };
  }

  // Ask once for Chrome notifications when opening Friends
  if (notificationPermission() === "default" && !wasNotifyAsked()) {
    enableNotifications().catch(() => {});
  }

  let tab = "chat";
  let pendingWatchMedia = null;
  let pendingShare = null;
  try {
    const fromShorts = sessionStorage.getItem("lantaw-shorts-watch");
    if (fromShorts) {
      tab = "watch";
      try {
        pendingWatchMedia = JSON.parse(fromShorts);
      } catch {
        pendingWatchMedia = null;
      }
      sessionStorage.removeItem("lantaw-shorts-watch");
    }
  } catch {
    /* ignore */
  }
  try {
    const rawShare = sessionStorage.getItem("lantaw-share-pending");
    if (rawShare) {
      pendingShare = JSON.parse(rawShare);
      if (!pendingShare?.id) pendingShare = null;
      else tab = "chat";
    }
  } catch {
    pendingShare = null;
  }

  const clearPendingShare = () => {
    pendingShare = null;
    try {
      sessionStorage.removeItem("lantaw-share-pending");
    } catch {
      /* ignore */
    }
  };
  try {
    if (tab === "chat") {
      const jump = sessionStorage.getItem("lantaw-friends-tab");
      if (jump === "friends" || jump === "watch" || jump === "chat") {
        sessionStorage.removeItem("lantaw-friends-tab");
        tab = jump;
      }
    }
  } catch {
    /* ignore */
  }
  let friendships = [];
  let parties = [];
  /** @type {Record<string, object>} */
  let watchingByUser = {};
  let activity = { requests: 0, chats: 0, invites: 0, chatIds: [] };
  let chatPreviews = {};
  /** @type {Record<string, { user_id: string, body: string, updated_at: string }>} */
  let friendNotes = {};
  let notices = [];
  let noteComposer = false;
  let noteHistory = false;
  let meCard = {
    id: me.id,
    display_name: displayNameFromUser(me),
    avatar_url: avatarFromUser(me),
  };
  resolveUserProfile(me)
    .then((profile) => {
      meCard = {
        id: me.id,
        display_name: profile?.name || meCard.display_name,
        avatar_url: profile?.avatar || meCard.avatar_url,
      };
      paintPeopleRow();
    })
    .catch(() => {});

  function chatIdFromHash() {
    const qs = (location.hash.replace(/^#/, "") || "").split("?")[1] || "";
    const id = new URLSearchParams(qs).get("chat") || "";
    return /^[A-Za-z0-9-]{8,80}$/.test(id) ? id : null;
  }

  let activeChatId = tab === "chat" ? chatIdFromHash() : null;
  /** Peer’s last_read_at for the open thread (synced seen receipts). */
  let peerReadAt = null;

  const syncChatUrl = () => {
    const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    if (path !== "/friends") return;
    const params = new URLSearchParams(
      (location.hash.replace(/^#/, "") || "").split("?")[1] || ""
    );
    if (tab === "chat" && activeChatId) params.set("chat", activeChatId);
    else params.delete("chat");
    const qs = params.toString();
    const next = `#/friends${qs ? `?${qs}` : ""}`;
    if (location.hash === next) return;
    history.replaceState(history.state, "", `${location.pathname}${location.search}${next}`);
  };
  let unsubChat = null;
  let unsubPage = null;
  let unsubWatchDoc = null;
  let unsubChatVv = null;
  let unsubPresence = null;
  let liveTimer = null;
  let liveBusy = false;
  let liveQueued = false;
  let chatPaint = null;
  let lastThreadPaintKey = "";
  let inboxFetchToken = 0;
  let peerIsTyping = false;

  startPresence().catch(() => {});

  const syncPresenceUi = () => {
    page.querySelectorAll("[data-presence-id]").forEach((el) => {
      const id = el.dataset.presenceId;
      const on = isUserOnline(id);
      el.classList.toggle("is-online", on || peerIsTyping);
      const inThread = Boolean(el.closest(".fp-chat__head"));
      const onLabel =
        inThread && peerIsTyping
          ? "Typing…"
          : inThread
            ? "Active now"
            : "Online";
      const offLabel = presenceLabelFor(id, { onlineText: "Online" });
      const showOn = on || (inThread && peerIsTyping);
      const text = showOn ? onLabel : offLabel === "Online" ? "Offline" : offLabel;
      el.setAttribute("title", text);
      el.setAttribute("aria-label", text);
      const label = el.querySelector("[data-presence-label]");
      if (label) {
        label.textContent = text;
        label.classList.toggle("is-online", showOn);
        label.classList.toggle("is-typing", inThread && peerIsTyping);
      }
    });
  };

  /** Drop Watching-now chips when a friend goes offline or the row goes stale. */
  const syncWatchingPresence = () => {
    const before = Object.keys(watchingByUser).length;
    pruneWatchingMap(watchingByUser, { isOnline: isUserOnline });
    const changed = Object.keys(watchingByUser).length !== before;
    syncPresenceUi();
    if (tab === "chat") {
      paintInboxList();
      if (!activeChatId) paintPeopleRow();
    } else if (tab === "friends") {
      try {
        paintPeopleLists?.();
      } catch {
        /* people helpers may not exist until that tab mounts */
      }
    }
    if (changed) writeInboxSnapshot();
  };

  const page = document.createElement("div");
  page.className = "page-pad friends-page";
  root.innerHTML = "";
  root.appendChild(page);

  const clearChatViewport = () => {
    unsubChatVv?.();
    root.style.removeProperty("--friends-chat-vh");
    root.style.removeProperty("transform");
    document.documentElement.style.removeProperty("--friends-kb-bottom");
    document.documentElement.style.removeProperty("--friends-compose-h");
    document.body.classList.remove("is-friends-chat-kb");
    const spacer = root.querySelector("#chat-compose-spacer");
    if (spacer) spacer.hidden = true;
  };

  const syncChatLock = () => {
    // Full-bleed chat chrome only inside an open thread (Messenger-style).
    const locked = tab === "chat" && Boolean(activeChatId);
    const inbox = tab === "chat" && !activeChatId && !noteComposer;
    page.classList.toggle("friends-page--chat", locked);
    page.classList.toggle("friends-page--inbox", inbox);
    page.classList.toggle("friends-page--note", noteComposer);
    root.classList.toggle("view--friends-chat", locked);
    root.classList.toggle("view--note", noteComposer);
    document.body.classList.toggle("is-friends-chat", locked);
    document.body.classList.toggle("is-note-page", noteComposer);
    if (!locked) clearChatViewport();
    syncChatUrl();
  };

  const avatarHtml = (p, sizeClass = "") => {
    const name = p?.display_name || p?.email || "?";
    const initial = name.slice(0, 1).toUpperCase();
    if (p?.avatar_url) {
      return `<img class="fp-avatar ${sizeClass}" src="${escapeHtml(
        p.avatar_url
      )}" alt="" referrerpolicy="no-referrer" />`;
    }
    return `<span class="fp-avatar fp-avatar--fallback ${sizeClass}">${escapeHtml(
      initial
    )}</span>`;
  };

  const presenceAvatarHtml = (p, sizeClass = "") => {
    if (!p?.id) return avatarHtml(p, sizeClass);
    const on = isUserOnline(p.id);
    return `
      <span
        class="fp-presence ${on ? "is-online" : ""}"
        data-presence-id="${escapeHtml(p.id)}"
        title="${on ? "Online" : "Offline"}"
        aria-label="${on ? "Online" : "Offline"}"
      >
        ${avatarHtml(p, sizeClass)}
        <i class="fp-presence__dot" aria-hidden="true"></i>
      </span>
    `;
  };

  const emptyState = (title, text) => `
    <div class="fp-empty">
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">${escapeHtml(text)}</p>
    </div>
  `;

  const formatConvoTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate()
    ) {
      return "Yesterday";
    }
    const weekAgo = now.getTime() - 6 * 24 * 60 * 60 * 1000;
    if (d.getTime() >= weekAgo) {
      return d.toLocaleDateString([], { weekday: "short" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const chatBodyPreview = (rawBody) => {
    const inner = unwrapReplyBody(rawBody);
    if (parseGifMessage(inner)) return "GIF";
    const shared = parseShareMessage(inner);
    if (shared) {
      const label = shared.title || "a title";
      return `Shared ${label.length > 40 ? `${label.slice(0, 39)}…` : label}`;
    }
    return String(inner || "").replace(/\s+/g, " ").trim();
  };

  const previewLine = (preview) => {
    if (!preview?.body && !preview?.deleted_at) return "Tap to say hi";
    const mine = preview.sender_id === me.id;
    if (preview.deleted_at) {
      return mine ? "You deleted a message" : "Message deleted";
    }
    const text = chatBodyPreview(preview.body);
    if (!text) return "Tap to say hi";
    const clipped = text.length > 64 ? `${text.slice(0, 63)}…` : text;
    return mine ? `You: ${clipped}` : clipped;
  };

  const watchingPartyFor = (friendshipId) =>
    parties.find(
      (p) =>
        p.friendship_id === friendshipId &&
        (p.status === "active" || p.status === "invited")
    ) || null;

  const soloWatchingFor = (userId) => {
    if (!userId) return null;
    // Offline friends never show a live “Watching now” chip.
    if (!isUserOnline(userId)) return null;
    const row = watchingByUser[userId];
    if (!row) return null;
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (!Number.isFinite(age) || age > 6 * 60 * 1000) {
      delete watchingByUser[userId];
      return null;
    }
    return row;
  };

  const sortedInboxFriends = (accepted, previews = chatPreviews) =>
    [...accepted].sort((a, b) => {
      const wa = watchingPartyFor(a.id);
      const wb = watchingPartyFor(b.id);
      const sa = soloWatchingFor(a.other?.id);
      const sb = soloWatchingFor(b.other?.id);
      const waRank = wa?.status === "active" ? 3 : wa ? 2 : sa ? 1 : 0;
      const wbRank = wb?.status === "active" ? 3 : wb ? 2 : sb ? 1 : 0;
      if (waRank !== wbRank) return wbRank - waRank;
      const pa = previews[a.id];
      const pb = previews[b.id];
      const ta = pa?.created_at ? new Date(pa.created_at).getTime() : 0;
      const tb = pb?.created_at ? new Date(pb.created_at).getTime() : 0;
      if (ta !== tb) return tb - ta;
      const oa = isUserOnline(a.other?.id) ? 1 : 0;
      const ob = isUserOnline(b.other?.id) ? 1 : 0;
      if (oa !== ob) return ob - oa;
      const na = (a.other?.display_name || a.other?.email || "").toLowerCase();
      const nb = (b.other?.display_name || b.other?.email || "").toLowerCase();
      return na.localeCompare(nb);
    });

  const convoListHtml = (
    accepted,
    previews = chatPreviews,
    { activeId = null } = {}
  ) =>
    sortedInboxFriends(accepted, previews)
      .map((f) => {
        const on = isUserOnline(f.other?.id);
        const unread = activity.chatIds?.includes(f.id);
        const preview = previews[f.id];
        const hasChat = Boolean(preview);
        const watching = watchingPartyFor(f.id);
        const watchingActive = watching?.status === "active";
        const solo = !watching ? soloWatchingFor(f.other?.id) : null;
        const isActive = activeId && f.id === activeId;
        return `
        <div
          class="fp-convo-wrap ${watching || solo ? "is-watching" : ""} ${
            watchingActive || solo ? "is-watching-live" : ""
          } ${isActive ? "is-active" : ""}"
          role="listitem"
        >
          <button type="button" class="fp-convo ${
            unread ? "has-unread" : ""
          } ${hasChat ? "has-chat" : ""} ${
            isActive ? "is-active" : ""
          }" data-open-chat="${f.id}" ${
            isActive ? 'aria-current="page"' : ""
          }>
            <span
              class="fp-convo__avatar"
              role="button"
              tabindex="0"
              data-open-profile="${f.id}"
              aria-label="View profile"
            >${presenceAvatarHtml(f.other)}</span>
            <span class="fp-convo__meta">
              <span class="fp-convo__top">
                <strong>${escapeHtml(
                  f.other?.display_name || f.other?.email || "Friend"
                )}</strong>
                ${
                  hasChat
                    ? `<time class="fp-convo__time">${escapeHtml(
                        formatConvoTime(preview.created_at)
                      )}</time>`
                    : ""
                }
              </span>
              <span class="fp-convo__preview ${unread ? "is-unread" : ""}">
                ${
                  hasChat
                    ? escapeHtml(previewLine(preview))
                    : solo
                      ? `<em class="fp-watching-inline">Watching ${escapeHtml(
                          solo.title || "something"
                        )}</em>`
                    : `<em class="fp-presence-label ${
                        on ? "is-online" : ""
                      }" data-presence-id="${escapeHtml(
                        f.other?.id || ""
                      )}"><span data-presence-label>${escapeHtml(
                        on
                          ? "Active now"
                          : presenceLabelFor(f.other?.id, {
                              onlineText: "Active now",
                            })
                      )}</span></em>`
                }
              </span>
            </span>
            ${
              unread
                ? `<i class="fp-convo__unread" aria-label="Unread"></i>`
                : `<span class="fp-convo__chev" aria-hidden="true"></span>`
            }
          </button>
          ${
            watching
              ? `<button
                  type="button"
                  class="fp-convo__watching ${
                    watchingActive ? "is-live" : ""
                  }"
                  data-open-party="${escapeHtml(watching.id)}"
                >
                  ${
                    watching.poster
                      ? `<img src="${escapeHtml(watching.poster)}" alt="" />`
                      : `<span class="fp-convo__watching-ph" aria-hidden="true">▶</span>`
                  }
                  <span class="fp-convo__watching-text">
                    <strong>${
                      watchingActive ? "Watching now" : "Watch invite"
                    }</strong>
                    <em>${escapeHtml(watching.title || "a title")}</em>
                  </span>
                  <span class="fp-convo__watching-cta">${
                    watchingActive ? "Join" : "Open"
                  }</span>
                </button>`
              : solo
                ? `<a
                    class="fp-convo__watching is-live"
                    href="${linkTo(watchingTitlePath(solo))}"
                  >
                    ${
                      solo.poster
                        ? `<img src="${escapeHtml(solo.poster)}" alt="" />`
                        : `<span class="fp-convo__watching-ph" aria-hidden="true">▶</span>`
                    }
                    <span class="fp-convo__watching-text">
                      <strong>Watching now</strong>
                      <em>${escapeHtml(solo.title || "a title")}</em>
                    </span>
                    <span class="fp-convo__watching-cta">View</span>
                  </a>`
                : ""
          }
        </div>`;
      })
      .join("");

  const inboxPaintKey = (accepted, previews = chatPreviews) =>
    sortedInboxFriends(accepted, previews)
      .map((f) => {
        const p = previews[f.id];
        const w = watchingPartyFor(f.id);
        const s = soloWatchingFor(f.other?.id);
        const unread = activity.chatIds?.includes(f.id) ? "1" : "0";
        return `${f.id}:${p?.id || ""}:${p?.created_at || ""}:${unread}:${
          isUserOnline(f.other?.id) ? "1" : "0"
        }:${w?.id || ""}:${w?.status || ""}:${s?.tmdb_id || ""}:${
          s?.updated_at || ""
        }`;
      })
      .join("|");

  const closeFriendProfile = () => {
    page.querySelector("#friend-profile")?.remove();
  };

  const formatViewedAt = (iso) => {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return "just now";
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
    try {
      return new Date(t).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const openFriendProfile = async (friendshipId) => {
    const friendship =
      friendships.find((f) => f.id === friendshipId && f.status === "accepted") ||
      null;
    const userId = friendship?.other?.id || friendship?.otherId;
    if (!userId) return;

    closeFriendProfile();
    const shell = document.createElement("div");
    shell.id = "friend-profile";
    shell.className = "fp-profile";
    shell.innerHTML = `
      <button type="button" class="fp-profile__backdrop" data-profile-close aria-label="Close"></button>
      <div class="fp-profile__sheet" role="dialog" aria-modal="true" aria-label="Friend profile">
        <div class="fp-profile__grab" aria-hidden="true"></div>
        <header class="fp-profile__head">
          ${presenceAvatarHtml(friendship.other, "fp-avatar--lg")}
          <div class="fp-profile__identity">
            <strong>${escapeHtml(
              friendship.other?.display_name || friendship.other?.email || "Friend"
            )}</strong>
            <span
              class="fp-presence-label ${
                isUserOnline(userId) ? "is-online" : ""
              }"
              data-presence-id="${escapeHtml(userId)}"
            ><em data-presence-label>${escapeHtml(
              presenceLabelFor(userId, { onlineText: "Active now" })
            )}</em></span>
          </div>
          <button type="button" class="fp-icon-btn" data-profile-close aria-label="Close">✕</button>
        </header>
        <div class="fp-profile__body">
          ${loadingHtml({ className: "fp-profile__loading", size: "sm" })}
        </div>
        <div class="fp-profile__actions">
          <button type="button" class="fp-btn fp-btn--solid" data-profile-chat="${escapeHtml(
            friendshipId
          )}">Message</button>
          <button type="button" class="fp-btn" data-profile-watch="${escapeHtml(
            friendshipId
          )}">Watch together</button>
        </div>
      </div>
    `;
    page.appendChild(shell);
    syncPresenceUi();

    shell.querySelectorAll("[data-profile-close]").forEach((btn) => {
      btn.addEventListener("click", closeFriendProfile);
    });
    shell.querySelector("[data-profile-chat]")?.addEventListener("click", () => {
      closeFriendProfile();
      tab = "chat";
      activeChatId = friendshipId;
      renderShell();
      renderPanel();
    });
    shell.querySelector("[data-profile-watch]")?.addEventListener("click", () => {
      closeFriendProfile();
      tab = "watch";
      activeChatId = null;
      renderShell();
      renderPanel();
    });

    const body = shell.querySelector(".fp-profile__body");
    try {
      const data = await getFriendProfile(userId);
      if (!shell.isConnected) return;
      rememberLastSeen([data.profile]);
      const watching = data.watching;
      const history = data.history || [];
      const peers = data.peers || [];

      body.innerHTML = `
        ${
          watching
            ? `<section class="fp-profile__block">
                <h3>Watching now</h3>
                <a class="fp-profile__now" href="${linkTo(
                  watchingTitlePath(watching)
                )}">
                  ${
                    watching.poster
                      ? `<img src="${escapeHtml(watching.poster)}" alt="" />`
                      : `<span class="fp-profile__ph" aria-hidden="true">▶</span>`
                  }
                  <span>
                    <strong>${escapeHtml(watching.title || "a title")}</strong>
                    <em>Open title</em>
                  </span>
                </a>
              </section>`
            : `<section class="fp-profile__block">
                <h3>Watching now</h3>
                <p class="muted fp-profile__empty">Not watching anything right now.</p>
              </section>`
        }
        <section class="fp-profile__block">
          <h3>Recently viewed</h3>
          ${
            history.length
              ? `<div class="fp-profile__posters">
                  ${history
                    .map(
                      (h) => `
                    <a class="fp-profile__poster" href="${linkTo(
                      `/${h.media_type === "tv" ? "tv" : "movie"}/${h.tmdb_id}`
                    )}" title="${escapeHtml(h.title || "")}">
                      ${
                        h.poster
                          ? `<img src="${escapeHtml(h.poster)}" alt="" />`
                          : `<span>${escapeHtml(
                              (h.title || "?").slice(0, 1)
                            )}</span>`
                      }
                      <em>${escapeHtml(formatViewedAt(h.viewed_at))}</em>
                    </a>`
                    )
                    .join("")}
                </div>`
              : `<p class="muted fp-profile__empty">No shared history yet. Ask them to open a few titles on LANTAW.</p>`
          }
        </section>
        <section class="fp-profile__block">
          <h3>Friends · ${peers.length}</h3>
          ${
            peers.length
              ? `<div class="fp-profile__peers">
                  ${peers
                    .map((p) => {
                      rememberLastSeen([p]);
                      return `
                      <div class="fp-profile__peer">
                        ${presenceAvatarHtml(p, "fp-avatar--sm")}
                        <span>
                          <strong>${escapeHtml(
                            p.display_name || p.email || "User"
                          )}</strong>
                          <em class="fp-presence-label ${
                            isUserOnline(p.id) ? "is-online" : ""
                          }" data-presence-id="${escapeHtml(p.id || "")}">
                            <span data-presence-label>${escapeHtml(
                              presenceLabelFor(p.id, {
                                onlineText: "Online",
                              })
                            )}</span>
                          </em>
                        </span>
                      </div>`;
                    })
                    .join("")}
                </div>`
              : `<p class="muted fp-profile__empty">No other friends to show.</p>`
          }
        </section>
      `;
      syncPresenceUi();
    } catch (err) {
      if (!shell.isConnected) return;
      body.innerHTML = `
        <p class="muted fp-profile__empty">${escapeHtml(
          err.message || "Couldn’t load profile."
        )}</p>
        <p class="muted fp-profile__empty">If this is new, run <code>202603300008_friend_profile_views.sql</code> in Supabase.</p>
      `;
    }
  };

  const bindProfileTriggers = (rootEl = page) => {
    rootEl.querySelectorAll("[data-open-profile]").forEach((el) => {
      if (el.dataset.profileBound) return;
      el.dataset.profileBound = "1";
      const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFriendProfile(el.dataset.openProfile);
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") open(e);
      });
    });
  };

  const bindInboxListActions = (rootEl = page) => {
    rootEl.querySelectorAll("[data-open-chat]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        activeChatId = btn.dataset.openChat;
        renderShell();
        renderPanel();
      });
    });
    rootEl.querySelectorAll("[data-open-party]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const party = parties.find((p) => p.id === btn.dataset.openParty);
        if (party) location.hash = linkTo(partyWatchPath(party));
        else {
          tab = "watch";
          renderShell();
          renderPanel();
        }
      });
    });
    bindProfileTriggers(rootEl);
    syncPresenceUi();
  };

  /** Soft-update inbox rows in place — avoids remount blink. */
  const paintInboxList = () => {
    const list = page.querySelector(".fp-convo-list");
    if (!list || tab !== "chat") return;
    // Full inbox, or the desktop/tablet rail while a thread is open
    if (activeChatId && !list.closest(".fp-chat__rail")) return;
    const accepted = friendships.filter((f) => f.status === "accepted");
    const key = inboxPaintKey(accepted);
    if (list.dataset.paintKey === key) {
      syncPresenceUi();
      return;
    }
    list.dataset.paintKey = key;
    list.innerHTML = convoListHtml(accepted, chatPreviews, {
      activeId: activeChatId,
    });
    bindInboxListActions(list);
  };

  const refreshChatPreviews = async () => {
    const accepted = friendships.filter((f) => f.status === "accepted");
    if (!accepted.length) {
      chatPreviews = {};
      return chatPreviews;
    }
    const token = ++inboxFetchToken;
    try {
      const next = await listChatPreviews(accepted.map((f) => f.id));
      if (token !== inboxFetchToken) return chatPreviews;
      chatPreviews = next;
      return chatPreviews;
    } catch (_) {
      return chatPreviews;
    }
  };

  const partyPeerName = (p, mineHost) => {
    const peer = mineHost ? p.guest : p.host;
    return peer?.display_name || peer?.email || "Friend";
  };

  const partyListHtml = () => {
    if (!parties.length) {
      return emptyState("No invites", "Watch invites will show up here.");
    }
    return parties
      .map((p) => {
        const mineHost = p.host_id === me.id;
        const peer = partyPeerName(p, mineHost);
        const openLabel =
          p.status === "active" ? "Join room" : mineHost ? "Open & wait" : "Open";
        return `
          <div class="fp-party">
            ${
              p.poster
                ? `<img src="${escapeHtml(p.poster)}" alt="" />`
                : `<div class="fp-party__ph"></div>`
            }
            <div class="fp-party__body">
              <strong>${escapeHtml(p.title)}</strong>
              <span class="muted">${
                mineHost
                  ? `You invited ${escapeHtml(peer)}`
                  : `${escapeHtml(peer)} invited you`
              } · ${escapeHtml(p.status)}</span>
              <div class="fp-party__actions">
                ${
                  p.status === "active" || p.status === "invited"
                    ? `<a class="fp-btn fp-btn--solid" href="${linkTo(
                        partyWatchPath(p)
                      )}">${openLabel}</a>`
                    : ""
                }
                ${
                  p.status === "invited" && !mineHost
                    ? `<button class="fp-btn fp-btn--solid" type="button" data-party-accept="${p.id}">Accept</button>
                       <button class="fp-btn" type="button" data-party-decline="${p.id}">Decline</button>`
                    : ""
                }
                ${
                  p.status === "active" || p.status === "invited"
                    ? `<button class="fp-btn" type="button" data-party-end="${p.id}">End</button>`
                    : ""
                }
                <button class="fp-btn fp-btn--danger" type="button" data-party-delete="${p.id}">Delete</button>
              </div>
            </div>
          </div>`;
      })
      .join("");
  };

  const paintPartyList = () => {
    const partyList = page.querySelector("#party-list");
    if (!partyList) return;
    partyList.innerHTML = partyListHtml();
  };

  /** Update People lists in place — no full panel remount (avoids blink). */
  const paintPeopleLists = () => {
    const panel = page.querySelector("#friends-panel");
    if (!panel || tab !== "friends") return;

    const accepted = friendships.filter((f) => f.status === "accepted");
    const incoming = friendships.filter((f) => f.isIncoming);
    const outgoing = friendships.filter((f) => f.isOutgoing);

    let reqSection = panel.querySelector("#requests-section");
    if (incoming.length || outgoing.length) {
      if (!reqSection) {
        const friends = panel.querySelector("#friends-section");
        const find = panel.querySelector(".fp-find");
        reqSection = document.createElement("section");
        reqSection.className = "fp-block fp-block--split";
        reqSection.id = "requests-section";
        reqSection.innerHTML = `<h2>Requests</h2><div class="fp-list" id="requests-list"></div>`;
        if (friends) friends.before(reqSection);
        else find?.after(reqSection);
      }
      const reqBox = reqSection.querySelector("#requests-list");
      if (reqBox) {
        reqBox.innerHTML = [
          ...incoming.map((f) =>
            personRow(
              f.other,
              `<button class="fp-btn fp-btn--solid" data-accept="${f.id}" type="button">Accept</button>
               <button class="fp-btn" data-decline="${f.id}" type="button">Decline</button>`
            )
          ),
          ...outgoing.map((f) =>
            personRow(
              f.other,
              `<span class="fp-pill">Pending</span>
               <button class="fp-btn" data-remove="${f.id}" type="button">Cancel</button>`
            )
          ),
        ].join("");
      }
    } else {
      reqSection?.remove();
    }

    let friendsBox = panel.querySelector("#friends-list");
    if (!friendsBox) {
      const block = document.createElement("section");
      block.className = "fp-block";
      block.innerHTML = `<h2>Your friends</h2><div class="fp-list" id="friends-list"></div>`;
      panel.appendChild(block);
      friendsBox = block.querySelector("#friends-list");
    }
    if (!accepted.length) {
      friendsBox.innerHTML = emptyState(
        "No friends yet",
        "Add someone from People you may know, or search by name or email."
      );
    } else {
      friendsBox.innerHTML = accepted
        .map((f) =>
          personRow(
            f.other,
            `<button class="fp-btn fp-btn--solid" data-chat="${f.id}" type="button">Chat</button>
             <button class="fp-btn" data-remove="${f.id}" type="button">Remove</button>`,
            { friendshipId: f.id }
          )
        )
        .join("");
    }
    bindProfileTriggers(panel);
  };

  const personRow = (p, actions = "", { compact = false, friendshipId = "" } = {}) => {
    if (p) rememberLastSeen([p]);
    const on = Boolean(p?.id && isUserOnline(p.id));
    const name = p?.display_name || "User";
    const email = p?.email || "";
    const status = p?.id
      ? presenceLabelFor(p.id, { onlineText: "Online" })
      : "Offline";
    const statusText = on ? "Online" : status === "Online" ? "Offline" : status;
    const solo = soloWatchingFor(p?.id);
    const avatar = friendshipId
      ? `<button type="button" class="fp-row__avatar-btn" data-open-profile="${escapeHtml(
          friendshipId
        )}" aria-label="View profile">${presenceAvatarHtml(
          p,
          compact ? "fp-avatar--md" : ""
        )}</button>`
      : presenceAvatarHtml(p, compact ? "fp-avatar--md" : "");
    return `
    <div class="fp-row ${compact ? "fp-row--people" : ""} ${
      solo ? "is-watching" : ""
    }">
      ${avatar}
      <div class="fp-row__meta">
        <strong>${escapeHtml(name)}</strong>
        <span
          class="fp-presence-label ${on ? "is-online" : ""}"
          data-presence-id="${escapeHtml(p?.id || "")}"
          ${
            p?.last_seen_at
              ? `data-last-seen="${escapeHtml(p.last_seen_at)}"`
              : ""
          }
        ><em data-presence-label>${escapeHtml(statusText)}</em></span>
        ${
          solo
            ? `<a class="fp-row__watching" href="${linkTo(
                watchingTitlePath(solo)
              )}">Watching ${escapeHtml(solo.title || "something")}</a>`
            : ""
        }
        ${
          email
            ? `<span class="fp-row__email" title="${escapeHtml(email)}">${escapeHtml(
                email
              )}</span>`
            : ""
        }
      </div>
      <div class="fp-row__actions">${actions}</div>
    </div>
  `;
  };

  const shortLabel = (name, fallback = "Friend") => {
    const raw = String(name || fallback).trim();
    const first = raw.split(/[\s@]/)[0] || fallback;
    return first.length > 12 ? `${first.slice(0, 11)}…` : first;
  };

  const peopleRowHtml = () => {
    const accepted = friendships.filter((f) => f.status === "accepted");
    const ranked = [...accepted].sort((a, b) => {
      const na = friendNotes[a.other?.id]?.body ? 1 : 0;
      const nb = friendNotes[b.other?.id]?.body ? 1 : 0;
      if (na !== nb) return nb - na;
      const oa = isUserOnline(a.other?.id) ? 1 : 0;
      const ob = isUserOnline(b.other?.id) ? 1 : 0;
      if (oa !== ob) return ob - oa;
      const an = (a.other?.display_name || a.other?.email || "").toLowerCase();
      const bn = (b.other?.display_name || b.other?.email || "").toLowerCase();
      return an.localeCompare(bn);
    });
    const mine = friendNotes[me.id];
    const watchCount = parties.filter(
      (p) =>
        (p.status === "invited" || p.status === "active") &&
        (p.host_id === me.id || p.guest_id === me.id)
    ).length;

    const friendItem = (friend) => {
      const note = friendNotes[friend.other?.id];
      const on = isUserOnline(friend.other?.id);
      const name = friend.other?.display_name || friend.other?.email || "Friend";
      return `
        <button type="button" class="fp-people-item" data-open-chat="${friend.id}" aria-label="${escapeHtml(
          note?.body ? `${name}. Note: ${note.body}` : name
        )}">
          ${
            note?.body
              ? `<span class="fp-people-item__bubble">${escapeHtml(note.body)}</span>`
              : `<span class="fp-people-item__bubble fp-people-item__bubble--empty"></span>`
          }
          <span class="fp-people-item__face ${on ? "is-online" : ""}">
            ${avatarHtml(friend.other)}
          </span>
          <span class="fp-people-item__name">${escapeHtml(shortLabel(name))}</span>
        </button>`;
    };

    return `
      <button type="button" class="fp-people-item fp-people-item--me" data-edit-note aria-label="${
        mine?.body ? `Your note: ${escapeHtml(mine.body)}` : "Add a note"
      }">
        ${
          mine?.body
            ? `<span class="fp-people-item__bubble">${escapeHtml(mine.body)}</span>`
            : `<span class="fp-people-item__bubble fp-people-item__bubble--empty"></span>`
        }
        <span class="fp-people-item__face">
          ${avatarHtml(meCard)}
          ${mine?.body ? "" : `<i class="fp-people-item__plus" aria-hidden="true">+</i>`}
        </span>
        <span class="fp-people-item__name">Your note</span>
      </button>
      ${ranked.map(friendItem).join("")}
      <button type="button" class="fp-people-item fp-people-item--watch" data-open-watch aria-label="Watch together">
        <span class="fp-people-item__bubble fp-people-item__bubble--empty"></span>
        <span class="fp-people-item__face fp-people-item__face--watch">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 7.8v8.4L17 12 9.2 7.8Z" fill="currentColor"/></svg>
          ${watchCount ? `<em class="fp-people-item__badge">${watchCount > 9 ? "9+" : watchCount}</em>` : ""}
        </span>
        <span class="fp-people-item__name">Watch</span>
      </button>
    `;
  };

  const peopleBlockHtml = () => `
    <div class="fp-people">
      <div class="fp-people-row ${rowHasNotes() ? "has-notes" : ""}" role="list">${peopleRowHtml()}</div>
    </div>
  `;

  const rowHasNotes = () =>
    Boolean(friendNotes[me.id]?.body) ||
    friendships.some(
      (f) => f.status === "accepted" && friendNotes[f.other?.id]?.body
    );

  const paintPeopleRow = () => {
    const row = page.querySelector(".fp-people-row");
    if (!row || tab !== "chat" || activeChatId) return;
    row.classList.toggle("has-notes", rowHasNotes());
    row.innerHTML = peopleRowHtml();
    bindPeopleRow(row);
  };

  const bindPeopleRow = (rootEl = page) => {
    rootEl.querySelectorAll("[data-open-chat]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        activeChatId = btn.dataset.openChat;
        renderShell();
        renderPanel();
      });
    });
    rootEl.querySelectorAll("[data-open-watch]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        tab = "watch";
        activeChatId = null;
        renderShell();
        renderPanel();
      });
    });
    rootEl.querySelectorAll("[data-edit-note]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => openNoteComposer());
    });
  };

  const openNoteComposer = () => {
    noteComposer = true;
    if (!noteHistory) {
      history.pushState({ lantawNote: 1 }, "");
      noteHistory = true;
    }
    renderShell();
    renderPanel();
    page.querySelector("#fp-note-input")?.focus();
  };

  const closeNoteComposer = () => {
    const popped = noteHistory;
    noteComposer = false;
    noteHistory = false;
    renderShell();
    renderPanel();
    if (popped) history.back();
  };

  const onNotePop = () => {
    if (!noteComposer) return;
    noteComposer = false;
    noteHistory = false;
    if (!document.getElementById("view")?.contains(page)) return;
    renderShell();
    renderPanel();
  };
  window.addEventListener("popstate", onNotePop);

  const renderNotePage = (panel) => {
    const existing = friendNotes[me.id]?.body || "";
    panel.innerHTML = `
      <section class="fp-note-page">
        <header class="fp-note-page__bar">
          <button type="button" class="fp-note-page__close" data-note-close aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          </button>
          <button type="button" class="fp-note-page__share" data-note-share disabled>Share</button>
        </header>
        <div class="fp-note-page__stage">
          <div class="fp-note-bubble">
            <textarea
              id="fp-note-input"
              maxlength="60"
              rows="2"
              enterkeyhint="done"
              autocomplete="off"
              autocapitalize="sentences"
              placeholder="Share a thought…"
              aria-label="Your note"
            >${escapeHtml(existing)}</textarea>
          </div>
          <div class="fp-note-page__me">${avatarHtml(meCard, "fp-avatar--lg")}</div>
          <p class="fp-note-page__hint">Friends can see this for 24 hours.</p>
          ${
            existing
              ? `<button type="button" class="fp-note-page__delete" data-note-delete>Delete note</button>`
              : ""
          }
        </div>
      </section>
    `;

    const input = panel.querySelector("#fp-note-input");
    const share = panel.querySelector("[data-note-share]");
    const fit = () => {
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
      if (share) share.disabled = !input.value.trim();
    };
    fit();
    input?.addEventListener("input", fit);
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);

    panel.querySelector("[data-note-close]")?.addEventListener("click", () => {
      closeNoteComposer();
    });
    share?.addEventListener("click", async () => {
      const text = input?.value || "";
      share.disabled = true;
      try {
        const saved = await saveFriendNote(text);
        if (saved) friendNotes[me.id] = saved;
        else delete friendNotes[me.id];
        writeInboxSnapshot();
        closeNoteComposer();
      } catch (err) {
        share.disabled = !text.trim();
        showNotice({ title: "Couldn’t share note", message: err.message });
      }
    });
    panel.querySelector("[data-note-delete]")?.addEventListener("click", async () => {
      try {
        await saveFriendNote("");
        delete friendNotes[me.id];
        writeInboxSnapshot();
        closeNoteComposer();
      } catch (err) {
        showNotice({ title: "Couldn’t delete note", message: err.message });
      }
    });
  };

  const NOTICE_SEEN_KEY = `lantaw-notices-seen:${me.id}`;
  let noticeSeenAt = 0;
  try {
    noticeSeenAt = Number(localStorage.getItem(NOTICE_SEEN_KEY)) || 0;
  } catch {
    noticeSeenAt = 0;
  }
  let noticeHighlightAfter = noticeSeenAt;

  const unreadNoticeCount = () =>
    notices.filter((item) => new Date(item.at).getTime() > noticeSeenAt).length;

  const markNoticesSeen = () => {
    noticeHighlightAfter = noticeSeenAt;
    noticeSeenAt = Date.now();
    try {
      localStorage.setItem(NOTICE_SEEN_KEY, String(noticeSeenAt));
    } catch {
      /* ignore */
    }
  };

  async function refreshNotices() {
    try {
      const accepted = friendships.filter((f) => f.status === "accepted");
      notices = await listActivityNotices({
        friendIds: accepted.map((f) => f.other?.id).filter(Boolean),
        friendships: accepted,
      });
    } catch {
      /* keep the last list */
    }
  }

  const noticeTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const tabBadge = (n) => (n ? `<em>${n > 9 ? "9+" : n}</em>` : "");

  const renderShell = () => {
    const requestCount = activity.requests || friendships.filter((f) => f.isIncoming).length;
    const chatCount = activity.chats || 0;
    const inviteCount =
      activity.invites ||
      parties.filter((p) => p.guest_id === me.id && p.status === "invited").length;

    const title =
      tab === "notices"
        ? "Notifications"
        : tab === "watch"
          ? "Watch together"
          : tab === "friends"
            ? "People"
            : "Chats";

    // Hide chrome while inside a Messenger thread
    const inThread = tab === "chat" && Boolean(activeChatId);
    const hideChrome = inThread || noteComposer;

    page.innerHTML = `
      ${
        hideChrome
          ? ""
          : `<header class="fp-msg-head">
        <h1>${title}</h1>
        <nav class="fp-msg-actions" aria-label="Friends sections">
          <button type="button" class="fp-icon-btn ${
            tab === "chat" ? "is-active" : ""
          }" data-tab="chat" aria-label="Chats">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 3.2V6.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            ${tabBadge(chatCount)}
          </button>
          <button type="button" class="fp-icon-btn ${
            tab === "watch" ? "is-active" : ""
          }" data-tab="watch" aria-label="Watch together">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.2 9.4v5.2L14.8 12l-4.6-2.6Z" fill="currentColor"/></svg>
            ${tabBadge(inviteCount)}
          </button>
          <button type="button" class="fp-icon-btn ${
            tab === "friends" ? "is-active" : ""
          }" data-tab="friends" aria-label="People">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="10.2" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.8 18.8c1.4-2.7 3.5-4.1 5.2-4.1s3.8 1.4 5.2 4.1M13.4 18.5c1-1.8 2.4-2.8 3.5-2.8 1.2 0 2.4.8 3.3 2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            ${tabBadge(requestCount)}
          </button>
          <button type="button" class="fp-icon-btn ${
            tab === "notices" ? "is-active" : ""
          }" data-tab="notices" aria-label="Notifications">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8a4.4 4.4 0 0 0-4.4 4.4v2.1c0 .9-.3 1.7-.9 2.4L5.4 14.4c-.5.6-.1 1.6.7 1.6h11.8c.8 0 1.2-1 .7-1.6l-1.3-1.7c-.6-.7-.9-1.5-.9-2.4V8.2A4.4 4.4 0 0 0 12 3.8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 17.2a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            ${tabBadge(unreadNoticeCount())}
          </button>
        </nav>
      </header>`
      }

      <div class="fp-panel" id="friends-panel"></div>
    `;

    page.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.tab;
        if (next === "notices" && tab !== "notices") markNoticesSeen();
        tab = next;
        if (next === "chat") activeChatId = null;
        renderShell();
        renderPanel();
      });
    });
    syncChatLock();
  };

  const INBOX_CACHE_KEY = "lantaw-friends-snapshot";

  const readInboxSnapshot = () => {
    try {
      const raw = sessionStorage.getItem(INBOX_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.userId !== me.id) return null;
      if (Date.now() - Number(data.at || 0) > 30 * 60 * 1000) return null;
      return data;
    } catch {
      return null;
    }
  };

  const writeInboxSnapshot = () => {
    const payload = {
      userId: me.id,
      at: Date.now(),
      friendships,
      parties,
      watchingByUser,
      activity,
      chatPreviews,
      friendNotes,
    };
    try {
      sessionStorage.setItem(INBOX_CACHE_KEY, JSON.stringify(payload));
    } catch {
      /* private mode / quota */
    }
    idbSet(`friends:${me.id}`, payload);
  };

  const noteUserIds = () => [
    me.id,
    ...friendships.map((f) => f.other?.id).filter(Boolean),
  ];

  async function refreshNotes() {
    try {
      friendNotes = await listFriendNotes(noteUserIds());
    } catch {
      /* keep the last notes */
    }
    paintPeopleRow();
  }

  async function refreshData() {
    const [nextFriends, nextParties, nextWatching, nextActivity] = await Promise.all([
      listFriendships(),
      listWatchParties().catch(() => parties),
      listFriendsWatching().catch(() => watchingByUser),
      getFriendsActivityCounts().catch(() => activity),
    ]);
    friendships = nextFriends;
    rememberLastSeen(friendships.map((f) => f.other).filter(Boolean));
    parties = nextParties;
    watchingByUser = pruneWatchingMap(nextWatching || {}, {
      isOnline: isUserOnline,
    });
    activity = nextActivity;
    await Promise.all([refreshNotes(), refreshNotices()]);
  }

  async function renderPanel() {
    if (tab !== "chat") clearChatViewport();
    const panel = page.querySelector("#friends-panel");
    if (!panel) return;

    if (noteComposer) {
      if (!panel.querySelector(".fp-note-page")) renderNotePage(panel);
      return;
    }

    if (tab === "notices") {
      panel.innerHTML = notices.length
        ? `<div class="fp-notices" role="list">
            ${notices
              .map((item) => {
                const unread = new Date(item.at).getTime() > noticeHighlightAfter;
                return `
                  <button type="button" class="fp-notice ${
                    unread ? "is-unread" : ""
                  }" data-notice="${escapeHtml(item.id)}">
                    ${avatarHtml({
                      display_name: item.actorName,
                      avatar_url: item.actorAvatar,
                    })}
                    <span class="fp-notice__copy">
                      <strong>${escapeHtml(item.actorName)} <em>${escapeHtml(
                        item.action
                      )}</em></strong>
                      ${
                        item.preview
                          ? `<p>${escapeHtml(item.preview)}</p>`
                          : ""
                      }
                      <time>${escapeHtml(noticeTime(item.at))}</time>
                    </span>
                  </button>`;
              })
              .join("")}
          </div>`
        : emptyState(
            "No notifications yet",
            "Mentions, replies, likes, and friend notes show up here."
          );
      panel.querySelectorAll("[data-notice]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const item = notices.find((entry) => entry.id === btn.dataset.notice);
          if (!item) return;
          if (item.chatId) {
            tab = "chat";
            activeChatId = item.chatId;
            renderShell();
            renderPanel();
            return;
          }
          if (item.href) location.hash = linkTo(item.href);
        });
      });
      return;
    }

    if (tab === "friends") {
      const accepted = friendships.filter((f) => f.status === "accepted");
      const incoming = friendships.filter((f) => f.isIncoming);
      const outgoing = friendships.filter((f) => f.isOutgoing);
      const relatedIds = friendships
        .map((f) => f.other?.id)
        .filter(Boolean);

      panel.innerHTML = `
        <section class="fp-find">
          <div class="fp-find__head">
            <h2>Find people</h2>
            <p class="muted fp-lead">Search by name or email to add someone.</p>
          </div>
          <div class="fp-search fp-find__search">
            <div class="fp-search__box">
              <input
                type="search"
                id="people-search"
                placeholder="Search name or email"
                autocomplete="off"
                enterkeyhint="search"
              />
              <button type="button" class="fp-search__clear" id="people-clear" hidden>✕</button>
            </div>
          </div>
          <p class="fp-status muted" id="people-msg" hidden></p>
          <div class="fp-search-results" id="search-results" hidden></div>
        </section>

        <section class="fp-block fp-suggest-block" id="suggest-section">
          <div class="fp-block__head">
            <h2 id="suggest-heading">People you may know</h2>
            <p class="muted fp-block__sub" id="suggest-sub">Suggested accounts on LANTAW</p>
          </div>
          <div class="fp-suggest" id="suggest-list">
            ${loadingHtml({ className: "fp-suggest-loading" })}
          </div>
        </section>

        ${
          incoming.length || outgoing.length
            ? `<section class="fp-block fp-block--split" id="requests-section">
                <h2>Requests</h2>
                <div class="fp-list" id="requests-list"></div>
              </section>`
            : ""
        }

        <section class="fp-block fp-block--split" id="friends-section">
          <h2>Your friends</h2>
          <div class="fp-list" id="friends-list"></div>
        </section>
      `;

      const reqBox = panel.querySelector("#requests-list");
      if (reqBox) {
        reqBox.innerHTML = [
          ...incoming.map((f) =>
            personRow(
              f.other,
              `<button class="fp-btn fp-btn--solid" data-accept="${f.id}" type="button">Accept</button>
               <button class="fp-btn" data-decline="${f.id}" type="button">Decline</button>`
            )
          ),
          ...outgoing.map((f) =>
            personRow(
              f.other,
              `<span class="fp-pill">Pending</span>
               <button class="fp-btn" data-remove="${f.id}" type="button">Cancel</button>`
            )
          ),
        ].join("");
      }

      const friendsBox = panel.querySelector("#friends-list");
      if (!accepted.length) {
        friendsBox.innerHTML = emptyState(
          "No friends yet",
          "Add someone from People you may know, or search by name or email."
        );
      } else {
        friendsBox.innerHTML = accepted
          .map((f) =>
            personRow(
              f.other,
              `<button class="fp-btn fp-btn--solid" data-chat="${f.id}" type="button">Chat</button>
               <button class="fp-btn" data-remove="${f.id}" type="button">Remove</button>`,
              { friendshipId: f.id }
            )
          )
          .join("");
      }
      bindProfileTriggers(panel);

      const suggestSection = panel.querySelector("#suggest-section");
      const suggestSub = panel.querySelector("#suggest-sub");
      const resultsBox = panel.querySelector("#suggest-list");
      const searchResults = panel.querySelector("#search-results");
      const peopleSearch = panel.querySelector("#people-search");
      const peopleClear = panel.querySelector("#people-clear");
      const peopleMsg = panel.querySelector("#people-msg");
      let searchToken = 0;
      let searchTimer = null;
      let suggestCache = [];
      let suggestExpanded = false;
      const SUGGEST_PREVIEW = 12;

      const paintPeopleList = (
        box,
        rows,
        { emptyTitle, emptyText, preview = false, moreId = "suggest" } = {}
      ) => {
        if (!box) return;
        if (!rows.length) {
          box.innerHTML = emptyState(
            emptyTitle || "No one new right now",
            emptyText || "When more people join LANTAW, they’ll show up here."
          );
          return;
        }
        const showAll =
          !preview || suggestExpanded || rows.length <= SUGGEST_PREVIEW;
        const visible = showAll ? rows : rows.slice(0, SUGGEST_PREVIEW);
        const more = rows.length - visible.length;
        box.innerHTML = `
          <div class="fp-list fp-list--people">${visible
            .map((p) =>
              personRow(
                p,
                `<button class="fp-btn fp-btn--solid fp-btn--add" type="button" data-add="${p.id}">Add</button>`,
                { compact: true }
              )
            )
            .join("")}</div>
          ${
            more > 0
              ? `<button type="button" class="fp-more" id="${moreId}-more">Show ${more} more</button>`
              : suggestExpanded && preview && rows.length > SUGGEST_PREVIEW
                ? `<button type="button" class="fp-more" id="${moreId}-less">Show less</button>`
                : ""
          }`;
        box.querySelector(`#${moreId}-more`)?.addEventListener("click", () => {
          suggestExpanded = true;
          paintPeopleList(box, suggestCache, {
            preview: true,
            moreId,
          });
        });
        box.querySelector(`#${moreId}-less`)?.addEventListener("click", () => {
          suggestExpanded = false;
          paintPeopleList(box, suggestCache, {
            preview: true,
            moreId,
          });
        });
      };

      const showBrowseMode = () => {
        if (searchResults) {
          searchResults.hidden = true;
          searchResults.innerHTML = "";
        }
        if (suggestSection) suggestSection.hidden = false;
        if (suggestSub) suggestSub.hidden = false;
      };

      const showSearchMode = () => {
        if (searchResults) searchResults.hidden = false;
        if (suggestSection) suggestSection.hidden = true;
      };

      const loadSuggestions = async () => {
        const token = ++searchToken;
        showBrowseMode();
        try {
          const rows = await listSuggestedProfiles({
            limit: 48,
            excludeIds: relatedIds,
          });
          if (token !== searchToken) return;
          if (peopleSearch.value.trim().length >= 2) return;
          rememberLastSeen(rows);
          suggestCache = rows;
          suggestExpanded = false;
          resultsBox.innerHTML = rows.length
            ? peopleCardsHtml(rows.slice(0, 20))
            : emptyState(
                "No one new right now",
                "When more people join LANTAW, they’ll show up here."
              );
        } catch (err) {
          if (token !== searchToken) return;
          resultsBox.innerHTML = emptyState(
            "Couldn’t load suggestions",
            err.message || "Try again in a moment."
          );
        }
      };

      const runSearch = async (query) => {
        const token = ++searchToken;
        const q = query.trim();
        peopleClear.hidden = !q;

        if (q.length < 2) {
          peopleMsg.hidden = true;
          await loadSuggestions();
          return;
        }

        showSearchMode();
        peopleMsg.hidden = false;
        peopleMsg.textContent = "Searching…";
        try {
          const rows = await searchProfiles(q, { limit: 16 });
          if (token !== searchToken) return;
          paintPeopleList(
            searchResults,
            rows.filter((r) => !relatedIds.includes(r.id)),
            {
              emptyTitle: "No matches",
              emptyText: "Try another name or the full email address.",
            }
          );
          peopleMsg.hidden = true;
        } catch (err) {
          if (token !== searchToken) return;
          peopleMsg.textContent = err.message || "Search failed";
        }
      };

      peopleSearch.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runSearch(peopleSearch.value), 220);
      });
      peopleClear.addEventListener("click", () => {
        peopleSearch.value = "";
        peopleClear.hidden = true;
        peopleMsg.hidden = true;
        loadSuggestions();
        peopleSearch.focus();
      });

      loadSuggestions();
      return;
    }

    if (tab === "chat") {
      // Drop Watch-tab capture listeners so they don't steal taps from chat
      unsubWatchDoc?.();

      const accepted = friendships.filter((f) => f.status === "accepted");
      const openInvites = parties.filter(
        (p) =>
          (p.status === "invited" || p.status === "active") &&
          (p.host_id === me.id || p.guest_id === me.id)
      );

      // —— Messenger inbox (conversation list) ——
      if (!activeChatId) {
        if (!accepted.length) {
          panel.innerHTML = `
            ${peopleBlockHtml()}
            ${
              pendingShare?.id
                ? `<div class="fp-share-banner" role="status">
                    <span class="fp-share-banner__ph" aria-hidden="true">↗</span>
                    <span class="fp-share-banner__copy">
                      <strong>Sharing ${escapeHtml(
                        pendingShare.title || "this title"
                      )}</strong>
                      <em>Add a friend first, then open their chat</em>
                    </span>
                    <button type="button" class="fp-text-btn" data-share-cancel>Cancel</button>
                  </div>`
                : ""
            }
            ${emptyState(
              "No conversations yet",
              "Add a friend from People, then start chatting."
            )}
            <button type="button" class="btn btn--primary fp-inbox__cta" data-tab="friends">
              Find people
            </button>
          `;
          panel.querySelector("[data-share-cancel]")?.addEventListener("click", () => {
            clearPendingShare();
            renderPanel();
          });
          panel.querySelector("[data-tab]")?.addEventListener("click", () => {
            tab = "friends";
            renderShell();
            renderPanel();
          });
          bindPeopleRow(panel);
          return;
        }

        // Paint friends immediately (cached previews) — no loading flash
        const shareBanner = pendingShare?.id
          ? `<div class="fp-share-banner" role="status">
              ${
                pendingShare.poster
                  ? `<img class="fp-share-banner__poster" src="${escapeHtml(
                      pendingShare.poster
                    )}" alt="" />`
                  : `<span class="fp-share-banner__ph" aria-hidden="true">↗</span>`
              }
              <span class="fp-share-banner__copy">
                <strong>Sharing ${escapeHtml(
                  pendingShare.title || "this title"
                )}</strong>
                <em>Open a chat, then tap Send</em>
              </span>
              <button type="button" class="fp-text-btn" data-share-cancel>Cancel</button>
            </div>`
          : "";

        panel.innerHTML = `
          <div class="fp-inbox">
            ${peopleBlockHtml()}
            ${shareBanner}
            ${
              openInvites.length
                ? `<section class="fp-invite-strip" aria-label="Watch together">
                    <div class="fp-invite-strip__head">
                      <strong>Watch together</strong>
                      <button type="button" class="fp-text-btn" data-tab="watch">New invite</button>
                    </div>
                    <div class="fp-invite-strip__list">
                      ${openInvites
                        .slice(0, 6)
                        .map((p) => {
                          const mineHost = p.host_id === me.id;
                          const peer = partyPeerName(p, mineHost);
                          return `
                          <button type="button" class="fp-invite-card" data-open-party="${p.id}">
                            ${
                              p.poster
                                ? `<img src="${escapeHtml(p.poster)}" alt="" />`
                                : `<span class="fp-invite-card__ph"></span>`
                            }
                            <span>
                              <strong>${escapeHtml(p.title)}</strong>
                              <em>${
                                mineHost
                                  ? `You invited ${escapeHtml(peer)}`
                                  : `${escapeHtml(peer)} invited you`
                              } · ${escapeHtml(p.status)}</em>
                            </span>
                          </button>`;
                        })
                        .join("")}
                    </div>
                  </section>`
                : ""
            }
            <div class="fp-convo-list" role="list" data-paint-key="${escapeHtml(
              inboxPaintKey(accepted)
            )}">
              ${convoListHtml(accepted)}
            </div>
          </div>
        `;

        panel.querySelector("[data-share-cancel]")?.addEventListener("click", () => {
          clearPendingShare();
          renderPanel();
        });
        panel.querySelectorAll("[data-tab]").forEach((btn) => {
          btn.addEventListener("click", () => {
            tab = btn.dataset.tab;
            activeChatId = null;
            renderShell();
            renderPanel();
          });
        });
        bindInboxListActions(panel);
        bindPeopleRow(panel);

        // Soft-refresh previews in background; only rewrite list if data changed
        refreshChatPreviews().then(() => {
          if (tab !== "chat" || activeChatId) return;
          paintInboxList();
        });
        return;
      }

      const current = accepted.find((f) => f.id === activeChatId) || accepted[0];
      if (!current) {
        activeChatId = null;
        renderShell();
        renderPanel();
        return;
      }
      activeChatId = current.id;

      const peerOnline = isUserOnline(current.other?.id);
      const peerSolo = soloWatchingFor(current.other?.id);
      panel.innerHTML = `
        <div class="fp-chat fp-chat--thread fp-chat--split">
          <aside class="fp-chat__rail" aria-label="Conversations">
            <div class="fp-chat__rail-head">
              <strong>Chats</strong>
            </div>
            <div class="fp-convo-list" role="list" data-paint-key="${escapeHtml(
              inboxPaintKey(accepted)
            )}">
              ${convoListHtml(accepted, chatPreviews, { activeId: current.id })}
            </div>
          </aside>
          <section class="fp-chat__thread">
            <header class="fp-chat__head">
              <button type="button" class="fp-icon-btn fp-chat__back" data-chat-back aria-label="Back to chats">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button type="button" class="fp-chat__peer" data-open-profile="${
                current.id
              }" aria-label="View profile">
                <span class="fp-chat__head-text">
                  <strong>${escapeHtml(current.other?.display_name || "Friend")}</strong>
                  ${
                    peerSolo
                      ? `<em class="fp-watching-inline">Watching ${escapeHtml(
                          peerSolo.title || "something"
                        )}</em>`
                      : `<span
                    class="fp-presence-label ${peerOnline ? "is-online" : ""}"
                    data-presence-id="${escapeHtml(current.other?.id || "")}"
                  ><em data-presence-label>${
                    peerOnline ? "Active now" : "Offline"
                  }</em></span>`
                  }
                </span>
              </button>
              ${
                peerSolo
                  ? `<a class="fp-chat__watching-link" href="${linkTo(
                      watchingTitlePath(peerSolo)
                    )}">View</a>`
                  : ""
              }
              <div class="fp-chat__head-actions">
                <button type="button" class="fp-icon-btn" data-video-call aria-label="Video call" title="Video call">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3.5" y="7" width="11.5" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M15.5 10.2 20 7.8v8.4l-4.5-2.4V10.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button type="button" class="fp-icon-btn fp-chat__watch-btn" data-tab="watch" aria-label="Watch together" title="Watch together">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M10.2 9.4v5.2L14.8 12l-4.6-2.6Z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            </header>
            <div class="fp-chat__messages" id="chat-messages">${loadingHtml({
              className: "ui-loading--inline",
              size: "sm",
            })}</div>
            <p class="fp-chat__typing" id="chat-typing" hidden aria-live="polite">
              <span class="fp-chat__typing-dots" aria-hidden="true"></span>
              <span id="chat-typing-label"></span>
            </p>
            <div class="fp-chat__compose-spacer" id="chat-compose-spacer" hidden></div>
            <div class="fp-chat__composer" id="chat-composer">
              <div
                class="fp-chat__gifs"
                id="chat-gifs"
                hidden
                role="listbox"
                aria-label="GIF suggestions"
              ></div>
              ${
                pendingShare?.id
                  ? `<div class="fp-share-draft" id="share-draft">
                      ${
                        pendingShare.poster
                          ? `<img class="fp-share-draft__poster" src="${escapeHtml(
                              pendingShare.poster
                            )}" alt="" />`
                          : `<span class="fp-share-draft__ph" aria-hidden="true">↗</span>`
                      }
                      <div class="fp-share-draft__meta">
                        <strong>${escapeHtml(
                          pendingShare.title || "Untitled"
                        )}</strong>
                        <em>Share in this chat</em>
                      </div>
                      <button type="button" class="fp-btn fp-btn--solid" id="share-draft-send">Send</button>
                      <button type="button" class="fp-text-btn" id="share-draft-cancel" aria-label="Cancel share">✕</button>
                    </div>`
                  : ""
              }
              <div class="fp-reply-draft" id="reply-draft" hidden></div>
              <form class="fp-chat__compose" id="chat-form" autocomplete="off">
                <button
                  type="button"
                  class="fp-chat__gif-btn"
                  id="chat-gif-btn"
                  aria-label="GIFs"
                  aria-pressed="false"
                  title="GIFs"
                >GIF</button>
                <textarea
                  name="body"
                  id="chat-input"
                  rows="1"
                  placeholder="Message"
                  enterkeyhint="send"
                  inputmode="text"
                  autocapitalize="sentences"
                  autocorrect="on"
                  spellcheck="true"
                  autocomplete="on"
                  aria-label="Message"
                ></textarea>
                <button class="fp-chat__send" type="button" id="chat-send" aria-label="Send">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.4 11.2 20.2 3.8c.7-.3 1.4.4 1.1 1.1L13.9 21.7c-.3.8-1.5.7-1.7-.1l-1.7-7.1-7.1-1.7c-.8-.2-.9-1.4-.1-1.7Z" fill="currentColor"/>
                  </svg>
                </button>
              </form>
            </div>
          </section>
        </div>
      `;

      bindInboxListActions(panel);
      panel.querySelectorAll("[data-chat-back]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeChatId = null;
          unsubChat?.();
          renderShell();
          renderPanel();
        });
      });
      panel.querySelector('[data-tab="watch"]')?.addEventListener("click", () => {
        tab = "watch";
        activeChatId = null;
        unsubChat?.();
        renderShell();
        renderPanel();
      });
      panel.querySelector("[data-video-call]")?.addEventListener("click", async () => {
        const peer = current.other;
        if (!peer?.id) return;
        const name = peer.display_name || peer.email || "Friend";
        if (!isUserOnline(peer.id)) {
          const ok = await showConfirm({
            title: "Friend looks offline",
            message: `${name} doesn’t appear online right now. Start the video call anyway?`,
            confirmLabel: "Call anyway",
            cancelLabel: "Cancel",
          });
          if (!ok) return;
        } else {
          const ok = await showConfirm({
            title: "Start video call?",
            message: `Call ${name} with camera and microphone?`,
            confirmLabel: "Start call",
            cancelLabel: "Cancel",
          });
          if (!ok) return;
        }
        try {
          await startVideoCall({
            friendshipId: current.id,
            peerId: peer.id,
            peerName: name,
          });
        } catch (err) {
          await showNotice({
            title: "Couldn’t start call",
            message: err.message || "Something went wrong starting the video call.",
          });
        }
      });

      const box = panel.querySelector("#chat-messages");
      const chatId = activeChatId;
      const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
      let replyTarget = null;
      const replyDraft = panel.querySelector("#reply-draft");
      let paintReplyDraft = () => {};
      let setReplyTarget = () => {};

      const groupReactions = (reactions = []) => {
        const map = new Map();
        for (const r of reactions) {
          const key = r.emoji;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(r.user_id);
        }
        return [...map.entries()].map(([emoji, users]) => ({ emoji, users }));
      };

      let threadMessages = [];
      let threadFetchBusy = false;
      let threadFetchQueued = false;
      let threadPoll = null;
      let sending = false;
      peerReadAt = null;

      const paint = (messages) => {
        if (!box.isConnected) return;
        threadMessages = Array.isArray(messages) ? messages : [];
        const paintKey =
          `${peerReadAt || ""}::` +
          threadMessages
            .map(
              (m) =>
                `${m.id}:${m.body}:${m.edited_at || ""}:${(m.reactions || [])
                  .map((r) => `${r.emoji}:${r.user_id}`)
                  .sort()
                  .join(",")}`
            )
            .join("|");
        if (paintKey && paintKey === lastThreadPaintKey) {
          const latestSame = threadMessages[threadMessages.length - 1];
          markChatRead(activeChatId, latestSame?.created_at);
          return;
        }
        lastThreadPaintKey = paintKey;

        const stickBottom =
          box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        const prevScrollTop = box.scrollTop;
        if (!threadMessages.length) {
          box.innerHTML = `
            <div class="fp-chat__empty">
              ${presenceAvatarHtml(current.other, "fp-avatar--md")}
              <strong>${escapeHtml(current.other?.display_name || "Friend")}</strong>
              <p class="muted">You're friends on LANTAW. Say hi.</p>
            </div>`;
          markChatRead(activeChatId);
          return;
        }

        // Last message from me that the peer has already opened/read
        let seenMsgId = null;
        if (peerReadAt) {
          for (let i = threadMessages.length - 1; i >= 0; i -= 1) {
            const row = threadMessages[i];
            if (
              row.sender_id === me.id &&
              !row.deleted_at &&
              String(row.created_at) <= String(peerReadAt)
            ) {
              seenMsgId = row.id;
              break;
            }
          }
        }

        const CLUSTER_MS = 2 * 60 * 1000;
        box.innerHTML = threadMessages
          .map((m, i) => {
            const mine = m.sender_id === me.id;
            const prev = threadMessages[i - 1];
            const next = threadMessages[i + 1];
            const t = new Date(m.created_at).getTime();
            const samePrev =
              prev &&
              prev.sender_id === m.sender_id &&
              t - new Date(prev.created_at).getTime() < CLUSTER_MS;
            const sameNext =
              next &&
              next.sender_id === m.sender_id &&
              new Date(next.created_at).getTime() - t < CLUSTER_MS;
            const cluster = samePrev && sameNext
              ? "is-mid"
              : samePrev
                ? "is-end"
                : sameNext
                  ? "is-start"
                  : "is-alone";
            const showAvatar = !mine && !sameNext;
            const showTime = !sameNext;
            const groups = groupReactions(m.reactions);
            const deleted = Boolean(m.deleted_at);
            const envelope = deleted
              ? { reply: null, body: m.body }
              : parseReplyEnvelope(m.body);
            const contentBody = envelope.body;
            const replyMeta = envelope.reply;
            const gifUrl = deleted ? null : parseGifMessage(contentBody);
            const share =
              deleted || gifUrl ? null : parseShareMessage(contentBody);
            const timeLabel = new Date(m.created_at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });
            const sharePath = share
              ? share.mediaType === "tv"
                ? `/tv/${share.id}`
                : `/movie/${share.id}`
              : "";
            const sharePayload = share
              ? escapeAttr(
                  JSON.stringify({
                    id: share.id,
                    mediaType: share.mediaType,
                    title: share.title,
                    poster: share.poster,
                  })
                )
              : "";
            const replyWho =
              replyMeta?.senderId && replyMeta.senderId === me.id
                ? "You"
                : current.other?.display_name || "Friend";

            return `
          <div
            class="fp-msg ${mine ? "is-me" : "is-them"} ${cluster}${
              showAvatar ? " has-avatar" : ""
            }${deleted ? " is-deleted" : ""}"
            data-msg-id="${escapeHtml(m.id)}"
            data-msg-mine="${mine ? "1" : "0"}"
          >
            <i class="fp-msg__reply-hint" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" fill="currentColor"/></svg>
            </i>
            ${
              !mine
                ? `<div class="fp-msg__aside">${
                    showAvatar
                      ? avatarHtml(current.other, "fp-avatar--xs")
                      : ""
                  }</div>`
                : ""
            }
            <div class="fp-msg__stack">
              <div class="fp-bubble ${mine ? "is-me" : ""} ${cluster}${
                gifUrl ? " is-gif" : ""
              }${share ? " is-share" : ""}${deleted ? " is-deleted" : ""}${
                replyMeta ? " has-reply" : ""
              }">
                ${
                  !deleted && replyMeta
                    ? `<button type="button" class="fp-bubble__quote" data-jump-reply="${escapeHtml(
                        replyMeta.id
                      )}">
                        <strong>${escapeHtml(replyWho)}</strong>
                        <em>${escapeHtml(replyMeta.preview || "Message")}</em>
                      </button>`
                    : ""
                }
                ${
                  deleted
                    ? `<p class="fp-bubble__text fp-bubble__deleted">This message was deleted</p>`
                    : gifUrl
                      ? `<img class="fp-bubble__gif" src="${escapeHtml(
                          gifUrl
                        )}" alt="GIF" loading="lazy" decoding="async" />`
                      : share
                        ? `<div class="fp-share-card">
                            <a class="fp-share-card__media" href="${escapeAttr(
                              linkTo(sharePath)
                            )}">
                              ${
                                share.poster
                                  ? `<img class="fp-share-card__poster" src="${escapeAttr(
                                      share.poster
                                    )}" alt="" loading="lazy" decoding="async" />`
                                  : `<div class="fp-share-card__poster fp-share-card__poster--ph"></div>`
                              }
                              <span class="fp-share-card__meta">
                                <strong>${escapeHtml(share.title)}</strong>
                                <em>${escapeHtml(
                                  share.mediaType === "tv" ? "TV" : "Movie"
                                )}</em>
                              </span>
                            </a>
                            <button
                              type="button"
                              class="fp-share-card__watch"
                              data-share-watch="${sharePayload}"
                            >Watch together</button>
                          </div>`
                        : `<p class="fp-bubble__text">${escapeHtml(
                            contentBody
                          )}</p>`
                }
                ${
                  !deleted && groups.length
                    ? `<div class="fp-bubble__reactions" data-react-chips>
                        ${groups
                          .map(
                            (g) => `
                          <button
                            type="button"
                            class="fp-react-chip ${
                              g.users.includes(me.id) ? "is-mine" : ""
                            }"
                            data-react="${escapeHtml(m.id)}"
                            data-emoji="${escapeHtml(g.emoji)}"
                          >${escapeHtml(g.emoji)}${
                              g.users.length > 1
                                ? ` <span>${g.users.length}</span>`
                                : ""
                            }</button>`
                          )
                          .join("")}
                      </div>`
                    : ""
                }
              </div>
              ${
                showTime
                  ? `<div class="fp-msg__meta">
                      <time class="fp-msg__time">${escapeHtml(timeLabel)}${
                        !deleted && m.edited_at ? " · Edited" : ""
                      }</time>
                      ${
                        mine && seenMsgId === m.id
                          ? `<span class="fp-msg__seen" title="Seen">${avatarHtml(
                              current.other,
                              "fp-avatar--seen"
                            )}</span>`
                          : ""
                      }
                    </div>`
                  : mine && seenMsgId === m.id
                    ? `<div class="fp-msg__meta fp-msg__meta--seen-only">
                        <span class="fp-msg__seen" title="Seen">${avatarHtml(
                          current.other,
                          "fp-avatar--seen"
                        )}</span>
                      </div>`
                    : ""
              }
              ${
                deleted
                  ? ""
                  : `<div class="fp-bubble__tools" hidden>
                <div class="fp-react-bar">
                  ${REACTIONS.map(
                    (e) =>
                      `<button type="button" class="fp-react-pick" data-react="${escapeHtml(
                        m.id
                      )}" data-emoji="${escapeHtml(e)}" aria-label="React ${e}">${e}</button>`
                  ).join("")}
                </div>
                <div class="fp-bubble__actions">
                  <button type="button" class="fp-bubble__reply" data-reply="${escapeHtml(
                    m.id
                  )}">Reply</button>
                  ${
                    mine && !gifUrl && !share
                      ? `<button type="button" class="fp-bubble__edit" data-edit="${escapeHtml(
                          m.id
                        )}">Edit</button>`
                      : ""
                  }
                  <button type="button" class="fp-bubble__del" data-del-me="${escapeHtml(
                    m.id
                  )}">Delete for me</button>
                  ${
                    mine
                      ? `<button type="button" class="fp-bubble__del is-danger" data-del-everyone="${escapeHtml(
                          m.id
                        )}">Delete for everyone</button>`
                      : ""
                  }
                </div>
              </div>`
              }
            </div>
          </div>`;
          })
          .join("");
        if (stickBottom) box.scrollTop = box.scrollHeight;
        else box.scrollTop = prevScrollTop;
        const latest = threadMessages[threadMessages.length - 1];
        markChatRead(activeChatId, latest?.created_at);
        // Keep inbox preview cache warm when viewing a thread
        if (latest) {
          chatPreviews = {
            ...chatPreviews,
            [chatId]: {
              id: latest.id,
              friendship_id: chatId,
              sender_id: latest.sender_id,
              body: latest.body,
              created_at: latest.created_at,
              deleted_at: latest.deleted_at || null,
            },
          };
        }
      };
      const paintFromServer = (messages) => {
        if (sending) {
          // Keep optimistic bubbles until send finishes
          const locals = threadMessages.filter((m) =>
            String(m.id).startsWith("local-")
          );
          if (locals.length) {
            const server = Array.isArray(messages) ? messages : [];
            const merged = [...server];
            for (const local of locals) {
              const already = server.some(
                (m) =>
                  m.sender_id === local.sender_id &&
                  m.body === local.body &&
                  Math.abs(
                    new Date(m.created_at).getTime() -
                      new Date(local.created_at).getTime()
                  ) < 60000
              );
              if (!already) merged.push(local);
            }
            paint(merged);
            return;
          }
        }
        paint(messages);
      };
      chatPaint = paintFromServer;
      lastThreadPaintKey = "";

      const refreshThread = async () => {
        if (threadFetchBusy) {
          threadFetchQueued = true;
          return;
        }
        threadFetchBusy = true;
        try {
          do {
            threadFetchQueued = false;
            peerReadAt = await getPeerChatReadAt(
              chatId,
              current.otherId
            ).catch(() => peerReadAt);
            paintFromServer(await listMessages(chatId));
          } while (threadFetchQueued && box.isConnected);
        } finally {
          threadFetchBusy = false;
        }
      };

      box.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        const shareWatch = t.closest("[data-share-watch]");
        if (shareWatch) {
          e.preventDefault();
          e.stopPropagation();
          let media = null;
          try {
            media = JSON.parse(shareWatch.getAttribute("data-share-watch") || "");
          } catch {
            media = null;
          }
          if (!media?.id || !current?.otherId) {
            await showNotice({
              title: "Watch together",
              message: "Could not start from this share.",
            });
            return;
          }
          shareWatch.disabled = true;
          try {
            const item = {
              id: Number(media.id),
              mediaType: media.mediaType === "tv" ? "tv" : "movie",
              title: media.title || "Untitled",
              poster: media.poster || null,
            };
            addRecentMovie(item);
            const party = await createWatchParty({
              friendshipId: chatId,
              guestId: current.otherId,
              mediaType: item.mediaType,
              tmdbId: item.id,
              title: item.title,
              poster: item.poster,
            });
            location.hash = linkTo(partyWatchPath(party));
          } catch (err) {
            shareWatch.disabled = false;
            await showNotice({
              title: "Watch together",
              message: err.message || "Could not start watch party.",
            });
          }
          return;
        }

        if (t.closest(".fp-share-card")) {
          // Let poster link navigate; don't open bubble tools
          if (t.closest("a.fp-share-card__media")) return;
          e.stopPropagation();
          return;
        }

        const reactBtn = t.closest("[data-react]");
        if (reactBtn) {
          e.preventDefault();
          e.stopPropagation();
          try {
            await toggleMessageReaction(
              reactBtn.dataset.react,
              reactBtn.dataset.emoji
            );
            await refreshThread();
          } catch (err) {
            alert(err.message || "Could not react");
          }
          return;
        }

        const replyBtn = t.closest("[data-reply]");
        if (replyBtn) {
          e.preventDefault();
          e.stopPropagation();
          const msg = threadMessages.find((row) => row.id === replyBtn.dataset.reply);
          setReplyTarget(msg);
          box.querySelectorAll(".fp-bubble__tools").forEach((el) => {
            el.hidden = true;
          });
          return;
        }

        const jumpBtn = t.closest("[data-jump-reply]");
        if (jumpBtn) {
          e.preventDefault();
          e.stopPropagation();
          const target = [...box.querySelectorAll(".fp-msg[data-msg-id]")].find(
            (el) => el.dataset.msgId === jumpBtn.dataset.jumpReply
          );
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.add("is-flash");
            window.setTimeout(() => target.classList.remove("is-flash"), 900);
          }
          return;
        }

        const editBtn = t.closest("[data-edit]");
        if (editBtn) {
          e.preventDefault();
          e.stopPropagation();
          const msg = threadMessages.find((row) => row.id === editBtn.dataset.edit);
          const envelope = parseReplyEnvelope(msg?.body || "");
          const next = window.prompt("Edit message", envelope.body || "");
          if (next == null) return;
          const saved = envelope.reply
            ? wrapReplyMessage(envelope.reply, next)
            : next;
          try {
            await editMessage(editBtn.dataset.edit, saved);
            await refreshThread();
          } catch (err) {
            alert(err.message || "Could not edit");
          }
          return;
        }

        const delMeBtn = t.closest("[data-del-me]");
        if (delMeBtn) {
          e.preventDefault();
          e.stopPropagation();
          const ok = await showConfirm({
            title: "Delete for you?",
            message: "This removes the message from your chat only. Your friend can still see it.",
            confirmLabel: "Delete for me",
            cancelLabel: "Cancel",
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteMessageForMe(delMeBtn.dataset.delMe);
            await refreshThread();
          } catch (err) {
            alert(err.message || "Could not delete");
          }
          return;
        }

        const delAllBtn = t.closest("[data-del-everyone]");
        if (delAllBtn) {
          e.preventDefault();
          e.stopPropagation();
          const ok = await showConfirm({
            title: "Delete for everyone?",
            message: "This message will be removed for you and your friend.",
            confirmLabel: "Delete for everyone",
            cancelLabel: "Cancel",
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteMessageForEveryone(delAllBtn.dataset.delEveryone);
            await refreshThread();
          } catch (err) {
            alert(err.message || "Could not delete");
          }
          return;
        }

        const row = t.closest(".fp-msg[data-msg-id]");
        if (!row || !box.contains(row) || row.classList.contains("is-deleted")) return;
        // Toggle tools on this message; close others
        box.querySelectorAll(".fp-bubble__tools").forEach((el) => {
          if (!row.contains(el)) el.hidden = true;
        });
        const tools = row.querySelector(".fp-bubble__tools");
        if (tools) tools.hidden = !tools.hidden;
      });

      try {
        peerReadAt = await getPeerChatReadAt(
          activeChatId,
          current.otherId
        ).catch(() => null);
        paint(await listMessages(activeChatId));
        activity = await getFriendsActivityCounts().catch(() => activity);
      } catch (err) {
        box.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }

      if (unsubChat) unsubChat();
      peerIsTyping = false;

      const typingEl = panel.querySelector("#chat-typing");
      const typingLabel = panel.querySelector("#chat-typing-label");
      const peerName = current.other?.display_name || "Friend";
      let typingHideTimer = null;
      let typingPingTimer = null;
      let amTyping = false;

      const setPeerTyping = (visible, name = peerName) => {
        peerIsTyping = Boolean(visible);
        if (typingEl && typingLabel) {
          if (!visible) {
            typingEl.hidden = true;
            typingLabel.textContent = "";
          } else {
            typingLabel.textContent = `${name} is typing…`;
            typingEl.hidden = false;
            requestAnimationFrame(() => {
              box.scrollTop = box.scrollHeight;
            });
          }
        }
        syncPresenceUi();
      };

      // Stable topic so typing broadcast reaches the other person
      const channel = getSupabase()
        .channel(`friend-chat-${chatId}`, {
          config: { broadcast: { self: false } },
        })
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friend_messages",
            filter: `friendship_id=eq.${chatId}`,
          },
          () => {
            setPeerTyping(false);
            refreshThread()
              .then(async () => {
                activity = await getFriendsActivityCounts().catch(() => activity);
                notifyFriendsBadge();
              })
              .catch(() => {});
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friend_message_reactions",
          },
          () => {
            refreshThread().catch(() => {});
          }
        )
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          if (!payload || payload.userId === me.id) return;
          window.clearTimeout(typingHideTimer);
          if (payload.typing) {
            setPeerTyping(true, peerName);
            typingHideTimer = window.setTimeout(() => setPeerTyping(false), 2200);
          } else {
            setPeerTyping(false);
          }
        })
        .subscribe();

      const sendTyping = async (typing) => {
        try {
          await channel.send({
            type: "broadcast",
            event: "typing",
            payload: {
              typing: Boolean(typing),
              userId: me.id,
              name: me.user_metadata?.display_name || me.email || "Friend",
            },
          });
        } catch {
          /* ignore */
        }
      };

      const stopTypingPing = () => {
        window.clearTimeout(typingPingTimer);
        typingPingTimer = null;
        if (!amTyping) return;
        amTyping = false;
        sendTyping(false);
      };

      const pulseTyping = () => {
        sendTyping(true);
        amTyping = true;
        window.clearTimeout(typingPingTimer);
        typingPingTimer = window.setTimeout(stopTypingPing, 1400);
      };

      // Realtime can lag or miss events — poll the open thread so chat stays near-instant
      threadPoll = setInterval(() => {
        if (sending) return;
        refreshThread().catch(() => {});
      }, 4000);
      unsubChat = () => {
        stopTypingPing();
        window.clearTimeout(typingHideTimer);
        peerIsTyping = false;
        if (threadPoll) clearInterval(threadPoll);
        threadPoll = null;
        getSupabase().removeChannel(channel);
        unsubChat = null;
        chatPaint = null;
      };

      const form = panel.querySelector("#chat-form");
      const input = panel.querySelector("#chat-input");
      const sendBtn = panel.querySelector("#chat-send");
      const gifBtn = panel.querySelector("#chat-gif-btn");
      const gifStrip = panel.querySelector("#chat-gifs");
      const composer = panel.querySelector("#chat-composer");
      const composeSpacer = panel.querySelector("#chat-compose-spacer");
      const chatShell = panel.querySelector(".fp-chat--thread");
      const shareDraft = panel.querySelector("#share-draft");
      const shareDraftSend = panel.querySelector("#share-draft-send");
      const shareDraftCancel = panel.querySelector("#share-draft-cancel");

      paintReplyDraft = () => {
        if (!replyDraft) return;
        if (!replyTarget?.id) {
          replyDraft.hidden = true;
          replyDraft.innerHTML = "";
          requestAnimationFrame(() => syncChatViewport?.());
          return;
        }
        const who = replyTarget.mine
          ? "Yourself"
          : current.other?.display_name || "Friend";
        replyDraft.hidden = false;
        replyDraft.innerHTML = `
          <div class="fp-reply-draft__bar" aria-hidden="true"></div>
          <div class="fp-reply-draft__meta">
            <strong>Replying to ${escapeHtml(who)}</strong>
            <em>${escapeHtml(replyTarget.preview || "Message")}</em>
          </div>
          <button type="button" class="fp-text-btn" data-reply-cancel aria-label="Cancel reply">✕</button>`;
        replyDraft
          .querySelector("[data-reply-cancel]")
          ?.addEventListener("click", () => {
            replyTarget = null;
            paintReplyDraft();
          });
        requestAnimationFrame(() => syncChatViewport?.());
      };

      setReplyTarget = (msg) => {
        if (!msg || msg.deleted_at) return;
        const preview = chatBodyPreview(msg.body) || "Message";
        replyTarget = {
          id: msg.id,
          preview: preview.slice(0, 120),
          senderId: msg.sender_id,
          mine: msg.sender_id === me.id,
        };
        paintReplyDraft();
        input?.focus({ preventScroll: true });
        requestAnimationFrame(() => syncChatViewport?.());
      };

      // Messenger-style swipe right → reply
      let swipe = null;
      const resetSwipeVisual = (row) => {
        if (!row) return;
        const stack = row.querySelector(".fp-msg__stack");
        if (stack) {
          stack.style.transition = "transform 0.18s var(--ease, ease)";
          stack.style.transform = "";
          window.setTimeout(() => {
            if (stack.isConnected) stack.style.transition = "";
          }, 200);
        }
        row.classList.remove("is-swiping", "is-reply-ready");
      };
      box.addEventListener(
        "touchstart",
        (e) => {
          const row = e.target.closest(".fp-msg[data-msg-id]");
          if (!row || row.classList.contains("is-deleted")) return;
          if (e.target.closest("button, a, input, textarea, .fp-bubble__tools")) {
            return;
          }
          const t = e.changedTouches?.[0];
          if (!t) return;
          swipe = {
            row,
            id: row.dataset.msgId,
            x0: t.clientX,
            y0: t.clientY,
            dx: 0,
            armed: false,
          };
        },
        { passive: true }
      );
      box.addEventListener(
        "touchmove",
        (e) => {
          if (!swipe) return;
          const t = e.changedTouches?.[0];
          if (!t) return;
          const dx = t.clientX - swipe.x0;
          const dy = t.clientY - swipe.y0;
          if (!swipe.armed) {
            if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
              swipe = null;
              return;
            }
            if (dx > 10) swipe.armed = true;
            else return;
          }
          swipe.dx = Math.max(0, Math.min(dx, 76));
          const stack = swipe.row.querySelector(".fp-msg__stack");
          if (stack) {
            stack.style.transition = "none";
            stack.style.transform = `translateX(${swipe.dx}px)`;
          }
          swipe.row.classList.toggle("is-swiping", swipe.dx > 8);
          swipe.row.classList.toggle("is-reply-ready", swipe.dx >= 52);
        },
        { passive: true }
      );
      const endSwipe = () => {
        if (!swipe) return;
        const { row, dx, id } = swipe;
        resetSwipeVisual(row);
        if (dx >= 52) {
          const msg = threadMessages.find((m) => m.id === id);
          setReplyTarget(msg);
        }
        swipe = null;
      };
      box.addEventListener("touchend", endSwipe, { passive: true });
      box.addEventListener("touchcancel", endSwipe, { passive: true });

      shareDraftCancel?.addEventListener("click", () => {
        clearPendingShare();
        shareDraft?.remove();
        requestAnimationFrame(() => syncChatViewport?.());
      });

      shareDraftSend?.addEventListener("click", async () => {
        if (!pendingShare?.id || !chatId) return;
        shareDraftSend.disabled = true;
        try {
          await sendMessage(chatId, shareMessageBody(pendingShare));
          clearPendingShare();
          shareDraft?.remove();
          requestAnimationFrame(() => {
            syncChatViewport?.();
            box?.scrollTo?.({ top: box.scrollHeight, behavior: "smooth" });
          });
        } catch (err) {
          shareDraftSend.disabled = false;
          await showNotice({
            title: "Share",
            message: err.message || "Could not send.",
          });
        }
      });

      let inputFocused = false;
      let gifOpen = false;
      let gifTimer = 0;
      let gifReq = 0;

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
            <div class="fp-chat__gifs-head">
              <strong>${escapeHtml(label)}</strong>
              <button type="button" class="fp-chat__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
            </div>
            <p class="fp-chat__gifs-empty">No GIFs found</p>`;
          gifStrip.hidden = false;
          return;
        }
        gifStrip.innerHTML = `
          <div class="fp-chat__gifs-head">
            <strong>${escapeHtml(label)}</strong>
            <span class="fp-chat__gifs-via">GIPHY</span>
            <button type="button" class="fp-chat__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
          </div>
          <div class="fp-chat__gifs-rail" role="presentation">
            ${items
              .map(
                (g) => `
              <button
                type="button"
                class="fp-chat__gif-pick"
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
        // Re-pin above keyboard after height change
        requestAnimationFrame(() => syncChatViewport());
      };

      const loadGifs = async (query) => {
        if (!hasGifApi() || !gifStrip) return;
        const req = ++gifReq;
        const q = String(query || "").trim();
        gifStrip.hidden = false;
        gifStrip.innerHTML = `
          <div class="fp-chat__gifs-head">
            <strong>${q ? `Results for “${escapeHtml(q)}”` : "Trending GIFs"}</strong>
            <button type="button" class="fp-chat__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
          </div>
          <p class="fp-chat__gifs-empty">Searching…</p>`;
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
            <div class="fp-chat__gifs-head">
              <strong>GIFs</strong>
              <button type="button" class="fp-chat__gifs-close" data-gif-close aria-label="Close GIFs">✕</button>
            </div>
            <p class="fp-chat__gifs-empty">Couldn’t load GIFs</p>`;
        }
      };

      let screenH = Math.round(
        window.visualViewport?.height || window.innerHeight
      );

      const rememberScreen = () => {
        if (inputFocused) return;
        const vv = window.visualViewport;
        screenH = Math.round(Math.max(window.innerHeight, vv?.height || 0));
      };

      const measureComposeH = () =>
        Math.ceil(
          composer?.getBoundingClientRect().height ||
            form?.getBoundingClientRect().height ||
            0
        ) || 58;

      const clearComposerPin = () => {
        chatShell?.style.removeProperty("height");
        chatShell?.style.removeProperty("max-height");
        root.style.removeProperty("--friends-chat-vh");
        root.style.removeProperty("transform");
        document.documentElement.style.removeProperty("--friends-kb-bottom");
        if (composeSpacer) composeSpacer.hidden = true;
      };

      clearChatViewport();

      const syncChatViewport = () => {
        const vv = window.visualViewport;
        const split = window.matchMedia("(min-width: 768px)").matches;
        const layoutH = window.innerHeight;
        const visibleH = vv ? Math.round(vv.height) : layoutH;
        const offsetTop = vv ? Math.round(vv.offsetTop) : 0;
        rememberScreen();
        // While the message field is focused on a phone, the tab bar stays hidden.
        // Height math alone fails: Android shrinks innerHeight before focus fires.
        const kbMode = Boolean(inputFocused && !split);

        document.body.classList.toggle("is-friends-chat-kb", kbMode);

        const composeH = measureComposeH();
        document.documentElement.style.setProperty(
          "--friends-compose-h",
          `${composeH}px`
        );

        if (!kbMode) {
          clearComposerPin();
          return;
        }

        const chatVh = Math.max(220, visibleH);
        root.style.setProperty("--friends-chat-vh", `${chatVh}px`);
        if (chatShell) {
          chatShell.style.height = `${chatVh}px`;
          chatShell.style.maxHeight = `${chatVh}px`;
        }
        if (offsetTop > 1) root.style.transform = `translateY(${offsetTop}px)`;
        else root.style.removeProperty("transform");

        requestAnimationFrame(() => {
          if (box) box.scrollTop = box.scrollHeight;
        });
      };

      syncChatViewport();
      window.visualViewport?.addEventListener("resize", syncChatViewport);
      window.visualViewport?.addEventListener("scroll", syncChatViewport);
      window.addEventListener("resize", syncChatViewport);
      unsubChatVv = () => {
        window.visualViewport?.removeEventListener("resize", syncChatViewport);
        window.visualViewport?.removeEventListener("scroll", syncChatViewport);
        window.removeEventListener("resize", syncChatViewport);
        clearComposerPin();
        document.documentElement.style.removeProperty("--friends-compose-h");
        document.body.classList.remove("is-friends-chat-kb");
        unsubChatVv = null;
      };

      const syncSendEnabled = () => {
        if (!sendBtn) return;
        const hasText = Boolean(String(input?.value || "").trim());
        sendBtn.disabled = sending || !hasText;
        sendBtn.classList.toggle("is-ready", hasText && !sending);
      };

      const autosizeChatInput = () => {
        if (!input) return;
        input.style.height = "auto";
        const max = Math.round(
          Math.min(window.innerHeight * 0.32, 148) || 148
        );
        const next = Math.min(input.scrollHeight, max);
        input.style.height = `${Math.max(next, 40)}px`;
        input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
      };

      syncSendEnabled();
      autosizeChatInput();
      input?.addEventListener("input", () => {
        syncSendEnabled();
        autosizeChatInput();
        syncChatViewport?.();
        if (String(input?.value || "").trim()) pulseTyping();
        else stopTypingPing();
      });

      const sendChat = async (rawBody) => {
        if (sending) return;
        const typed = String(rawBody ?? input?.value ?? "").trim();
        if (!typed) {
          input?.focus();
          return;
        }
        const pendingReply = replyTarget;
        const text = pendingReply?.id
          ? wrapReplyMessage(pendingReply, typed)
          : typed;
        sending = true;
        stopTypingPing();
        clearTimeout(gifTimer);
        hideGifStrip();
        if (input) input.value = "";
        replyTarget = null;
        paintReplyDraft();
        syncSendEnabled();
        autosizeChatInput();
        // Show the bubble immediately — don't wait on the network round-trip
        const optimistic = {
          id: `local-${Date.now()}`,
          friendship_id: chatId,
          sender_id: me.id,
          body: text,
          created_at: new Date().toISOString(),
          edited_at: null,
          reactions: [],
        };
        paint([...threadMessages, optimistic]);
        requestAnimationFrame(() => {
          box.scrollTop = box.scrollHeight;
        });
        try {
          await sendMessage(chatId, text);
          await refreshThread();
        } catch (err) {
          const inner = unwrapReplyBody(text);
          if (
            input &&
            !parseGifMessage(inner) &&
            !parseShareMessage(inner)
          ) {
            input.value = inner;
            autosizeChatInput();
          }
          if (pendingReply?.id) {
            replyTarget = pendingReply;
            paintReplyDraft();
          }
          paint(threadMessages.filter((m) => m.id !== optimistic.id));
          alert(err.message);
        } finally {
          sending = false;
          syncSendEnabled();
          input?.focus({ preventScroll: true });
          syncChatViewport();
        }
      };

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
          syncChatViewport();
          return;
        }
        const q = String(input?.value || "").trim();
        await loadGifs(q.length >= 2 ? q : "");
        syncChatViewport();
      });

      gifStrip?.addEventListener("click", (e) => {
        if (e.target.closest("[data-gif-close]")) {
          e.preventDefault();
          hideGifStrip();
          syncChatViewport();
          return;
        }
        const pick = e.target.closest("[data-gif-url]");
        if (!pick) return;
        e.preventDefault();
        const url = pick.getAttribute("data-gif-url");
        if (!url) return;
        const gifId = pick.getAttribute("data-gif-id") || "";
        registerGifShare(gifId, String(input?.value || "").trim());
        sendChat(gifMessageBody(url));
      });

      form?.addEventListener("submit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendChat();
      });

      sendBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendChat();
      });

      let allowLineBreak = false;

      input?.addEventListener("keydown", (e) => {
        if (e.isComposing || e.key === "Process" || e.keyCode === 229) return;
        if (e.key !== "Enter") return;
        if (e.shiftKey) {
          allowLineBreak = true;
          return;
        }
        e.preventDefault();
        sendChat();
      });

      input?.addEventListener("beforeinput", (e) => {
        if (e.isComposing || e.inputType !== "insertLineBreak") return;
        if (allowLineBreak) {
          allowLineBreak = false;
          return;
        }
        e.preventDefault();
        sendChat();
      });

      input?.addEventListener("focus", () => {
        inputFocused = true;
        document.body.classList.add("is-friends-chat-kb");
        syncChatViewport();
        [80, 220, 420].forEach((ms) => {
          setTimeout(() => {
            if (!inputFocused) return;
            syncChatViewport();
            if (box) box.scrollTop = box.scrollHeight;
          }, ms);
        });
      });

      input?.addEventListener("blur", () => {
        inputFocused = false;
        stopTypingPing();
        setTimeout(() => {
          if (inputFocused) return;
          syncChatViewport();
        }, 80);
      });

      return;
    }

    const accepted = friendships.filter((f) => f.status === "accepted");
    const recent = getRecentMovies().slice(0, 40);
    let selectedFriend = null;
    let selectedMedia = null;

    panel.innerHTML = `
      <section class="fp-block">
        <h2>New invite</h2>
        <p class="muted fp-lead">Search a friend and a recent title, then send an invite.</p>
        <form class="fp-watch" id="watch-invite">
          <div class="fp-search" data-search="friend">
            <span class="fp-search__label">Friend</span>
            <div class="fp-search__box">
              <input
                type="search"
                id="friend-search"
                placeholder="Search friend by name or email"
                autocomplete="off"
                ${!accepted.length ? "disabled" : ""}
              />
            </div>
            <div class="fp-search__menu" id="friend-menu" hidden></div>
            <input type="hidden" name="friendshipId" id="friend-value" />
            <input type="hidden" name="guestId" id="guest-value" />
            <div class="fp-search__picked" id="friend-picked" hidden></div>
          </div>

          <div class="fp-search" data-search="media">
            <span class="fp-search__label">Title</span>
            <div class="fp-search__box">
              <input
                type="search"
                id="media-search"
                placeholder="Search recent titles"
                autocomplete="off"
                ${!recent.length ? "disabled" : ""}
              />
            </div>
            <div class="fp-search__menu" id="media-menu" hidden></div>
            <input type="hidden" name="media" id="media-value" />
            <div class="fp-search__picked" id="media-picked" hidden></div>
          </div>

          <button class="btn btn--primary" type="submit" id="watch-submit" disabled>Send invite</button>
          <p class="fp-status muted" id="watch-msg">
            ${
              !accepted.length
                ? "Add a friend first."
                : !recent.length
                  ? "Browse a movie or show first so it appears in Recent."
                  : "Type to search, then pick from the list."
            }
          </p>
        </form>
      </section>

      <section class="fp-block">
        <h2>Invites</h2>
        <div class="fp-list" id="party-list"></div>
      </section>
    `;

    paintPartyList();

    const friendInput = panel.querySelector("#friend-search");
    const mediaInput = panel.querySelector("#media-search");
    const friendMenu = panel.querySelector("#friend-menu");
    const mediaMenu = panel.querySelector("#media-menu");
    const friendValue = panel.querySelector("#friend-value");
    const guestValue = panel.querySelector("#guest-value");
    const mediaValue = panel.querySelector("#media-value");
    const friendPicked = panel.querySelector("#friend-picked");
    const mediaPicked = panel.querySelector("#media-picked");
    const friendWrap = panel.querySelector('[data-search="friend"]');
    const mediaWrap = panel.querySelector('[data-search="media"]');
    const submitBtn = panel.querySelector("#watch-submit");

    const syncSubmit = () => {
      submitBtn.disabled = !(selectedFriend && selectedMedia);
    };

    const closeMenus = () => {
      friendMenu.hidden = true;
      mediaMenu.hidden = true;
    };

    const setFriend = (friend) => {
      selectedFriend = friend;
      if (!friend) {
        friendValue.value = "";
        guestValue.value = "";
        friendPicked.hidden = true;
        friendPicked.innerHTML = "";
        friendInput.value = "";
        friendInput.hidden = false;
        friendWrap?.classList.remove("is-picked");
        syncSubmit();
        return;
      }
      friendValue.value = friend.id;
      guestValue.value = friend.otherId;
      friendInput.hidden = true;
      friendInput.blur();
      friendWrap?.classList.add("is-picked");
      friendPicked.hidden = false;
      friendPicked.innerHTML = `
        ${avatarHtml(friend.other, "fp-avatar--sm")}
        <div>
          <strong>${escapeHtml(friend.other?.display_name || "Friend")}</strong>
          <span>${escapeHtml(friend.other?.email || "")}</span>
        </div>
        <button type="button" class="fp-search__clear" data-clear="friend" aria-label="Clear friend">✕</button>
      `;
      friendPicked.querySelector('[data-clear="friend"]')?.addEventListener("click", () =>
        setFriend(null)
      );
      closeMenus();
      syncSubmit();
    };

    const setMedia = (item) => {
      selectedMedia = item;
      if (!item) {
        mediaValue.value = "";
        mediaPicked.hidden = true;
        mediaPicked.innerHTML = "";
        mediaInput.value = "";
        mediaInput.hidden = false;
        mediaWrap?.classList.remove("is-picked");
        syncSubmit();
        return;
      }
      mediaValue.value = `${item.mediaType || "movie"}:${item.id}`;
      mediaInput.hidden = true;
      mediaInput.blur();
      mediaWrap?.classList.add("is-picked");
      mediaPicked.hidden = false;
      mediaPicked.innerHTML = `
        ${
          item.poster
            ? `<img class="fp-search__poster" src="${escapeHtml(item.poster)}" alt="" />`
            : `<div class="fp-search__poster fp-search__poster--ph"></div>`
        }
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml((item.mediaType || "movie").toUpperCase())}</span>
        </div>
        <button type="button" class="fp-search__clear" data-clear="media" aria-label="Clear title">✕</button>
      `;
      mediaPicked.querySelector('[data-clear="media"]')?.addEventListener("click", () =>
        setMedia(null)
      );
      closeMenus();
      syncSubmit();
    };

    // Pre-fill title when arriving from detail / Shorts “Watch together”
    if (pendingWatchMedia?.id) {
      const item = {
        id: Number(pendingWatchMedia.id),
        mediaType: pendingWatchMedia.mediaType || "movie",
        title: pendingWatchMedia.title || "Untitled",
        poster: pendingWatchMedia.poster || null,
      };
      pendingWatchMedia = null;
      addRecentMovie(item);
      setMedia(item);
      if (mediaInput && !recent.length) {
        mediaInput.disabled = false;
        mediaInput.placeholder = "Search recent titles";
      }
      const msg = panel.querySelector("#watch-msg");
      if (msg && accepted.length) {
        msg.textContent = "Title ready — pick a friend to invite.";
      }
    }

    const renderFriendMenu = (query = "") => {
      const q = query.trim().toLowerCase();
      const matches = accepted.filter((f) => {
        const label = `${f.other?.display_name || ""} ${f.other?.email || ""}`.toLowerCase();
        return !q || label.includes(q);
      });
      if (!matches.length) {
        friendMenu.innerHTML = `<p class="fp-search__empty">No friends found</p>`;
        friendMenu.hidden = false;
        return;
      }
      friendMenu.innerHTML = matches
        .map(
          (f) => `
        <button type="button" class="fp-search__option" data-friend-id="${f.id}">
          ${avatarHtml(f.other, "fp-avatar--sm")}
          <div>
            <strong>${escapeHtml(f.other?.display_name || "Friend")}</strong>
            <span>${escapeHtml(f.other?.email || "")}</span>
          </div>
        </button>`
        )
        .join("");
      friendMenu.hidden = false;
      friendMenu.querySelectorAll("[data-friend-id]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => {
          const friend = accepted.find((f) => f.id === btn.dataset.friendId);
          setFriend(friend || null);
        });
      });
    };

    const renderMediaMenu = (query = "") => {
      const q = query.trim().toLowerCase();
      const matches = recent.filter((m) => {
        const label = String(m.title || "").toLowerCase();
        return !q || label.includes(q);
      });
      if (!matches.length) {
        mediaMenu.innerHTML = `<p class="fp-search__empty">No titles found</p>`;
        mediaMenu.hidden = false;
        return;
      }
      mediaMenu.innerHTML = matches
        .map(
          (m) => `
        <button type="button" class="fp-search__option" data-media-key="${m.mediaType || "movie"}:${m.id}">
          ${
            m.poster
              ? `<img class="fp-search__poster" src="${escapeHtml(m.poster)}" alt="" />`
              : `<div class="fp-search__poster fp-search__poster--ph"></div>`
          }
          <div>
            <strong>${escapeHtml(m.title)}</strong>
            <span>${escapeHtml((m.mediaType || "movie").toUpperCase())}</span>
          </div>
        </button>`
        )
        .join("");
      mediaMenu.hidden = false;
      mediaMenu.querySelectorAll("[data-media-key]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => {
          const [mediaType, id] = String(btn.dataset.mediaKey).split(":");
          const item = recent.find(
            (m) =>
              String(m.id) === String(id) && (m.mediaType || "movie") === mediaType
          );
          setMedia(item || null);
        });
      });
    };

    const closeFriendMenu = () => {
      if (friendMenu) friendMenu.hidden = true;
    };
    const closeMediaMenu = () => {
      if (mediaMenu) mediaMenu.hidden = true;
    };

    // Friend dropdown sits absolutely over the title field — close it before title can receive taps
    friendInput?.addEventListener("pointerdown", () => closeMediaMenu());
    mediaInput?.addEventListener("pointerdown", () => closeFriendMenu());

    friendInput?.addEventListener("focus", () => {
      closeMediaMenu();
      renderFriendMenu(friendInput.value);
    });
    friendInput?.addEventListener("input", () => renderFriendMenu(friendInput.value));
    friendInput?.addEventListener("blur", () => {
      setTimeout(closeFriendMenu, 150);
    });

    mediaInput?.addEventListener("focus", () => {
      closeFriendMenu();
      renderMediaMenu(mediaInput.value);
    });
    mediaInput?.addEventListener("input", () => renderMediaMenu(mediaInput.value));
    mediaInput?.addEventListener("blur", () => {
      setTimeout(closeMediaMenu, 150);
    });

    // Tap outside either menu closes it (mobile-friendly)
    unsubWatchDoc?.();
    const onDocPointer = (e) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (friendMenu && !friendMenu.hidden && !friendMenu.contains(t) && t !== friendInput) {
        closeFriendMenu();
      }
      if (mediaMenu && !mediaMenu.hidden && !mediaMenu.contains(t) && t !== mediaInput) {
        closeMediaMenu();
      }
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    unsubWatchDoc = () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      unsubWatchDoc = null;
    };

    panel.querySelector("#watch-invite")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = panel.querySelector("#watch-msg");
      if (!selectedFriend || !selectedMedia) {
        msg.textContent = "Pick a friend and a title first.";
        return;
      }
      msg.textContent = "Sending…";
      try {
        const party = await createWatchParty({
          friendshipId: selectedFriend.id,
          guestId: selectedFriend.otherId,
          mediaType: selectedMedia.mediaType || "movie",
          tmdbId: Number(selectedMedia.id),
          title: selectedMedia.title || "Untitled",
          poster: selectedMedia.poster || null,
        });
        msg.textContent = "Invite sent — opening room…";
        location.hash = linkTo(partyWatchPath(party));
      } catch (err) {
        msg.textContent = err.message || "Failed to invite";
      }
    });

  }

  // Stable delegation — survives soft refreshes (no blink / lost taps)
  page.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const dismissCard = t.closest("[data-pymk-dismiss]");
    if (dismissCard) {
      const rail = dismissCard.closest(".pymk__rail");
      dismissCard.closest(".pymk__card")?.remove();
      if (rail && !rail.querySelector(".pymk__card")) {
        const box = rail.parentElement;
        if (box) {
          box.innerHTML = emptyState(
            "No one new right now",
            "When more people join LANTAW, they’ll show up here."
          );
        }
      }
      return;
    }

    const addBtn = t.closest("[data-add]");
    const acceptFriend = t.closest("[data-accept]");
    const declineFriend = t.closest("[data-decline]");
    const removeFriend = t.closest("[data-remove]");
    const chatBtn = t.closest("[data-chat]");
    const accept = t.closest("[data-party-accept]");
    const decline = t.closest("[data-party-decline]");
    const end = t.closest("[data-party-end]");
    const del = t.closest("[data-party-delete]");

    if (
      !addBtn &&
      !acceptFriend &&
      !declineFriend &&
      !removeFriend &&
      !chatBtn &&
      !accept &&
      !decline &&
      !end &&
      !del
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const afterPeopleChange = async () => {
      await refreshData();
      syncTabBadgesOnly();
      paintPeopleLists();
      notifyFriendsBadge();
    };

    if (addBtn) {
      const id = addBtn.dataset.add;
      addBtn.disabled = true;
      addBtn.textContent = "…";
      const peopleMsg = page.querySelector("#people-msg");
      if (peopleMsg) {
        peopleMsg.hidden = false;
        peopleMsg.textContent = "Sending request…";
      }
      try {
        await sendFriendRequest(id);
        if (peopleMsg) peopleMsg.textContent = "Request sent.";
        addBtn.closest(".pymk__card, .fp-row")?.remove();
        await afterPeopleChange();
      } catch (err) {
        if (peopleMsg) peopleMsg.textContent = err.message || "Could not send request";
        addBtn.disabled = false;
        addBtn.textContent = addBtn.classList.contains("pymk__add")
          ? "Add friend"
          : "Add";
      }
      return;
    }

    if (acceptFriend) {
      try {
        await respondToFriendRequest(acceptFriend.dataset.accept, true);
        await afterPeopleChange();
      } catch (err) {
        alert(err.message || "Could not accept");
      }
      return;
    }

    if (declineFriend) {
      try {
        await respondToFriendRequest(declineFriend.dataset.decline, false);
        await afterPeopleChange();
      } catch (err) {
        alert(err.message || "Could not decline");
      }
      return;
    }

    if (removeFriend) {
      try {
        await removeFriendship(removeFriend.dataset.remove);
        await afterPeopleChange();
      } catch (err) {
        alert(err.message || "Could not remove");
      }
      return;
    }

    if (chatBtn) {
      activeChatId = chatBtn.dataset.chat;
      tab = "chat";
      renderShell();
      renderPanel();
      return;
    }

    if (accept) {
      const id = accept.dataset.partyAccept;
      const party = parties.find((p) => p.id === id);
      try {
        await updateWatchPartyStatus(id, "active");
        if (party) {
          location.hash = linkTo(partyWatchPath({ ...party, status: "active" }));
          return;
        }
        await refreshData();
        paintPartyList();
        syncTabBadgesOnly();
      } catch (err) {
        alert(err.message || "Could not accept");
      }
      return;
    }

    if (decline) {
      try {
        await updateWatchPartyStatus(decline.dataset.partyDecline, "declined");
        await refreshData();
        paintPartyList();
        syncTabBadgesOnly();
      } catch (err) {
        alert(err.message || "Could not decline");
      }
      return;
    }

    if (end) {
      try {
        // Host/guest End removes the room + chat from the lobby.
        await endWatchParty(end.dataset.partyEnd);
        await refreshData();
        paintPartyList();
        syncTabBadgesOnly();
      } catch (err) {
        alert(err.message || "Could not end");
      }
      return;
    }

    if (del) {
      del.setAttribute("disabled", "true");
      try {
        await deleteWatchParty(del.dataset.partyDelete);
        await refreshData();
        paintPartyList();
        syncTabBadgesOnly();
      } catch (err) {
        alert(err.message || "Could not delete");
        del.removeAttribute("disabled");
      }
    }
  });

  const syncTabBadgesOnly = () => {
    const actions = page.querySelector(".fp-msg-actions");
    if (!actions) return;
    const setBadge = (name, n) => {
      const btn = actions.querySelector(`[data-tab="${name}"]`);
      if (!btn) return;
      let em = btn.querySelector("em");
      if (!n) {
        em?.remove();
        return;
      }
      if (!em) {
        em = document.createElement("em");
        btn.appendChild(em);
      }
      em.textContent = n > 9 ? "9+" : String(n);
    };
    setBadge("friends", activity.requests || 0);
    setBadge("chat", activity.chats || 0);
    setBadge("watch", activity.invites || 0);
    setBadge("notices", unreadNoticeCount());
  };

  async function applyLiveUpdate(payload) {
    if (liveBusy) {
      liveQueued = true;
      return;
    }
    liveBusy = true;
    try {
      const table = payload?.table;
      const fromBadge = payload?.source === "badge-event";
      const source = payload?.source;
      const isSoft =
        source === "poll" ||
        source === "visible" ||
        source === "queued" ||
        fromBadge;

      // Open thread: refresh messages first — skip heavy friendship/party refetch
      if (tab === "chat" && activeChatId && chatPaint) {
        const row = payload?.new;
        const msgEvent = table === "friend_messages";
        const readEvent = table === "friend_chat_reads";
        const forThis =
          !(msgEvent || readEvent) ||
          !row?.friendship_id ||
          row.friendship_id === activeChatId;
        if (forThis && (msgEvent || readEvent || isSoft || !table)) {
          try {
            if (readEvent || isSoft || !table) {
              const peerId =
                friendships.find((f) => f.id === activeChatId)?.otherId || null;
              if (peerId) {
                peerReadAt = await getPeerChatReadAt(
                  activeChatId,
                  peerId
                ).catch(() => peerReadAt);
              }
            }
            chatPaint(await listMessages(activeChatId));
          } catch (_) {
            /* ignore */
          }
        }
        refreshChatPreviews().catch(() => {});
        activity = await getFriendsActivityCounts().catch(() => activity);
        syncTabBadgesOnly();
        if (!fromBadge) notifyFriendsBadge();
        return;
      }

      await refreshData();
      // Avoid badge-event → refresh → notify → badge-event loops
      if (!fromBadge) notifyFriendsBadge();

      syncTabBadgesOnly();

      // Always patch lists in place — never remount shell (blinks)
      if (tab === "watch") {
        paintPartyList();
      } else if (tab === "friends") {
        paintPeopleLists();
      } else if (tab === "chat") {
        // Soft-update inbox only — never remount (blinks)
        await refreshChatPreviews();
        paintInboxList();
      }
      writeInboxSnapshot();
    } finally {
      liveBusy = false;
      if (liveQueued) {
        liveQueued = false;
        scheduleLiveRefresh({ source: "queued" });
      }
    }
  }

  function scheduleLiveRefresh(payload) {
    clearTimeout(liveTimer);
    // Message events should paint ASAP; polls can debounce a bit
    const delay =
      payload?.table === "friend_messages" ||
      payload?.table === "friend_chat_reads"
        ? 40
        : 180;
    liveTimer = setTimeout(() => {
      applyLiveUpdate(payload).catch(() => {});
    }, delay);
  }

  const inboxSnapshot =
    readInboxSnapshot() || (await idbGet(`friends:${me.id}`));
  if (inboxSnapshot) {
    friendships = Array.isArray(inboxSnapshot.friendships)
      ? inboxSnapshot.friendships
      : [];
    parties = Array.isArray(inboxSnapshot.parties) ? inboxSnapshot.parties : [];
    watchingByUser = pruneWatchingMap(
      { ...(inboxSnapshot.watchingByUser || {}) },
      { isOnline: isUserOnline }
    );
    activity = inboxSnapshot.activity || activity;
    chatPreviews = inboxSnapshot.chatPreviews || {};
    friendNotes = inboxSnapshot.friendNotes || {};
    rememberLastSeen(friendships.map((f) => f.other).filter(Boolean));
  }

  renderShell();
  if (inboxSnapshot) {
    await renderPanel();
    syncPresenceUi();
  }

  try {
    // Friend list first so chats can paint. Parties / watching / badges run beside it.
    const partiesP = listWatchParties().catch(() => parties);
    const watchP = listFriendsWatching().catch(() => watchingByUser);
    const activityP = getFriendsActivityCounts().catch(() => activity);
    friendships = await listFriendships();
    rememberLastSeen(friendships.map((f) => f.other).filter(Boolean));
    const notesP = refreshNotes();
    const noticesP = refreshNotices();
    const previewsP = refreshChatPreviews();
    if (!inboxSnapshot) {
      renderShell();
      await renderPanel();
    }
    const [nextParties, nextWatching, nextActivity] = await Promise.all([
      partiesP,
      watchP,
      activityP,
      previewsP,
      notesP,
      noticesP,
    ]);
    parties = nextParties;
    watchingByUser = pruneWatchingMap(nextWatching || {}, {
      isOnline: isUserOnline,
    });
    activity = nextActivity;
    writeInboxSnapshot();
    if (tab === "chat" && !activeChatId) {
      paintInboxList();
      paintPeopleRow();
      syncTabBadgesOnly();
    } else {
      renderShell();
      await renderPanel();
    }
  } catch (err) {
    page.querySelector("#friends-panel").innerHTML = `
      ${emptyState("Couldn’t load Friends", err.message)}
      <p class="muted">Run migrations <code>202603260003_friends_chat_watch.sql</code> and <code>202603260005_friends_realtime.sql</code> in Supabase.</p>
    `;
    return {
      suspend() {
        page.querySelector("textarea")?.blur();
        clearChatViewport();
        root.classList.remove("view--friends-chat", "view--note");
        document.body.classList.remove("is-friends-chat", "is-friends-chat-kb", "is-note-page");
      },
      resume() {
        syncChatLock();
      },
      unmount() {
        clearTimeout(liveTimer);
        unsubChat?.();
        unsubPage?.();
        unsubWatchDoc?.();
        unsubPresence?.();
        clearChatViewport();
      },
    };
  }
  await renderPanel();
  syncPresenceUi();

  // Realtime + light poll (Watch invites). Poll must not remount People.
  unsubPage = subscribeFriendsRealtime(
    (payload) => {
      scheduleLiveRefresh(payload);
    },
    { pollMs: 12000, listenBadgeEvent: true }
  );
  unsubPresence = onPresenceChange(() => syncWatchingPresence());
  syncWatchingPresence();
  // Refresh “5m ago” labels and drop stale / offline Watching-now chips
  const lastSeenTick = window.setInterval(() => syncWatchingPresence(), 60_000);

  const onActivityNotice = () => {
    refreshNotices()
      .then(() => {
        syncTabBadgesOnly();
        if (tab === "notices") renderPanel();
      })
      .catch(() => {});
  };
  window.addEventListener(ACTIVITY_NOTICE_EVENT, onActivityNotice);

  return {
    suspend() {
      page.querySelector("textarea")?.blur();
      clearChatViewport();
      root.classList.remove("view--friends-chat", "view--note");
      document.body.classList.remove("is-friends-chat", "is-friends-chat-kb", "is-note-page");
    },
    resume() {
      syncChatLock();
    },
    unmount() {
      window.removeEventListener("popstate", onNotePop);
      window.removeEventListener(ACTIVITY_NOTICE_EVENT, onActivityNotice);
      clearTimeout(liveTimer);
      clearInterval(lastSeenTick);
      peerIsTyping = false;
      closeFriendProfile();
      unsubChat?.();
      unsubPage?.();
      unsubWatchDoc?.();
      unsubPresence?.();
      clearChatViewport();
      page.classList.remove("friends-page--chat", "friends-page--note");
      root.classList.remove("view--friends-chat", "view--note");
      document.body.classList.remove("is-friends-chat", "is-friends-chat-kb", "is-note-page");
    },
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
