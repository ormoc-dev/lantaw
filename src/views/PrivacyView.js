import { linkTo } from "../router/index.js";

export async function PrivacyView(root) {
  root.classList.add("view--auth");

  root.innerHTML = `
    <section class="auth-page legal-page">
      <div class="auth-page__glow auth-page__glow--a" aria-hidden="true"></div>
      <div class="auth-page__glow auth-page__glow--b" aria-hidden="true"></div>
      <div class="auth-page__grain" aria-hidden="true"></div>

      <div class="auth-shell legal-shell">
        <a class="back" href="${linkTo("/login")}">← Back</a>
        <p class="auth-brand">LANTAW</p>
        <h1 class="legal-title">Privacy</h1>
        <div class="legal-copy">
          <p>
            LANTAW is just for fun — gawa ng Ormocanon. Solo developer, not a company.
          </p>
          <p>
            We only keep your email and display name so you can sign in, save a watchlist, and use friends features.
            We don’t sell your info.
          </p>
          <p>
            Catalog data comes from third-party services. Some streams may be pirated / unofficial embeds,
            so don’t expect perfect quality, uptime, or every title to work.
          </p>
        </div>
      </div>

      <footer class="auth-legal">
        <a href="#/privacy" aria-current="page">Privacy</a>
      </footer>
    </section>
  `;

  return {
    unmount() {
      root.classList.remove("view--auth");
    },
  };
}
