import {
  getSession,
  signIn,
  signInWithGoogle,
  signUp,
} from "../services/authService.js";

export async function LoginView(root) {
  const session = await getSession();
  if (session) {
    location.hash = "#/";
    return { unmount() {} };
  }

  root.classList.add("view--auth");

  let mode = "signin";

  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-page__glow auth-page__glow--a" aria-hidden="true"></div>
      <div class="auth-page__glow auth-page__glow--b" aria-hidden="true"></div>
      <div class="auth-page__grain" aria-hidden="true"></div>

      <div class="auth-shell">
        <aside class="auth-brand-pane">
          <p class="auth-brand">Movie</p>
          <p class="auth-brand-pane__tag">Your personal cinema shelf — save titles, pick up later.</p>
        </aside>

        <div class="auth-flow">
          <header class="auth-flow__head">
            <h1>Welcome</h1>
            <p class="auth-lead">One Google button for new and existing accounts. Or use email below.</p>
          </header>

          <button type="button" class="btn btn--google" id="google-btn">
            <svg class="btn--google__svg" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p class="auth-error auth-error--google" id="auth-error" hidden></p>
          <p class="auth-success" id="auth-success" hidden></p>

          <div class="auth-divider"><span>or continue with email</span></div>

          <div class="auth-tabs" role="tablist" aria-label="Email account">
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
            <label class="auth-field">
              <span>Password</span>
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
    </section>
  `;

  const form = root.querySelector("#auth-form");
  const nameField = root.querySelector("#name-field");
  const nameInput = root.querySelector("#display-name");
  const passwordInput = root.querySelector("#password");
  const submit = root.querySelector("#auth-submit");
  const errorEl = root.querySelector("#auth-error");
  const successEl = root.querySelector("#auth-success");
  const googleBtn = root.querySelector("#google-btn");
  const switchBtn = root.querySelector("#switch-mode");
  const foot = root.querySelector("#auth-foot");
  const tabSignin = root.querySelector("#tab-signin");
  const tabSignup = root.querySelector("#tab-signup");
  const tabInk = root.querySelector("#tab-ink");

  function moveInk(activeBtn) {
    tabInk.style.width = `${activeBtn.offsetWidth}px`;
    tabInk.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  }

  function setMode(next) {
    mode = next;
    const signup = mode === "signup";

    submit.textContent = signup ? "Create account" : "Sign in";

    nameField.hidden = !signup;
    nameInput.required = signup;
    passwordInput.autocomplete = signup ? "new-password" : "current-password";

    tabSignin.classList.toggle("is-active", !signup);
    tabSignup.classList.toggle("is-active", signup);
    tabSignin.setAttribute("aria-selected", String(!signup));
    tabSignup.setAttribute("aria-selected", String(signup));
    moveInk(signup ? tabSignup : tabSignin);

    foot.innerHTML = signup
      ? `Already have an email account? <button type="button" class="link-btn" id="switch-mode">Sign in</button>`
      : `New here? <button type="button" class="link-btn" id="switch-mode">Create an email account</button>`;
    foot.querySelector("#switch-mode").addEventListener("click", () => {
      setMode(signup ? "signin" : "signup");
    });

    successEl.hidden = true;
  }

  tabSignin.addEventListener("click", () => setMode("signin"));
  tabSignup.addEventListener("click", () => setMode("signup"));
  switchBtn.addEventListener("click", () => setMode("signup"));

  const oauthError = new URLSearchParams(window.location.search).get(
    "error_description"
  );
  if (oauthError) {
    const friendly = decodeURIComponent(oauthError.replace(/\+/g, " "));
    errorEl.textContent = friendly.includes("exchange external code")
      ? "Google login failed. In Supabase → Authentication → Providers → Google, paste a fresh Client Secret from Google Cloud (Reset secret), then try again."
      : friendly;
    errorEl.hidden = false;
    const clean = `${window.location.origin}${window.location.pathname}#/login`;
    window.history.replaceState({}, "", clean);
  }

  requestAnimationFrame(() => moveInk(tabSignin));
  window.addEventListener("resize", () => {
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
      if (mode === "signup") {
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
          location.hash = "#/";
        }
      } else {
        await signIn({ email, password });
        location.hash = "#/";
      }
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong";
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  return {
    unmount() {
      root.classList.remove("view--auth");
    },
  };
}
