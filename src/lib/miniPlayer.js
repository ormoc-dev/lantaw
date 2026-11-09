/** Picture that survives leaving a title or a watch-together room.
 * ✕ stops it. End party still stops it before the room closes.
 */

let current = null;
let pendingExpandKey = "";

function escapeText(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensureHost() {
  let host = document.getElementById("mini-player");
  if (host) return host;
  host = document.createElement("div");
  host.id = "mini-player";
  host.className = "mini-player";
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", "Mini player");
  host.innerHTML = `
    <div class="mini-player__stage">
      <div class="mini-player__frame"></div>
      <button type="button" class="mini-player__expand" aria-label="Return to title"></button>
    </div>
    <div class="mini-player__bar">
      <button type="button" class="mini-player__open">
        <span class="mini-player__title"></span>
      </button>
      <button type="button" class="mini-player__close" aria-label="Close mini player">✕</button>
    </div>
  `;
  host.querySelector(".mini-player__close")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMiniPlayer();
  });
  host.querySelector(".mini-player__open")?.addEventListener("click", () => {
    openMiniPlayer();
  });
  host.querySelector(".mini-player__expand")?.addEventListener("click", () => {
    openMiniPlayer();
  });
  document.body.appendChild(host);
  return host;
}

/** Move an already-playing stream iframe into the corner. */
export function dockMiniPlayer({ iframe, title, href, key }) {
  if (!iframe || !key || !href) return false;
  const host = ensureHost();
  const frame = host.querySelector(".mini-player__frame");
  iframe.id = "stream-iframe";
  iframe.classList.remove("is-guarded");
  iframe.removeAttribute("tabindex");
  frame?.replaceChildren(iframe);
  const label = host.querySelector(".mini-player__title");
  const playing = title || "Now playing";
  if (label) label.textContent = playing;
  host.querySelector(".mini-player__expand")?.setAttribute(
    "aria-label",
    `Return to ${playing}`
  );
  host.hidden = false;
  current = { key, href, title: title || "Now playing" };
  return true;
}

export function peekMiniPlayer() {
  return current;
}

/** Pull the iframe back into a page. Returns null if the key doesn't match. */
export function takeMiniPlayer(key) {
  if (!current || current.key !== key) return null;
  const iframe = document.querySelector("#mini-player #stream-iframe");
  current = null;
  pendingExpandKey = "";
  document.getElementById("mini-player")?.remove();
  return iframe || null;
}

export function closeMiniPlayer() {
  const iframe = document.querySelector("#mini-player #stream-iframe");
  if (iframe) iframe.src = "about:blank";
  document.getElementById("mini-player")?.remove();
  current = null;
  pendingExpandKey = "";
}

export function consumeMiniExpand(key) {
  if (!pendingExpandKey || pendingExpandKey !== key) return false;
  pendingExpandKey = "";
  return true;
}

function openMiniPlayer() {
  if (!current) return;
  pendingExpandKey = current.key;
  const href = current.href;
  if (location.hash === href) {
    window.dispatchEvent(new CustomEvent("lantaw-mini-expand"));
    return;
  }
  location.hash = href;
}
