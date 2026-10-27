import { linkTo } from "../router/index.js";

/**
 * Search + category chips that stay fixed on mobile while content scrolls.
 * Desktop: brand + search rail, then a full-width category tab strip.
 * @param {HTMLElement[]} children — typically [HomeSearchBar, CategoryChips]
 */
export function HomeSticky(children = []) {
  const sticky = document.createElement("div");
  sticky.className = "home-sticky";

  const [search, chips, ...rest] = children;

  const rail = document.createElement("div");
  rail.className = "home-sticky__rail";

  const brand = document.createElement("a");
  brand.className = "home-sticky__brand";
  brand.href = linkTo("/");
  brand.setAttribute("aria-label", "LANTAW home");
  brand.innerHTML = `<span class="home-sticky__mark">LANTAW</span>`;

  if (search) rail.append(brand, search);
  else rail.append(brand);

  sticky.append(rail);
  if (chips) sticky.append(chips);
  if (rest.length) sticky.append(...rest);

  const spacer = document.createElement("div");
  spacer.className = "home-sticky-spacer";
  spacer.setAttribute("aria-hidden", "true");

  const syncSpacer = () => {
    const fixed = getComputedStyle(sticky).position === "fixed";
    spacer.style.height = fixed ? `${sticky.offsetHeight}px` : "0px";
  };

  const ro = new ResizeObserver(syncSpacer);
  ro.observe(sticky);
  requestAnimationFrame(syncSpacer);
  window.addEventListener("resize", syncSpacer);
  window.addEventListener("scroll", syncSpacer, { passive: true });

  return {
    sticky,
    spacer,
    unmount() {
      ro.disconnect();
      window.removeEventListener("resize", syncSpacer);
      window.removeEventListener("scroll", syncSpacer);
      spacer.style.height = "0px";
    },
  };
}
