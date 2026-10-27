import { CATEGORIES } from "../config/categories.js";
import { linkTo } from "../router/index.js";

/**
 * Category tab nav — each chip opens its own page view.
 * @param {{ activeId?: string }} [options]
 */
export function CategoryChips({ activeId = "" } = {}) {
  const nav = document.createElement("nav");
  nav.className = "category-chips";
  nav.setAttribute("aria-label", "Categories");

  CATEGORIES.forEach((cat) => {
    const a = document.createElement("a");
    a.className = "category-chip";
    if (cat.id === activeId) a.classList.add("is-active");
    a.href = linkTo(cat.path);
    a.dataset.category = cat.id;
    a.textContent = cat.title;
    // Explicit hash navigation — avoids base-href / touch-scroll quirks
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const hash = linkTo(cat.path);
      if (location.hash === hash) {
        // Re-tap active chip: scroll chips into view only
        a.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
        return;
      }
      location.hash = hash;
    });
    nav.appendChild(a);
  });

  // Keep the active chip visible in the horizontal scroller
  requestAnimationFrame(() => {
    nav.querySelector(".category-chip.is-active")?.scrollIntoView({
      inline: "center",
      block: "nearest",
    });
  });

  return nav;
}
