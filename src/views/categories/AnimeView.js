import { CategoryView } from "../CategoryView.js?v=148";

export async function AnimeView(root) {
  return CategoryView(root, { categoryId: "anime" });
}
