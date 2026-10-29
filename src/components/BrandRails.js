import { TV_NETWORKS, MOVIE_STUDIOS } from "../config/brands.js";
import { linkTo } from "../router/index.js";
import { tmdb, posterUrl } from "../lib/tmdb.js";

function initials(name = "") {
  const parts = String(name).replace(/\+/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function brandTile(brand, kind) {
  const a = document.createElement("a");
  a.className = "brand-tile";
  a.href = linkTo(`/brand/${kind}/${brand.id}`);
  a.title = brand.name;
  a.dataset.brandId = String(brand.id);
  a.dataset.brandKind = kind;
  a.setAttribute("role", "listitem");
  a.innerHTML = `
    <span class="brand-tile__mark" style="--brand:${escapeAttr(brand.color)}">
      <span class="brand-tile__fallback">${escapeHtml(initials(brand.name))}</span>
    </span>
    <span class="brand-tile__name">${escapeHtml(brand.name)}</span>
  `;
  return a;
}

async function hydrateLogos(root, brands, kind) {
  for (const brand of brands) {
    try {
      const data =
        kind === "network"
          ? await tmdb.network(brand.id)
          : await tmdb.company(brand.id);
      const src = posterUrl(data?.logo_path, "w154");
      if (!src) continue;
      const marks = root.querySelectorAll(
        `[data-brand-id="${brand.id}"][data-brand-kind="${kind}"] .brand-tile__mark`
      );
      marks.forEach((mark) => {
        if (mark.querySelector(".brand-tile__logo")) return;
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
        img.className = "brand-tile__logo";
        img.referrerPolicy = "no-referrer";
        img.onload = () => {
          mark.classList.add("has-logo");
          mark.querySelector(".brand-tile__fallback")?.remove();
        };
        img.onerror = () => img.remove();
        mark.appendChild(img);
      });
    } catch {
      /* keep fallback initials */
    }
  }
}

/** One logo rail (TV Networks or Movie Studios). */
export function BrandRail({ title, brands, kind }) {
  const section = document.createElement("section");
  section.className = "brand-rail";
  section.innerHTML = `
    <header class="brand-rail__head">
      <h2>${escapeHtml(title)}</h2>
    </header>
    <div class="brand-rail__viewport">
      <div class="brand-rail__track" role="list"></div>
    </div>
  `;
  const track = section.querySelector(".brand-rail__track");
  brands.forEach((brand) => track.appendChild(brandTile(brand, kind)));
  // Duplicate for seamless loop
  brands.forEach((brand) => {
    const clone = brandTile(brand, kind);
    clone.setAttribute("aria-hidden", "true");
    clone.tabIndex = -1;
    track.appendChild(clone);
  });
  track.classList.add("brand-rail__track--marquee");
  // Duration scales with brand count so speed stays readable
  const seconds = Math.max(28, brands.length * 3.2);
  track.style.setProperty("--brand-marquee-duration", `${seconds}s`);

  hydrateLogos(section, brands, kind);
  return section;
}

export function TvNetworksRail() {
  return BrandRail({
    title: "TV Networks",
    brands: TV_NETWORKS,
    kind: "network",
  });
}

export function MovieStudiosRail() {
  return BrandRail({
    title: "Movie Studios",
    brands: MOVIE_STUDIOS,
    kind: "studio",
  });
}

/** @deprecated use TvNetworksRail + MovieStudiosRail */
export function BrandRails() {
  const wrap = document.createElement("div");
  wrap.className = "brand-rails";
  wrap.append(TvNetworksRail(), MovieStudiosRail());
  return wrap;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str = "") {
  return escapeHtml(str);
}
