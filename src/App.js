import { createRouter } from "./router/index.js";
import { createBottomNav } from "./components/BottomNav.js";
import { HomeView } from "./views/HomeView.js?v=151";
import { MovieView, TvView } from "./views/MovieView.js?v=156";
import { LoginView } from "./views/LoginView.js";
import { PrivacyView } from "./views/PrivacyView.js?v=141";
import { ResetPasswordView } from "./views/ResetPasswordView.js";
import { WatchlistView } from "./views/WatchlistView.js";
import { ShortsView } from "./views/ShortsView.js";
import { RankingsView } from "./views/RankingsView.js";
import { DiscoverView } from "./views/DiscoverView.js";
import { MeView } from "./views/MeView.js?v=146";
import { FriendsView } from "./views/FriendsView.js?v=152";
import { WatchPartyView } from "./views/WatchPartyView.js?v=156";
import { RecentView } from "./views/RecentView.js";
import { RecommendView } from "./views/categories/RecommendView.js?v=151";
import { FilipinoView } from "./views/categories/FilipinoView.js?v=167";
import { MoviesView } from "./views/categories/MoviesView.js?v=151";
import { TvShowView } from "./views/categories/TvShowView.js?v=151";
import { AnimeView } from "./views/categories/AnimeView.js?v=151";
import { KdramaView } from "./views/categories/KdramaView.js?v=151";
import { VivamaxView } from "./views/categories/VivamaxView.js?v=151";
import { BrandView } from "./views/BrandView.js";

export function createApp(root) {
  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.innerHTML = `
    <main id="view"></main>
  `;
  root.appendChild(shell);

  const bottomNav = createBottomNav();
  shell.append(bottomNav.el);

  const router = createRouter(shell.querySelector("#view"));
  router.add("/", HomeView);
  router.add("/login", LoginView);
  router.add("/privacy", PrivacyView);
  router.add("/reset-password", ResetPasswordView);
  router.add("/recommend", RecommendView);
  router.add("/brand/:kind/:id", BrandView);
  router.add("/filipino", FilipinoView);
  router.add("/vivamax", VivamaxView);
  router.add("/movies", MoviesView);
  router.add("/tv-show", TvShowView);
  router.add("/anime", AnimeView);
  router.add("/kdrama", KdramaView);
  router.add("/shorts", ShortsView);
  router.add("/rankings", RankingsView);
  router.add("/discover", DiscoverView);
  router.add("/me", MeView);
  router.add("/friends", FriendsView);
  router.add("/watch-party/:id", WatchPartyView);
  router.add("/recent", RecentView);
  router.add("/watchlist", WatchlistView);
  router.add("/movie/:id", MovieView);
  router.add("/tv/:id", TvView);

  return {
    mount() {
      router.start();
      bottomNav.sync();
    },
  };
}
