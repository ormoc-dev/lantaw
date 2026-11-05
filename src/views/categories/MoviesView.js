import { CategoryView } from "../CategoryView.js?v=144";

export async function MoviesView(root) {
  return CategoryView(root, { categoryId: "movies" });
}
