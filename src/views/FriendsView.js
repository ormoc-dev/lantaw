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
  listSuggestedProfiles,
  notifyFriendsBadge,
  sendFriendRequest,
  sendMessage,
  subscribeFriendsRealtime,
  updateWatchPartyStatus,
  deleteWatchParty,
} from "../services/friendsService.js";
import { linkTo } from "../router/index.js";

export async function FriendsView(root) {
  const me = await getUser();
  if (!me) {
    root.innerHTML = `<p class="muted">Sign in to use Friends.</p>`;
    return { unmount() {} };
  }

  let tab = "friends";
  let friendships = [];
  let parties = [];
  let activity = { requests: 0, chats: 0, invites: 0, chatIds: [] };
  let activeChatId = null;
  let unsubChat = null;
  let unsubPage = null;
  let unsubWatchDoc = null;
  let unsubChatVv = null;
  let liveTimer = null;
  let liveBusy = false;
  let liveQueued = false;
  let chatPaint = null;

  const page = document.createElement("div");
  page.className = "page-pad friends-page";
  root.innerHTML = "";
  root.appendChild(page);

  const clearChatViewport = () => {
    unsubChatVv?.();
    root.style.removeProperty("--friends-chat-vh");
  };

  const syncChatLock = () => {
    const locked = tab === "chat";
    page.classList.toggle("friends-page--chat", locked);
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
        "Add someone from suggestions above."
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

  const personRow = (p, actions = "") => `
    <div class="fp-row">
      ${avatarHtml(p)}
      <div class="fp-row__meta">
        <strong>${escapeHtml(p?.display_name || "User")}</strong>
        <span>${escapeHtml(p?.email || "")}</span>
      </div>
      <div class="fp-row__actions">${actions}</div>
    </div>
  `;

  const tabBadge = (n) => (n ? `<em>${n > 9 ? "9+" : n}</em>` : "");

  const renderShell = () => {
    const acceptedCount = friendships.filter((f) => f.status === "accepted").length;
    const requestCount = activity.requests || friendships.filter((f) => f.isIncoming).length;
    const chatCount = activity.chats || 0;
    const inviteCount =
      activity.invites ||
      parties.filter((p) => p.guest_id === me.id && p.status === "invited").length;

    page.innerHTML = `
      <header class="fp-head">
        <div>
          <p class="fp-kicker">Social</p>
          <h1>Friends</h1>
        </div>
        <p class="fp-count muted">${acceptedCount} friend${acceptedCount === 1 ? "" : "s"}</p>
      </header>

      <nav class="fp-tabs" role="tablist" aria-label="Friends sections">
        <button type="button" class="fp-tab ${tab === "friends" ? "is-active" : ""}" data-tab="friends">
          People${tabBadge(requestCount)}
        </button>
        <button type="button" class="fp-tab ${tab === "chat" ? "is-active" : ""}" data-tab="chat">
          Chat${tabBadge(chatCount)}
        </button>
        <button type="button" class="fp-tab ${tab === "watch" ? "is-active" : ""}" data-tab="watch">
          Watch${tabBadge(inviteCount)}
        </button>
      </nav>

      <div class="fp-panel" id="friends-panel"></div>
    `;

    page.querySelectorAll(".fp-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.dataset.tab;
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
              <p class="muted fp-lead">Browse suggestions or search by name / email.</p>
            </div>
          </div>
          <div class="fp-search fp-find__search">
            <div class="fp-search__box">
              <input
                type="search"
                id="people-search"
                placeholder="Filter by name or email"
                autocomplete="off"
              />
              <button type="button" class="fp-search__clear" id="people-clear" hidden>✕</button>
            </div>
          </div>
          <p class="fp-status muted" id="people-msg" hidden></p>
          <div class="fp-suggest" id="suggest-list">
            <p class="muted fp-suggest__loading">Loading people…</p>
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
          "Add someone from suggestions above."
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

      const suggestBox = panel.querySelector("#suggest-list");
      const peopleSearch = panel.querySelector("#people-search");
      const peopleClear = panel.querySelector("#people-clear");
      const peopleMsg = panel.querySelector("#people-msg");
      let suggestAll = [];
      let suggestToken = 0;
      let searchTimer = null;

      const paintSuggestions = (rows, { filtered = false } = {}) => {
        if (!rows.length) {
          suggestBox.innerHTML = emptyState(
            filtered ? "No matches" : "No suggestions yet",
            filtered
              ? "Try another name or email."
              : "When more people join LANTAW, they’ll show up here."
          );
          return;
        }
        suggestBox.innerHTML = `<div class="fp-list">${rows
          .map((p) =>
            personRow(
              p,
              `<button class="fp-btn fp-btn--solid" type="button" data-add="${p.id}">Add</button>`
            )
          )
          .join("")}</div>`;

        // Add handled via page delegation
      };

      const loadSuggestions = async () => {
        const token = ++suggestToken;
        try {
          suggestAll = await listSuggestedProfiles({
            limit: 32,
            excludeIds: relatedIds,
          });
          if (token !== suggestToken) return;
          paintSuggestions(suggestAll);
        } catch (err) {
          if (token !== suggestToken) return;
          suggestBox.innerHTML = emptyState(
            "Couldn’t load people",
            err.message || "Try again in a moment."
          );
        }
      };

      const runFilter = async (query) => {
        const token = ++suggestToken;
        const q = query.trim();
        peopleClear.hidden = !q;
        if (!q) {
          peopleMsg.hidden = true;
          paintSuggestions(suggestAll);
          return;
        }
        peopleMsg.hidden = false;
        peopleMsg.textContent = "Searching…";
        try {
          const rows = await searchProfiles(q, { limit: 16 });
          if (token !== suggestToken) return;
          const filtered = rows.filter((r) => !relatedIds.includes(r.id));
          paintSuggestions(filtered, { filtered: true });
          peopleMsg.hidden = true;
        } catch (err) {
          if (token !== suggestToken) return;
          peopleMsg.textContent = err.message || "Search failed";
        }
      };

      peopleSearch.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runFilter(peopleSearch.value), 200);
      });
      peopleClear.addEventListener("click", () => {
        peopleSearch.value = "";
        peopleClear.hidden = true;
        peopleMsg.hidden = true;
        paintSuggestions(suggestAll);
        peopleSearch.focus();
      });

      loadSuggestions();
      return;
    }

    if (tab === "chat") {
      // Drop Watch-tab capture listeners so they don't steal taps from chat
      unsubWatchDoc?.();

      const accepted = friendships.filter((f) => f.status === "accepted");
      if (!accepted.length) {
        panel.innerHTML = emptyState(
          "Chat is empty",
          "Add a friend first, then start a conversation."
        );
        return;
      }
      if (!activeChatId) activeChatId = accepted[0].id;
      const current = accepted.find((f) => f.id === activeChatId) || accepted[0];
      activeChatId = current.id;

      panel.innerHTML = `
        <div class="fp-chat">
          <div class="fp-chat__people">
            ${accepted
              .map(
                (f) => `
              <button type="button" class="fp-chat__person ${
                f.id === activeChatId ? "is-active" : ""
              }" data-open-chat="${f.id}">
                ${avatarHtml(f.other, "fp-avatar--sm")}
                <span>${escapeHtml(f.other?.display_name || f.other?.email || "Friend")}</span>
                ${
                  activity.chatIds?.includes(f.id) && f.id !== activeChatId
                    ? `<i class="fp-chat__dot" aria-hidden="true"></i>`
                    : ""
                }
              </button>`
              )
              .join("")}
          </div>
          <section class="fp-chat__thread">
            <header class="fp-chat__head">
              ${avatarHtml(current.other, "fp-avatar--sm")}
              <div>
                <strong>${escapeHtml(current.other?.display_name || "Friend")}</strong>
                <span class="muted">${escapeHtml(current.other?.email || "")}</span>
              </div>
            </header>
            <div class="fp-chat__messages" id="chat-messages"><p class="muted">Loading…</p></div>
            <form class="fp-chat__compose" id="chat-form">
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

      panel.querySelectorAll("[data-open-chat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeChatId = btn.dataset.openChat;
          renderPanel();
        });
      });

      const box = panel.querySelector("#chat-messages");
      const paint = (messages) => {
        if (!box.isConnected) return;
        if (!messages.length) {
          box.innerHTML = `<p class="muted fp-chat__empty">No messages yet.</p>`;
          markChatRead(activeChatId);
          return;
        }
        box.innerHTML = messages
          .map(
            (m) => `
          <div class="fp-bubble ${m.sender_id === me.id ? "is-me" : ""}">
            <p>${escapeHtml(m.body)}</p>
            <time>${new Date(m.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}</time>
          </div>`
          )
          .join("");
        box.scrollTop = box.scrollHeight;
        const latest = messages[messages.length - 1];
        markChatRead(activeChatId, latest?.created_at);
      };
      chatPaint = paint;

      const syncTabBadges = () => {
        const tabs = page.querySelector(".fp-tabs");
        if (!tabs) return;
        const peopleBtn = tabs.querySelector('[data-tab="friends"]');
        const chatBtn = tabs.querySelector('[data-tab="chat"]');
        const watchBtn = tabs.querySelector('[data-tab="watch"]');
        if (peopleBtn) peopleBtn.innerHTML = `People${tabBadge(activity.requests)}`;
        if (chatBtn) chatBtn.innerHTML = `Chat${tabBadge(activity.chats)}`;
        if (watchBtn) watchBtn.innerHTML = `Watch${tabBadge(activity.invites)}`;
      };

      try {
        paint(await listMessages(activeChatId));
        activity = await getFriendsActivityCounts().catch(() => activity);
        syncTabBadges();
      } catch (err) {
        box.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }

      if (unsubChat) unsubChat();
      const chatId = activeChatId;
      const channel = getSupabase()
        .channel(`chat-${chatId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "friend_messages",
            filter: `friendship_id=eq.${chatId}`,
          },
          async (payload) => {
            try {
              if (payload?.new && payload.new.friendship_id === chatId) {
                // Fast path: append via full reload for correct order
                paint(await listMessages(chatId));
              } else {
                paint(await listMessages(chatId));
              }
              activity = await getFriendsActivityCounts().catch(() => activity);
              syncTabBadges();
              notifyFriendsBadge();
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

      // Keep chat chrome inside the visible viewport (mobile keyboard)
      clearChatViewport();
      const syncChatViewport = () => {
        const vv = window.visualViewport;
        const h = vv ? Math.round(vv.height) : window.innerHeight;
        if (h > 0) root.style.setProperty("--friends-chat-vh", `${h}px`);
      };
      syncChatViewport();
      window.visualViewport?.addEventListener("resize", syncChatViewport);
      window.visualViewport?.addEventListener("scroll", syncChatViewport);
      window.addEventListener("resize", syncChatViewport);
      unsubChatVv = () => {
        window.visualViewport?.removeEventListener("resize", syncChatViewport);
        window.visualViewport?.removeEventListener("scroll", syncChatViewport);
        window.removeEventListener("resize", syncChatViewport);
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
          input?.focus();
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
        setTimeout(() => {
          syncChatViewport();
          form?.scrollIntoView({ block: "end", behavior: "smooth" });
          box.scrollTop = box.scrollHeight;
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
        await updateWatchPartyStatus(end.dataset.partyEnd, "ended");
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
    const tabs = page.querySelector(".fp-tabs");
    if (!tabs) return;
    const peopleBtn = tabs.querySelector('[data-tab="friends"]');
    const chatBtn = tabs.querySelector('[data-tab="chat"]');
    const watchBtn = tabs.querySelector('[data-tab="watch"]');
    const countEl = page.querySelector(".fp-count");
    const acceptedCount = friendships.filter((f) => f.status === "accepted").length;
    if (peopleBtn) peopleBtn.innerHTML = `People${tabBadge(activity.requests)}`;
    if (chatBtn) chatBtn.innerHTML = `Chat${tabBadge(activity.chats)}`;
    if (watchBtn) watchBtn.innerHTML = `Watch${tabBadge(activity.invites)}`;
    if (countEl) {
      countEl.textContent = `${acceptedCount} friend${acceptedCount === 1 ? "" : "s"}`;
    }
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
      } else if (tab === "chat" && table === "friend_messages") {
        const row = payload?.new;
        if (row?.friendship_id && row.friendship_id === activeChatId && chatPaint) {
          try {
            chatPaint(await listMessages(activeChatId));
          } catch (_) {
            /* ignore */
          }
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
        clearChatViewport();
      },
    };
  }
  await renderPanel();

  // Realtime + light poll (Watch invites). Poll must not remount People.
  unsubPage = subscribeFriendsRealtime(
    (payload) => {
      scheduleLiveRefresh(payload);
    },
    { pollMs: 12000, listenBadgeEvent: true }
  );

  return {
    unmount() {
      clearTimeout(liveTimer);
      unsubChat?.();
      unsubPage?.();
      unsubWatchDoc?.();
      clearChatViewport();
      page.classList.remove("friends-page--chat");
      root.classList.remove("view--friends-chat");
      document.body.classList.remove("is-friends-chat");
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
