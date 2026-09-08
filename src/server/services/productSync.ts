import { getNextAvailableProductId } from "../utils/idUtils";
import { mapD1RowToProductSchema } from "./d1Client";
import { normalizeSizeLabel, parseSizeMlFromLabel } from "../../lib/sizeUtils";

// The three "classic <-> D1 shape" product converters. These are pure
// transformation logic (no network/file I/O) but they read AND reassign
// the shared products[]/d1_products[] arrays wholesale (not just mutate
// items in place), so they need setter injection, not just getters, to
// match the original inline behavior where they reassigned the raw
// module-level `let products` / `let d1_products` variables directly.
//
// findFeaturedProductMatch always returns null now that the hardcoded
// catalog it used to match against was removed upstream — kept as a
// local no-op stub (same as in d1Client.ts/catalogSync.ts) purely so the
// optional-chaining fallback call sites below (`fp?.name`, `fp?.category`,
// etc.) keep working exactly as before without every call site needing
// to be rewritten.
function findFeaturedProductMatch(_p: any) {
  return null;
}

// Shared by both directions below: a D1 row's pack_product_ids can be a JSON
// string, an array already parsed by an intermediate step, or absent —
// malformed/missing data just means "no constituent products recorded" and
// the pack still functions, it simply won't pull in their reviews yet.
function parsePackProductIds(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((id: any) => String(id));
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((id: any) => String(id));
    } catch {
      // fall through
    }
  }
  return [];
}

interface ProductSyncState {
  getProducts: () => any[];
  setProducts: (v: any[]) => void;
  getD1Products: () => any[];
  setD1Products: (v: any[]) => void;
}

