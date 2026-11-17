import { CategoryView } from "../CategoryView.js?v=180";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
