import type { Product } from '../types';

// Keep image warming and the visible carousel on exactly the same selection.
export function isCollectionProduct(p: Product): boolean {
    if (!p) return false;
    const isAvailable = String(p.isAvailable) !== "0" && String(p.isAvailable) !== "false";
    const inCatalog = (p as any).in_catalog !== 0 && (p as any).in_catalog !== "0" && (p as any).in_catalog !== false && String((p as any).in_catalog) !== "false";

    const swiperVal = p.showInSwiper !== undefined ? p.showInSwiper : (p as any).show_in_swiper;
    const isSwiperVisible = swiperVal !== false && swiperVal !== 0 && String(swiperVal) !== "0" && String(swiperVal) !== "false" && String(swiperVal) !== "null" && String(swiperVal) !== "undefined";

    const displaySec = String(p.displaySection || (p as any).display_section || "both").toLowerCase();
    const matchesSection = displaySec !== "products" && displaySec !== "packs" && displaySec !== "none";

    return isAvailable && inCatalog && isSwiperVisible && matchesSection;
  
}
