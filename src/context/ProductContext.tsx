import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Product } from '../types';
import { fetchWithCache, getCachedSync } from '../lib/apiCache';

interface ProductContextType {
  products: Product[];
  storeSettings: any;
  loading: boolean;
  fetchProducts: () => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setStoreSettings: React.Dispatch<React.SetStateAction<any>>;
}

const ProductContext = createContext<ProductContextType>({ 
  products: [],
  storeSettings: {},
  loading: true, 
  fetchProducts: () => {}, 
  setProducts: () => {},
  setStoreSettings: () => {} 
});

/** Ratings keyed by lowercased product reference, as /api/reviews/summary returns them. */
type RatingSummary = Record<string, { count: number; rating: string }>;

/**
 * Copies each product's rating and review count out of the summary.
 *
 * Reviews name their product by id or by name depending on how the review was
 * created, so every reference a product answers to is tried in turn.
 */
function applyRatingSummary(list: any[], summary: RatingSummary | null): any[] {
  if (!summary || list.length === 0) return list;
  const lookup = (value: any) => {
    const key = String(value ?? '').toLowerCase().trim();
    return key ? summary[key] : undefined;
  };
  return list.map((p: any) => {
    const entry = lookup(p.id) || lookup(p.name) || lookup(p.name_en);
    if (entry && entry.count > 0) {
      // rating stays the string the server formatted ("4.7"); consumers parse it.
      return { ...p, rating: entry.rating, reviews: entry.count };
    }
    // Absent from the summary means no visible reviews, so any rating the
    // product is carrying is cleared rather than left standing. Merging
    // additively meant hiding or deleting a product's last review left its
    // stars on screen until the tab was reloaded.
    if (p.rating === undefined && p.reviews === undefined) return p;
    return { ...p, rating: undefined, reviews: 0 };
  });
}

export function ProductProvider({ children }: { children: React.ReactNode }) {
  const initialCache = getCachedSync<any>('/api/products');
  const initialServerProduct = typeof window !== 'undefined' ? (window as any).__INITIAL_PRODUCT__ : null;

  const [products, setProducts] = useState<Product[]>(() => {
    // When the server flags a 404, don't populate from the localStorage cache.
    // The cached catalog may still contain an old slug (e.g. "-golden-jojoba-oil")
    // that would match the invalid URL, causing the product to render briefly
    // before the fresh API call corrects it. Start empty so the slug check in
    // ProductDetail immediately shows NotFoundPage.
    if (typeof window !== 'undefined' && (window as any).__INITIAL_NOT_FOUND__) {
      return [];
    }
    if (initialCache?.success && Array.isArray(initialCache.products) && initialCache.products.length > 0) {
      return initialCache.products;
    }
    if (initialServerProduct) {
      return [initialServerProduct];
    }
    return [];
  });

  const [storeSettings, setStoreSettings] = useState<any>(
    initialCache?.storeSettings || {}
  );

  const [loading, setLoading] = useState(() => {
    if (initialCache?.success && Array.isArray(initialCache.products) && initialCache.products.length > 0) {
      return false;
    }
    // Server flagged this as a 404 — no product exists, no spinner needed.
    if (typeof window !== 'undefined' && (window as any).__INITIAL_NOT_FOUND__) {
      return false;
    }
    if (initialServerProduct && typeof window !== 'undefined' && window.location.pathname.startsWith('/product/')) {
      return false;
    }
    return true;
  });

  // Survives across fetchProducts() calls, so a product refresh (after an admin
  // edit, say) re-applies the ratings instead of blanking every star.
  const ratingSummaryRef = useRef<RatingSummary | null>(null);

  const fetchProducts = useCallback(() => {
    // A server-flagged 404 has no product and never will — skip the fetch entirely.
    if (typeof window !== 'undefined' && (window as any).__INITIAL_NOT_FOUND__) {
      return;
    }

    const isDirectProductWithInitial =
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/product/') &&
      !!(window as any).__INITIAL_PRODUCT__;

    if (!getCachedSync('/api/products') && !isDirectProductWithInitial) {
      setLoading(true);
    }
    
    // Start both fetches in parallel, but do NOT make the product list wait
    // on reviews. Previously this awaited reviewsPromise before the first
    // setProducts() call, so the whole product grid stayed blank until BOTH
    // requests finished and a per-product review join (O(products x reviews)
    // in JS) had run — even though the products themselves had already
    // arrived. Now products render as soon as their own request resolves,
    // and ratings are patched in afterwards as a second, non-blocking update.
    //
    // The second request is the compact ratings summary, not the full review
    // list. This used to pull /api/reviews in its entirety on every first page
    // load — the single biggest payload in the app, growing with every review
    // ever written — purely to derive a star rating and a count per card. Worse,
    // the join below matched on r.product_id / r.product_name, which public
    // review objects don't carry (they reference products through a `products`
    // array), so it always found nothing and the whole download was wasted.
    const productsPromise = fetchWithCache('/api/products');
    const summaryPromise = fetchWithCache('/api/reviews/summary').catch(() => null);

    productsPromise
      .then((data) => {
        if (data && data.success) {
          if (data.storeSettings) setStoreSettings(data.storeSettings);
          if (data.products && Array.isArray(data.products)) {
            // Ratings applied here too, not only in the summary handler below.
            //
            // This is why stars and review counts were missing everywhere. The
            // two requests race, and the summary is a tiny response while
            // /api/products is the largest one on the site — so the summary
            // almost always won. Its handler then called
            // `setProducts(prev => prev.length === 0 ? prev : ...)`, found an
            // empty list because the products hadn't arrived yet, and returned
            // it unchanged. The ratings were dropped on the floor and never
            // retried, so every product rendered as if it had no reviews.
            //
            // Whichever lands first now stores its half and the merge happens
            // when the second one arrives.
            setProducts(applyRatingSummary(data.products, ratingSummaryRef.current));
          } else {
            setProducts([]);
          }
        } else {
          setProducts([]);
        }
      })
      .catch((err) => {
        console.error("Failed to load products from DB", err);
      })
      .finally(() => {
        setLoading(false);
      });

    // Attach rating/review-count once the summary arrives, without blocking the
    // initial render above. The summary is keyed by lowercased product
    // reference — reviews name their products by id or by name, so try each of
    // the ones this product answers to.
    summaryPromise
      .then((summaryData) => {
        if (!summaryData || !summaryData.success || !summaryData.summary) return;
        // Kept so the products handler can use it whichever order they resolve
        // in, and so a later product refresh doesn't lose the ratings again.
        ratingSummaryRef.current = summaryData.summary;
        setProducts((prev) =>
          prev.length === 0 ? prev : applyRatingSummary(prev, summaryData.summary),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const value = useMemo(() => ({
    products, storeSettings, loading, fetchProducts, setProducts, setStoreSettings
  }), [products, storeSettings, loading, fetchProducts]);

  return (
    <ProductContext.Provider value={value}>
      {children}
    </ProductContext.Provider>
  );
}

export function useProducts() {
  return useContext(ProductContext);
}
