import { linkTo } from "../router/index.js";
import { searchMovies } from "../services/movieService.js";

/**
 * Sticky search + recent icon bar with live title suggestions.
 * @param {{ onSearch: (query: string) => void | Promise<void> }} options
 */
export function HomeSearchBar({ onSearch }) {
  const header = document.createElement("header");
  header.className = "home-bar";
  header.innerHTML = `
    <div class="home-search-wrap">
      <form class="home-search" id="home-search" role="search">
        <span class="home-search__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="m16.2 16.2 3.3 3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </span>
        <input
          type="search"
          name="q"
          id="home-search-input"
          placeholder="Search movies…"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="search"
          aria-autocomplete="list"
          aria-controls="home-suggest"
          aria-expanded="false"
        />
      </form>
      <div
        class="home-suggest"
        id="home-suggest"
        role="listbox"
        aria-label="Search suggestions"
        hidden
      ></div>
    </div>
    <a class="home-bar__recent" href="${linkTo(
      "/recent"
    )}" aria-label="Recently viewed" title="Recently viewed">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>
  `;

  const form = header.querySelector("#home-search");
  const input = header.querySelector("#home-search-input");
  const menu = header.querySelector("#home-suggest");

  let timer = null;
  let reqId = 0;
  let items = [];
  let active = -1;

  const setOpen = (open) => {
    menu.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) {
      active = -1;
      menu.querySelectorAll(".home-suggest__item.is-active").forEach((el) => {
        el.classList.remove("is-active");
      });
    }
  };

  const close = () => setOpen(false);

  const scoreTitle = (title, q) => {
    const t = String(title || "").toLowerCase();
    const query = q.toLowerCase();
    if (!query) return 0;
    if (t === query) return 300;
    if (t.startsWith(query)) return 200;
    const words = t.split(/[\s:.\-_/'’]+/).filter(Boolean);
    if (words.some((w) => w.startsWith(query))) return 150;
    if (t.includes(` ${query}`)) return 100;
    if (t.includes(query)) return 50;
    return 0;
  };

  const paint = (query, results) => {
    const q = query.trim();
    if (!q) {
      items = [];
      menu.innerHTML = "";
      close();
      return;
    }

    const ranked = [...results]
      .map((r) => ({ ...r, _score: scoreTitle(r.title, q) }))
      .filter((r) => r._score > 0)
      .sort((a, b) => b._score - a._score || (b.rating || 0) - (a.rating || 0))
      .slice(0, 8);

    items = ranked;
    active = -1;

    if (!ranked.length) {
      menu.innerHTML = `
        <button type="button" class="home-suggest__item home-suggest__item--run" data-run="1" role="option">
          <span class="home-suggest__meta">
            <strong>Search for “${escapeHtml(q)}”</strong>
            <em>No close title matches</em>
          </span>
        </button>
      `;
      setOpen(true);
      return;
    }

    menu.innerHTML =
      ranked
        .map((r, i) => {
          const year = r.releaseDate ? String(r.releaseDate).slice(0, 4) : "";
          const href =
            r.mediaType === "tv"
              ? linkTo(`/tv/${r.id}`)
              : linkTo(`/movie/${r.id}`);
          const poster = r.poster
            ? `<img class="home-suggest__poster" src="${escapeHtml(
                r.poster
              )}" alt="" loading="lazy" />`
            : `<span class="home-suggest__poster home-suggest__poster--empty" aria-hidden="true"></span>`;
          return `
            <a
              class="home-suggest__item"
              role="option"
              id="home-suggest-${i}"
              href="${href}"
              data-index="${i}"
            >
              ${poster}
              <span class="home-suggest__meta">
                <strong>${escapeHtml(r.title)}</strong>
                <em>${escapeHtml(
                  [year, r.mediaType === "tv" ? "TV" : "Movie"]
                    .filter(Boolean)
                    .join(" · ")
                )}</em>
              </span>
            </a>
          `;
        })
        .join("") +
      `
      <button type="button" class="home-suggest__item home-suggest__item--run" data-run="1" role="option">
        <span class="home-suggest__meta">
          <strong>See all results for “${escapeHtml(q)}”</strong>
        </span>
      </button>
    `;
    setOpen(true);
  };

  const runSuggest = async (raw) => {
    const q = String(raw || "").trim();
    if (q.length < 1) {
      items = [];
      menu.innerHTML = "";
      close();
      return;
    }
    const id = ++reqId;
    try {
      const { results } = await searchMovies(q);
      if (id !== reqId) return;
      paint(q, results || []);
    } catch {
      if (id !== reqId) return;
      menu.innerHTML = `
        <button type="button" class="home-suggest__item home-suggest__item--run" data-run="1" role="option">
          <span class="home-suggest__meta">
            <strong>Search for “${escapeHtml(q)}”</strong>
          </span>
        </button>
      `;
      setOpen(true);
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSuggest(input.value), 220);
  };

  const setActive = (next) => {
    const opts = [...menu.querySelectorAll(".home-suggest__item")];
    if (!opts.length) return;
    active = (next + opts.length) % opts.length;
    opts.forEach((el, i) => el.classList.toggle("is-active", i === active));
    opts[active]?.scrollIntoView({ block: "nearest" });
  };

  const commitSearch = async (q) => {
    close();
    await onSearch?.(q);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    // If a suggestion is highlighted, open it
    const opts = [...menu.querySelectorAll(".home-suggest__item")];
    const current = active >= 0 ? opts[active] : null;
    if (current && !current.dataset.run && current.getAttribute("href")) {
      close();
      location.hash = current.getAttribute("href");
      return;
    }
    await commitSearch(q);
  });

  input.addEventListener("input", schedule);
  input.addEventListener("focus", () => {
    if (input.value.trim()) schedule();
  });

  input.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  menu.addEventListener("mousedown", (e) => {
    // Keep input focus; allow click to land
    const run = e.target.closest("[data-run]");
    if (run) e.preventDefault();
  });

  menu.addEventListener("click", async (e) => {
    const run = e.target.closest("[data-run]");
    if (run) {
      e.preventDefault();
      await commitSearch(input.value.trim());
      return;
    }
    // Links navigate via hash; just close
    const link = e.target.closest("a.home-suggest__item");
    if (link) close();
  });

  const onDocPointer = (e) => {
    if (!header.isConnected) {
      document.removeEventListener("pointerdown", onDocPointer, true);
      return;
    }
    if (!(e.target instanceof Node)) return;
    if (!header.contains(e.target)) close();
  };
  document.addEventListener("pointerdown", onDocPointer, true);

  return header;
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
