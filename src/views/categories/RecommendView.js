import { CategoryView } from "../CategoryView.js?v=150";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
