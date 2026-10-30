/**
 * Soften third-party embed ads:
 * - eat the first click (common popup trigger)
 * - cover the embed's ← / back control so exit never hits ad handlers
 * - block window.open while the player is open
 * - reclaim focus if a popup steals it
 * Sandbox (no allow-popups / no top-navigation) does the heavy lifting.
 */

export function attachStreamAdGuard(
  frame,
  {
    onSafeExit,
    skipShield = false,
    showExit = true,
    shieldLabel = "Tap to play",
    shieldHint = "Blocks pop-up ads on the first click",
    exitCorner = "start",
    exitLabel = "←",
  } = {}
) {
  if (!frame) return () => {};

  const iframe = frame.querySelector("iframe");
  let unlocked = Boolean(skipShield);
  let lastInteract = 0;
  let shield = null;
  let exitBtn = null;

  // Solo watch / guest sync — host Play already starts under a user gesture.
  if (!skipShield) {
    shield = document.createElement("button");
    shield.type = "button";
    shield.className = "stream-shield";
    shield.setAttribute("aria-label", shieldLabel);
    shield.innerHTML = `
      <span class="stream-shield__pulse" aria-hidden="true"></span>
      <span class="stream-shield__label">${escapeShieldText(shieldLabel)}</span>
      <span class="stream-shield__hint">${escapeShieldText(shieldHint)}</span>
    `;
    frame.appendChild(shield);

    if (iframe) {
      iframe.classList.add("is-guarded");
      iframe.setAttribute("tabindex", "-1");
    }

    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      lastInteract = Date.now();
      // Load the embed only on Sync / tap — never prefetch behind the shield
      if (iframe?.dataset?.src) {
        iframe.src = iframe.dataset.src;
        delete iframe.dataset.src;
      }
      shield.classList.add("is-leaving");
      window.setTimeout(() => shield.remove(), 280);
      iframe?.classList.remove("is-guarded");
    };

    shield.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      unlock();
    });
  } else if (iframe?.dataset?.src) {
    // Host path with deferSrc (rare): still honor data-src without a shield
    iframe.src = iframe.dataset.src;
    delete iframe.dataset.src;
  }

  const safeExit = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    lastInteract = Date.now();
    if (typeof onSafeExit === "function") {
      onSafeExit();
      return;
    }
    // Fallback: just tear down the iframe so embed back can't fire ads.
    if (iframe) iframe.src = "about:blank";
  };

  // Detail: cover embed ←. Watch party can omit this (room has Back / End).
  if (showExit) {
    exitBtn = document.createElement("button");
    exitBtn.type = "button";
    exitBtn.className = `stream-exit${
      exitCorner === "end" ? " stream-exit--end" : ""
    }`;
    exitBtn.setAttribute("aria-label", "Close player");
    exitBtn.innerHTML = `<span aria-hidden="true">${escapeShieldText(
      exitLabel
    )}</span>`;
    frame.appendChild(exitBtn);

    exitBtn.addEventListener("pointerdown", (e) => {
      // Beat the iframe to the punch on touch devices.
      e.preventDefault();
      e.stopPropagation();
    });
    exitBtn.addEventListener("click", safeExit);
  }

  const onFramePointer = () => {
    lastInteract = Date.now();
  };
  frame.addEventListener("pointerdown", onFramePointer);

  const nativeOpen = window.open.bind(window);
  let blockedPopupAt = 0;
  // While this guard is mounted, swallow popup attempts from the page/embed flow.
  window.open = () => {
    blockedPopupAt = Date.now();
    return null;
  };

  const reclaimFocus = () => {
    if (!unlocked) return;
    // Only reclaim after a blocked popup — never when the user is using the player
    // (seek / pause / fullscreen). Stealing focus mid-seek restarts many embeds.
    if (!blockedPopupAt || Date.now() - blockedPopupAt > 2500) return;
    window.setTimeout(() => {
      if (iframe && document.activeElement === iframe) return;
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      blockedPopupAt = 0;
    }, 80);
  };

  window.addEventListener("blur", reclaimFocus);

  // CineSrc `back=close` → postMessage; treat as our safe exit.
  const onMessage = (event) => {
    if (event.origin !== "https://cinesrc.st") return;
    if (event.data?.type !== "cinesrc:close") return;
    safeExit(event);
  };
  window.addEventListener("message", onMessage);

  return () => {
    window.open = nativeOpen;
    window.removeEventListener("blur", reclaimFocus);
    window.removeEventListener("message", onMessage);
    frame.removeEventListener("pointerdown", onFramePointer);
    shield?.remove();
    exitBtn?.remove();
    iframe?.classList.remove("is-guarded");
  };
}

function escapeShieldText(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
