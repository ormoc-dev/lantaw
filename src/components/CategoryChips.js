import { CATEGORIES } from "../config/categories.js?v=185";
import { linkTo } from "../router/index.js";

/**
 * Category tab nav — each chip opens its own page view.
 * Soft edge fade hints when more tabs are off-screen (no overlay badge).
 * @param {{ activeId?: string }} [options]
 */
export function CategoryChips({ activeId = "" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "category-chips-wrap";

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
        bringChipIntoView(a);
        syncOverflow();
        return;
      }
      location.hash = hash;
    });
    nav.appendChild(a);
  });

  wrap.append(nav);

  const syncOverflow = () => {
    const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
    const left = nav.scrollLeft > 2;
    const right = nav.scrollLeft < max - 2;
    wrap.classList.toggle("is-scrollable", max > 2);
    wrap.classList.toggle("has-left", left);
    wrap.classList.toggle("has-right", right);
  };

  /** Keep the chip fully visible with a little side breathing room (no mid-word clip). */
  const bringChipIntoView = (chip, behavior = "smooth") => {
    if (!chip) return;
    const pad = 12;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    const viewLeft = nav.scrollLeft;
    const viewRight = viewLeft + nav.clientWidth;
    if (left < viewLeft + pad) {
      nav.scrollTo({ left: Math.max(0, left - pad), behavior });
    } else if (right > viewRight - pad) {
      nav.scrollTo({
        left: Math.min(nav.scrollWidth - nav.clientWidth, right - nav.clientWidth + pad),
        behavior,
      });
    }
  };

  nav.addEventListener("scroll", syncOverflow, { passive: true });
  const ro = new ResizeObserver(syncOverflow);
  ro.observe(nav);

  requestAnimationFrame(() => {
    bringChipIntoView(nav.querySelector(".category-chip.is-active"), "auto");
    syncOverflow();
  });

  return wrap;
}
