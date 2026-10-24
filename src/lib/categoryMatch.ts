/**
 * Which products belong on which section page.
 *
 * This used to live inside CategoryPage.tsx, so only the browser knew the rule
 * and every section page had to download the WHOLE catalogue (descriptions,
 * usage, ingredients of every product) just to filter it down locally.
 * It now lives here so the server can apply the exact same rule and send each
 * section page only its own products (GET /api/products/section/:slug).
 *
 * Pure functions, no React / Node imports: both bundles use this file.
 */
import { CATEGORIES } from "../components/constants";

export function hasCategoryMatch(p: any, targetCats: string[]) {
  if (!p) return false;
  const catStr = String(p.category || "").toLowerCase();
  const nameStr = String(p.name || "").toLowerCase();
  const nameEnStr = String(p.name_en || "").toLowerCase();
  const displaySec = String(p.displaySection || p.display_section || "").toLowerCase();
  const pIdStr = String(p.id || "").toLowerCase();

  // If display_section is 'home', hide from all catalog pages (only shows on homepage swiper)
  if (displaySec === "home") return false;

  return targetCats.some((tc) => {
    const target = tc.toLowerCase().trim();
    if (!target) return false;
    if (target === "all") return true;

    if (target === "products" || target === "ourproducts" || target === "our-products") {
      if (displaySec === "packs") return false;
      // Exclude packs even if they accidentally categorize them as Oils
      if (catStr.includes("pack") || catStr.includes("bundle") || pIdStr.startsWith("pack-") || nameEnStr.includes("pack")) return false;
      return catStr.includes("oil") || catStr === "oils" || catStr === "";
    }
    if (target === "skin")
      return (
        catStr.includes("skin") ||
        catStr.includes("peau") ||
        catStr.includes("بشرة") ||
        catStr.includes("face") ||
        catStr.includes("body") ||
        catStr.includes("general") ||
        nameStr.includes("بشرة") ||
        nameEnStr.includes("skin") ||
        nameEnStr.includes("face")
      );
    if (target === "hair" || target === "scalp")
      return (
        catStr.includes("hair") ||
        catStr.includes("scalp") ||
        catStr.includes("cheveux") ||
        catStr.includes("شعر") ||
        catStr.includes("فروة") ||
        nameStr.includes("شعر") ||
        nameEnStr.includes("hair") ||
        nameEnStr.includes("scalp")
      );
    if (target === "oil" || target === "oils")
      return catStr.includes("oil") || catStr.includes("زيوت") || catStr.includes("أويلز") || nameEnStr.includes("oil");
    if (target === "pack" || target === "packs" || target === "bundle" || target === "collection")
      return (
        catStr.includes("pack") ||
        catStr.includes("bundle") ||
        catStr.includes("باقة") ||
        catStr.includes("مجموعة") ||
        catStr.includes("مجموعات") ||
        catStr.includes("collection") ||
        displaySec === "packs" ||
        pIdStr.startsWith("pack-") ||
        nameEnStr.includes("pack") ||
        nameStr.includes("باقة") ||
        nameStr.includes("مجموعة") ||
        nameStr.includes("مجموعات") ||
        nameStr.includes("طقم")
      );
    return catStr === target || catStr.includes(target) || catStr.split(/[\s,-]+/).includes(target);
  });
}

/** URL slug (last path segment, lowercased) -> the targets hasCategoryMatch is called with. */
export function getCategoryTargets(cleanId: string, isLive = false): string[] {
  if (!cleanId || ["all", "products", "ourproducts", "our-products", "category"].includes(cleanId)) {
    return [cleanId || "products"];
  }
  if (cleanId === "oils" || cleanId === "oil") return ["oil", "oils"];
  if (["skin", "peau", "peaux"].includes(cleanId)) return ["skin"];
  if (["hair", "hair-and-scalp", "hair_and_scalp", "scalp", "cheveux"].includes(cleanId)) return ["hair", "scalp"];
  if (["packs", "pack", "collections", "bundles"].includes(cleanId)) return ["pack", "packs", "bundle", "collection"];
  if (isLive || cleanId === "live") return ["live", "livepack", "live-pack", "pack"];
  const category = CATEGORIES.find((c) => c.id.toLowerCase() === cleanId);
  if (category) return [category.name, category.id];
  return [cleanId];
}

/** Long text the product cards never show. Dropped from section lists. */
const HEAVY_FIELDS = ["description", "usage", "ingredients"] as const;
export function toListProduct<T extends Record<string, any>>(p: T): T {
  const out: any = { ...p };
  for (const f of HEAVY_FIELDS) if (f in out) out[f] = "";
  return out;
}
