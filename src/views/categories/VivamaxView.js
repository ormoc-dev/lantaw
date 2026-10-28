import { CategoryView } from "../CategoryView.js";
import { linkTo } from "../../router/index.js";

const AGE_KEY = "lantaw-vivamax-18";

function hasConfirmedAge() {
  try {
    return localStorage.getItem(AGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberConfirmedAge() {
  try {
    localStorage.setItem(AGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function askAgeConfirmation(root) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "me-modal vivamax-age-modal";
    modal.innerHTML = `
      <div class="me-modal__backdrop" data-age="no" aria-hidden="true"></div>
      <div
        class="me-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vivamax-age-title"
      >
        <p class="vivamax-age-modal__eyebrow">Vivamax</p>
        <h2 id="vivamax-age-title">Are you 18 or older?</h2>
        <p class="me-modal__lead">
          Vivamax includes mature content. Confirm you are at least
          <strong>18 years old</strong> to continue.
        </p>
        <div class="me-modal__actions">
          <button type="button" class="me-modal__btn" data-age="no">No</button>
          <button type="button" class="me-modal__btn me-modal__btn--accent" data-age="yes">
            Yes, I’m 18+
          </button>
        </div>
      </div>
    `;

    root.innerHTML = "";
    root.appendChild(modal);
    document.body.classList.add("me-modal-open");

    const finish = (ok) => {
      document.body.classList.remove("me-modal-open");
      modal.remove();
      resolve(ok);
    };

    modal.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-age]");
      if (!btn) return;
      finish(btn.getAttribute("data-age") === "yes");
    });
  });
}

export async function VivamaxView(root) {
  if (!hasConfirmedAge()) {
    const ok = await askAgeConfirmation(root);
    if (!ok) {
      location.hash = linkTo("/recommend");
      return { unmount() {} };
    }
    rememberConfirmedAge();
  }

  return CategoryView(root, { categoryId: "vivamax" });
}
