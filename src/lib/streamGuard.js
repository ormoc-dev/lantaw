/**
 * Soften third-party embed ads:
 * - eat the first click (common popup trigger)
 * - cover the embed's ← / back control so exit never hits ad handlers
 * - block window.open while the player is open
 * - reclaim focus if a popup steals it
 * Sandbox (no allow-popups / no top-navigation) does the heavy lifting.
 */

export function attachStreamAdGuard(frame, { onSafeExit } = {}) {
  if (!frame) return () => {};

  const iframe = frame.querySelector("iframe");
  let unlocked = false;
  let lastInteract = 0;

  const shield = document.createElement("button");
  shield.type = "button";
  shield.className = "stream-shield";
  shield.setAttribute("aria-label", "Tap to unlock player");
  shield.innerHTML = `
    <span class="stream-shield__pulse" aria-hidden="true"></span>
    <span class="stream-shield__label">Tap to play</span>
    <span class="stream-shield__hint">Blocks pop-up ads on the first click</span>
  `;
  frame.appendChild(shield);

  // Sit on top of the embed's own ← so that click exits our app cleanly.
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "stream-exit";
  exitBtn.setAttribute("aria-label", "Close player");
  exitBtn.innerHTML = `<span aria-hidden="true">←</span>`;
  frame.appendChild(exitBtn);

  if (iframe) {
    iframe.classList.add("is-guarded");
    iframe.setAttribute("tabindex", "-1");
  }

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    lastInteract = Date.now();
    shield.classList.add("is-leaving");
    window.setTimeout(() => shield.remove(), 280);
    iframe?.classList.remove("is-guarded");
  };

  shield.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    unlock();
  });

  const safeExit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    lastInteract = Date.now();
    if (typeof onSafeExit === "function") {
      onSafeExit();
      return;
    }
    // Fallback: just tear down the iframe so embed back can't fire ads.
    if (iframe) iframe.src = "about:blank";
  };

  exitBtn.addEventListener("pointerdown", (e) => {
    // Beat the iframe to the punch on touch devices.
    e.preventDefault();
    e.stopPropagation();
  });
  exitBtn.addEventListener("click", safeExit);

  const onFramePointer = () => {
    lastInteract = Date.now();
  };
  frame.addEventListener("pointerdown", onFramePointer);

  const nativeOpen = window.open.bind(window);
  // While this guard is mounted, swallow popup attempts from the page/embed flow.
  window.open = () => null;

  const reclaimFocus = () => {
    if (!unlocked) return;
    if (Date.now() - lastInteract > 2500) return;
    window.setTimeout(() => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
    }, 0);
  };

  window.addEventListener("blur", reclaimFocus);

  return () => {
    window.open = nativeOpen;
    window.removeEventListener("blur", reclaimFocus);
    frame.removeEventListener("pointerdown", onFramePointer);
    shield.remove();
    exitBtn.remove();
    iframe?.classList.remove("is-guarded");
  };
}
