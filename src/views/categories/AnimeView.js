import { CategoryView } from "../CategoryView.js?v=151";

export async function AnimeView(root) {
  return CategoryView(root, { categoryId: "anime" });
}
