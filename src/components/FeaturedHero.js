import { linkTo } from "../router/index.js";

/**
 * Featured banner — one title, or a rotating set on home.
 * @param {{ item?: object, items?: object[] }} options
 */
export function FeaturedHero({ item, items } = {}) {
  const list = (items?.length ? items : item ? [item] : []).filter(Boolean);
  const hero = document.createElement("section");
  hero.className = "home-hero";
  if (list.length > 1) hero.classList.add("home-hero--carousel");
  if (!list.length) return hero;

  let index = 0;
  let timer = null;
  const AUTO_MS = 5500;

  const paint = () => {
    const current = list[index];
    const bg = current.backdrop || current.poster || "";
    const href =
      current.mediaType === "tv"
        ? `/tv/${current.id}`
        : `/movie/${current.id}`;
    const safeBg = escapeAttr(bg);

    hero.innerHTML = `
      <div class="home-hero__slides" aria-live="polite">
        <div
          class="home-hero__bg is-active"
          style="${safeBg ? `background-image:url('${safeBg}')` : ""}"
        ></div>
      </div>
      <div class="home-hero__content">
        <p class="home-hero__eyebrow">Featured${
          list.length > 1 ? ` · ${index + 1}/${list.length}` : ""
        }</p>
        <h2>${escapeHtml(current.title)}</h2>
        <p class="home-hero__overview">${escapeHtml(
          truncate(current.overview, 120)
        )}</p>
        ${
          list.length > 1
            ? `
        <div class="home-hero__dots" role="tablist" aria-label="Featured titles">
          ${list
            .map(
              (_, i) => `
            <button
              type="button"
              class="home-hero__dot ${i === index ? "is-active" : ""}"
              role="tab"
              aria-selected="${i === index ? "true" : "false"}"
              aria-label="Featured ${i + 1}"
              data-index="${i}"
            ></button>`
            )
            .join("")}
        </div>`
            : ""
        }
        <a class="btn btn--primary home-hero__cta" href="${linkTo(
          href
        )}">View details</a>
      </div>
    `;

    if (list.length > 1) {
      hero.querySelectorAll(".home-hero__dot").forEach((dot) => {
        dot.addEventListener("click", () => go(Number(dot.dataset.index)));
      });
    }
  };

  const go = (next) => {
    index = ((next % list.length) + list.length) % list.length;
    paint();
    restart();
  };

  const stop = () => {
    clearInterval(timer);
    timer = null;
  };

  const restart = () => {
    stop();
    if (list.length < 2) return;
    timer = setInterval(() => go(index + 1), AUTO_MS);
  };

  paint();
  restart();

  hero.addEventListener("mouseenter", stop);
  hero.addEventListener("mouseleave", restart);
  hero.addEventListener("focusin", stop);
  hero.addEventListener("focusout", (e) => {
    if (!hero.contains(e.relatedTarget)) restart();
  });

  hero._unmountFeatured = stop;
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

function escapeAttr(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
