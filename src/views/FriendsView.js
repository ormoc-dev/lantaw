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
  subscribeFriendsRealtime,
  updateWatchPartyStatus,
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
  let liveTimer = null;
  let liveBusy = false;
  let liveQueued = false;
  let chatPaint = null;

  const page = document.createElement("div");
  page.className = "page-pad friends-page";
  root.innerHTML = "";
  root.appendChild(page);

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
  };

  async function refreshData() {
    friendships = await listFriendships();
    parties = await listWatchParties();
    activity = await getFriendsActivityCounts().catch(() => activity);
  }

  async function renderPanel() {
    const panel = page.querySelector("#friends-panel");
    if (!panel) return;

    if (tab === "friends") {
      const accepted = friendships.filter((f) => f.status === "accepted");
      const incoming = friendships.filter((f) => f.isIncoming);
      const outgoing = friendships.filter((f) => f.isOutgoing);

      panel.innerHTML = `
        <form class="fp-add" id="add-friend">
          <div class="fp-search fp-add__search">
            <div class="fp-search__box">
              <input
                type="search"
                id="add-search"
                placeholder="Search by name or email"
                autocomplete="off"
                aria-autocomplete="list"
                aria-controls="add-menu"
              />
              <button type="button" class="fp-search__clear" id="add-clear" hidden>✕</button>
            </div>
            <div class="fp-search__menu" id="add-menu" hidden></div>
            <input type="hidden" name="userId" id="add-user-id" />
            <div class="fp-search__picked" id="add-picked" hidden></div>
          </div>
          <button class="btn btn--primary" type="submit" id="add-submit" disabled>Add</button>
        </form>
        <p class="fp-status muted" id="add-msg">Type a name or email to see suggestions.</p>

        ${
          incoming.length || outgoing.length
            ? `<section class="fp-block">
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
          "Search by name or email to send a request."
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

      const addForm = panel.querySelector("#add-friend");
      const addInput = panel.querySelector("#add-search");
      const addMenu = panel.querySelector("#add-menu");
      const addUserId = panel.querySelector("#add-user-id");
      const addPicked = panel.querySelector("#add-picked");
      const addClear = panel.querySelector("#add-clear");
      const addSubmit = panel.querySelector("#add-submit");
      const addMsg = panel.querySelector("#add-msg");
      let selectedAdd = null;
      let addSearchToken = 0;
      let addSearchTimer = null;

      const setAddPick = (profile) => {
        selectedAdd = profile;
        if (!profile) {
          addUserId.value = "";
          addPicked.hidden = true;
          addPicked.innerHTML = "";
          addClear.hidden = true;
          addInput.hidden = false;
          addInput.value = "";
          addSubmit.disabled = true;
          addMenu.hidden = true;
          return;
        }
        addUserId.value = profile.id;
        addInput.hidden = true;
        addClear.hidden = false;
        addPicked.hidden = false;
        addPicked.innerHTML = `
          ${avatarHtml(profile, "fp-avatar--sm")}
          <div>
            <strong>${escapeHtml(profile.display_name || "User")}</strong>
            <span>${escapeHtml(profile.email || "")}</span>
          </div>
        `;
        addMenu.hidden = true;
        addSubmit.disabled = false;
        addMsg.textContent = "Ready to send request.";
      };

      const paintAddMenu = (rows) => {
        if (!rows.length) {
          addMenu.innerHTML = `<p class="fp-search__empty">No people found</p>`;
          addMenu.hidden = false;
          return;
        }
        addMenu.innerHTML = rows
          .map(
            (p) => `
          <button type="button" class="fp-search__option" data-add-id="${p.id}">
            ${avatarHtml(p, "fp-avatar--sm")}
            <div>
              <strong>${escapeHtml(p.display_name || "User")}</strong>
              <span>${escapeHtml(p.email || "")}</span>
            </div>
          </button>`
          )
          .join("");
        addMenu.hidden = false;
        addMenu.querySelectorAll("[data-add-id]").forEach((btn) => {
          btn.addEventListener("mousedown", (ev) => ev.preventDefault());
          btn.addEventListener("click", () => {
            const profile = rows.find((r) => r.id === btn.dataset.addId);
            setAddPick(profile || null);
          });
        });
      };

      const runAddSearch = async (query) => {
        const token = ++addSearchToken;
        const q = query.trim();
        if (q.length < 1) {
          addMenu.hidden = true;
          addMenu.innerHTML = "";
          return;
        }
        addMsg.textContent = "Searching…";
        try {
          const rows = await searchProfiles(q, { limit: 8 });
          if (token !== addSearchToken) return;
          paintAddMenu(rows);
          addMsg.textContent = rows.length
            ? "Pick someone from the list."
            : "No match — try another name or email.";
        } catch (err) {
          if (token !== addSearchToken) return;
          addMenu.hidden = true;
          addMsg.textContent = err.message || "Search failed";
        }
      };

      addInput.addEventListener("input", () => {
        if (selectedAdd) setAddPick(null);
        addSubmit.disabled = true;
        clearTimeout(addSearchTimer);
        addSearchTimer = setTimeout(() => runAddSearch(addInput.value), 220);
      });

      addInput.addEventListener("focus", () => {
        if (addInput.value.trim() && !selectedAdd) runAddSearch(addInput.value);
      });

      addClear.addEventListener("click", () => {
        setAddPick(null);
        addMsg.textContent = "Type a name or email to see suggestions.";
        addInput.focus();
      });

      addForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const userId = addUserId.value || selectedAdd?.id;
        if (!userId) {
          addMsg.textContent = "Pick a person from the suggestions first.";
          return;
        }
        addMsg.textContent = "Sending…";
        addSubmit.disabled = true;
        try {
          await sendFriendRequest(userId);
          addMsg.textContent = "Request sent.";
          if (form && typeof form.reset === "function") form.reset();
          setAddPick(null);
          await refreshData();
          renderShell();
          renderPanel();
        } catch (err) {
          addMsg.textContent = err.message || "Could not send request";
          addSubmit.disabled = false;
        }
      });

      panel.querySelectorAll("[data-accept]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await respondToFriendRequest(btn.dataset.accept, true);
          await refreshData();
          renderShell();
          renderPanel();
        });
      });
      panel.querySelectorAll("[data-decline]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await respondToFriendRequest(btn.dataset.decline, false);
          await refreshData();
          renderShell();
          renderPanel();
        });
      });
      panel.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await removeFriendship(btn.dataset.remove);
          await refreshData();
          renderShell();
          renderPanel();
        });
      });
      panel.querySelectorAll("[data-chat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeChatId = btn.dataset.chat;
          tab = "chat";
          renderShell();
          renderPanel();
        });
      });
      return;
    }

    if (tab === "chat") {
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
              <input type="text" name="body" placeholder="Write a message" autocomplete="off" required />
              <button class="btn btn--primary" type="submit">Send</button>
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

      panel.querySelector("#chat-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const input = form?.body;
        const text = input?.value?.trim();
        if (!text) return;
        input.value = "";
        try {
          await sendMessage(chatId, text);
          paint(await listMessages(chatId));
        } catch (err) {
          alert(err.message);
        }
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
              <button type="button" class="fp-search__clear" data-clear="friend" hidden>✕</button>
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
              <button type="button" class="fp-search__clear" data-clear="media" hidden>✕</button>
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

    const partyList = panel.querySelector("#party-list");
    if (!parties.length) {
      partyList.innerHTML = emptyState("No invites", "Watch invites will show up here.");
    } else {
      partyList.innerHTML = parties
        .map((p) => {
          const mineHost = p.host_id === me.id;
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
                  <a class="fp-btn fp-btn--solid" href="${linkTo(
                    partyWatchPath(p)
                  )}">${
                    p.status === "active"
                      ? "Join room"
                      : mineHost
                        ? "Open & wait"
                        : "Open"
                  }</a>
                  ${
                    p.status === "invited" && !mineHost
                      ? `<button class="fp-btn fp-btn--solid" type="button" data-party-accept="${p.id}">Accept & watch</button>
                         <button class="fp-btn" type="button" data-party-decline="${p.id}">Decline</button>`
                      : ""
                  }
                  ${
                    p.status === "active" || p.status === "invited"
                      ? `<button class="fp-btn" type="button" data-party-end="${p.id}">End</button>`
                      : ""
                  }
                </div>
              </div>
            </div>`;
        })
        .join("");
    }

    const friendInput = panel.querySelector("#friend-search");
    const mediaInput = panel.querySelector("#media-search");
    const friendMenu = panel.querySelector("#friend-menu");
    const mediaMenu = panel.querySelector("#media-menu");
    const friendValue = panel.querySelector("#friend-value");
    const guestValue = panel.querySelector("#guest-value");
    const mediaValue = panel.querySelector("#media-value");
    const friendPicked = panel.querySelector("#friend-picked");
    const mediaPicked = panel.querySelector("#media-picked");
    const friendClear = panel.querySelector('[data-clear="friend"]');
    const mediaClear = panel.querySelector('[data-clear="media"]');
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
        friendClear.hidden = true;
        friendInput.value = "";
        friendInput.hidden = false;
        syncSubmit();
        return;
      }
      friendValue.value = friend.id;
      guestValue.value = friend.otherId;
      friendInput.hidden = true;
      friendClear.hidden = false;
      friendPicked.hidden = false;
      friendPicked.innerHTML = `
        ${avatarHtml(friend.other, "fp-avatar--sm")}
        <div>
          <strong>${escapeHtml(friend.other?.display_name || "Friend")}</strong>
          <span>${escapeHtml(friend.other?.email || "")}</span>
        </div>
      `;
      closeMenus();
      syncSubmit();
    };

    const setMedia = (item) => {
      selectedMedia = item;
      if (!item) {
        mediaValue.value = "";
        mediaPicked.hidden = true;
        mediaPicked.innerHTML = "";
        mediaClear.hidden = true;
        mediaInput.value = "";
        mediaInput.hidden = false;
        syncSubmit();
        return;
      }
      mediaValue.value = `${item.mediaType || "movie"}:${item.id}`;
      mediaInput.hidden = true;
      mediaClear.hidden = false;
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
      `;
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

    friendClear?.addEventListener("click", () => setFriend(null));
    mediaClear?.addEventListener("click", () => setMedia(null));

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

    panel.querySelectorAll("[data-party-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.partyAccept;
        const party = parties.find((p) => p.id === id);
        await updateWatchPartyStatus(id, "active");
        if (party) {
          location.hash = linkTo(partyWatchPath({ ...party, status: "active" }));
          return;
        }
        await refreshData();
        renderShell();
        renderPanel();
      });
    });
    panel.querySelectorAll("[data-party-decline]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateWatchPartyStatus(btn.dataset.partyDecline, "declined");
        await refreshData();
        renderShell();
        renderPanel();
      });
    });
    panel.querySelectorAll("[data-party-end]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateWatchPartyStatus(btn.dataset.partyEnd, "ended");
        await refreshData();
        renderShell();
        renderPanel();
      });
    });
  }

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
      const table = payload?.table || payload?.source;
      await refreshData();
      notifyFriendsBadge();

      // Keep chat composer intact; only refresh bubbles for this thread
      if (tab === "chat" && table === "friend_messages") {
        const row = payload?.new;
        if (row?.friendship_id && row.friendship_id === activeChatId && chatPaint) {
          try {
            chatPaint(await listMessages(activeChatId));
          } catch (_) {
            /* ignore */
          }
        }
        syncTabBadgesOnly();
        return;
      }

      // People / Watch (and friendship list changes while chatting) — full refresh
      renderShell();
      await renderPanel();
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
      },
    };
  }
  await renderPanel();

  unsubPage = subscribeFriendsRealtime((payload) => {
    scheduleLiveRefresh(payload);
  });

  return {
    unmount() {
      clearTimeout(liveTimer);
      unsubChat?.();
      unsubPage?.();
      unsubWatchDoc?.();
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
