import { getUser } from "../services/authService.js";
import { getRecentMovies } from "../services/recentService.js";
import { getSupabase } from "../lib/supabase.js";
import {
  createWatchParty,
  getFriendsActivityCounts,
  listChatPreviews,
  listFriendships,
  listMessages,
  listWatchParties,
  markChatRead,
  partyWatchPath,
  removeFriendship,
  respondToFriendRequest,
  searchProfiles,
  notifyFriendsBadge,
  sendFriendRequest,
  sendMessage,
  editMessage,
  toggleMessageReaction,
  subscribeFriendsRealtime,
  endWatchParty,
  updateWatchPartyStatus,
  deleteWatchParty,
} from "../services/friendsService.js";
import {
  isUserOnline,
  onPresenceChange,
  startPresence,
} from "../services/presenceService.js";
import { startVideoCall } from "../services/callService.js";
import { showConfirm, showNotice } from "../lib/appModal.js";
import { loadingHtml } from "../components/Loading.js";
import { linkTo } from "../router/index.js";

export async function FriendsView(root) {
  const me = await getUser();
  if (!me) {
    root.innerHTML = `<p class="muted">Sign in to use Friends.</p>`;
    return { unmount() {} };
  }

  let tab = "chat";
  try {
    const fromShorts = sessionStorage.getItem("lantaw-shorts-watch");
    if (fromShorts) {
      tab = "watch";
      sessionStorage.removeItem("lantaw-shorts-watch");
    }
  } catch {
    /* ignore */
  }
  let friendships = [];
  let parties = [];
  let activity = { requests: 0, chats: 0, invites: 0, chatIds: [] };
  let chatPreviews = {};
  let activeChatId = null;
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
      const on = isUserOnline(el.dataset.presenceId);
      el.classList.toggle("is-online", on || peerIsTyping);
      const inThread = Boolean(el.closest(".fp-chat__head"));
      const onLabel =
        inThread && peerIsTyping
          ? "Typing…"
          : inThread
            ? "Active now"
            : "Online";
      const offLabel = "Offline";
      const showOn = on || (inThread && peerIsTyping);
      el.setAttribute("title", showOn ? onLabel : offLabel);
      el.setAttribute("aria-label", showOn ? onLabel : offLabel);
      const label = el.querySelector("[data-presence-label]");
      if (label) {
        label.textContent = showOn ? onLabel : offLabel;
        label.classList.toggle("is-online", showOn);
        label.classList.toggle("is-typing", inThread && peerIsTyping);
      }
    });
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
    page.classList.toggle("friends-page--chat", locked);
    page.classList.toggle("friends-page--inbox", tab === "chat" && !activeChatId);
    root.classList.toggle("view--friends-chat", locked);
    document.body.classList.toggle("is-friends-chat", locked);
    if (!locked) clearChatViewport();
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

  const previewLine = (preview) => {
    if (!preview?.body) return "Tap to say hi";
    const mine = preview.sender_id === me.id;
    const text = String(preview.body).replace(/\s+/g, " ").trim();
    const clipped = text.length > 64 ? `${text.slice(0, 63)}…` : text;
    return mine ? `You: ${clipped}` : clipped;
  };

  const watchingPartyFor = (friendshipId) =>
    parties.find(
      (p) =>
        p.friendship_id === friendshipId &&
        (p.status === "active" || p.status === "invited")
    ) || null;

  const sortedInboxFriends = (accepted, previews = chatPreviews) =>
    [...accepted].sort((a, b) => {
      const wa = watchingPartyFor(a.id);
      const wb = watchingPartyFor(b.id);
      const waRank = wa?.status === "active" ? 2 : wa ? 1 : 0;
      const wbRank = wb?.status === "active" ? 2 : wb ? 1 : 0;
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

  const convoListHtml = (accepted, previews = chatPreviews) =>
    sortedInboxFriends(accepted, previews)
      .map((f) => {
        const on = isUserOnline(f.other?.id);
        const unread = activity.chatIds?.includes(f.id);
        const preview = previews[f.id];
        const hasChat = Boolean(preview);
        const watching = watchingPartyFor(f.id);
        const watchingActive = watching?.status === "active";
        return `
        <div
          class="fp-convo-wrap ${watching ? "is-watching" : ""} ${
            watchingActive ? "is-watching-live" : ""
          }"
          role="listitem"
        >
          <button type="button" class="fp-convo ${
            unread ? "has-unread" : ""
          } ${hasChat ? "has-chat" : ""}" data-open-chat="${f.id}">
            ${presenceAvatarHtml(f.other)}
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
                    : `<em class="fp-presence-label ${
                        on ? "is-online" : ""
                      }" data-presence-id="${escapeHtml(
                        f.other?.id || ""
                      )}"><span data-presence-label>${
                        on ? "Active now" : "Offline"
                      }</span></em>`
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
        const unread = activity.chatIds?.includes(f.id) ? "1" : "0";
        return `${f.id}:${p?.id || ""}:${p?.created_at || ""}:${unread}:${
          isUserOnline(f.other?.id) ? "1" : "0"
        }:${w?.id || ""}:${w?.status || ""}`;
      })
      .join("|");

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
    syncPresenceUi();
  };

  /** Soft-update inbox rows in place — avoids remount blink. */
  const paintInboxList = () => {
    const list = page.querySelector(".fp-convo-list");
    if (!list || tab !== "chat" || activeChatId) return;
    const accepted = friendships.filter((f) => f.status === "accepted");
    const key = inboxPaintKey(accepted);
    if (list.dataset.paintKey === key) {
      syncPresenceUi();
      return;
    }
    list.dataset.paintKey = key;
    list.innerHTML = convoListHtml(accepted);
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

  const partyListHtml = () => {
    if (!parties.length) {
      return emptyState("No invites", "Watch invites will show up here.");
    }
    return parties
      .map((p) => {
        const mineHost = p.host_id === me.id;
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
              <span class="muted">${mineHost ? "You invited" : "Invite for you"} · ${escapeHtml(
                p.status
              )}</span>
              <div class="fp-row__actions">
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
        const find = panel.querySelector(".fp-find");
        reqSection = document.createElement("section");
        reqSection.className = "fp-block";
        reqSection.id = "requests-section";
        reqSection.innerHTML = `<h2>Requests</h2><div class="fp-list" id="requests-list"></div>`;
        find?.after(reqSection);
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
        "Search by name or email above to send a request."
      );
    } else {
      friendsBox.innerHTML = accepted
        .map((f) =>
          personRow(
            f.other,
            `<button class="fp-btn fp-btn--solid" data-chat="${f.id}" type="button">Chat</button>
             <button class="fp-btn" data-remove="${f.id}" type="button">Remove</button>`
          )
        )
        .join("");
    }
  };

  const personRow = (p, actions = "") => {
    const on = Boolean(p?.id && isUserOnline(p.id));
    return `
    <div class="fp-row">
      ${presenceAvatarHtml(p)}
      <div class="fp-row__meta">
        <strong>${escapeHtml(p?.display_name || "User")}</strong>
        <span
          class="fp-presence-label ${on ? "is-online" : ""}"
          data-presence-id="${escapeHtml(p?.id || "")}"
        ><em data-presence-label>${on ? "Online" : "Offline"}</em></span>
        ${p?.email ? `<span>${escapeHtml(p.email)}</span>` : ""}
      </div>
      <div class="fp-row__actions">${actions}</div>
    </div>
  `;
  };

  const tabBadge = (n) => (n ? `<em>${n > 9 ? "9+" : n}</em>` : "");

  const renderShell = () => {
    const requestCount = activity.requests || friendships.filter((f) => f.isIncoming).length;
    const chatCount = activity.chats || 0;
    const inviteCount =
      activity.invites ||
      parties.filter((p) => p.guest_id === me.id && p.status === "invited").length;

    const title =
      tab === "watch" ? "Watch together" : tab === "friends" ? "People" : "Chats";

    // Hide chrome while inside a Messenger thread
    const inThread = tab === "chat" && Boolean(activeChatId);

    page.innerHTML = `
      ${
        inThread
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
        </nav>
      </header>`
      }

      <div class="fp-panel" id="friends-panel"></div>
    `;

    page.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.tab;
        tab = next;
        if (next === "chat") activeChatId = null;
        renderShell();
        renderPanel();
      });
    });
    syncChatLock();
  };

  async function refreshData() {
    friendships = await listFriendships();
    parties = await listWatchParties();
    activity = await getFriendsActivityCounts().catch(() => activity);
  }

  async function renderPanel() {
    if (tab !== "chat") clearChatViewport();
    const panel = page.querySelector("#friends-panel");
    if (!panel) return;

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
            <div>
              <h2>Find people</h2>
              <p class="muted fp-lead">Search by name or email — profiles stay private until you look them up.</p>
            </div>
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
          <div class="fp-suggest" id="suggest-list">
            ${emptyState(
              "Search to find people",
              "Type a name or email to look someone up. We don’t list other users here."
            )}
          </div>
        </section>

        ${
          incoming.length || outgoing.length
            ? `<section class="fp-block" id="requests-section">
                <h2>Requests</h2>
                <div class="fp-list" id="requests-list"></div>
              </section>`
            : ""
        }

        <section class="fp-block">
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
          "Search by name or email above to send a request."
        );
      } else {
        friendsBox.innerHTML = accepted
          .map((f) =>
            personRow(
              f.other,
              `<button class="fp-btn fp-btn--solid" data-chat="${f.id}" type="button">Chat</button>
               <button class="fp-btn" data-remove="${f.id}" type="button">Remove</button>`
            )
          )
          .join("");
      }

      const resultsBox = panel.querySelector("#suggest-list");
      const peopleSearch = panel.querySelector("#people-search");
      const peopleClear = panel.querySelector("#people-clear");
      const peopleMsg = panel.querySelector("#people-msg");
      let searchToken = 0;
      let searchTimer = null;

      const showPrivacyEmpty = () => {
        resultsBox.innerHTML = emptyState(
          "Search to find people",
          "Type a name or email to look someone up. We don’t list other users here."
        );
      };

      const paintResults = (rows) => {
        if (!rows.length) {
          resultsBox.innerHTML = emptyState(
            "No matches",
            "Try another name or the full email address."
          );
          return;
        }
        resultsBox.innerHTML = `<div class="fp-list">${rows
          .map((p) =>
            personRow(
              p,
              `<button class="fp-btn fp-btn--solid" type="button" data-add="${p.id}">Add</button>`
            )
          )
          .join("")}</div>`;
      };

      const runSearch = async (query) => {
        const token = ++searchToken;
        const q = query.trim();
        peopleClear.hidden = !q;

        if (q.length < 2) {
          peopleMsg.hidden = true;
          showPrivacyEmpty();
          return;
        }

        peopleMsg.hidden = false;
        peopleMsg.textContent = "Searching…";
        try {
          const rows = await searchProfiles(q, { limit: 16 });
          if (token !== searchToken) return;
          paintResults(rows.filter((r) => !relatedIds.includes(r.id)));
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
        showPrivacyEmpty();
        peopleSearch.focus();
      });

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
            ${emptyState(
              "No conversations yet",
              "Add a friend from People, then start chatting."
            )}
            <button type="button" class="btn btn--primary fp-inbox__cta" data-tab="friends">
              Find people
            </button>
          `;
          panel.querySelector("[data-tab]")?.addEventListener("click", () => {
            tab = "friends";
            renderShell();
            renderPanel();
          });
          return;
        }

        // Paint friends immediately (cached previews) — no loading flash
        panel.innerHTML = `
          <div class="fp-inbox">
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
                          return `
                          <button type="button" class="fp-invite-card" data-open-party="${p.id}">
                            ${
                              p.poster
                                ? `<img src="${escapeHtml(p.poster)}" alt="" />`
                                : `<span class="fp-invite-card__ph"></span>`
                            }
                            <span>
                              <strong>${escapeHtml(p.title)}</strong>
                              <em>${mineHost ? "You invited" : "Invite"} · ${escapeHtml(
                                p.status
                              )}</em>
                            </span>
                          </button>`;
                        })
                        .join("")}
                    </div>
                  </section>`
                : `<button type="button" class="fp-watch-banner" data-tab="watch">
                    <span aria-hidden="true">▶</span>
                    <span><strong>Watch together</strong><em>Invite a friend to a movie or show</em></span>
                  </button>`
            }
            <div class="fp-convo-list" role="list" data-paint-key="${escapeHtml(
              inboxPaintKey(accepted)
            )}">
              ${convoListHtml(accepted)}
            </div>
          </div>
        `;

        panel.querySelectorAll("[data-tab]").forEach((btn) => {
          btn.addEventListener("click", () => {
            tab = btn.dataset.tab;
            activeChatId = null;
            renderShell();
            renderPanel();
          });
        });
        bindInboxListActions(panel);

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
      panel.innerHTML = `
        <div class="fp-chat fp-chat--thread">
          <section class="fp-chat__thread">
            <header class="fp-chat__head">
              <button type="button" class="fp-icon-btn fp-chat__back" data-chat-back aria-label="Back to chats">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button type="button" class="fp-chat__peer" data-chat-back aria-label="Back to chats">
                ${presenceAvatarHtml(current.other, "fp-avatar--md")}
                <span class="fp-chat__head-text">
                  <strong>${escapeHtml(current.other?.display_name || "Friend")}</strong>
                  <span
                    class="fp-presence-label ${peerOnline ? "is-online" : ""}"
                    data-presence-id="${escapeHtml(current.other?.id || "")}"
                  ><em data-presence-label>${
                    peerOnline ? "Active now" : "Offline"
                  }</em></span>
                </span>
              </button>
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
            <form class="fp-chat__compose" id="chat-form" autocomplete="off">
              <input
                type="text"
                name="body"
                id="chat-input"
                placeholder="Aa"
                autocomplete="off"
                enterkeyhint="send"
                inputmode="text"
                aria-label="Message"
              />
              <button class="fp-chat__send" type="button" id="chat-send" aria-label="Send">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3.4 11.2 20.2 3.8c.7-.3 1.4.4 1.1 1.1L13.9 21.7c-.3.8-1.5.7-1.7-.1l-1.7-7.1-7.1-1.7c-.8-.2-.9-1.4-.1-1.7Z" fill="currentColor"/>
                </svg>
              </button>
            </form>
          </section>
        </div>
      `;

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

      const paint = (messages) => {
        if (!box.isConnected) return;
        threadMessages = Array.isArray(messages) ? messages : [];
        const paintKey = threadMessages
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
              <p class="muted">You're friends on Cine. Say hi.</p>
            </div>`;
          markChatRead(activeChatId);
          return;
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
            const timeLabel = new Date(m.created_at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });

            return `
          <div
            class="fp-msg ${mine ? "is-me" : "is-them"} ${cluster}${
              showAvatar ? " has-avatar" : ""
            }"
            data-msg-id="${escapeHtml(m.id)}"
            data-msg-mine="${mine ? "1" : "0"}"
          >
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
              <div class="fp-bubble ${mine ? "is-me" : ""} ${cluster}">
                <p class="fp-bubble__text">${escapeHtml(m.body)}</p>
                ${
                  groups.length
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
                  ? `<time class="fp-msg__time">${escapeHtml(timeLabel)}${
                      m.edited_at ? " · Edited" : ""
                    }</time>`
                  : ""
              }
              <div class="fp-bubble__tools" hidden>
                <div class="fp-react-bar">
                  ${REACTIONS.map(
                    (e) =>
                      `<button type="button" class="fp-react-pick" data-react="${escapeHtml(
                        m.id
                      )}" data-emoji="${escapeHtml(e)}" aria-label="React ${e}">${e}</button>`
                  ).join("")}
                </div>
                ${
                  mine
                    ? `<button type="button" class="fp-bubble__edit" data-edit="${escapeHtml(
                        m.id
                      )}">Edit</button>`
                    : ""
                }
              </div>
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
            paintFromServer(await listMessages(chatId));
          } while (threadFetchQueued && box.isConnected);
        } finally {
          threadFetchBusy = false;
        }
      };

      box.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

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

        const editBtn = t.closest("[data-edit]");
        if (editBtn) {
          e.preventDefault();
          e.stopPropagation();
          const row = editBtn.closest(".fp-msg");
          const textEl = row?.querySelector(".fp-bubble__text");
          const currentBody = textEl?.textContent || "";
          const next = window.prompt("Edit message", currentBody);
          if (next == null) return;
          try {
            await editMessage(editBtn.dataset.edit, next);
            await refreshThread();
          } catch (err) {
            alert(err.message || "Could not edit");
          }
          return;
        }

        const row = t.closest(".fp-msg[data-msg-id]");
        if (!row || !box.contains(row)) return;
        // Toggle tools on this message; close others
        box.querySelectorAll(".fp-bubble__tools").forEach((el) => {
          if (!row.contains(el)) el.hidden = true;
        });
        const tools = row.querySelector(".fp-bubble__tools");
        if (tools) tools.hidden = !tools.hidden;
      });

      try {
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
      }, 1200);
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
      const composeSpacer = panel.querySelector("#chat-compose-spacer");
      const chatShell = panel.querySelector(".fp-chat--thread");
      let chatLockH = 0;
      let inputFocused = false;
      let kbPollTimer = null;

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

      // Pin compose above the mobile keyboard so typing stays visible.
      clearChatViewport();
      const syncChatViewport = () => {
        const vv = window.visualViewport;
        const layoutH = window.innerHeight;
        const visibleH = vv ? vv.height : layoutH;
        const inset = keyboardInset();
        const shrunk = vv ? layoutH - vv.height > 50 : false;
        const kbOpen =
          inset > 40 ||
          shrunk ||
          (inputFocused && vv && vv.height / layoutH < 0.9);

        document.body.classList.toggle("is-friends-chat-kb", kbOpen);

        if (!kbOpen) {
          chatLockH = 0;
          chatShell?.style.removeProperty("height");
          chatShell?.style.removeProperty("max-height");
          root.style.removeProperty("--friends-chat-vh");
          root.style.removeProperty("transform");
          document.documentElement.style.removeProperty("--friends-kb-bottom");
          document.documentElement.style.removeProperty("--friends-compose-h");
          form?.style.removeProperty("bottom");
          if (composeSpacer) composeSpacer.hidden = true;
          return;
        }

        if (!chatLockH && chatShell) {
          chatLockH =
            Math.round(chatShell.getBoundingClientRect().height) || layoutH;
        }

        // Prefer visual viewport height so the thread fits above the keyboard
        const chatVh = Math.max(220, Math.round(visibleH));
        root.style.setProperty("--friends-chat-vh", `${chatVh}px`);
        if (chatShell) {
          chatShell.style.height = `${chatVh}px`;
          chatShell.style.maxHeight = `${chatVh}px`;
        }

        document.documentElement.style.setProperty(
          "--friends-kb-bottom",
          `${inset}px`
        );
        // Inline bottom as a hard fallback (some WebViews ignore the CSS var)
        if (form) form.style.bottom = `${inset}px`;

        const composeH = Math.ceil(form?.getBoundingClientRect().height || 0) || 58;
        document.documentElement.style.setProperty(
          "--friends-compose-h",
          `${composeH}px`
        );
        if (composeSpacer) composeSpacer.hidden = false;

        lockPageScroll();
        requestAnimationFrame(() => {
          box.scrollTop = box.scrollHeight;
        });
      };

      const startKbPoll = () => {
        clearInterval(kbPollTimer);
        let ticks = 0;
        kbPollTimer = setInterval(() => {
          syncChatViewport();
          ticks += 1;
          if (ticks >= 16 || (!inputFocused && keyboardInset() < 40)) {
            clearInterval(kbPollTimer);
            kbPollTimer = null;
          }
        }, 50);
      };

      syncChatViewport();
      window.visualViewport?.addEventListener("resize", syncChatViewport);
      window.visualViewport?.addEventListener("scroll", syncChatViewport);
      window.addEventListener("resize", syncChatViewport);
      unsubChatVv = () => {
        clearInterval(kbPollTimer);
        kbPollTimer = null;
        window.visualViewport?.removeEventListener("resize", syncChatViewport);
        window.visualViewport?.removeEventListener("scroll", syncChatViewport);
        window.removeEventListener("resize", syncChatViewport);
        chatShell?.style.removeProperty("height");
        chatShell?.style.removeProperty("max-height");
        form?.style.removeProperty("bottom");
        document.documentElement.style.removeProperty("--friends-kb-bottom");
        document.documentElement.style.removeProperty("--friends-compose-h");
        if (composeSpacer) composeSpacer.hidden = true;
        unsubChatVv = null;
      };

      const syncSendEnabled = () => {
        if (!sendBtn) return;
        const hasText = Boolean(String(input?.value || "").trim());
        sendBtn.disabled = sending || !hasText;
        sendBtn.classList.toggle("is-ready", hasText && !sending);
      };
      syncSendEnabled();
      input?.addEventListener("input", () => {
        syncSendEnabled();
        if (String(input?.value || "").trim()) pulseTyping();
        else stopTypingPing();
      });

      const sendChat = async () => {
        if (sending) return;
        const text = String(input?.value || "").trim();
        if (!text) {
          input?.focus();
          return;
        }
        sending = true;
        stopTypingPing();
        if (input) input.value = "";
        syncSendEnabled();
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
          if (input) input.value = text;
          paint(threadMessages.filter((m) => m.id !== optimistic.id));
          alert(err.message);
        } finally {
          sending = false;
          syncSendEnabled();
          input?.focus({ preventScroll: true });
          syncChatViewport();
        }
      };

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

      input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendChat();
        }
      });

      input?.addEventListener("focus", () => {
        inputFocused = true;
        // Lift immediately so the bar isn’t trapped under the rising keyboard
        document.body.classList.add("is-friends-chat-kb");
        if (chatShell && !chatLockH) {
          chatLockH = Math.round(chatShell.getBoundingClientRect().height);
        }
        lockPageScroll();
        syncChatViewport();
        startKbPoll();
        [80, 160, 280, 450, 700].forEach((ms) => {
          setTimeout(() => {
            if (!inputFocused) return;
            syncChatViewport();
            lockPageScroll();
            box.scrollTop = box.scrollHeight;
          }, ms);
        });
      });

      input?.addEventListener("blur", () => {
        inputFocused = false;
        stopTypingPing();
        setTimeout(() => {
          if (inputFocused) return;
          syncChatViewport();
        }, 120);
      });

      return;
    }

    const accepted = friendships.filter((f) => f.status === "accepted");
    const recent = getRecentMovies().slice(0, 40);
    let selectedFriend = null;
    let selectedMedia = null;

    panel.innerHTML = `
      <section class="fp-block">
        <h2>Watch together</h2>
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
        addBtn.closest(".fp-row")?.remove();
        await afterPeopleChange();
      } catch (err) {
        if (peopleMsg) peopleMsg.textContent = err.message || "Could not send request";
        addBtn.disabled = false;
        addBtn.textContent = "Add";
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
        const forThis =
          !msgEvent ||
          !row?.friendship_id ||
          row.friendship_id === activeChatId;
        if (forThis && (msgEvent || isSoft || !table)) {
          try {
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
    const delay = payload?.table === "friend_messages" ? 40 : 180;
    liveTimer = setTimeout(() => {
      applyLiveUpdate(payload).catch(() => {});
    }, delay);
  }

  renderShell();
  try {
    await refreshData();
    // Warm preview cache before first paint so inbox doesn't flash "loading"
    await refreshChatPreviews();
    renderShell();
  } catch (err) {
    page.querySelector("#friends-panel").innerHTML = `
      ${emptyState("Couldn’t load Friends", err.message)}
      <p class="muted">Run migrations <code>202603260003_friends_chat_watch.sql</code> and <code>202603260005_friends_realtime.sql</code> in Supabase.</p>
    `;
    return {
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
  unsubPresence = onPresenceChange(() => syncPresenceUi());
  syncPresenceUi();

  return {
    unmount() {
      clearTimeout(liveTimer);
      peerIsTyping = false;
      unsubChat?.();
      unsubPage?.();
      unsubWatchDoc?.();
      unsubPresence?.();
      clearChatViewport();
      page.classList.remove("friends-page--chat");
      root.classList.remove("view--friends-chat");
      document.body.classList.remove("is-friends-chat", "is-friends-chat-kb");
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
