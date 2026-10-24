import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Product } from '../types';
import { fetchWithCache, getCachedSync } from '../lib/apiCache';
import { matchesProduct } from '../lib/productMatch';

interface ProductContextType {
  products: Product[];
  featuredProducts: Product[];
  featuredLoading: boolean;
  storeSettings: any;
  loading: boolean;
  productError: boolean;
  fetchProducts: () => void;
  fetchFeaturedProducts: () => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setStoreSettings: React.Dispatch<React.SetStateAction<any>>;
}
const CATALOG_STORAGE_KEY = 'bellaura_catalog_cache_v1';
const CATALOG_STORAGE_MAX_AGE = 10 * 60 * 1000;
function readStoredCatalog(): Product[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.products) || Date.now() - Number(parsed.savedAt || 0) > CATALOG_STORAGE_MAX_AGE) return [];
    return parsed.products;
  } catch { return []; }
}

const ProductContext = createContext<ProductContextType>({
  products: [], featuredProducts: [], featuredLoading: false, storeSettings: {}, loading: true, productError: false,
  fetchProducts: () => {}, fetchFeaturedProducts: () => {}, setProducts: () => {}, setStoreSettings: () => {},
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
  const { pathname } = useLocation();
  const productId = pathname.startsWith('/product/') ? decodeURIComponent(pathname.split('/')[2] || '') : '';
  const [products, setProducts] = useState<Product[]>(() => {
    const initial = (window as any).__INITIAL_PRODUCT__;
    if (initial && matchesProduct(initial, productId)) return [initial];
    return readStoredCatalog();
  });
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>(() =>
    getCachedSync<any>('/api/products/featured', 30_000)?.products || [],
  );
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [storeSettings, setStoreSettings] = useState<any>(() => getCachedSync<any>('/api/store-settings')?.storeSettings || {});
  const [catalogLoading, setCatalogLoading] = useState(() => readStoredCatalog().length === 0);
  const [resolvedProduct, setResolvedProduct] = useState('');
  const [failedProduct, setFailedProduct] = useState('');
  const catalogRequested = useRef(false);
  const featuredRequested = useRef(false);
  const ratingSummaryRef = useRef<RatingSummary | null>(null);

  useEffect(() => {
    let active = true;
    fetchWithCache('/api/store-settings').then(data => {
      if (active && data?.storeSettings) setStoreSettings(data.storeSettings);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // A direct product visit requests one product, regardless of the catalog size.
  useEffect(() => {
    if (!productId) return;
    let active = true;
    setFailedProduct('');
    fetchWithCache(`/api/products/${encodeURIComponent(productId)}`).then(data => {
      if (!active) return;
      if (data?.success && data.product) {
        setProducts(previous => [...previous.filter(p => String(p.id) !== String(data.product.id)), data.product]);
        void fetchWithCache('/api/reviews/summary').then(summary => {
          if (!active || !summary?.success || !summary.summary) return;
          ratingSummaryRef.current = summary.summary;
          setProducts(previous => applyRatingSummary(previous, summary.summary));
        }).catch(() => {});
      }
    }).catch(error => {
      if (!active) return;
      if (error instanceof Error && error.message === 'HTTP error 404') {
        setProducts(previous => previous.filter(p => !matchesProduct(p, productId)));
      } else setFailedProduct(productId);
    }).finally(() => { if (active) setResolvedProduct(productId); });
    return () => { active = false; };
  }, [productId]);

  // Called by catalog consumers only (a visible collection, listing, or cart).
  const fetchProducts = useCallback(() => {
    if (catalogRequested.current) return;
    catalogRequested.current = true;
    // A recent session catalog is rendered immediately; refresh it in the background.
    const hasUsableCatalog = products.length > 0;
    if (!hasUsableCatalog) setCatalogLoading(true);
    fetchWithCache('/api/products').then(data => {
      if (!data?.success || !Array.isArray(data.products)) throw new Error('Catalog unavailable');
      const nextProducts = applyRatingSummary(data.products, ratingSummaryRef.current);
      setProducts(nextProducts);
      try { window.sessionStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify({ products: nextProducts, savedAt: Date.now() })); } catch {}
      if (data.storeSettings) setStoreSettings(data.storeSettings);
      // Ratings never delay the catalog's first render.
      void fetchWithCache('/api/reviews/summary').then(data => {
        if (!data?.success || !data.summary) return;
        ratingSummaryRef.current = data.summary;
        setProducts(previous => applyRatingSummary(previous, data.summary));
      }).catch(() => {});
    }).catch(error => {
      catalogRequested.current = false;
      console.error('Failed to load catalog', error);
    }).finally(() => setCatalogLoading(false));
  }, [products.length]);

  // Warm the full catalog after the homepage has had time to paint, so moving to a
  // product/category section usually uses cached data instead of waiting for D1.
  useEffect(() => {
    if (pathname !== '/' || products.length > 0) return;
    let cancelled = false;
    const run = () => { if (!cancelled) fetchProducts(); };
    const idleWindow = window as any;
    const idleId = typeof idleWindow.requestIdleCallback === 'function'
      ? idleWindow.requestIdleCallback(run, { timeout: 1800 })
      : window.setTimeout(run, 1200);
    return () => { cancelled = true; if (typeof idleWindow.cancelIdleCallback === 'function') idleWindow.cancelIdleCallback(idleId); else window.clearTimeout(idleId); };
  }, [pathname, products.length, fetchProducts]);

  const fetchFeaturedProducts = useCallback(() => {
    if (featuredRequested.current) return;
    featuredRequested.current = true;
    setFeaturedLoading(true);
    fetchWithCache('/api/products/featured', 30_000).then(data => {
      if (!data?.success || !Array.isArray(data.products)) throw new Error('Featured products unavailable');
      setFeaturedProducts(data.products);
      void fetchWithCache('/api/reviews/summary').then(summary => {
        if (!summary?.success || !summary.summary) return;
        ratingSummaryRef.current = summary.summary;
        setFeaturedProducts(previous => applyRatingSummary(previous, summary.summary));
      }).catch(() => {});
    }).catch(error => {
      featuredRequested.current = false;
      console.error('Failed to load featured products', error);
    }).finally(() => setFeaturedLoading(false));
  }, []);

  const loading = productId
    ? resolvedProduct !== productId && !products.some(p => matchesProduct(p, productId))
    : catalogLoading;
  const productError = Boolean(productId && failedProduct === productId);
  const value = useMemo(() => ({ products, featuredProducts, featuredLoading, storeSettings, loading, productError,
    fetchProducts, fetchFeaturedProducts, setProducts, setStoreSettings }),
    [products, featuredProducts, featuredLoading, storeSettings, loading, productError, fetchProducts, fetchFeaturedProducts]);
  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProducts(requireCatalog = false) {
  const context = useContext(ProductContext);
  useEffect(() => {
    if (requireCatalog) context.fetchProducts();
  }, [requireCatalog, context.fetchProducts]);
  return context;
}
