import {
  getSession,
  onAuthChange,
  resolveUserProfile,
  signOut,
} from "../services/authService.js";

export async function AuthBar(host) {
  const bar = document.createElement("div");
  bar.className = "auth-bar";
  host.append(bar);

  async function render(session) {
    if (!session?.user) {
      bar.innerHTML = "";
      return;
    }

    const { name: label, avatar } = await resolveUserProfile(session.user);

    bar.innerHTML = `
      ${
        avatar
          ? `<img class="auth-bar__avatar" src="${avatar}" alt="" width="28" height="28" />`
          : ""
      }
      <span class="auth-bar__user">${escapeHtml(label)}</span>
      <button type="button" class="link-btn" id="sign-out">Sign out</button>
    `;
    bar.querySelector("#sign-out").addEventListener("click", async () => {
      await signOut();
      location.hash = "#/login";
    });
  }

  const session = await getSession();
  await render(session);
  const unsub = onAuthChange((next) => render(next));

  return {
    unmount() {
      unsub();
      bar.remove();
    },
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
