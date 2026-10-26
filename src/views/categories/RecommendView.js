import { CategoryView } from "../CategoryView.js";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
