import { CategoryView } from "../CategoryView.js";

export async function TvShowView(root) {
  return CategoryView(root, { categoryId: "tv-show" });
}
