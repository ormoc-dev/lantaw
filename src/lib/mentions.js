/**
 * Comment @mentions — stored as @[Display Name](userId), shown as @Display Name.
 */

const TOKEN_RE = /@\[([^\]]+)\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionLabel(friend) {
  return String(friend?.name || friend?.display_name || "Friend")
    .replace(/[\[\]]/g, "")
    .trim()
    .slice(0, 48);
}

/** Stored form — stable id for notices/push. */
export function mentionToken(friend) {
  const name = mentionLabel(friend);
  const id = friend?.id;
  if (!id || !name) return "";
  return `@[${name}](${id})`;
}

/**
 * Convert friendly `@Name` (from the picker) into stored `@[Name](id)` tokens.
 * Existing `@[Name](id)` tokens are left alone.
 */
export function encodeMentions(text = "", friends = []) {
  let out = String(text || "");
  const saved = [];
  out = out.replace(new RegExp(TOKEN_RE.source, "gi"), (m) => {
    saved.push(m);
    return `\0${saved.length - 1}\0`;
  });

  const sorted = [...(friends || [])]
    .filter((f) => f?.id && mentionLabel(f))
    .sort((a, b) => mentionLabel(b).length - mentionLabel(a).length);

  for (const friend of sorted) {
    const label = mentionLabel(friend);
    const token = mentionToken(friend);
    if (!token) continue;
    const re = new RegExp(
      `(^|[\\s([{])@(${escapeRegExp(label)})(?=$|[\\s.,!?;:)\\]}])`,
      "gi"
    );
    out = out.replace(re, (_, pre) => `${pre}${token}`);
  }

  out = out.replace(/\0(\d+)\0/g, (_, i) => saved[Number(i)] || "");
  return out;
}

/** Unique mentioned user ids in text order. */
export function extractMentionIds(text = "") {
  const ids = [];
  const seen = new Set();
  const re = new RegExp(TOKEN_RE.source, "gi");
  let m;
  while ((m = re.exec(String(text)))) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Pretty HTML for comment bodies (escaped + mention chips). */
export function formatMentionsHtml(text = "") {
  const s = String(text || "");
  let out = "";
  let last = 0;
  const re = new RegExp(TOKEN_RE.source, "gi");
  let m;
  while ((m = re.exec(s))) {
    out += escapeHtml(s.slice(last, m.index));
    out += `<span class="detail__mention">@${escapeHtml(m[1])}</span>`;
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  return out;
}

/**
 * Active @query at caret, if any.
 * @returns {{ start: number, end: number, query: string } | null}
 */
export function mentionQueryAt(text, caret) {
  const value = String(text || "");
  const pos = Math.max(0, Math.min(Number(caret) || 0, value.length));
  const before = value.slice(0, pos);
  // Don't reopen while editing an existing token
  if (/@\[[^\]]*\]\([^)]*$/.test(before)) return null;
  const m = before.match(/(^|[\s([{])@([^@[\]\n]*)$/);
  if (!m) return null;
  const token = m[0].slice(m[1].length); // "@query"
  return {
    start: pos - token.length,
    end: pos,
    query: m[2] || "",
  };
}

export function filterMentionFriends(friends = [], query = "") {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const list = (friends || []).filter((f) => f?.id && f?.name);
  if (!q) return list.slice(0, 8);
  return list
    .filter((f) => {
      const name = String(f.name).toLowerCase();
      const email = String(f.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    })
    .slice(0, 8);
}

/**
 * Attach a lightweight @friend picker to a textarea.
 * @returns {() => void} detach
 */
export function attachMentionPicker(textarea, { getFriends } = {}) {
  if (!textarea) return () => {};

  let menu = null;
  let matches = [];
  let index = 0;
  let range = null;

  const close = () => {
    menu?.remove();
    menu = null;
    matches = [];
    range = null;
    index = 0;
  };

  const paint = () => {
    if (!menu) return;
    if (!matches.length) {
      close();
      return;
    }
    menu.innerHTML = matches
      .map((f, i) => {
        const initial = String(f.name || "?").slice(0, 1).toUpperCase();
        const avatar = f.avatar_url
          ? `<img src="${escapeHtml(f.avatar_url)}" alt="" referrerpolicy="no-referrer" />`
          : `<span>${escapeHtml(initial)}</span>`;
        return `<button type="button" class="mention-menu__item${
          i === index ? " is-active" : ""
        }" data-mention-i="${i}" role="option" aria-selected="${
          i === index ? "true" : "false"
        }">
          <i class="mention-menu__avatar">${avatar}</i>
          <em>${escapeHtml(f.name)}</em>
        </button>`;
      })
      .join("");
  };

  const place = () => {
    if (!menu) return;
    const host =
      textarea.closest(".detail__comments-form-main") ||
      textarea.closest(".detail__comment-reply-form") ||
      textarea.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    if (!menu.isConnected) host.appendChild(menu);
  };

  const open = async () => {
    range = mentionQueryAt(textarea.value, textarea.selectionStart);
    if (!range) {
      close();
      return;
    }
    const friends =
      typeof getFriends === "function" ? await getFriends() : getFriends || [];
    matches = filterMentionFriends(friends, range.query);
    if (!matches.length) {
      close();
      return;
    }
    index = Math.min(index, matches.length - 1);
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "mention-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", "Mention a friend");
      menu.addEventListener("mousedown", (e) => {
        const btn = e.target.closest("[data-mention-i]");
        if (!btn) return;
        e.preventDefault();
        pick(Number(btn.dataset.mentionI));
      });
    }
    place();
    paint();
  };

  const pick = (i) => {
    const friend = matches[i];
    if (!friend || !range) return;
    const label = mentionLabel(friend);
    if (!label) return;
    const insert = `@${label}`;
    const value = textarea.value;
    const before = value.slice(0, range.start);
    const after = value.slice(range.end);
    const next = `${before}${insert} ${after}`;
    textarea.value = next;
    const caret = before.length + insert.length + 1;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    close();
  };

  const onInput = () => {
    open().catch(() => close());
  };

  const onKeyDown = (e) => {
    if (!menu || !matches.length) {
      if (e.key === "Escape") close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      index = (index + 1) % matches.length;
      paint();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      index = (index - 1 + matches.length) % matches.length;
      paint();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(index);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const onBlur = () => {
    // Allow mousedown on menu first
    window.setTimeout(() => {
      if (!menu?.matches(":hover")) close();
    }, 120);
  };

  textarea.addEventListener("input", onInput);
  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("click", onInput);
  textarea.addEventListener("keyup", onInput);
  textarea.addEventListener("blur", onBlur);

  return () => {
    close();
    textarea.removeEventListener("input", onInput);
    textarea.removeEventListener("keydown", onKeyDown);
    textarea.removeEventListener("click", onInput);
    textarea.removeEventListener("keyup", onInput);
    textarea.removeEventListener("blur", onBlur);
  };
}

export { escapeRegExp };
