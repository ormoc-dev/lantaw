import { CategoryView } from "../CategoryView.js?v=151";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
