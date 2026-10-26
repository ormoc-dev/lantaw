/**
 * Search + category chips that stay fixed on mobile while content scrolls.
 * Extends the shared frosted .app-header-bg so home chrome is one continuous glass panel.
 * @param {HTMLElement[]} children
 */
export function HomeSticky(children = []) {
  const sticky = document.createElement("div");
  sticky.className = "home-sticky";
  sticky.append(...children);

  const spacer = document.createElement("div");
  spacer.className = "home-sticky-spacer";
  spacer.setAttribute("aria-hidden", "true");

  const headerBg = () => document.querySelector(".app-header-bg");

  const resetChrome = () => {
    const bg = headerBg();
    if (bg) bg.style.height = "";
    document.documentElement.classList.remove("has-home-chrome");
  };

  const syncChrome = () => {
    const fixed = getComputedStyle(sticky).position === "fixed";
    spacer.style.height = fixed ? `${sticky.offsetHeight}px` : "0px";

    const bg = headerBg();
    if (!bg) return;

    if (fixed) {
      document.documentElement.classList.add("has-home-chrome");
      const bottom = sticky.getBoundingClientRect().bottom;
      bg.style.height = `${Math.ceil(bottom)}px`;
    } else {
      resetChrome();
    }
  };

  const ro = new ResizeObserver(syncChrome);
  ro.observe(sticky);
  requestAnimationFrame(syncChrome);
  window.addEventListener("resize", syncChrome);
  window.addEventListener("scroll", syncChrome, { passive: true });

  return {
    sticky,
    spacer,
    unmount() {
      ro.disconnect();
      window.removeEventListener("resize", syncChrome);
      window.removeEventListener("scroll", syncChrome);
      resetChrome();
    },
  };
}
