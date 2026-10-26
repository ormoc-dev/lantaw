import { linkTo } from "../router/index.js";

/**
 * Featured banner for home / category pages.
 * @param {{ item: object }} options
 */
export function FeaturedHero({ item }) {
  const hero = document.createElement("section");
  hero.className = "home-hero";
  if (!item) return hero;

  const bg = item.backdrop || item.poster || "";
  const href =
    item.mediaType === "tv" ? `/tv/${item.id}` : `/movie/${item.id}`;

  hero.innerHTML = `
    <div class="home-hero__bg" style="${
      bg ? `background-image:url('${bg}')` : ""
    }"></div>
    <div class="home-hero__content">
      <p class="home-hero__eyebrow">Featured</p>
      <h2>${escapeHtml(item.title)}</h2>
      <p class="home-hero__overview">${escapeHtml(
        truncate(item.overview, 120)
      )}</p>
      <a class="btn btn--primary home-hero__cta" href="${linkTo(
        href
      )}">View details</a>
    </div>
  `;

  return hero;
}

function truncate(str = "", n = 140) {
  if (str.length <= n) return str;
  return `${str.slice(0, n).trim()}…`;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