export function createProductSyncService(state: ProductSyncState) {
  // Rebuilds the classic `products` array entirely from `d1_products`
  // (D1's raw row shape) — used whenever fresh D1 data has just been
  // loaded/fetched and the classic array needs to reflect it exactly.
  function syncSqlToClassicProducts() {
    const d1_products = state.getD1Products();
    if (Array.isArray(d1_products) && d1_products.length > 0) {
      const activeD1 = d1_products.filter((p) => p.in_catalog !== 0);
      const mapped = activeD1.map((p) => {
        const isSale = p.discount_applicable === 1;
        const numericPrice = isNaN(parseFloat(p.price))
          ? 60
          : Math.round(parseFloat(p.price));
        const discountPriceRaw = parseFloat(p.discount_price);

        const priceStr =
          isSale && !isNaN(discountPriceRaw)
            ? `${Math.round(discountPriceRaw)} DH`
            : `${numericPrice} DH`;
        const originalPriceStr =
          isSale && !isNaN(discountPriceRaw) ? `${numericPrice} DH` : undefined;

        const fp: any = findFeaturedProductMatch(p);

        let benefitsArray: string[] = [];
        if (typeof p.benefits === "string" && p.benefits.trim()) {
          benefitsArray = p.benefits
            .split("\n")
            .map((b: string) => b.trim())
            .filter(Boolean);
        } else if (fp && Array.isArray(fp.benefits) && fp.benefits.length > 0) {
          benefitsArray = fp.benefits;
        } else if (p.description) {
          benefitsArray = [p.description];
        }

        const sizeLabel = normalizeSizeLabel(p.size_label);
        const sizeMl =
          p.size_ml !== undefined && p.size_ml !== null && p.size_ml !== "" && Number.isFinite(Number(p.size_ml))
            ? Math.round(Number(p.size_ml))
            : parseSizeMlFromLabel(sizeLabel);

        // Map back to classic product object schema with exact key specs
        return {
          id: String(p.product_nbr),
          name: p.name || fp?.name || "",
          name_en: p.name_en || fp?.name_en || "",
          category: p.category || fp?.category || "Oils",
          price: priceStr,
          originalPrice: originalPriceStr,
          isSale: isSale,
          isAvailable:
            p.available === 1 ||
            p.available === true ||
            p.available === "1" ||
            p.available === "true",
          showInSwiper: p.show_in_swiper !== 0,
          image: p.image_url || fp?.image || "",
          description: (p.description && p.description.trim()) || fp?.description || "",
          benefits: benefitsArray,
          usage: (p.usage && p.usage.trim()) || fp?.usage || "",
          ingredients: (p.ingredients && p.ingredients.trim()) || fp?.ingredients || "",
          // No `: 50` fallback any more. This mapper rebuilds the classic array
          // from the D1 rows, so defaulting here meant a product whose size had
          // never been set came back claiming to be 50 ml — and, combined with
          // the reverse mapper below, that invented 50 was then written back to
          // D1 as if an admin had chosen it.
          size_ml: sizeMl,
          size_label: sizeLabel,
          volume: sizeLabel,
          isPack: p.is_pack === 1 || p.is_pack === true || p.is_pack === "1",
          packProductIds: parsePackProductIds(p.pack_product_ids),
          orderIndex: p.order_index !== undefined ? Number(p.order_index) : 0,
          tag: p.tag !== undefined && p.tag !== null ? String(p.tag) : (fp?.tag || ""),
          exclude_from_sitemap: p.exclude_from_sitemap === 1 ? 1 : 0,
          displaySection: p.display_section || "both",
          // Previously dropped on every full rebuild of the classic array —
          // a product's custom SEO title/description/slug would disappear
          // from GET /api/products (the no-D1-configured fallback reads the
          // classic array directly) even though it was sitting correctly in
          // d1_products/D1, simply because this mapper never carried it over.
          seo_title: p.seo_title || "",
          seo_description: p.seo_description || "",
          seo_priority: p.seo_priority || "",
          seo_changefreq: p.seo_changefreq || "",
          slug: p.slug || "",
          show_size: p.show_size !== 0 && p.show_size !== "0" && p.show_size !== false && (p as any).showSize !== false ? 1 : 0,
          showSize: p.show_size !== 0 && p.show_size !== "0" && p.show_size !== false && (p as any).showSize !== false,
        };
      });

      mapped.sort((a, b) => {
        const aOrd = a.orderIndex !== undefined ? Number(a.orderIndex) : 0;
        const bOrd = b.orderIndex !== undefined ? Number(b.orderIndex) : 0;
        if (aOrd !== bOrd) return aOrd - bOrd;
        return 0;
      });

      state.setProducts(mapped);
    }
  }

  // Merges d1_products into the classic `products` array in place —
  // updates matching entries by id, appends new ones. Used for
  // incremental sync (unlike syncSqlToClassicProducts, which rebuilds
  // the whole array from scratch).
  function syncD1ToClassicProducts() {
    const d1_products = state.getD1Products();
    const products = state.getProducts();
    if (Array.isArray(d1_products) && d1_products.length > 0) {
      for (const d1p of d1_products) {
        if (!d1p) continue;
        const mappedProduct = mapD1RowToProductSchema(d1p);
        if (!mappedProduct) continue;

        const idx = products.findIndex((p) => String(p.id) === mappedProduct.id);
        if (idx !== -1) {
          products[idx] = { ...products[idx], ...mappedProduct, id: mappedProduct.id };
        } else {
          products.push(mappedProduct);
        }
      }
    }
  }

  // Rebuilds `d1_products` entirely from the classic `products` array —
  // used after any admin edit to the classic array (create/update/reorder)
  // so the D1-shaped mirror stays in sync for subsequent D1 writes/reads.
  function syncClassicToSqlProducts() {
    const products = state.getProducts();
    const d1_products = state.getD1Products();
    if (Array.isArray(products) && products.length > 0) {
      const existingMap = new Map<number, any>();
      if (Array.isArray(d1_products)) {
        for (const d1_p of d1_products) {
          if (d1_p && typeof d1_p.product_nbr === "number") {
            existingMap.set(d1_p.product_nbr, d1_p);
          }
        }
      }

      const classicMapped = products.map((p) => {
        const pRawPrice =
          typeof p.price === "string"
            ? p.price.replace(" DH", "")
            : String(p.price);
        const activePrice = isNaN(parseFloat(pRawPrice))
          ? 60.0
          : parseFloat(pRawPrice);

        let origPrice = activePrice;
        if (p.originalPrice) {
          const pRawOrig =
            typeof p.originalPrice === "string"
              ? p.originalPrice.replace(" DH", "")
              : String(p.originalPrice);
          origPrice = parseFloat(pRawOrig) || activePrice;
        }

        const isSale =
          p.isSale === true || (p.originalPrice && activePrice < origPrice);

        const fp: any = findFeaturedProductMatch(p);

        let benefitsStr = "";
        if (Array.isArray(p.benefits) && p.benefits.length > 0) {
          benefitsStr = p.benefits.join("\n");
        } else if (p.benefits) {
          benefitsStr = String(p.benefits);
        } else if (fp && Array.isArray(fp.benefits) && fp.benefits.length > 0) {
          benefitsStr = fp.benefits.join("\n");
        }

        const usageVal = p.usage || fp?.usage || "";
        const ingredientsVal = p.ingredients || fp?.ingredients || "";
        const tagVal = p.tag !== undefined && p.tag !== null ? String(p.tag) : (fp?.tag || null);

        // `volume` is accepted as an alias so a classic product built by an
        // older code path (where the size only ever lived in `volume`) still
        // round-trips its label into D1.
        const reverseSizeLabel = normalizeSizeLabel(p.size_label || p.volume) || null;
        const reverseSizeMl =
          p.size_ml !== undefined && p.size_ml !== null && p.size_ml !== "" && Number.isFinite(Number(p.size_ml))
            ? Math.round(Number(p.size_ml))
            : parseSizeMlFromLabel(reverseSizeLabel);

        const isPureNumericId = /^\d+$/.test(String(p.id));

        let targetNbr;
        if (isPureNumericId) {
          targetNbr = parseInt(String(p.id), 10);
        } else {
          // If it's a UUID, assign the next available id to avoid conflicts
          targetNbr = getNextAvailableProductId(Array.from(existingMap.values()));
          existingMap.set(targetNbr, { product_nbr: targetNbr }); // Claim it immediately for loop
          // Update the classic product to match the new D1 product nbr to stay in sync!
          p.id = String(targetNbr);
        }

        return {
          product_nbr: targetNbr,
          name: p.name || fp?.name || "",
          name_en: p.name_en || fp?.name_en || "",
          price: isSale ? origPrice : activePrice,
          discount_applicable: isSale ? 1 : 0,
          discount_price: isSale ? activePrice : null,
          available:
            p.isAvailable === false ||
            p.isAvailable === "false" ||
            p.isAvailable === 0 ||
            p.isAvailable === "0"
              ? 0
              : 1,
          // `p.size_ml || 50` here was the other half of the size bug: 0,
          // undefined and null all became 50, so this reverse mapper handed the
          // invented default straight to the D1 writer. Null now stays null.
          size_ml: reverseSizeMl,
          size_label: reverseSizeLabel,
          is_pack: p.isPack ? 1 : 0,
          pack_product_ids: JSON.stringify(Array.isArray(p.packProductIds) ? p.packProductIds : []),
          description: p.description || fp?.description || "",
          image_url: p.image || fp?.image || "",
          category: p.category || fp?.category || "Oils",
          show_in_swiper: p.showInSwiper ? 1 : 0,
          in_catalog: 1,
          benefits: benefitsStr,
          usage: usageVal,
          ingredients: ingredientsVal,
          tag: tagVal,
          order_index: p.orderIndex !== undefined ? Number(p.orderIndex) : 0,
          exclude_from_sitemap: p.exclude_from_sitemap ? 1 : 0,
          display_section: p.displaySection || p.display_section || "both",
          // Same reasoning as syncSqlToClassicProducts above, in the other
          // direction: this rebuilds d1_products from the classic array, and
          // previously dropped these fields entirely — so any SEO data set
          // via the classic array (e.g. from the no-D1-configured code path)
          // would never make it back into the object this app actually
          // writes to D1 with.
          seo_title: p.seo_title || "",
          seo_description: p.seo_description || "",
          seo_priority: p.seo_priority || "",
          seo_changefreq: p.seo_changefreq || "",
          slug: p.slug || "",
          show_size: p.show_size === 0 || p.show_size === "0" || p.show_size === false || (p as any).showSize === false ? 0 : 1,
        };
      });

      for (const p of classicMapped) {
        const existing = existingMap.get(p.product_nbr);
        existingMap.set(p.product_nbr, {
          ...existing,
          ...p,
          in_catalog:
            existing && existing.in_catalog !== undefined && existing.in_catalog !== null
              ? existing.in_catalog
              : 1,
        });
      }

      state.setD1Products(
        Array.from(existingMap.values()).sort((a, b) => a.product_nbr - b.product_nbr),
      );
    }
  }

  return { syncSqlToClassicProducts, syncD1ToClassicProducts, syncClassicToSqlProducts };
}
