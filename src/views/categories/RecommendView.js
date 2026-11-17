import { CategoryView } from "../CategoryView.js?v=179";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
