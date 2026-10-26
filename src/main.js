import { createApp } from "./App.js";
import { recoverSession } from "./services/authService.js";
import { assetUrl } from "./config/base.js";

async function boot() {
  let session = null;
  try {
    session = await recoverSession();
  } catch (err) {
    console.warn("Session recovery failed:", err?.message || err);
  }

  // If Google login succeeded, never stay on #/login
  if (session && (location.hash === "#/login" || !location.hash)) {
    location.hash = "#/";
  }

  const root = document.getElementById("app");
  const app = createApp(root);
  app.mount();
}

boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(assetUrl("/sw.js")).catch(() => {
      /* offline cache optional */
    });
  });
}
