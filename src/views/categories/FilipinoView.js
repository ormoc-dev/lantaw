import { CategoryView } from "../CategoryView.js";

export async function FilipinoView(root) {
  return CategoryView(root, { categoryId: "filipino" });
}
