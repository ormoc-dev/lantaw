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
    a.textContent = cat.title;
    nav.appendChild(a);
  });

  return nav;
}
