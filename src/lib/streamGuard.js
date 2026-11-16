/**
 * Soften third-party embed ads:
 * - eat the first click (common popup trigger)
 * - defer src load so "Watch now" user-activation can't chain into window.open
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
    /** Quiet first-tap catcher (no big play overlay). */
    ghostShield = false,
    showExit = true,
    shieldLabel = "Tap to start",
    shieldHint = "Blocks pop-up ads on the first tap",
    exitCorner = "start",
    exitLabel = "←",
  } = {}
) {
  if (!frame) return () => {};

  const iframe = frame.querySelector("iframe");
  let unlocked = Boolean(skipShield) && !ghostShield;
  let shield = null;
  let exitBtn = null;
  let loadTimer = 0;

  const loadDeferredSrc = () => {
    if (!iframe?.dataset?.src) return;
    const url = iframe.dataset.src;
    delete iframe.dataset.src;
    // Load outside the current user-gesture stack so the embed can't
    // open a tab/window using the Watch now / Tap activation.
    loadTimer = window.setTimeout(() => {
      loadTimer = 0;
      if (iframe.isConnected) iframe.src = url;
    }, 0);
  };

  const useShield = !skipShield || ghostShield;

  if (useShield) {
    shield = document.createElement("button");
    shield.type = "button";
    shield.className = ghostShield
      ? "stream-shield stream-shield--ghost"
      : "stream-shield";
    shield.setAttribute("aria-label", shieldLabel);
    if (ghostShield) {
      shield.innerHTML = `
        <span class="stream-shield__ghost-label">${escapeShieldText(
          shieldLabel
        )}</span>
        <span class="stream-shield__hint">${escapeShieldText(shieldHint)}</span>
      `;
    } else {
      shield.innerHTML = `
        <span class="stream-shield__pulse" aria-hidden="true"></span>
        <span class="stream-shield__label">${escapeShieldText(shieldLabel)}</span>
        <span class="stream-shield__hint">${escapeShieldText(shieldHint)}</span>
      `;
    }
    frame.appendChild(shield);

    if (iframe) {
      iframe.classList.add("is-guarded");
      iframe.setAttribute("tabindex", "-1");
    }

    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      loadDeferredSrc();
      shield.classList.add("is-leaving");
      window.setTimeout(() => shield.remove(), 280);
      iframe?.classList.remove("is-guarded");
    };

    shield.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      unlock();
    });
    shield.addEventListener("pointerdown", (e) => {
      // Beat iframe / synthetic click handlers that open ads.
      e.preventDefault();
      e.stopPropagation();
    });
  } else if (iframe?.dataset?.src) {
    loadDeferredSrc();
  }

  const safeExit = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (typeof onSafeExit === "function") {
      onSafeExit();
      return;
    }
    if (iframe) iframe.src = "about:blank";
  };

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
      e.preventDefault();
      e.stopPropagation();
    });
    exitBtn.addEventListener("click", safeExit);
  }

  const onFramePointer = () => {};
  frame.addEventListener("pointerdown", onFramePointer);

  const nativeOpen = window.open.bind(window);
  let blockedPopupAt = 0;
  const blockedOpen = () => {
    blockedPopupAt = Date.now();
    return null;
  };
  try {
    Object.defineProperty(window, "open", {
      configurable: true,
      writable: true,
      value: blockedOpen,
    });
  } catch {
    window.open = blockedOpen;
  }

  const reclaimFocus = () => {
    if (!unlocked) return;
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

  const onMessage = (event) => {
    if (event.origin !== "https://cinesrc.st") return;
    if (event.data?.type !== "cinesrc:close") return;
    safeExit(event);
  };
  window.addEventListener("message", onMessage);

  return () => {
    if (loadTimer) clearTimeout(loadTimer);
    try {
      Object.defineProperty(window, "open", {
        configurable: true,
        writable: true,
        value: nativeOpen,
      });
    } catch {
      window.open = nativeOpen;
    }
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
