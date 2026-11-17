/** Reply-to envelopes stored as friend chat message bodies. */

const PREFIX = "[reply]";

/**
 * @param {{ id: string, preview?: string, senderId?: string|null }} reply
 * @param {string} body
 */
export function wrapReplyMessage(reply, body) {
  const text = String(body || "");
  const id = String(reply?.id || "").trim();
  if (!id || !text) return text;
  const meta = JSON.stringify({
    id,
    preview: String(reply?.preview || "").replace(/\s+/g, " ").trim().slice(0, 120),
    senderId: reply?.senderId || null,
  });
  return `${PREFIX}${meta}\n${text}`;
}

/**
 * @param {string} body
 * @returns {{ reply: { id: string, preview: string, senderId: string|null } | null, body: string }}
 */
export function parseReplyEnvelope(body) {
  const text = String(body || "");
  if (!text.startsWith(PREFIX)) return { reply: null, body: text };
  const nl = text.indexOf("\n");
  if (nl < 0) return { reply: null, body: text };
  try {
    const raw = JSON.parse(text.slice(PREFIX.length, nl));
    const id = String(raw?.id || "").trim();
    if (!id) return { reply: null, body: text };
    return {
      reply: {
        id,
        preview: String(raw?.preview || "").replace(/\s+/g, " ").trim().slice(0, 120),
        senderId: raw?.senderId ? String(raw.senderId) : null,
      },
      body: text.slice(nl + 1),
    };
  } catch {
    return { reply: null, body: text };
  }
}

/** Inner content after stripping a reply envelope (if any). */
export function unwrapReplyBody(body) {
  return parseReplyEnvelope(body).body;
}
