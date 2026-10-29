/**
 * Lightweight in-app confirm / notice modals (no window.alert / confirm).
 * Reuses the Me-page modal look.
 */

let seq = 0;

function ensureHost() {
  let host = document.getElementById("app-modal-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "app-modal-host";
    document.body.appendChild(host);
  }
  return host;
}

function openModal({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = null,
  danger = false,
}) {
  return new Promise((resolve) => {
    const host = ensureHost();
    const id = `app-modal-${++seq}`;
    const wrap = document.createElement("div");
    wrap.className = "me-modal app-modal";
    wrap.id = id;
    wrap.innerHTML = `
      <div class="me-modal__backdrop" data-app-modal-cancel></div>
      <div
        class="me-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="${id}-title"
      >
        <h2 id="${id}-title">${escapeHtml(title)}</h2>
        <p class="me-modal__lead">${escapeHtml(message)}</p>
        <div class="me-modal__actions ${cancelLabel ? "" : "me-modal__actions--single"}">
          ${
            cancelLabel
              ? `<button type="button" class="me-modal__btn" data-app-modal-cancel>${escapeHtml(
                  cancelLabel
                )}</button>`
              : ""
          }
          <button
            type="button"
            class="me-modal__btn ${
              danger ? "me-modal__btn--danger" : "me-modal__btn--accent"
            }"
            data-app-modal-ok
          >${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const finish = (value) => {
      document.body.classList.remove("me-modal-open");
      wrap.remove();
      window.removeEventListener("keydown", onKey);
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };

    wrap.querySelectorAll("[data-app-modal-cancel]").forEach((el) => {
      el.addEventListener("click", () => finish(false));
    });
    wrap.querySelector("[data-app-modal-ok]")?.addEventListener("click", () =>
      finish(true)
    );
    window.addEventListener("keydown", onKey);

    host.appendChild(wrap);
    document.body.classList.add("me-modal-open");
    wrap.querySelector("[data-app-modal-ok]")?.focus();
  });
}

export function showConfirm({
  title = "Confirm",
  message = "",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return openModal({ title, message, confirmLabel, cancelLabel, danger });
}

export function showNotice({
  title = "Notice",
  message = "",
  okLabel = "OK",
} = {}) {
  return openModal({
    title,
    message,
    confirmLabel: okLabel,
    cancelLabel: null,
  }).then(() => undefined);
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
