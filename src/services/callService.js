import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let pc = null;
let localStream = null;
let inboxChannel = null;
let sessionChannel = null;

let myId = null;
let ui = null;
let pendingInvite = null;
let activeCall = null; // { friendshipId, peerId, peerName, role: 'caller'|'callee' }
let makingOffer = false;

function el(sel) {
  return ui?.root?.querySelector(sel) || null;
}

function setStatus(text) {
  const node = el("[data-vc-status]");
  if (node) node.textContent = text || "";
}

function showStage(mode) {
  if (!ui?.root) return;
  ui.root.hidden = mode === "idle";
  ui.root.dataset.mode = mode;
  const incoming = el("[data-vc-incoming]");
  const active = el("[data-vc-active]");
  if (incoming) incoming.hidden = mode !== "incoming";
  if (active) active.hidden = mode === "incoming" || mode === "idle";
}

function ensureUi() {
  if (ui?.root?.isConnected) return ui;
  const root = document.createElement("div");
  root.className = "vc";
  root.hidden = true;
  root.dataset.mode = "idle";
  root.innerHTML = `
    <div class="vc__incoming" data-vc-incoming hidden>
      <div class="vc__incoming-card">
        <p class="vc__kicker">Incoming video call</p>
        <strong data-vc-peer>Friend</strong>
        <div class="vc__incoming-actions">
          <button type="button" class="btn btn--primary" data-vc-accept>Accept</button>
          <button type="button" class="btn btn--ghost" data-vc-decline>Decline</button>
        </div>
      </div>
    </div>
    <div class="vc__active" data-vc-active hidden>
      <div class="vc__stage">
        <video class="vc__remote" data-vc-remote autoplay playsinline></video>
        <video class="vc__local" data-vc-local autoplay playsinline muted></video>
      </div>
      <p class="vc__status" data-vc-status></p>
      <div class="vc__bar">
        <button type="button" class="vc__ctrl" data-vc-mute aria-label="Mute">Mic</button>
        <button type="button" class="vc__ctrl" data-vc-cam aria-label="Camera">Cam</button>
        <button type="button" class="vc__ctrl vc__ctrl--end" data-vc-end aria-label="End call">End</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelector("[data-vc-accept]")?.addEventListener("click", () => {
    acceptIncomingCall().catch((err) => alert(err.message || "Could not accept"));
  });
  root.querySelector("[data-vc-decline]")?.addEventListener("click", () => {
    declineIncomingCall().catch(() => {});
  });
  root.querySelector("[data-vc-end]")?.addEventListener("click", () => {
    hangUp({ notify: true }).catch(() => {});
  });
  root.querySelector("[data-vc-mute]")?.addEventListener("click", (e) => {
    const track = localStream?.getAudioTracks()?.[0];
    if (!track) return;
    track.enabled = !track.enabled;
    e.currentTarget.classList.toggle("is-off", !track.enabled);
    e.currentTarget.textContent = track.enabled ? "Mic" : "Muted";
  });
  root.querySelector("[data-vc-cam]")?.addEventListener("click", (e) => {
    const track = localStream?.getVideoTracks()?.[0];
    if (!track) return;
    track.enabled = !track.enabled;
    e.currentTarget.classList.toggle("is-off", !track.enabled);
    e.currentTarget.textContent = track.enabled ? "Cam" : "Cam off";
  });

  ui = { root };
  return ui;
}

async function getLocalMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { facingMode: "user" },
  });
  const localVideo = el("[data-vc-local]");
  if (localVideo) {
    localVideo.srcObject = localStream;
  }
  return localStream;
}

function wirePeerConnection() {
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if (!ev.candidate || !sessionChannel || !activeCall) return;
    sessionChannel.send({
      type: "broadcast",
      event: "signal",
      payload: {
        kind: "ice",
        from: myId,
        candidate: ev.candidate.toJSON(),
      },
    });
  };

  pc.ontrack = (ev) => {
    const remoteVideo = el("[data-vc-remote]");
    if (!remoteVideo) return;
    if (ev.streams?.[0]) {
      remoteVideo.srcObject = ev.streams[0];
    } else {
      const stream = remoteVideo.srcObject || new MediaStream();
      stream.addTrack(ev.track);
      remoteVideo.srcObject = stream;
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === "connected") setStatus("Connected");
    else if (state === "connecting") setStatus("Connecting…");
    else if (state === "failed") setStatus("Connection failed");
    else if (state === "disconnected") setStatus("Reconnecting…");
    else if (state === "closed") setStatus("");
  };
}

async function attachLocalTracks() {
  const stream = await getLocalMedia();
  for (const track of stream.getTracks()) {
    const already = pc.getSenders().some((s) => s.track?.id === track.id);
    if (!already) pc.addTrack(track, stream);
  }
}

async function joinSession(friendshipId, { onAccepted } = {}) {
  if (sessionChannel) {
    try {
      await getSupabase().removeChannel(sessionChannel);
    } catch {
      /* ignore */
    }
    sessionChannel = null;
  }

  sessionChannel = getSupabase().channel(`lantaw-call-session:${friendshipId}`, {
    config: { broadcast: { self: false } },
  });

  sessionChannel.on("broadcast", { event: "signal" }, async ({ payload }) => {
    if (!payload || payload.from === myId) return;
    try {
      if (payload.kind === "offer" && activeCall?.role === "callee") {
        if (!pc) {
          wirePeerConnection();
          await attachLocalTracks();
        }
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sessionChannel.send({
          type: "broadcast",
          event: "signal",
          payload: {
            kind: "answer",
            from: myId,
            sdp: pc.localDescription,
          },
        });
        setStatus("Connected");
      } else if (payload.kind === "answer" && activeCall?.role === "caller") {
        await pc?.setRemoteDescription(payload.sdp);
        setStatus("Connected");
      } else if (payload.kind === "ice" && payload.candidate) {
        try {
          await pc?.addIceCandidate(payload.candidate);
        } catch {
          /* ignore late candidates */
        }
      } else if (payload.kind === "hangup") {
        await hangUp({ notify: false });
      }
    } catch (err) {
      console.warn("Call signal error:", err);
      setStatus(err.message || "Call error");
    }
  });

  if (onAccepted) {
    sessionChannel.on("broadcast", { event: "accepted" }, (msg) => {
      onAccepted(msg);
    });
  }

  await new Promise((resolve) => {
    sessionChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
}

async function sendInbox(peerId, event, payload) {
  const ch = getSupabase().channel(`lantaw-call-inbox:${peerId}`, {
    config: { broadcast: { self: false } },
  });
  await new Promise((resolve) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await ch.send({ type: "broadcast", event, payload });
  setTimeout(() => {
    getSupabase().removeChannel(ch).catch(() => {});
  }, 800);
}

/**
 * Listen for incoming calls for the signed-in user (app-wide).
 */
export async function startCallInbox() {
  ensureUi();
  const user = await getUser();
  if (!user) {
    await stopCallInbox();
    return;
  }
  if (inboxChannel && myId === user.id) return;

  await stopCallInbox();
  myId = user.id;
  ensureUi();

  inboxChannel = getSupabase().channel(`lantaw-call-inbox:${user.id}`, {
    config: { broadcast: { self: false } },
  });

  inboxChannel.on("broadcast", { event: "invite" }, ({ payload }) => {
    if (!payload?.friendshipId || payload.from === myId) return;
    if (activeCall || pendingInvite) {
      sendInbox(payload.from, "busy", { friendshipId: payload.friendshipId }).catch(
        () => {}
      );
      return;
    }
    pendingInvite = {
      friendshipId: payload.friendshipId,
      peerId: payload.from,
      peerName: payload.name || "Friend",
    };
    const nameEl = el("[data-vc-peer]");
    if (nameEl) nameEl.textContent = pendingInvite.peerName;
    showStage("incoming");
    setStatus("Incoming call…");
  });

  inboxChannel.on("broadcast", { event: "cancel" }, ({ payload }) => {
    if (
      pendingInvite &&
      (!payload?.friendshipId ||
        payload.friendshipId === pendingInvite.friendshipId)
    ) {
      pendingInvite = null;
      showStage("idle");
      return;
    }
    if (
      activeCall?.role === "caller" &&
      payload?.friendshipId === activeCall.friendshipId
    ) {
      hangUp({ notify: false }).catch(() => {});
      alert("Call declined");
    }
  });

  inboxChannel.on("broadcast", { event: "busy" }, () => {
    if (activeCall?.role === "caller") {
      setStatus("Busy");
      hangUp({ notify: false }).catch(() => {});
      alert("Friend is busy on another call.");
    }
  });

  await new Promise((resolve) => {
    inboxChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
}

export async function stopCallInbox() {
  await hangUp({ notify: false }).catch(() => {});
  if (inboxChannel) {
    try {
      await getSupabase().removeChannel(inboxChannel);
    } catch {
      /* ignore */
    }
  }
  inboxChannel = null;
  myId = null;
}

export async function startVideoCall({ friendshipId, peerId, peerName }) {
  ensureUi();
  const user = await getUser();
  if (!user) throw new Error("Sign in to call");
  if (!friendshipId || !peerId) throw new Error("Missing call target");
  if (activeCall || pendingInvite) throw new Error("Already in a call");
  if (!window.isSecureContext && location.hostname !== "localhost") {
    throw new Error("Video calls need HTTPS (or localhost)");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can’t start a video call");
  }

  myId = user.id;
  activeCall = {
    friendshipId,
    peerId,
    peerName: peerName || "Friend",
    role: "caller",
  };

  showStage("active");
  setStatus("Calling…");
  const nameEl = el("[data-vc-peer]");
  if (nameEl) nameEl.textContent = activeCall.peerName;

  try {
    await joinSession(friendshipId, {
      onAccepted: async ({ payload }) => {
        if (payload?.from === myId || activeCall?.role !== "caller") return;
        if (makingOffer || pc) return;
        try {
          setStatus("Connecting…");
          wirePeerConnection();
          await attachLocalTracks();
          makingOffer = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          makingOffer = false;
          sessionChannel.send({
            type: "broadcast",
            event: "signal",
            payload: {
              kind: "offer",
              from: myId,
              sdp: pc.localDescription,
            },
          });
        } catch (err) {
          makingOffer = false;
          alert(err.message || "Could not start call");
          await hangUp({ notify: true });
        }
      },
    });
    await getLocalMedia();
    await sendInbox(peerId, "invite", {
      friendshipId,
      from: myId,
      name: user.user_metadata?.display_name || user.email || "Friend",
    });
  } catch (err) {
    await hangUp({ notify: true });
    throw err;
  }
}

export async function acceptIncomingCall() {
  if (!pendingInvite) return;
  ensureUi();
  const user = await getUser();
  if (!user) throw new Error("Sign in to answer");

  const invite = pendingInvite;
  pendingInvite = null;
  activeCall = {
    friendshipId: invite.friendshipId,
    peerId: invite.peerId,
    peerName: invite.peerName,
    role: "callee",
  };

  showStage("active");
  setStatus("Connecting…");

  await joinSession(invite.friendshipId);
  await getLocalMedia();
  wirePeerConnection();
  await attachLocalTracks();

  await sessionChannel.send({
    type: "broadcast",
    event: "accepted",
    payload: { from: myId, friendshipId: invite.friendshipId },
  });
}

export async function declineIncomingCall() {
  const invite = pendingInvite;
  pendingInvite = null;
  showStage("idle");
  if (invite?.peerId) {
    await sendInbox(invite.peerId, "cancel", {
      friendshipId: invite.friendshipId,
      from: myId,
    }).catch(() => {});
  }
}

export async function hangUp({ notify = true } = {}) {
  const call = activeCall;
  activeCall = null;
  pendingInvite = null;
  makingOffer = false;

  if (notify && call && sessionChannel) {
    try {
      await sessionChannel.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "hangup", from: myId },
      });
    } catch {
      /* ignore */
    }
  }
  if (notify && call?.peerId && call.role === "caller") {
    sendInbox(call.peerId, "cancel", {
      friendshipId: call.friendshipId,
      from: myId,
    }).catch(() => {});
  }

  try {
    pc?.getSenders()?.forEach((s) => {
      try {
        s.track?.stop();
      } catch {
        /* ignore */
      }
    });
    pc?.close();
  } catch {
    /* ignore */
  }
  pc = null;

  localStream?.getTracks()?.forEach((t) => t.stop());
  localStream = null;

  const localVideo = el("[data-vc-local]");
  const remoteVideo = el("[data-vc-remote]");
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;

  if (sessionChannel) {
    try {
      await getSupabase().removeChannel(sessionChannel);
    } catch {
      /* ignore */
    }
  }
  sessionChannel = null;

  showStage("idle");
  setStatus("");
}

export function isInCall() {
  return Boolean(activeCall || pendingInvite);
}
