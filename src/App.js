import { createRouter } from "./router/index.js";
import { createBottomNav } from "./components/BottomNav.js";
import { HomeView } from "./views/HomeView.js";
import { MovieView } from "./views/MovieView.js";
import { LoginView } from "./views/LoginView.js";
import { WatchlistView } from "./views/WatchlistView.js";
import { ShortsView } from "./views/ShortsView.js";
import { RankingsView } from "./views/RankingsView.js";
import { DiscoverView } from "./views/DiscoverView.js";
import { MeView } from "./views/MeView.js";

export function createApp(root) {
  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.innerHTML = `<main id="view"></main>`;
  root.appendChild(shell);

  const bottomNav = createBottomNav();
  shell.appendChild(bottomNav.el);

  const router = createRouter(shell.querySelector("#view"));
  router.add("/", HomeView);
  router.add("/login", LoginView);
  router.add("/shorts", ShortsView);
  router.add("/rankings", RankingsView);
  router.add("/discover", DiscoverView);
  router.add("/me", MeView);
  router.add("/watchlist", WatchlistView);
  router.add("/movie/:id", MovieView);

  return {
    mount() {
      router.start();
      bottomNav.sync();
    },
  };
}
