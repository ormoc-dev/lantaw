import { getSupabase } from "../lib/supabase.js";
import { getUser } from "./authService.js";
import { showNotice } from "../lib/appModal.js";

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Public TURN fallback so mobile/strict NATs can finish connecting
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

let pc = null;
let localStream = null;
let inboxChannel = null;
let sessionChannel = null;
let pendingIce = [];
let remoteReady = false;

let myId = null;
let ui = null;
let pendingInvite = null;
let activeCall = null;
let offerStarted = false;

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
    acceptIncomingCall().catch((err) =>
      showNotice({
        title: "Couldn’t answer",
        message: err.message || "Could not accept the call.",
      })
    );
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

function sdpPayload(desc) {
  if (!desc) return null;
  return { type: desc.type, sdp: desc.sdp };
}

async function sendSignal(payload) {
  if (!sessionChannel) return;
  await sessionChannel.send({
    type: "broadcast",
    event: "signal",
    payload: { ...payload, from: myId },
  });
}

async function flushIce() {
  if (!pc || !remoteReady) return;
  const queued = pendingIce.splice(0);
  for (const raw of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(raw));
    } catch (err) {
      console.warn("ICE flush failed", err);
    }
  }
}

async function getLocalMedia() {
  if (localStream) {
    const localVideo = el("[data-vc-local]");
    if (localVideo && localVideo.srcObject !== localStream) {
      localVideo.srcObject = localStream;
    }
    return localStream;
  }
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { facingMode: "user" },
  });
  const localVideo = el("[data-vc-local]");
  if (localVideo) localVideo.srcObject = localStream;
  return localStream;
}

function wirePeerConnection() {
  if (pc) return pc;
  pendingIce = [];
  remoteReady = false;
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    sendSignal({
      kind: "ice",
      candidate: ev.candidate.toJSON(),
    }).catch(() => {});
  };

  pc.ontrack = (ev) => {
    const remoteVideo = el("[data-vc-remote]");
    if (!remoteVideo) return;
    const stream = ev.streams?.[0] || new MediaStream([ev.track]);
    remoteVideo.srcObject = stream;
    remoteVideo.play?.().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === "connected") setStatus("Connected");
    else if (state === "connecting") setStatus("Connecting…");
    else if (state === "failed") {
      setStatus("Connection failed");
      showNotice({
        title: "Call couldn’t connect",
        message:
          "Network blocked the peer link. Try the same Wi‑Fi, or a different network.",
      }).catch(() => {});
    } else if (state === "disconnected") setStatus("Reconnecting…");
    else if (state === "closed") setStatus("");
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc?.iceConnectionState;
    if (state === "connected" || state === "completed") setStatus("Connected");
    else if (state === "checking") setStatus("Connecting…");
    else if (state === "failed") setStatus("Connection failed");
  };

  return pc;
}

async function attachLocalTracks() {
  const stream = await getLocalMedia();
  const conn = wirePeerConnection();
  for (const track of stream.getTracks()) {
    const already = conn.getSenders().some((s) => s.track?.kind === track.kind);
    if (!already) conn.addTrack(track, stream);
  }
}

async function handleSignal(payload) {
  if (!payload || payload.from === myId) return;

  if (payload.kind === "offer" && activeCall?.role === "callee") {
    setStatus("Connecting…");
    await attachLocalTracks();
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    remoteReady = true;
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal({ kind: "answer", sdp: sdpPayload(pc.localDescription) });
    setStatus("Connecting…");
    return;
  }

  if (payload.kind === "answer" && activeCall?.role === "caller") {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    remoteReady = true;
    await flushIce();
    setStatus("Connecting…");
    return;
  }

  if (payload.kind === "ice" && payload.candidate) {
    if (!pc || !remoteReady) {
      pendingIce.push(payload.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (err) {
      console.warn("addIceCandidate", err);
    }
    return;
  }

  if (payload.kind === "hangup") {
    await hangUp({ notify: false });
  }
}

async function startCallerOffer() {
  if (offerStarted || activeCall?.role !== "caller") return;
  offerStarted = true;
  setStatus("Connecting…");
  await attachLocalTracks();
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(offer);
  await sendSignal({ kind: "offer", sdp: sdpPayload(pc.localDescription) });
}

async function joinSession(friendshipId) {
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
    try {
      await handleSignal(payload);
    } catch (err) {
      console.warn("Call signal error:", err);
      setStatus(err.message || "Call error");
    }
  });

  sessionChannel.on("broadcast", { event: "accepted" }, async ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (activeCall?.role !== "caller") return;
    try {
      await startCallerOffer();
    } catch (err) {
      offerStarted = false;
      await showNotice({
        title: "Call failed",
        message: err.message || "Could not start the video call.",
      });
      await hangUp({ notify: true });
    }
  });

  // Callee may have accepted before caller finished joining — ask again.
  sessionChannel.on("broadcast", { event: "ready" }, async ({ payload }) => {
    if (!payload || payload.from === myId) return;
    if (activeCall?.role === "caller") {
      try {
        await startCallerOffer();
      } catch (err) {
        console.warn(err);
      }
    }
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Could not join call channel")),
      10000
    );
    sessionChannel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error("Call channel error — check Realtime is enabled"));
      }
    });
  });
}

async function sendInbox(peerId, event, payload) {
  const topic = `lantaw-call-inbox:${peerId}`;
  const ch = getSupabase().channel(topic, {
    config: { broadcast: { self: false } },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Inbox timeout")), 8000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await ch.send({ type: "broadcast", event, payload });
  setTimeout(() => {
    getSupabase().removeChannel(ch).catch(() => {});
  }, 1200);
}

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
      showNotice({
        title: "Call declined",
        message: "Your friend declined the video call.",
      });
    }
  });

  inboxChannel.on("broadcast", { event: "busy" }, () => {
    if (activeCall?.role === "caller") {
      setStatus("Busy");
      hangUp({ notify: false }).catch(() => {});
      showNotice({
        title: "Friend is busy",
        message: "They’re already on another call. Try again in a bit.",
      });
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
  offerStarted = false;
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
    await getLocalMedia();
    await joinSession(friendshipId);
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
  offerStarted = false;
  activeCall = {
    friendshipId: invite.friendshipId,
    peerId: invite.peerId,
    peerName: invite.peerName,
    role: "callee",
  };

  showStage("active");
  setStatus("Connecting…");

  await getLocalMedia();
  await joinSession(invite.friendshipId);
  await attachLocalTracks();

  await sessionChannel.send({
    type: "broadcast",
    event: "accepted",
    payload: { from: myId, friendshipId: invite.friendshipId },
  });
  // If caller missed "accepted", nudge them to send the offer.
  await sessionChannel.send({
    type: "broadcast",
    event: "ready",
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
  offerStarted = false;
  remoteReady = false;
  pendingIce = [];

  if (notify && call && sessionChannel) {
    try {
      await sendSignal({ kind: "hangup" });
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
