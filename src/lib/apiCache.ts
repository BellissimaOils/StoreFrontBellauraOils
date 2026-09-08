// Instant In-Memory Cache for API Requests (Stale-While-Revalidate)
// Guarantees fast loading time when navigating to Home or specific sections.

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const pendingRequests = new Map<string, Promise<any>>();
// 10s, down from 30s. This is the last link in the chain that made an admin
// change take "10 to 30 seconds" to show up: even once the server was serving
// fresh data, an already-open tab kept answering from this in-memory copy for
// up to 30s, and revalidateBackground() below refreshes the Map without telling
// React, so nothing re-rendered until something else triggered a fetch.
// In-flight requests are still de-duplicated, so the extra requests this costs
// are one per endpoint per 10s at worst.
const DEFAULT_TTL = 1000 * 30; // 30 seconds

function readSessionCache<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = sessionStorage.getItem(`bellaura_cache_${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.timestamp === "number" && parsed.data) {
      return parsed;
    }
  } catch {}
  return null;
}

function writeSessionCache(key: string, entry: CacheEntry<any>) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    sessionStorage.setItem(`bellaura_cache_${key}`, JSON.stringify(entry));
  } catch {}
}

export async function fetchWithCache<T = any>(
  url: string,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  const cached = cache.get(url) || readSessionCache<T>(url);
  const now = Date.now();

  // Return cached data immediately if available and fresh
  if (cached && now - cached.timestamp < ttl) {
    if (!cache.has(url)) {
      cache.set(url, cached);
    }
    // Background revalidate if past 70% of TTL
    if (now - cached.timestamp > ttl * 0.7) {
      revalidateBackground(url);
    }
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
      const entry = { data, timestamp: Date.now() };
      cache.set(url, entry);
      writeSessionCache(url, entry);
      return data;
    })
    .finally(() => {
      pendingRequests.delete(url);
    });

  pendingRequests.set(url, fetchPromise);
  return fetchPromise;
}

export function getCachedSync<T = any>(url: string, ttl: number = DEFAULT_TTL): T | null {
  const cached = cache.get(url) || readSessionCache<T>(url);
  if (cached && Date.now() - cached.timestamp < ttl) {
    if (!cache.has(url)) {
      cache.set(url, cached);
    }
    return cached.data;
  }
  return null;
}

function revalidateBackground(url: string) {
  if (pendingRequests.has(url)) return;
  const p = fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
  })
    .then((res) => res.json())
    .then((data) => {
      cache.set(url, { data, timestamp: Date.now() });
    })
    .catch(() => {})
    .finally(() => {
      pendingRequests.delete(url);
    });
  pendingRequests.set(url, p);
}

// Warm up / Prefetch critical endpoints based on current route
export function prefetchAppInitialData() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;

  if (path.startsWith("/product/")) {
    // When accessing a direct product link, give THIS product top priority!
    // Prefetch this specific product's extended data and review summary immediately.
    const parts = path.split("/").filter(Boolean);
    const productId = parts[1];
    if (productId) {
      fetchWithCache(`/api/products/${productId}/data`);
    }
    fetchWithCache("/api/reviews/summary");
    fetchWithCache("/api/sections");

    // Defer the full catalog fetch so network bandwidth is 100% dedicated to
    // the requested product's hero images and details.
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => fetchWithCache("/api/products"), { timeout: 2500 });
    } else {
      setTimeout(() => fetchWithCache("/api/products"), 1500);
    }
  } else {
    // Always fetch products and nav sections (needed everywhere else)
    fetchWithCache("/api/products");
    fetchWithCache("/api/sections");

    if (path === "/" || path === "") {
      // Only prefetch homepage sections when on the homepage
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
