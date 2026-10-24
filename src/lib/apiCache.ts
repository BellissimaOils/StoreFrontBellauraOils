// Instant In-Memory Cache for API Requests
// Deduplicates concurrent in-flight requests and provides a short in-memory cache
// to prevent duplicate fetches across concurrent component mounts while ensuring
// changes made in the Admin Dashboard propagate rapidly to the Storefront.

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const pendingRequests = new Map<string, Promise<any>>();

// The direct product HTML can carry the requested product. Seed the same
// endpoint cache so startup prefetch and the provider do not download it again.
if (typeof window !== "undefined" && (window as any).__INITIAL_PRODUCT__) {
  const id = window.location.pathname.split("/")[2];
  if (id) cache.set(`/api/products/${id}`, {
    data: { success: true, product: (window as any).__INITIAL_PRODUCT__ }, timestamp: Date.now(),
  });
}


// Short 3s TTL to deduplicate concurrent component mounts without holding stale data
const DEFAULT_TTL = 3000;

// Clean up any legacy sessionStorage entries from previous versions
if (typeof window !== "undefined" && window.sessionStorage) {
  try {
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith("bellaura_cache_")) {
        sessionStorage.removeItem(key);
      }
    });
  } catch {}
}

export async function fetchWithCache<T = any>(
  url: string,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  const cached = cache.get(url);
  const now = Date.now();

  // Return cached data immediately if within short TTL
  if (cached && now - cached.timestamp < ttl) {
    return cached.data;
  }

  // Deduplicate inflight requests
  if (pendingRequests.has(url)) {
    return pendingRequests.get(url)!;
  }

  const fetchPromise = fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      cache.set(url, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      pendingRequests.delete(url);
    });

  pendingRequests.set(url, fetchPromise);
  return fetchPromise;
}

export function getCachedSync<T = any>(url: string, ttl: number = DEFAULT_TTL): T | null {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  return null;
}

// Warm up / Prefetch critical endpoints based on current route
export function prefetchAppInitialData() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  const warm = (url: string) => { void fetchWithCache(url).catch(() => {}); };

  // Keep the active route's critical request alone at startup. On Home, the
  // homepage section response is what reveals the real Hero image URL; warming
  // settings/SEO sections at the same time competes with that critical request.
  if (path === "/" || path === "") {
    const serverSectionsAvailable = Array.isArray((window as any).__INITIAL_HOMEPAGE_SECTIONS__)
      && (window as any).__INITIAL_HOMEPAGE_SECTIONS__.length > 0;
    // If the server already supplied the Hero configuration, do not refresh it
    // until after the preloaded Hero image is ready. Otherwise this is the one
    // critical request we start immediately on a cold Home visit.
    if (!serverSectionsAvailable) warm("/api/homepage-sections");
    let secondaryStarted = false;
    const deferSecondary = () => {
      if (secondaryStarted) return;
      secondaryStarted = true;
      const run = () => {
        if (serverSectionsAvailable) warm("/api/homepage-sections");
        warm("/api/sections");
        warm("/api/store-settings");
      };
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 5000 });
      else window.setTimeout(run, 1800);
    };
    window.addEventListener("bellaura:hero-ready", deferSecondary, { once: true });
    // Safety fallback if the Hero image fails or the Home route has no Hero.
    window.setTimeout(() => {
      if (!document.querySelector('[data-home-hero-ready="true"]')) deferSecondary();
    }, 6000);
  } else if (path.startsWith("/product/")) {
    const id = path.split("/").filter(Boolean)[1];
    if (id) warm(`/api/products/${encodeURIComponent(id)}`);
    // Product content is the critical path on direct product visits.
    const runSecondary = () => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => { warm("/api/store-settings"); }, { timeout: 4000 });
      } else window.setTimeout(() => warm("/api/store-settings"), 2000);
    };
    window.setTimeout(runSecondary, 1500);
  } else if (path === "/faq") {
    warm("/api/faq");
    warm("/api/store-settings");
  } else {
    // A section page needs its own product list right away: start it together
    // with /api/sections instead of after the JS bundle has mounted the page.
    const slug = path.replace(/^\/+|\/+$/g, "").toLowerCase();
    if (["products", "skin", "hair-and-scalp", "packs"].includes(slug)) {
      void fetchWithCache(`/api/products/section/${slug}`, 30_000).catch(() => {});
    }
    warm("/api/sections");
    warm("/api/store-settings");
  }
}

export function clearCache(url?: string) {
  if (url) {
    cache.delete(url);
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        sessionStorage.removeItem(`bellaura_cache_${url}`);
      } catch {}
    }
  } else {
    cache.clear();
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith("bellaura_cache_")) {
            sessionStorage.removeItem(key);
          }
        }
      } catch {}
    }
  }
}

/**
 * Returns true if a fetch for `url` is currently in-flight (started but not
 * yet resolved). Useful for callers that want to know whether prefetched data
 * is on its way without having to await it themselves.
 */
export function isPending(url: string): boolean {
  return pendingRequests.has(url);
}
