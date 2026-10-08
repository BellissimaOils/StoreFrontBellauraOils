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

  if (path.startsWith("/product/")) {
    const parts = path.split("/").filter(Boolean);
    const productId = parts[1];
    if (productId) {
      fetchWithCache(`/api/products/${productId}/data`);
    }
    fetchWithCache("/api/reviews/summary");
    fetchWithCache("/api/sections");

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => fetchWithCache("/api/products"), { timeout: 2500 });
    } else {
      setTimeout(() => fetchWithCache("/api/products"), 1500);
    }
  } else {
    fetchWithCache("/api/products");
    fetchWithCache("/api/sections");

    if (path === "/" || path === "") {
      fetchWithCache("/api/homepage-sections");
      fetchWithCache("/api/reviews/summary");
    } else if (path === "/faq") {
      fetchWithCache("/api/faq");
    }
  }
}

export function clearCache(url?: string) {
  if (url) {
    cache.delete(url);
  } else {
    cache.clear();
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
