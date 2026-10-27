/** Home category tabs → separate pages */
export const CATEGORIES = [
  {
    id: "recommend",
    path: "/recommend",
    title: "Recommend",
    description: "Highest-rated movies and TV.",
  },
  {
    id: "filipino",
    path: "/filipino",
    title: "Filipino",
    description: "Movies and shows from the Philippines.",
  },
  {
    id: "vivamax",
    path: "/vivamax",
    title: "Vivamax",
    description: "Bold Filipino originals from Vivamax.",
  },
  {
    id: "movies",
    path: "/movies",
    title: "Movies",
    description: "Popular movies worldwide.",
  },
  {
    id: "tv-show",
    path: "/tv-show",
    title: "TV Show",
    description: "Popular TV series to binge.",
  },
  {
    id: "anime",
    path: "/anime",
    title: "Anime",
    description: "Japanese animation movies and series.",
  },
];

export function getCategoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function getCategoryByPath(pathname) {
  return CATEGORIES.find((c) => c.path === pathname) || null;
}
