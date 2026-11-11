/** PBB house picture only. The camera list stays outside this frame. */
const PBB_EMBED = "https://pbbstream.online/";
const INNER_W = 1100;
const INNER_H = 640;
const CROP_W = 668;
const CROP_H = 498;
const PICTURE = { x: 40, y: 94 };
const SPLASH = {
  x: (INNER_W - CROP_W) / 2,
  y: (INNER_H - CROP_H) / 2,
};

function fitPbbFrame(frame, picture) {
  const iframe = frame?.querySelector("iframe");
  const width = frame?.clientWidth || 0;
  if (!iframe || !width) return;
  const origin = picture ? PICTURE : SPLASH;
  const scale = width / CROP_W;
  iframe.style.width = `${INNER_W}px`;
  iframe.style.height = `${INNER_H}px`;
  iframe.style.transformOrigin = "0 0";
  iframe.style.transform = `scale(${scale}) translate(${-origin.x}px, ${-origin.y}px)`;
  frame.style.height = `${Math.round(CROP_H * scale)}px`;
}

export function createPbbLive() {
  const section = document.createElement("section");
  section.className = "pbb-live";
  section.id = "pbb-live";
  section.setAttribute("aria-label", "PBB live");
  section.innerHTML = `
    <div class="pbb-live__head">
      <span class="pbb-live__badge">Live</span>
      <div class="pbb-live__titles">
        <h2>PBB Live</h2>
        <p>House picture only. Tap Enter Studio once, then unmute.</p>
      </div>
    </div>
    <div class="pbb-live__frame">
      <iframe
        src="${PBB_EMBED}"
        title="Pinoy Big Brother live"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </div>
  `;
  const frame = section.querySelector(".pbb-live__frame");
  const iframe = frame.querySelector("iframe");
  let picture = false;
  let pictureTimer = 0;
  const fit = () => fitPbbFrame(frame, picture);
  const showPicture = () => {
    if (picture) return;
    picture = true;
    iframe.style.transition = "transform 0.45s ease";
    fit();
  };
  const onInteract = () => {
    window.clearTimeout(pictureTimer);
    pictureTimer = window.setTimeout(showPicture, 700);
  };
  const onBlur = () => {
    window.setTimeout(() => {
      if (document.activeElement === iframe) onInteract();
    }, 0);
  };
  iframe.addEventListener("focus", onInteract);
  window.addEventListener("blur", onBlur);
  requestAnimationFrame(fit);
  window.addEventListener("resize", fit);
  section._stopFit = () => {
    window.clearTimeout(pictureTimer);
    iframe.removeEventListener("focus", onInteract);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", fit);
  };
  return section;
}

export function stopPbbLive(root) {
  root?.querySelector?.("#pbb-live")?._stopFit?.();
  const iframe = root?.querySelector?.("#pbb-live iframe");
  if (iframe) iframe.src = "about:blank";
}
