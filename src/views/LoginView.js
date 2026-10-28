import {
  consumeAuthError,
  getSession,
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  signUp,
} from "../services/authService.js";
import { getTrendingMovies } from "../services/movieService.js";
import {
  dismissInstallBanner,
  getInstallState,
  onInstallStateChange,
  openInExternalBrowser,
  promptInstall,
} from "../lib/pwaInstall.js";
import { consumeReturnPath } from "../router/index.js";

export async function LoginView(root) {
  const session = await getSession();
  if (session) {
    location.hash = `#${consumeReturnPath()}`;
    return { unmount() {} };
  }

  root.classList.add("view--auth");

  let mode = "signin";

  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-page__glow auth-page__glow--a" aria-hidden="true"></div>
      <div class="auth-page__glow auth-page__glow--b" aria-hidden="true"></div>
      <div class="auth-page__grain" aria-hidden="true"></div>

      <div class="auth-showcase" id="auth-showcase" aria-hidden="true">
        <div class="auth-showcase__fade auth-showcase__fade--left"></div>
        <div class="auth-showcase__track" id="auth-showcase-track"></div>
        <div class="auth-showcase__fade auth-showcase__fade--right"></div>
        <div class="auth-showcase__veil" aria-hidden="true"></div>
        <div class="auth-showcase__brand">
          <p class="auth-showcase__free">FREE</p>
          <p class="auth-brand">LANTAW</p>
          <p class="auth-showcase__tag">Now showing — sign in to watch</p>
        </div>
      </div>

      <div class="auth-shell">
        <div class="auth-flow" id="auth-flow">
          <header class="auth-flow__head">
            <div class="auth-flow__brand">
              <p class="auth-showcase__free">FREE</p>
              <p class="auth-brand">LANTAW</p>
            </div>
            <h1 id="auth-title">Welcome</h1>
            <p class="auth-lead" id="auth-lead">One Google button for new and existing accounts. Or use email below.</p>
          </header>

          <div id="auth-oauth">
            <button type="button" class="btn btn--google" id="google-btn">
              <svg class="btn--google__svg" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          <p class="auth-error auth-error--google" id="auth-error" hidden></p>
          <p class="auth-success" id="auth-success" hidden></p>

          <div class="auth-divider" id="auth-divider"><span>or continue with email</span></div>

          <div class="auth-tabs" role="tablist" aria-label="Email account" id="auth-tabs">
            <button type="button" class="auth-tab is-active" role="tab" aria-selected="true" data-mode="signin" id="tab-signin">
              Sign in
            </button>
            <button type="button" class="auth-tab" role="tab" aria-selected="false" data-mode="signup" id="tab-signup">
              Sign up
            </button>
            <span class="auth-tabs__ink" id="tab-ink" aria-hidden="true"></span>
          </div>

          <form id="auth-form" class="auth-form" novalidate>
            <label class="auth-field" id="name-field" hidden>
              <span>Display name</span>
              <input id="display-name" name="displayName" type="text" autocomplete="nickname" placeholder="How should we call you?" />
            </label>
            <label class="auth-field">
              <span>Email</span>
              <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@gmail.com" />
            </label>
            <label class="auth-field" id="password-field">
              <span class="auth-field__row">
                <span>Password</span>
                <button type="button" class="link-btn auth-forgot" id="forgot-btn">Forgot password?</button>
              </span>
              <input id="password" name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters" />
            </label>

            <button type="submit" class="btn btn--primary" id="auth-submit">Sign in</button>
          </form>

          <p class="auth-foot" id="auth-foot">
            New here?
            <button type="button" class="link-btn" id="switch-mode">Create an email account</button>
          </p>

        </div>
      </div>

      <footer class="auth-legal">
        <a href="#/privacy">Privacy</a>
      </footer>

      <div class="auth-install-modal" id="auth-install" hidden>
        <div class="auth-install-modal__backdrop" id="install-backdrop" aria-hidden="true"></div>
        <div
          class="auth-install-modal__sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-title"
        >
          <p class="auth-install-modal__eyebrow">LANTAW app</p>
          <strong id="install-title">Install LANTAW</strong>
          <p class="auth-install__hint" id="install-hint">
            Add to your home screen for a faster, full-screen app.
          </p>
          <ol class="auth-install__steps" id="install-steps" hidden></ol>
          <div class="auth-install__actions">
            <button type="button" class="btn btn--primary auth-install__btn" id="install-btn">
              Install app
            </button>
            <button type="button" class="link-btn" id="install-dismiss">Not now</button>
          </div>
        </div>
      </div>
    </section>
  `;

  const flow = root.querySelector("#auth-flow");
  const form = root.querySelector("#auth-form");
  const nameField = root.querySelector("#name-field");
  const nameInput = root.querySelector("#display-name");
  const passwordField = root.querySelector("#password-field");
  const passwordInput = root.querySelector("#password");
  const submit = root.querySelector("#auth-submit");
  const errorEl = root.querySelector("#auth-error");
  const successEl = root.querySelector("#auth-success");
  const googleBtn = root.querySelector("#google-btn");
  const oauthBlock = root.querySelector("#auth-oauth");
  const divider = root.querySelector("#auth-divider");
  const tabs = root.querySelector("#auth-tabs");
  const foot = root.querySelector("#auth-foot");
  const titleEl = root.querySelector("#auth-title");
  const leadEl = root.querySelector("#auth-lead");
  const forgotBtn = root.querySelector("#forgot-btn");
  const tabSignin = root.querySelector("#tab-signin");
  const tabSignup = root.querySelector("#tab-signup");
  const tabInk = root.querySelector("#tab-ink");

  function moveInk(activeBtn) {
    if (!activeBtn || tabs.hasAttribute("hidden")) return;
    tabInk.style.width = `${activeBtn.offsetWidth}px`;
    tabInk.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  }

  function bindFootSwitch() {
    foot.querySelector("#switch-mode")?.addEventListener("click", () => {
      if (mode === "forgot") setMode("signin");
      else if (mode === "signup") setMode("signin");
      else setMode("signup");
    });
  }

  function setHidden(el, hide) {
    if (!el) return;
    if (hide) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function setMode(next) {
    mode = next;
    const signup = mode === "signup";
    const forgot = mode === "forgot";

    flow.classList.toggle("auth-flow--forgot", forgot);

    // Email-only reset screen — hide Google, tabs, name, password
    setHidden(oauthBlock, forgot);
    setHidden(divider, forgot);
    setHidden(tabs, forgot);
    setHidden(nameField, !signup);
    setHidden(passwordField, forgot);
    nameInput.required = signup;
    passwordInput.required = !forgot;
    passwordInput.disabled = forgot;
    passwordInput.autocomplete = signup ? "new-password" : "current-password";

    if (forgot) {
      titleEl.textContent = "Forgot password";
      leadEl.textContent =
        "Enter the email for your account. We’ll send a reset link.";
      submit.textContent = "Send reset link";
      foot.innerHTML = `Remember it? <button type="button" class="link-btn" id="switch-mode">Back to sign in</button>`;
    } else if (signup) {
      titleEl.textContent = "Welcome";
      leadEl.textContent =
        "One Google button for new and existing accounts. Or use email below.";
      submit.textContent = "Create account";
      foot.innerHTML = `Already have an email account? <button type="button" class="link-btn" id="switch-mode">Sign in</button>`;
    } else {
      titleEl.textContent = "Welcome";
      leadEl.textContent =
        "One Google button for new and existing accounts. Or use email below.";
      submit.textContent = "Sign in";
      foot.innerHTML = `New here? <button type="button" class="link-btn" id="switch-mode">Create an email account</button>`;
    }

    tabSignin.classList.toggle("is-active", !signup && !forgot);
    tabSignup.classList.toggle("is-active", signup);
    tabSignin.setAttribute("aria-selected", String(!signup && !forgot));
    tabSignup.setAttribute("aria-selected", String(signup));
    if (!forgot) {
      requestAnimationFrame(() => moveInk(signup ? tabSignup : tabSignin));
    }

    bindFootSwitch();
    errorEl.hidden = true;
    if (!forgot) successEl.hidden = true;
  }

  tabSignin.addEventListener("click", () => setMode("signin"));
  tabSignup.addEventListener("click", () => setMode("signup"));
  forgotBtn.addEventListener("click", () => setMode("forgot"));
  bindFootSwitch();

  const oauthError =
    new URLSearchParams(window.location.search).get("error_description") ||
    consumeAuthError();
  if (oauthError) {
    const friendly = decodeURIComponent(String(oauthError).replace(/\+/g, " "));
    errorEl.textContent = friendly.includes("exchange external code")
      ? "Google login failed. In Supabase → Authentication → Providers → Google, paste a fresh Client Secret from Google Cloud (Reset secret), then try again."
      : friendly;
    errorEl.hidden = false;
    const clean = `${window.location.origin}${window.location.pathname}#/login`;
    window.history.replaceState({}, "", clean);
  }

  requestAnimationFrame(() => moveInk(tabSignin));
  window.addEventListener("resize", () => {
    if (mode === "forgot") return;
    moveInk(mode === "signup" ? tabSignup : tabSignin);
  });

  googleBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    successEl.hidden = true;
    googleBtn.disabled = true;
    try {
      await signInWithGoogle();
    } catch (err) {
      errorEl.textContent = err.message || "Google sign-in failed";
      errorEl.hidden = false;
      googleBtn.disabled = false;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    submit.disabled = true;

    const email = form.email.value;
    const password = form.password.value;
    const displayName = form.displayName.value;

    try {
      if (mode === "forgot") {
        await requestPasswordReset(email);
        successEl.textContent =
          "If that email has an account, a reset link is on its way. Check your inbox.";
        successEl.hidden = false;
      } else if (mode === "signup") {
        const { session: created, user } = await signUp({
          email,
          password,
          displayName,
        });
        if (!created && user) {
          successEl.textContent =
            "Account created. Check your email to confirm, then sign in.";
          successEl.hidden = false;
          setMode("signin");
        } else {
          // Router auth handler restores the last category (e.g. #/anime)
        }
      } else {
        await signIn({ email, password });
        // Router auth handler leaves /login → saved return path
      }
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong";
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  loadAuthShowcase(root.querySelector("#auth-showcase-track"));

  const installBox = root.querySelector("#auth-install");
  const installBtn = root.querySelector("#install-btn");
  const installHint = root.querySelector("#install-hint");
  const installTitle = root.querySelector("#install-title");
  const installSteps = root.querySelector("#install-steps");
  const installDismiss = root.querySelector("#install-dismiss");
  let unsubInstall = () => {};

  const setInstallSteps = (items) => {
    if (!installSteps) return;
    installSteps.innerHTML = items
      .map((html) => `<li>${html}</li>`)
      .join("");
  };

  const paintInstall = (state = getInstallState()) => {
    if (!installBox) return;
    // Always offer install on login unless already running as installed app
    // or the user dismissed it this session.
    const show = state.mode !== "installed" && !state.dismissed;
    installBox.hidden = !show;
    installBox.classList.toggle("is-ios", Boolean(state.ios));
    installBox.classList.toggle("is-in-app", state.mode === "in-app");
    if (!show) return;

    if (state.mode === "in-app") {
      const browser = state.browserLabel || (state.ios ? "Safari" : "Chrome");
      installTitle.textContent = `Open in ${browser}`;
      installHint.textContent = state.ios
        ? "Instagram / Facebook can’t install apps. Open this link in Safari, then add LANTAW to your Home Screen."
        : "Instagram / Facebook can’t install apps. Open LANTAW in Chrome, then tap Install.";
      if (state.ios) {
        setInstallSteps([
          "Tap <strong>⋯</strong> (top right) in Instagram",
          "Tap <strong>Open in external browser</strong> / <strong>Open in Safari</strong>",
          "In Safari, tap <strong>Share</strong> → <strong>Add to Home Screen</strong>",
        ]);
      } else {
        setInstallSteps([
          `Tap <strong>Open in ${browser}</strong> below`,
          "LANTAW opens in Chrome",
          "Tap <strong>Install app</strong> when it appears",
        ]);
      }
      installSteps.hidden = false;
      installBtn.textContent = `Open in ${browser}`;
      installBtn.onclick = () => {
        openInExternalBrowser();
      };
    } else if (state.mode === "ios" || state.mode === "ios-other") {
      installTitle.textContent = "Add LANTAW to iPhone";
      installHint.textContent =
        state.mode === "ios-other"
          ? "Open this page in Safari, then follow the steps below."
          : "iPhone installs from Safari’s Share menu — tap below for steps.";
      setInstallSteps([
        "Open this site in <strong>Safari</strong>",
        'Tap the <strong>Share</strong> button <span aria-hidden="true">□↑</span>',
        "Scroll and tap <strong>Add to Home Screen</strong>",
        "Tap <strong>Add</strong> — LANTAW opens like an app",
      ]);
      installSteps.hidden = false;
      installBtn.textContent = "Got it";
      installBtn.onclick = () => {
        dismissInstallBanner();
        paintInstall(getInstallState());
      };
    } else if (state.mode === "prompt") {
      installTitle.textContent = "Install LANTAW";
      installHint.textContent =
        "Install on your device for a faster full-screen experience.";
      installSteps.hidden = true;
      installBtn.textContent = "Install app";
      installBtn.onclick = async () => {
        installBtn.disabled = true;
        try {
          const result = await promptInstall();
          if (result?.outcome === "accepted") {
            installBox.hidden = true;
          }
        } finally {
          installBtn.disabled = false;
          paintInstall(getInstallState());
        }
      };
    } else {
      installTitle.textContent = "Install LANTAW";
      installHint.textContent = state.android
        ? "Tap your browser menu (⋮) → Install app / Add to Home screen."
        : "Use your browser menu → Install app / Add to Home screen. On iPhone, open in Safari first.";
      setInstallSteps(
        state.android
          ? [
              "Tap the <strong>⋮</strong> menu in Chrome",
              "Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>",
              "Confirm — LANTAW opens like an app",
            ]
          : [
              "Open this site in <strong>Chrome</strong> or <strong>Edge</strong>",
              "Use the browser menu → <strong>Install app</strong>",
              "Confirm — LANTAW opens like an app",
            ]
      );
      installSteps.hidden = false;
      installBtn.textContent = "Got it";
      installBtn.onclick = () => {
        dismissInstallBanner();
        paintInstall(getInstallState());
      };
    }
  };

  const closeInstall = () => {
    dismissInstallBanner();
    paintInstall(getInstallState());
  };

  installDismiss?.addEventListener("click", closeInstall);
  root.querySelector("#install-backdrop")?.addEventListener("click", closeInstall);

  // Clear a previous session dismiss so updates show the modal again once
  try {
    if (sessionStorage.getItem("lantaw-pwa-force") !== "55") {
      sessionStorage.removeItem("lantaw-pwa-dismiss");
      sessionStorage.setItem("lantaw-pwa-force", "55");
    }
  } catch {
    /* ignore */
  }

  unsubInstall = onInstallStateChange(paintInstall);
  paintInstall(getInstallState());

  return {
    unmount() {
      unsubInstall();
      root.classList.remove("view--auth");
    },
  };
}

async function loadAuthShowcase(track) {
  if (!track) return;
  const showcase = track.closest(".auth-showcase");

  try {
    const { results } = await getTrendingMovies();
    const posters = (results || []).filter((m) => m.poster).slice(0, 14);

    if (!posters.length) {
      showcase?.remove();
      return;
    }

    const strip = posters
      .map(
        (m) =>
          `<img class="auth-showcase__poster" src="${escapeAttr(
            m.poster
          )}" alt="" loading="lazy" draggable="false" />`
      )
      .join("");

    // Duplicate for a seamless marquee loop
    track.innerHTML = strip + strip;
    showcase?.classList.add("is-ready");
  } catch {
    showcase?.remove();
  }
}

function escapeAttr(str = "") {
  return String(str).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
