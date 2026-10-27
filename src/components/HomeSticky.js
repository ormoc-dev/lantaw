/**
 * Search + category chips that stay fixed on mobile while content scrolls.
 * @param {HTMLElement[]} children
 */
export function HomeSticky(children = []) {
  const sticky = document.createElement("div");
  sticky.className = "home-sticky";
  sticky.append(...children);

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
