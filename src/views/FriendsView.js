import { getUser } from "../services/authService.js";
import { getRecentMovies } from "../services/recentService.js";
import { getSupabase } from "../lib/supabase.js";
import {
  createWatchParty,
  listFriendships,
  listMessages,
  listWatchParties,
  removeFriendship,
  respondToFriendRequest,
  searchProfileByEmail,
  sendFriendRequest,
  sendMessage,
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
  let activeChatId = null;
  let unsubRealtime = null;

  const page = document.createElement("div");
  page.className = "page-pad friends-page";
  root.innerHTML = "";
  root.appendChild(page);

  const renderShell = () => {
    page.innerHTML = `
      <header class="page-head">
        <h1>Friends</h1>
        <p class="muted">Add friends, chat, and watch together.</p>
      </header>
      <div class="friends-tabs" role="tablist">
        <button type="button" class="friends-tab ${tab === "friends" ? "is-active" : ""}" data-tab="friends">Friends</button>
        <button type="button" class="friends-tab ${tab === "chat" ? "is-active" : ""}" data-tab="chat">Chat</button>
        <button type="button" class="friends-tab ${tab === "watch" ? "is-active" : ""}" data-tab="watch">Watch together</button>
      </div>
      <div class="friends-panel" id="friends-panel"></div>
    `;

    page.querySelectorAll(".friends-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.dataset.tab;
        renderShell();
        renderPanel();
      });
    });
  };

  const personCard = (p, extra = "") => `
    <div class="friend-card">
      ${
        p?.avatar_url
          ? `<img class="friend-card__avatar" src="${escapeHtml(p.avatar_url)}" alt="" />`
          : `<div class="friend-card__avatar friend-card__avatar--fallback">${escapeHtml(
              (p?.display_name || p?.email || "?").slice(0, 1).toUpperCase()
            )}</div>`
      }
      <div class="friend-card__meta">
        <strong>${escapeHtml(p?.display_name || "User")}</strong>
        <span class="muted">${escapeHtml(p?.email || "")}</span>
      </div>
      <div class="friend-card__actions">${extra}</div>
    </div>
  `;

  async function refreshData() {
    friendships = await listFriendships();
    parties = await listWatchParties();
  }

  async function renderPanel() {
    const panel = page.querySelector("#friends-panel");
    if (!panel) return;

    if (tab === "friends") {
      const accepted = friendships.filter((f) => f.status === "accepted");
      const incoming = friendships.filter((f) => f.isIncoming);
      const outgoing = friendships.filter((f) => f.isOutgoing);

      panel.innerHTML = `
        <form class="friends-add" id="add-friend">
          <label class="auth-field">
            <span>Add friend by email</span>
            <input type="email" name="email" placeholder="friend@email.com" required />
          </label>
          <button class="btn btn--primary" type="submit">Send request</button>
          <p class="muted friends-hint" id="add-msg"></p>
        </form>

        <section class="friends-section">
          <h2>Requests</h2>
          <div id="requests-list"></div>
        </section>
        <section class="friends-section">
          <h2>Your friends</h2>
          <div id="friends-list"></div>
        </section>
      `;

      const reqBox = panel.querySelector("#requests-list");
      if (!incoming.length && !outgoing.length) {
        reqBox.innerHTML = `<p class="muted">No pending requests.</p>`;
      } else {
        reqBox.innerHTML = [
          ...incoming.map(
            (f) =>
              personCard(
                f.other,
                `<button class="btn btn--primary" data-accept="${f.id}" type="button">Accept</button>
                 <button class="btn btn--ghost" data-decline="${f.id}" type="button">Decline</button>`
              )
          ),
          ...outgoing.map(
            (f) =>
              personCard(
                f.other,
                `<span class="muted">Pending</span>
                 <button class="btn btn--ghost" data-remove="${f.id}" type="button">Cancel</button>`
              )
          ),
        ].join("");
      }

      const friendsBox = panel.querySelector("#friends-list");
      if (!accepted.length) {
        friendsBox.innerHTML = `<p class="muted">No friends yet. Add someone by email.</p>`;
      } else {
        friendsBox.innerHTML = accepted
          .map(
            (f) =>
              personCard(
                f.other,
                `<button class="btn btn--ghost" data-chat="${f.id}" type="button">Chat</button>
                 <button class="btn btn--ghost" data-remove="${f.id}" type="button">Remove</button>`
              )
          )
          .join("");
      }

      panel.querySelector("#add-friend").addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = panel.querySelector("#add-msg");
        const email = e.currentTarget.email.value.trim();
        msg.textContent = "Sending…";
        try {
          const profile = await searchProfileByEmail(email);
          if (!profile) throw new Error("No user found with that email");
          await sendFriendRequest(profile.id);
          msg.textContent = "Request sent.";
          await refreshData();
          renderPanel();
        } catch (err) {
          msg.textContent = err.message || "Could not send request";
        }
      });

      panel.querySelectorAll("[data-accept]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await respondToFriendRequest(btn.dataset.accept, true);
          await refreshData();
          renderPanel();
        });
      });
      panel.querySelectorAll("[data-decline]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await respondToFriendRequest(btn.dataset.decline, false);
          await refreshData();
          renderPanel();
        });
      });
      panel.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await removeFriendship(btn.dataset.remove);
          await refreshData();
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
        panel.innerHTML = `<p class="muted">Add a friend first to start chatting.</p>`;
        return;
      }
      if (!activeChatId) activeChatId = accepted[0].id;
      const current = accepted.find((f) => f.id === activeChatId) || accepted[0];
      activeChatId = current.id;

      panel.innerHTML = `
        <div class="chat-layout">
          <aside class="chat-friends">
            ${accepted
              .map(
                (f) => `
              <button type="button" class="chat-friend ${f.id === activeChatId ? "is-active" : ""}" data-open-chat="${f.id}">
                ${escapeHtml(f.other?.display_name || f.other?.email || "Friend")}
              </button>`
              )
              .join("")}
          </aside>
          <section class="chat-thread">
            <header class="chat-thread__head">
              <strong>${escapeHtml(current.other?.display_name || "Friend")}</strong>
            </header>
            <div class="chat-messages" id="chat-messages"><p class="muted">Loading…</p></div>
            <form class="chat-compose" id="chat-form">
              <input type="text" name="body" placeholder="Say something…" autocomplete="off" required />
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
        if (!messages.length) {
          box.innerHTML = `<p class="muted">No messages yet. Say hi!</p>`;
          return;
        }
        box.innerHTML = messages
          .map(
            (m) => `
          <div class="chat-bubble ${m.sender_id === me.id ? "is-me" : ""}">
            <p>${escapeHtml(m.body)}</p>
            <time>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          </div>`
          )
          .join("");
        box.scrollTop = box.scrollHeight;
      };

      try {
        paint(await listMessages(activeChatId));
      } catch (err) {
        box.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
      }

      if (unsubRealtime) unsubRealtime();
      const channel = getSupabase()
        .channel(`chat-${activeChatId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "friend_messages",
            filter: `friendship_id=eq.${activeChatId}`,
          },
          async () => {
            try {
              paint(await listMessages(activeChatId));
            } catch (_) {
              /* ignore */
            }
          }
        )
        .subscribe();
      unsubRealtime = () => {
        getSupabase().removeChannel(channel);
        unsubRealtime = null;
      };

      panel.querySelector("#chat-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = e.currentTarget.body;
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try {
          await sendMessage(activeChatId, text);
          paint(await listMessages(activeChatId));
        } catch (err) {
          alert(err.message);
        }
      });
      return;
    }

    // Watch together
    const accepted = friendships.filter((f) => f.status === "accepted");
    const recent = getRecentMovies().slice(0, 8);

    panel.innerHTML = `
      <section class="friends-section">
        <h2>Invite a friend</h2>
        <p class="muted">Pick a recent title and a friend to watch together.</p>
        <form class="watch-invite" id="watch-invite">
          <label class="auth-field">
            <span>Friend</span>
            <select name="friendshipId" required>
              <option value="">Select friend…</option>
              ${accepted
                .map(
                  (f) =>
                    `<option value="${f.id}" data-guest="${f.otherId}">${escapeHtml(
                      f.other?.display_name || f.other?.email || "Friend"
                    )}</option>`
                )
                .join("")}
            </select>
          </label>
          <label class="auth-field">
            <span>Title</span>
            <select name="media" required>
              <option value="">Select from recent…</option>
              ${recent
                .map(
                  (m) =>
                    `<option value="${m.mediaType || "movie"}:${m.id}">${escapeHtml(
                      m.title
                    )}</option>`
                )
                .join("")}
            </select>
          </label>
          <button class="btn btn--primary" type="submit" ${
            !accepted.length || !recent.length ? "disabled" : ""
          }>Send invite</button>
          <p class="muted friends-hint" id="watch-msg">
            ${
              !accepted.length
                ? "Add a friend first."
                : !recent.length
                  ? "Open a movie/TV page first so it appears in Recent."
                  : ""
            }
          </p>
        </form>
      </section>
      <section class="friends-section">
        <h2>Your watch invites</h2>
        <div id="party-list"></div>
      </section>
    `;

    const partyList = panel.querySelector("#party-list");
    if (!parties.length) {
      partyList.innerHTML = `<p class="muted">No watch sessions yet.</p>`;
    } else {
      partyList.innerHTML = parties
        .map((p) => {
          const mineHost = p.host_id === me.id;
          const path =
            p.media_type === "tv" ? `/tv/${p.tmdb_id}` : `/movie/${p.tmdb_id}`;
          return `
            <div class="party-card">
              ${
                p.poster
                  ? `<img src="${escapeHtml(p.poster)}" alt="" />`
                  : `<div class="party-card__ph"></div>`
              }
              <div>
                <strong>${escapeHtml(p.title)}</strong>
                <p class="muted">${mineHost ? "You hosted" : "Invited you"} · ${escapeHtml(
                  p.status
                )}</p>
                <div class="party-card__actions">
                  <a class="btn btn--primary" href="${linkTo(path)}">Open</a>
                  ${
                    p.status === "invited" && !mineHost
                      ? `<button class="btn btn--ghost" type="button" data-party-accept="${p.id}">Accept</button>
                         <button class="btn btn--ghost" type="button" data-party-decline="${p.id}">Decline</button>`
                      : ""
                  }
                  ${
                    p.status === "active" || p.status === "invited"
                      ? `<button class="btn btn--ghost" type="button" data-party-end="${p.id}">End</button>`
                      : ""
                  }
                </div>
              </div>
            </div>`;
        })
        .join("");
    }

    panel.querySelector("#watch-invite")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const msg = panel.querySelector("#watch-msg");
      const friendshipId = form.friendshipId.value;
      const opt = form.friendshipId.selectedOptions[0];
      const guestId = opt?.dataset?.guest;
      const [mediaType, tmdbId] = String(form.media.value).split(":");
      const titleMeta = recent.find(
        (m) => String(m.id) === String(tmdbId) && (m.mediaType || "movie") === mediaType
      );
      msg.textContent = "Sending invite…";
      try {
        await createWatchParty({
          friendshipId,
          guestId,
          mediaType,
          tmdbId: Number(tmdbId),
          title: titleMeta?.title || "Untitled",
          poster: titleMeta?.poster || null,
        });
        msg.textContent = "Invite sent.";
        await refreshData();
        renderPanel();
      } catch (err) {
        msg.textContent = err.message || "Failed to invite";
      }
    });

    panel.querySelectorAll("[data-party-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateWatchPartyStatus(btn.dataset.partyAccept, "active");
        await refreshData();
        renderPanel();
      });
    });
    panel.querySelectorAll("[data-party-decline]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateWatchPartyStatus(btn.dataset.partyDecline, "declined");
        await refreshData();
        renderPanel();
      });
    });
    panel.querySelectorAll("[data-party-end]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateWatchPartyStatus(btn.dataset.partyEnd, "ended");
        await refreshData();
        renderPanel();
      });
    });
  }

  renderShell();
  try {
    await refreshData();
  } catch (err) {
    page.querySelector("#friends-panel").innerHTML = `
      <p class="muted">${escapeHtml(err.message)}</p>
      <p class="muted">If tables are missing, run the new Supabase migration <code>202603260003_friends_chat_watch.sql</code>.</p>
    `;
    return {
      unmount() {
        if (unsubRealtime) unsubRealtime();
      },
    };
  }
  await renderPanel();

  return {
    unmount() {
      if (unsubRealtime) unsubRealtime();
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
