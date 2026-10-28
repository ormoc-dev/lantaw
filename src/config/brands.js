/** Clickable brand rails on Recommend — TMDB network / company ids */

export const TV_NETWORKS = [
  { id: 213, name: "Netflix", color: "#e50914" },
  { id: 2739, name: "Disney+", color: "#113ccf" },
  { id: 1024, name: "Prime Video", color: "#00a8e1" },
  { id: 2552, name: "Apple TV+", color: "#1a1a1a" },
  { id: 3186, name: "Max", color: "#002be7" },
  { id: 453, name: "Hulu", color: "#1ce783" },
  { id: 4330, name: "Paramount+", color: "#0064ff" },
  { id: 3353, name: "Peacock", color: "#f4a6c9" },
  { id: 1112, name: "Crunchyroll", color: "#f47521" },
  { id: 456, name: "Tubi", color: "#fa382d" },
  { id: 2588, name: "Shudder", color: "#e50914" },
  { id: 174, name: "AMC+", color: "#02adc7" },
  { id: 6368, name: "MGM+", color: "#c5a572" },
];

export const MOVIE_STUDIOS = [
  { id: 420, name: "Marvel Studios", color: "#ec1d24" },
  { id: 3, name: "Pixar", color: "#00b0e3" },
  { id: 174, name: "Warner Bros.", color: "#1a3a8a" },
  { id: 33, name: "Universal", color: "#0a5ca8" },
  { id: 2, name: "Disney", color: "#113ccf" },
  { id: 4, name: "Paramount", color: "#0064ff" },
  { id: 9993, name: "DC", color: "#0378f4" },
  { id: 1, name: "Lucasfilm", color: "#1a1a1a" },
  { id: 41077, name: "A24", color: "#ffffff" },
  { id: 10342, name: "Studio Ghibli", color: "#1b8f4e" },
  { id: 3172, name: "Blumhouse", color: "#c41230" },
  { id: 521, name: "DreamWorks", color: "#0b6bb8" },
  { id: 2348, name: "Nickelodeon", color: "#ea5600" },
];

export function getBrand(kind, id) {
  const list = kind === "network" ? TV_NETWORKS : MOVIE_STUDIOS;
  return list.find((b) => String(b.id) === String(id)) || null;
}
