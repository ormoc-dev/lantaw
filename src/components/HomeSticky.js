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
    // Only needed when sticky is position:fixed (mobile)
    const fixed = getComputedStyle(sticky).position === "fixed";
    spacer.style.height = fixed ? `${sticky.offsetHeight}px` : "0px";
  };

  const ro = new ResizeObserver(syncSpacer);
  ro.observe(sticky);
  requestAnimationFrame(syncSpacer);
  window.addEventListener("resize", syncSpacer);

  return {
    sticky,
    spacer,
    unmount() {
      ro.disconnect();
      window.removeEventListener("resize", syncSpacer);
    },
  };
}
