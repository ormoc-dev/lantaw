import { CategoryView } from "../CategoryView.js?v=144";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
