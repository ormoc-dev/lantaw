import { env } from "../config/env.js";

/** Giphy API — https://developers.giphy.com/docs/api */
const BASE = "https://api.giphy.com/v1/gifs";

export function hasGifApi() {
  const key = String(env.giphyApiKey || "").trim();
  return Boolean(key) && !key.includes("YOUR_");
}

/** @deprecated use hasGifApi */
export const hasTenor = hasGifApi;

export function parseGifMessage(body) {
  const text = String(body || "").trim();
  const tagged = text.match(/^\[gif\](https?:\/\/\S+)$/i);
  if (tagged) return tagged[1];
  if (
    /^https?:\/\/(media\d*\.)?tenor\.com\/\S+/i.test(text) ||
    /^https?:\/\/c\.tenor\.com\/\S+/i.test(text) ||
    /^https?:\/\/media\d*\.giphy\.com\/\S+/i.test(text) ||
    /^https?:\/\/i\.giphy\.com\/\S+/i.test(text) ||
    /^https?:\/\/\S+\.gif(\?\S*)?$/i.test(text)
  ) {
    return text;
  }
  return null;
}

export function gifMessageBody(url) {
  return `[gif]${String(url || "").trim()}`;
}

function pickUrl(item) {
  const images = item?.images || {};
  return (
    images.fixed_height?.url ||
    images.downsized?.url ||
    images.original?.url ||
    images.fixed_height_small?.url ||
    ""
  );
}

function pickPreview(item) {
  const images = item?.images || {};
  return (
    images.fixed_height_small?.url ||
    images.preview_gif?.url ||
    images.fixed_width_small?.url ||
    images.fixed_height?.url ||
    ""
  );
}

function mapResults(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((item) => {
      const id = item?.id ? String(item.id) : "";
      const full = pickUrl(item);
      // Compact share URL stays under watch-party's 280-char body limit
      const url = id ? `https://i.giphy.com/${id}.gif` : full;
      if (!url) return null;
      return {
        id: id || url,
        url,
        preview: pickPreview(item) || full || url,
        title: String(item.title || "GIF"),
      };
    })
    .filter(Boolean);
}

async function giphyFetch(path, params = {}) {
  if (!hasGifApi()) return [];
  const q = new URLSearchParams({
    api_key: env.giphyApiKey,
    limit: "12",
    rating: "pg",
    ...params,
  });
  const res = await fetch(`${BASE}/${path}?${q}`);
  if (!res.ok) throw new Error("GIF search failed");
  return mapResults(await res.json());
}

/** Search GIFs for a typed query (auto-suggest). */
export async function searchGifs(query) {
  const q = String(query || "").trim();
  if (!q) return featuredGifs();
  return giphyFetch("search", { q });
}

/** Trending GIFs when the panel opens with an empty input. */
export async function featuredGifs() {
  return giphyFetch("trending");
}

/** No-op kept for call sites that registered Tenor shares. */
export function registerGifShare() {}
