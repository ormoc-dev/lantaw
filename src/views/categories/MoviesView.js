import { CategoryView } from "../CategoryView.js?v=148";

export async function MoviesView(root) {
  return CategoryView(root, { categoryId: "movies" });
}
