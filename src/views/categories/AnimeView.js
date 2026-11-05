import { CategoryView } from "../CategoryView.js?v=144";

export async function AnimeView(root) {
  return CategoryView(root, { categoryId: "anime" });
}
