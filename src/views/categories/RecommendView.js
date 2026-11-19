import { CategoryView } from "../CategoryView.js?v=188";

export async function RecommendView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
