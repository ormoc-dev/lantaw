/**
 * Facebook / Messenger-style banner at the top of the app.
 * Used for chat alerts while LANTAW is open.
 */

let host = null;
let hideTimer = null;
let seq = 0;

function ensureHost() {
  if (host?.isConnected) return host;
  host = document.createElement("div");
  host.id = "lantaw-toast-host";
  host.className = "lantaw-toast-host";
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function avatarHtml(url, name) {
  const initial = String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
  if (url) {
    return `<img class="lantaw-toast__avatar" src="${escapeHtml(
      url
    )}" alt="" referrerpolicy="no-referrer" />`;
  }
  return `<span class="lantaw-toast__avatar lantaw-toast__avatar--fallback">${escapeHtml(
    initial
  )}</span>`;
}

/**
 * @param {{
 *   title?: string,
 *   body?: string,
 *   avatarUrl?: string | null,
 *   duration?: number,
 *   onClick?: () => void,
 * }} opts
 */
export function showInAppToast({
  title = "LANTAW",
  body = "",
  avatarUrl = null,
  duration = 4500,
  onClick = null,
} = {}) {
  const root = ensureHost();
  const id = `lantaw-toast-${++seq}`;
  clearTimeout(hideTimer);

  root.querySelectorAll(".lantaw-toast").forEach((el) => el.remove());

  const toast = document.createElement("button");
  toast.type = "button";
  toast.id = id;
  toast.className = "lantaw-toast";
  toast.innerHTML = `
    ${avatarHtml(avatarUrl, title)}
    <span class="lantaw-toast__copy">
      <strong>${escapeHtml(title)}</strong>
      ${body ? `<em>${escapeHtml(body)}</em>` : ""}
    </span>
  `;

  const dismiss = () => {
    toast.classList.remove("is-in");
    toast.classList.add("is-out");
    window.setTimeout(() => toast.remove(), 220);
  };

  toast.addEventListener("click", () => {
    dismiss();
    try {
      onClick?.();
    } catch {
      /* ignore */
    }
  });

  root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-in"));
  hideTimer = window.setTimeout(dismiss, Math.max(2200, Number(duration) || 4500));
  return dismiss;
}
