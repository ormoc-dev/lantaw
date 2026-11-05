import { CategoryView } from "../CategoryView.js?v=144";

export async function TvShowView(root) {
  return CategoryView(root, { categoryId: "tv-show" });
}
