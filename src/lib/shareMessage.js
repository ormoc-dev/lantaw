/** Movie / TV share cards stored as friend chat message bodies. */

const PREFIX = "[share]";

/**
 * @param {{ id: number|string, mediaType?: string, title?: string, poster?: string|null }} item
 */
export function shareMessageBody(item) {
  const payload = {
    id: Number(item?.id) || 0,
    mediaType: item?.mediaType === "tv" ? "tv" : "movie",
    title: String(item?.title || "Untitled").slice(0, 160),
    poster: item?.poster ? String(item.poster).slice(0, 500) : null,
  };
  return `${PREFIX}${JSON.stringify(payload)}`;
}

/**
 * @param {string} body
 * @returns {{ id: number, mediaType: "movie"|"tv", title: string, poster: string|null }|null}
 */
export function parseShareMessage(body) {
  const text = String(body || "").trim();
  if (!text.startsWith(PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(PREFIX.length));
    const id = Number(raw?.id);
    if (!id) return null;
    return {
      id,
      mediaType: raw?.mediaType === "tv" ? "tv" : "movie",
      title: String(raw?.title || "Untitled").slice(0, 160),
      poster: raw?.poster ? String(raw.poster) : null,
    };
  } catch {
    return null;
  }
}
