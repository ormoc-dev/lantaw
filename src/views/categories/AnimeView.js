import { CategoryView } from "../CategoryView.js";

export async function AnimeView(root) {
  return CategoryView(root, { categoryId: "anime" });
}
