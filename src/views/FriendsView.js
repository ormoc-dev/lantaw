import { getUser } from "../services/authService.js";
import { getRecentMovies } from "../services/recentService.js";
import { getSupabase } from "../lib/supabase.js";
import {
  createWatchParty,
  getFriendsActivityCounts,
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
  let friendships = [];
  let parties = [];
  let activity = { requests: 0, chats: 0, invites: 0, chatIds: [] };
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

  startPresence().catch(() => {});

  const syncPresenceUi = () => {
    page.querySelectorAll("[data-presence-id]").forEach((el) => {
      const on = isUserOnline(el.dataset.presenceId);
      el.classList.toggle("is-online", on);
      el.setAttribute("title", on ? "Online" : "Offline");
      el.setAttribute("aria-label", on ? "Online" : "Offline");
      const label = el.querySelector("[data-presence-label]");
      if (label) label.textContent = on ? "Online" : "Offline";
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
            <div class="fp-convo-list" role="list">
              ${accepted
                .map((f) => {
                  const on = isUserOnline(f.other?.id);
                  const unread = activity.chatIds?.includes(f.id);
                  return `
                  <button type="button" class="fp-convo ${
                    unread ? "has-unread" : ""
                  }" data-open-chat="${f.id}" role="listitem">
                    ${presenceAvatarHtml(f.other)}
                    <span class="fp-convo__meta">
                      <strong>${escapeHtml(
                        f.other?.display_name || f.other?.email || "Friend"
                      )}</strong>
                      <em
                        class="fp-presence-label ${on ? "is-online" : ""}"
                        data-presence-id="${escapeHtml(f.other?.id || "")}"
                      ><span data-presence-label>${
                        on ? "Online" : "Offline"
                      }</span></em>
                    </span>
                    ${unread ? `<i class="fp-chat__dot" aria-label="Unread"></i>` : ""}
                  </button>`;
                })
                .join("")}
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
        panel.querySelectorAll("[data-open-chat]").forEach((btn) => {
          btn.addEventListener("click", () => {
            activeChatId = btn.dataset.openChat;
            renderShell();
            renderPanel();
          });
        });
        panel.querySelectorAll("[data-open-party]").forEach((btn) => {
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

      panel.innerHTML = `
        <div class="fp-chat fp-chat--thread">
          <section class="fp-chat__thread">
            <header class="fp-chat__head">
              <button type="button" class="fp-icon-btn fp-chat__back" data-chat-back aria-label="Back to chats">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              ${presenceAvatarHtml(current.other, "fp-avatar--sm")}
              <div class="fp-chat__head-text">
                <strong>${escapeHtml(current.other?.display_name || "Friend")}</strong>
                <span
                  class="muted fp-presence-label ${
                    isUserOnline(current.other?.id) ? "is-online" : ""
                  }"
                  data-presence-id="${escapeHtml(current.other?.id || "")}"
                ><em data-presence-label>${
                  isUserOnline(current.other?.id) ? "Online" : "Offline"
                }</em></span>
              </div>
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
            </header>
            <div class="fp-chat__messages" id="chat-messages">${loadingHtml({
              className: "ui-loading--inline",
              size: "sm",
            })}</div>
            <div class="fp-chat__compose-spacer" id="chat-compose-spacer" hidden></div>
            <form class="fp-chat__compose" id="chat-form" autocomplete="off">
              <input
                type="text"
                name="body"
                id="chat-input"
                placeholder="Write a message"
                autocomplete="off"
                enterkeyhint="send"
                inputmode="text"
              />
              <button class="btn btn--primary" type="button" id="chat-send">Send</button>
            </form>
          </section>
        </div>
      `;

      panel.querySelector("[data-chat-back]")?.addEventListener("click", () => {
        activeChatId = null;
        unsubChat?.();
        renderShell();
        renderPanel();
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

      const paint = (messages) => {
        if (!box.isConnected) return;
        const stickBottom =
          box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        if (!messages.length) {
          box.innerHTML = `<p class="muted fp-chat__empty">Say hi — or tap Watch to start a party.</p>`;
          markChatRead(activeChatId);
          return;
        }
        box.innerHTML = messages
          .map((m) => {
            const mine = m.sender_id === me.id;
            const groups = groupReactions(m.reactions);
            return `
          <div
            class="fp-bubble ${mine ? "is-me" : ""}"
            data-msg-id="${escapeHtml(m.id)}"
            data-msg-mine="${mine ? "1" : "0"}"
          >
            <p class="fp-bubble__text">${escapeHtml(m.body)}</p>
            <time>${new Date(m.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}${m.edited_at ? " · edited" : ""}</time>
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
                      >${escapeHtml(g.emoji)} <span>${g.users.length}</span></button>`
                      )
                      .join("")}
                  </div>`
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
          </div>`;
          })
          .join("");
        if (stickBottom) box.scrollTop = box.scrollHeight;
        const latest = messages[messages.length - 1];
        markChatRead(activeChatId, latest?.created_at);
      };
      chatPaint = paint;

      const refreshThread = async () => {
        paint(await listMessages(chatId));
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
          const bubble = editBtn.closest(".fp-bubble");
          const textEl = bubble?.querySelector(".fp-bubble__text");
          const current = textEl?.textContent || "";
          const next = window.prompt("Edit message", current);
          if (next == null) return;
          try {
            await editMessage(editBtn.dataset.edit, next);
            await refreshThread();
          } catch (err) {
            alert(err.message || "Could not edit");
          }
          return;
        }

        const bubble = t.closest(".fp-bubble[data-msg-id]");
        if (!bubble || !box.contains(bubble)) return;
        // Toggle tools on this bubble; close others
        box.querySelectorAll(".fp-bubble__tools").forEach((el) => {
          if (el.parentElement !== bubble) el.hidden = true;
        });
        const tools = bubble.querySelector(".fp-bubble__tools");
        if (tools) tools.hidden = !tools.hidden;
      });

      try {
        paint(await listMessages(activeChatId));
        activity = await getFriendsActivityCounts().catch(() => activity);
      } catch (err) {
        box.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }

      if (unsubChat) unsubChat();
      const channel = getSupabase()
        .channel(`chat-${chatId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friend_messages",
            filter: `friendship_id=eq.${chatId}`,
          },
          async () => {
            try {
              paint(await listMessages(chatId));
              activity = await getFriendsActivityCounts().catch(() => activity);
              notifyFriendsBadge();
            } catch (_) {
              /* ignore */
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friend_message_reactions",
          },
          async () => {
            try {
              paint(await listMessages(chatId));
            } catch (_) {
              /* ignore */
            }
          }
        )
        .subscribe();
      unsubChat = () => {
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

      const lockPageScroll = () => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        if (root.scrollTop) root.scrollTop = 0;
      };

      // Pin compose above the mobile keyboard so typing stays visible.
      clearChatViewport();
      const syncChatViewport = () => {
        const vv = window.visualViewport;
        const layoutH = window.innerHeight;
        const visibleH = vv ? vv.height : layoutH;
        const offsetTop = vv ? vv.offsetTop : 0;
        const covered = Math.max(0, Math.round(layoutH - (offsetTop + visibleH)));
        const kbOpen = covered > 80 || offsetTop > 40;

        document.body.classList.toggle("is-friends-chat-kb", kbOpen);

        if (!kbOpen) {
          chatLockH = 0;
          chatShell?.style.removeProperty("height");
          chatShell?.style.removeProperty("max-height");
          root.style.removeProperty("--friends-chat-vh");
          root.style.removeProperty("transform");
          document.documentElement.style.removeProperty("--friends-kb-bottom");
          document.documentElement.style.removeProperty("--friends-compose-h");
          if (composeSpacer) composeSpacer.hidden = true;
          return;
        }

        if (!chatLockH && chatShell) {
          chatLockH =
            Math.round(chatShell.getBoundingClientRect().height) || layoutH;
        }
        if (chatShell && chatLockH) {
          chatShell.style.height = `${chatLockH}px`;
          chatShell.style.maxHeight = `${chatLockH}px`;
        }

        root.style.setProperty(
          "--friends-chat-vh",
          `${Math.max(240, Math.round(visibleH))}px`
        );
        root.style.removeProperty("transform");
        document.documentElement.style.setProperty(
          "--friends-kb-bottom",
          `${covered}px`
        );

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
      syncChatViewport();
      window.visualViewport?.addEventListener("resize", syncChatViewport);
      window.visualViewport?.addEventListener("scroll", syncChatViewport);
      window.addEventListener("resize", syncChatViewport);
      unsubChatVv = () => {
        window.visualViewport?.removeEventListener("resize", syncChatViewport);
        window.visualViewport?.removeEventListener("scroll", syncChatViewport);
        window.removeEventListener("resize", syncChatViewport);
        chatShell?.style.removeProperty("height");
        chatShell?.style.removeProperty("max-height");
        document.documentElement.style.removeProperty("--friends-kb-bottom");
        document.documentElement.style.removeProperty("--friends-compose-h");
        if (composeSpacer) composeSpacer.hidden = true;
        unsubChatVv = null;
      };

      let sending = false;
      const sendChat = async () => {
        if (sending) return;
        const text = String(input?.value || "").trim();
        if (!text) {
          input?.focus();
          return;
        }
        sending = true;
        if (input) input.value = "";
        if (sendBtn) sendBtn.disabled = true;
        try {
          await sendMessage(chatId, text);
          paint(await listMessages(chatId));
        } catch (err) {
          if (input) input.value = text;
          alert(err.message);
        } finally {
          sending = false;
          if (sendBtn) sendBtn.disabled = false;
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
        if (chatShell && !chatLockH) {
          chatLockH = Math.round(chatShell.getBoundingClientRect().height);
        }
        lockPageScroll();
        [40, 120, 240, 400].forEach((ms) => {
          setTimeout(() => {
            syncChatViewport();
            lockPageScroll();
            box.scrollTop = box.scrollHeight;
          }, ms);
        });
      });

      input?.addEventListener("blur", () => {
        setTimeout(syncChatViewport, 80);
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
        if (activeChatId && table === "friend_messages") {
          const row = payload?.new;
          if (row?.friendship_id && row.friendship_id === activeChatId && chatPaint) {
            try {
              chatPaint(await listMessages(activeChatId));
            } catch (_) {
              /* ignore */
            }
          }
        } else if (!activeChatId) {
          // Refresh Messenger inbox (unread + watch invites)
          await renderPanel();
          syncPresenceUi();
        }
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
    liveTimer = setTimeout(() => {
      applyLiveUpdate(payload).catch(() => {});
    }, 180);
  }

  renderShell();
  try {
    await refreshData();
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
