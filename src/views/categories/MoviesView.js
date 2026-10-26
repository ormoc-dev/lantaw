import { CategoryView } from "../CategoryView.js";

export async function MoviesView(root) {
  return CategoryView(root, { categoryId: "movies" });
}
