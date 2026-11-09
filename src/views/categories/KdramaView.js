import { CategoryView } from "../CategoryView.js?v=151";

export async function KdramaView(root) {
  return CategoryView(root, { categoryId: "kdrama" });
}
