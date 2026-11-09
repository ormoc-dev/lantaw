import { CategoryView } from "../CategoryView.js?v=151";

export async function TvShowView(root) {
  return CategoryView(root, { categoryId: "tv-show" });
}
