import { CategoryView } from "./CategoryView.js?v=141";

/**
 * Home opens the Recommend experience (brand rails + curated rows).
 * Other categories stay on their own chip routes.
 */
export async function HomeView(root) {
  return CategoryView(root, { categoryId: "recommend" });
}
