import { linkTo } from "../router/index.js";

/**
 * Sticky search + recent icon bar.
 * @param {{ onSearch: (query: string) => void | Promise<void> }} options
 */
export function HomeSearchBar({ onSearch }) {
  const header = document.createElement("header");
  header.className = "home-bar";
  header.innerHTML = `
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
        placeholder="Search movies…"
        autocomplete="off"
        enterkeyhint="search"
      />
    </form>
    <a class="home-bar__recent" href="${linkTo(
      "/recent"
    )}" aria-label="Recently viewed" title="Recently viewed">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>
  `;

  header.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = e.currentTarget.q.value.trim();
    await onSearch?.(q);
  });

  return header;
}
