import { createApp } from "./App.js";
import { onAuthChange, recoverSession } from "./services/authService.js";
import {
  startPresence,
  stopPresence,
} from "./services/presenceService.js";
import {
  startCallInbox,
  stopCallInbox,
} from "./services/callService.js";
import {
  startWatchInviteInbox,
  stopWatchInviteInbox,
} from "./services/watchInviteService.js";
import { initPwaInstall } from "./lib/pwaInstall.js";

initPwaInstall();

// Light Halloween dressing in October (pumpkins only — no palette change).
if (new Date().getMonth() === 9) {
  document.body.classList.add("is-halloween");
}

async function boot() {
  let session = null;
  try {
    session = await recoverSession();
  } catch (err) {
    console.warn("Session recovery failed:", err?.message || err);
  }

  // After Google OAuth, land in the app — not back on /login.
  // Keep category routes (e.g. #/anime) on refresh; only leave /login.
  if (session) {
    const hashPath = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    if (hashPath === "/reset-password") {
      /* stay */
    } else if (!location.hash || location.hash === "#/login") {
      let next = "/";
      try {
        const saved = sessionStorage.getItem("lantaw-return-path");
        if (saved && saved.startsWith("/") && saved !== "/login") next = saved;
      } catch {
        /* ignore */
      }
      location.hash = `#${next}`;
    }
  }

  const root = document.getElementById("app");
  const app = createApp(root);
  app.mount();

  // Friend online/offline + call/watch-invite modals (while the app is open).
  if (session) {
    startPresence().catch(() => {});
    startCallInbox().catch(() => {});
    startWatchInviteInbox().catch(() => {});
  }
  onAuthChange((next) => {
    if (next) {
      startPresence().catch(() => {});
      startCallInbox().catch(() => {});
      startWatchInviteInbox().catch(() => {});
    } else {
      stopPresence().catch(() => {});
      stopCallInbox().catch(() => {});
      stopWatchInviteInbox().catch(() => {});
    }
  });
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML = `<p style="padding:1.5rem;color:#e8eef6;font-family:sans-serif">App failed to start. Open DevTools → Console for details.<br/><small>${String(
      err?.message || err
    )}</small></p>`;
  }
});
