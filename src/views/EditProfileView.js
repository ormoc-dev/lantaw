import {
  getSession,
  resolveUserProfile,
  updateDisplayName,
  uploadProfileAvatar,
} from "../services/authService.js";
import { linkTo } from "../router/index.js";

const PEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 5.5 18 11M4 20l1.2-5.3L16.4 3.5a2 2 0 0 1 2.8 0l1.3 1.3a2 2 0 0 1 0 2.8L9.3 18.8 4 20Z"/></svg>`;

export async function EditProfileView(root) {
  const session = await getSession();
  const user = session?.user;
  if (!user) {
    location.hash = linkTo("/login");
    return { unmount() {} };
  }

  const resolved = await resolveUserProfile(user);
  let name = resolved.name || "";
  let avatar = resolved.avatar || null;
  const email = resolved.email || user.email || "";
  const initial = (name || email || "?").slice(0, 1).toUpperCase();

  const avatarHtml = (url, letter) =>
    url
      ? `<img class="me-identity__avatar me-edit__avatar" id="me-edit-avatar-img" src="${escapeHtml(
          url
        )}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="me-identity__avatar me-identity__avatar--fallback me-edit__avatar" id="me-edit-avatar-img">${escapeHtml(
          letter
        )}</span>`;

  root.innerHTML = `
    <div class="me-page me-edit-page">
      <header class="me-edit__head">
        <a class="wl-back" href="${linkTo("/me")}" aria-label="Back to Me">←</a>
        <h1>Edit profile</h1>
      </header>

      <section class="me-edit__photo" aria-label="Profile photo">
        <button type="button" class="me-identity__avatar-wrap me-edit__avatar-btn" id="me-edit-avatar-btn" aria-label="Change profile photo">
          ${avatarHtml(avatar, initial)}
          <span class="me-identity__avatar-edit" aria-hidden="true">${PEN}</span>
        </button>
        <input type="file" id="me-edit-avatar-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        <button type="button" class="me-edit__photo-btn" id="me-edit-avatar-text">Change photo</button>
        <p class="me-edit__hint" id="me-edit-avatar-status" hidden></p>
      </section>

      <section class="me-edit__fields" aria-labelledby="me-edit-name-label">
        <label class="me-modal__label" id="me-edit-name-label" for="me-edit-name">Display name</label>
        <input
          class="me-modal__input"
          id="me-edit-name"
          type="text"
          maxlength="40"
          autocomplete="nickname"
          enterkeyhint="done"
          value="${escapeHtml(name)}"
        />
        ${
          email
            ? `<p class="me-edit__email">${escapeHtml(email)}</p>
               <p class="me-edit__hint">Email can’t be edited.</p>`
            : ""
        }
        <p class="me-modal__error" id="me-edit-error" hidden></p>
      </section>

      <div class="me-edit__actions">
        <button type="button" class="me-modal__btn me-modal__btn--accent" id="me-edit-save">Save</button>
      </div>
    </div>
  `;

  const avatarBtn = root.querySelector("#me-edit-avatar-btn");
  const avatarText = root.querySelector("#me-edit-avatar-text");
  const avatarFile = root.querySelector("#me-edit-avatar-file");
  const avatarStatus = root.querySelector("#me-edit-avatar-status");
  const nameInput = root.querySelector("#me-edit-name");
  const errorEl = root.querySelector("#me-edit-error");
  const saveBtn = root.querySelector("#me-edit-save");

  const setAvatarBusy = (busy, message = "") => {
    avatarBtn.disabled = busy;
    avatarText.disabled = busy;
    avatarBtn.classList.toggle("is-busy", busy);
    if (avatarStatus) {
      avatarStatus.hidden = !message;
      avatarStatus.textContent = message;
    }
  };

  const paintAvatar = (url, letter) => {
    const wrap = root.querySelector(".me-edit__avatar-btn");
    const existing = root.querySelector("#me-edit-avatar-img");
    if (existing?.tagName === "IMG" && url) {
      existing.src = url;
      return;
    }
    if (!wrap) return;
    existing?.remove();
    wrap.insertAdjacentHTML("afterbegin", avatarHtml(url, letter));
  };

  const pickPhoto = () => avatarFile?.click();
  avatarBtn?.addEventListener("click", pickPhoto);
  avatarText?.addEventListener("click", pickPhoto);

  avatarFile?.addEventListener("change", async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    setAvatarBusy(true, "Uploading…");
    try {
      avatar = await uploadProfileAvatar(file);
      paintAvatar(avatar, (name || email || "?").slice(0, 1).toUpperCase());
      setAvatarBusy(false, "Photo updated");
    } catch (err) {
      setAvatarBusy(false, err.message || "Could not update photo");
    } finally {
      avatarFile.value = "";
    }
  });

  const save = async () => {
    if (!saveBtn || !nameInput) return;
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      name = await updateDisplayName(nameInput.value);
      paintAvatar(avatar, name.slice(0, 1).toUpperCase());
      location.hash = linkTo("/me");
    } catch (err) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = err.message || "Could not update name";
      }
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  };

  saveBtn?.addEventListener("click", save);
  nameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });

  return { unmount() {} };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
