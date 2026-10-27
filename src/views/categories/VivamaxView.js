import { CategoryView } from "../CategoryView.js";

export async function VivamaxView(root) {
  return CategoryView(root, { categoryId: "vivamax" });
}
