import { createApp } from "./App.js";
import { recoverSession } from "./services/authService.js";

async function boot() {
  let session = null;
  try {
    session = await recoverSession();
  } catch (err) {
    console.warn("Session recovery failed:", err?.message || err);
  }

  if (session && (location.hash === "#/login" || !location.hash)) {
    location.hash = "#/";
  }

  const root = document.getElementById("app");
  const app = createApp(root);
  app.mount();
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

// Clear stale service workers so localhost always shows latest files
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}
