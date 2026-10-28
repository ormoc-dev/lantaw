import { getSession, updatePassword } from "../services/authService.js";

export async function ResetPasswordView(root) {
  const session = await getSession();
  if (!session) {
    location.hash = "#/login";
    return { unmount() {} };
  }

  root.classList.add("view--auth");

  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-page__glow auth-page__glow--a" aria-hidden="true"></div>
      <div class="auth-page__glow auth-page__glow--b" aria-hidden="true"></div>
      <div class="auth-shell">
        <aside class="auth-brand-pane">
          <p class="auth-brand">LANTAW</p>
          <p class="auth-brand-pane__tag">Choose a new password for your email account.</p>
        </aside>

        <div class="auth-flow">
          <header class="auth-flow__head">
            <h1>Reset password</h1>
            <p class="auth-lead">Enter a new password, then you can sign in as usual.</p>
          </header>

          <p class="auth-error" id="auth-error" hidden></p>
          <p class="auth-success" id="auth-success" hidden></p>

          <form id="reset-form" class="auth-form" novalidate>
            <label class="auth-field">
              <span>New password</span>
              <input
                id="password"
                name="password"
                type="password"
                required
                minlength="6"
                autocomplete="new-password"
                placeholder="At least 6 characters"
              />
            </label>
            <label class="auth-field">
              <span>Confirm password</span>
              <input
                id="password-confirm"
                name="passwordConfirm"
                type="password"
                required
                minlength="6"
                autocomplete="new-password"
                placeholder="Repeat new password"
              />
            </label>
            <button type="submit" class="btn btn--primary" id="reset-submit">
              Save new password
            </button>
          </form>
        </div>
      </div>

      <footer class="auth-legal">
        <a href="#/privacy">Privacy</a>
      </footer>
    </section>
  `;

  const form = root.querySelector("#reset-form");
  const submit = root.querySelector("#reset-submit");
  const errorEl = root.querySelector("#auth-error");
  const successEl = root.querySelector("#auth-success");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const password = form.password.value;
    const confirm = form.passwordConfirm.value;

    if (password.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters.";
      errorEl.hidden = false;
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = "Passwords do not match.";
      errorEl.hidden = false;
      return;
    }

    submit.disabled = true;
    try {
      await updatePassword(password);
      successEl.textContent = "Password updated. Taking you home…";
      successEl.hidden = false;
      window.setTimeout(() => {
        location.hash = "#/";
      }, 700);
    } catch (err) {
      errorEl.textContent = err.message || "Could not update password";
      errorEl.hidden = false;
      submit.disabled = false;
    }
  });

  return {
    unmount() {
      root.classList.remove("view--auth");
    },
  };
}
