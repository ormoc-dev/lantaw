import {
  presenceLabelFor,
  rememberLastSeen,
} from "../services/presenceService.js";

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str = "") {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function initialOf(name) {
  const ch = String(name || "?").trim().slice(0, 1).toUpperCase();
  return ch || "?";
}

/** Horizontal profile cards for the Friends → People suggestions. */
export function peopleCardsHtml(rows = []) {
  rememberLastSeen(rows);
  if (!rows.length) return "";
  return `
    <div class="pymk__rail">
      ${rows
        .map((p) => {
          const name = p.display_name || "User";
          const status = presenceLabelFor(p.id);
          const avatar = p.avatar_url
            ? `<img class="pymk__avatar" src="${escapeAttr(p.avatar_url)}" alt="" />`
            : `<span class="pymk__avatar pymk__avatar--fallback" aria-hidden="true">${escapeHtml(
                initialOf(name)
              )}</span>`;
          return `
            <article class="pymk__card">
              <button type="button" class="pymk__dismiss" data-pymk-dismiss aria-label="Dismiss ${escapeAttr(
                name
              )}">✕</button>
              ${avatar}
              <strong>${escapeHtml(name)}</strong>
              <span class="pymk__status">${escapeHtml(status)}</span>
              <button type="button" class="pymk__add" data-add="${escapeAttr(
                p.id
              )}">Add friend</button>
            </article>`;
        })
        .join("")}
    </div>`;
}
