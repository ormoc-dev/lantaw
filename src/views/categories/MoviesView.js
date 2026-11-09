import { CategoryView } from "../CategoryView.js?v=151";

export async function MoviesView(root) {
  return CategoryView(root, { categoryId: "movies" });
}
