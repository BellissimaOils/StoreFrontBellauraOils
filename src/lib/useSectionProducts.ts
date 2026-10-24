import { useEffect, useState } from "react";
import { fetchWithCache, getCachedSync } from "./apiCache";
import { applyRatingSummary } from "../context/ProductContext";
import type { Product } from "../types";

/**
 * Products of a single section page (/products, /skin, /hair-and-scalp, /packs
 * or an admin-created section).
 *
 * Section pages used to call useProducts(true), which downloads the ENTIRE
 * catalogue - every product of every section with all its long text - and then
 * filtered it in the browser. The first section a visitor opened paid for all
 * of them; only later sections were instant because the data was already there.
 * Now each page asks the server for just its own products, and the lists are
 * kept in memory so going back to a section you already saw shows it at once
 * (it is refreshed in the background).
 */

const TTL_MS = 30_000;
const sectionUrl = (slug: string) => `/api/products/section/${encodeURIComponent(slug || "products")}`;

/** Last known list per slug, any age. Used to paint instantly while revalidating. */
const memory = new Map<string, Product[]>();

async function loadProducts(slug: string): Promise<Product[]> {
  const data = await fetchWithCache(sectionUrl(slug), TTL_MS);
  if (!data?.success || !Array.isArray(data.products)) throw new Error("Section products unavailable");
  const list: Product[] = data.products;
  memory.set(slug, list);
  return list;
}

/** Stars/review counts. Separate step so it never delays the first paint. */
async function loadRated(slug: string, list: Product[]): Promise<Product[] | null> {
  try {
    const summary = await fetchWithCache("/api/reviews/summary");
    if (!summary?.success || !summary.summary) return null;
    const rated = applyRatingSummary(list, summary.summary) as Product[];
    memory.set(slug, rated);
    return rated;
  } catch {
    return null; // cards simply show no stars yet
  }
}

/**
 * Warm a section in the background (nav hover, idle time). Never throws.
 * Products only: ratings are fetched when the page actually opens, so warming
 * four sections does not mean four review-summary requests.
 */
export function prefetchSection(slug: string): Promise<unknown> {
  return loadProducts(slug).catch(() => {});
}

/** Memory first, then whatever the startup prefetch already put in the request cache. */
function initialList(slug: string): Product[] | undefined {
  const known = memory.get(slug);
  if (known) return known;
  const cached = getCachedSync<any>(sectionUrl(slug), TTL_MS);
  return cached?.success && Array.isArray(cached.products) ? cached.products : undefined;
}

export function useSectionProducts(slug: string, enabled = true) {
  const [products, setProducts] = useState<Product[]>(() => initialList(slug) ?? []);
  const [loaded, setLoaded] = useState(() => initialList(slug) !== undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const known = initialList(slug);
    setProducts(known ?? []);
    setLoaded(Boolean(known));
    setFailed(false);
    if (!enabled) return;
    let active = true;
    loadProducts(slug)
      .then((list) => {
        if (active) { setProducts(list); setLoaded(true); }
        return loadRated(slug, list);
      })
      .then((rated) => { if (active && rated) setProducts(rated); })
      .catch((error) => {
        console.error("Failed to load section products", error);
        if (active) { setFailed(true); setLoaded(true); }
      });
    return () => { active = false; };
  }, [slug, enabled]);

  return { products, loaded, failed };
}
