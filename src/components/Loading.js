/**
 * Inline loading spinner markup.
 * @param {{ label?: string, className?: string, size?: "sm" | "md" }} [options]
 */
export function loadingHtml({ label = "", className = "", size = "md" } = {}) {
  const classes = ["ui-loading", className].filter(Boolean).join(" ");
  const spinClass = ["ui-spinner", size === "sm" ? "ui-spinner--sm" : ""]
    .filter(Boolean)
    .join(" ");
  const aria = escapeHtml(label || "Loading");
  return `
    <div class="${classes}" role="status" aria-live="polite" aria-label="${aria}">
      <span class="${spinClass}" aria-hidden="true"></span>
      ${
        label
          ? `<span class="ui-loading__label">${escapeHtml(label)}</span>`
          : ""
      }
    </div>
  `;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
