import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { ClerkProvider } from "./lib/clerk";
import { ClerkErrorBoundary } from "./components/ClerkErrorBoundary";
import { prefetchAppInitialData } from "./lib/apiCache";

// Kick off instant background prefetching for home and section endpoints
prefetchAppInitialData();

// Always use the backend as the source of truth for all data.
// Clear ALL stale localStorage mock-emulator caches on startup to prevent any
// old/offline/hardcoded data from overriding real data from the backend server.
// These keys are only used as an offline fallback and persist across browser sessions.
try {
  const MOCK_CACHE_KEYS = [
    "bellaura_local_products",
    "bellaura_local_reviews",
    "bellaura_local_tokens",
    "bellaura_local_orders",
    "bellaura_local_coupons",
    "bellaura_local_images",
  ];
  MOCK_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
} catch {/* ignore if localStorage is unavailable */}


// --- PERFORMANCE LOGGING (DEV ONLY) ---
if (import.meta.env.DEV && typeof window !== "undefined") {
  try {
    // 1. Largest Contentful Paint (LCP)
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      console.log(
        `[Performance] LCP: ${lastEntry.startTime.toFixed(2)}ms`,
        lastEntry,
      );
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });

    // 2. Resource Timing (Images)
    const resourceObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      entries.forEach((entry: any) => {
        if (entry.initiatorType === "img" && entry.name.includes("r2")) {
          const ttfb = entry.responseStart - entry.requestStart;
          const downloadTime = entry.responseEnd - entry.responseStart;
          console.log(
            `[Performance] Image Load (${entry.name}): TTFB=${ttfb.toFixed(2)}ms, Download=${downloadTime.toFixed(2)}ms, Total=${entry.duration.toFixed(2)}ms`,
          );
        }
      });
    });
    resourceObserver.observe({ type: "resource", buffered: true });
  } catch (e) {
    console.warn("PerformanceObserver not supported", e);
  }
}
// ---------------------------

// Catch and suppress benign Vite WebSocket connection errors to prevent annoying visual error overlays/prompts
if (typeof window !== "undefined") {
  // Silence console methods from logging Vite HMR/WebSocket connection errors
  const isWebsocketOrViteNoise = (args: any[]) => {
    try {
      const merged = args
        .map((arg) => {
          if (typeof arg === "string") return arg;
          if (arg instanceof Error) return arg.message || String(arg);
          return String(arg);
        })
        .join(" ")
        .toLowerCase();

      return (
        merged.includes("websocket") ||
        merged.includes("[vite] connect") ||
        merged.includes("failed to connect") ||
        merged.includes("connection failed") ||
        merged.includes("hmr")
      );
    } catch {
      return false;
    }
  };

  const originalError = console.error;
  console.error = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalError.apply(console, args);
  };

  const originalWarn = console.warn;
  console.warn = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalWarn.apply(console, args);
  };

  const originalLog = console.log;
  console.log = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalLog.apply(console, args);
  };

  const originalDebug = console.debug;
  console.debug = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalDebug.apply(console, args);
  };

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      const reason = String(event.reason?.message || event.reason || "");
      if (
        reason.toLowerCase().includes("websocket") ||
        reason.toLowerCase().includes("vite") ||
        reason.toLowerCase().includes("failed to connect to websocket")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  window.addEventListener(
    "error",
    (event) => {
      const msg = String(event.message || "");
      if (
        msg.toLowerCase().includes("websocket") ||
        msg.toLowerCase().includes("vite") ||
        msg.toLowerCase().includes("failed to connect to websocket")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}

// ==========================================
// CLIENT-SIDE LOCAL STORAGE API FALLBACK
// ==========================================
interface LocalReview {
  id: string;
  name: string;
  rating: number;
  comment: string;
  image: string | null;
  date: string;
  tokenUsed: string;
  clientComment: string;
  products: string[];
}

interface LocalProduct {
  id: string;
  name: string;
  category: string;
  price: string;
  discountPrice?: string;
  isAvailable: boolean;
  image: string;
  description?: string;
  benefits?: string[];
  usage?: string;
  ingredients?: string[];
  orderIndex?: number;
  tag?: string;
}

interface LocalToken {
  id: string;
  token: string;
  status: "pending" | "submitted";
  createdAt: string;
  usedAt?: string;
  comment?: string;
  products: string[];
}

interface LocalOrder {
  id: string;
  orderNbr: string;
  customer: any;
  items: any[];
  total: number;
  appliedCoupon: any;
  discountAmount: number;
  subtotalPrice: number;
  status: string;
  comment?: string;
  createdAt: string;
}

interface LocalCoupon {
  id: string;
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  isActive: boolean;
  expiresAt?: string | null;
  minCartAmount?: number | null;
  applicableProducts?: string[] | null;
}

const dbData = {
  products: [] as any[],
  uploadedImages: [] as string[],
  reviews: [] as any[],
  tokens: [] as any[],
  orders: [] as any[],
  coupons: [] as any[],
};

// Check if we should activate client-side API simulation
const useLocalSimulation = () => {
  return false; // we always try fetch first, then fallback
};

// Local storage keys
const KEYS = {
  PRODUCTS: "bellaura_local_products",
  REVIEWS: "bellaura_local_reviews",
  TOKENS: "bellaura_local_tokens",
  ORDERS: "bellaura_local_orders",
  COUPONS: "bellaura_local_coupons",
  IMAGES: "bellaura_local_images",
};

// Initializers
const getLocalImages = (): string[] => {
  const stored = localStorage.getItem(KEYS.IMAGES);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) {
        // Automatically migrate any old root /images/ paths to new /images/CarrierOils/ paths if they match the DB
        let updated = false;
        const migrated = parsed.map((img: string) => {
          if (
            img &&
            typeof img === "string" &&
            img.startsWith("/images/") &&
            !img.includes("/CarrierOils/") &&
            !img.includes("/Packs/")
          ) {
            const filename = img.split("/").pop();
            const matchInDB = (dbData as any).uploadedImages?.find(
              (dbImg: string) => dbImg.endsWith(filename || ""),
            );
            if (matchInDB) {
              updated = true;
              return matchInDB;
            }
          }
          return img;
        });
        if (updated) {
          localStorage.setItem(KEYS.IMAGES, JSON.stringify(migrated));
        }
        return migrated;
      }
    } catch (e) {}
  }
  const initial = (dbData as any).uploadedImages || [];
  localStorage.setItem(KEYS.IMAGES, JSON.stringify(initial));
  return initial;
};
const getLocalProducts = (): LocalProduct[] => {
  const mapOldToNew = (products: LocalProduct[]) => {
    let updated = false;
    products.forEach((p) => {
      // 1. Sync with the real updated database.json representation
      const matchingP = dbData.products.find((fp) => fp.id === p.id);
      if (matchingP && p.image !== matchingP.image) {
        p.image = matchingP.image;
        updated = true;
      }

      // 2. Extra safety mapping for general /images/ paths that should use /images/CarrierOils
      if (
        p.image &&
        typeof p.image === "string" &&
        p.image.startsWith("/images/") &&
        !p.image.includes("/CarrierOils/") &&
        !p.image.includes("/Packs/")
      ) {
        const filename = p.image.split("/").pop();
        const matchInDB = (dbData as any).uploadedImages?.find(
          (dbImg: string) => dbImg.endsWith(filename || ""),
        );
        if (matchInDB) {
          p.image = matchInDB;
          updated = true;
        }
      }
    });
    if (updated) {
      localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
    }
    return products;
  };

  const stored = localStorage.getItem(KEYS.PRODUCTS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) {
        const list = mapOldToNew(parsed);
        list.sort((a, b) => {
          const aOrd = a.orderIndex !== undefined ? Number(a.orderIndex) : 0;
          const bOrd = b.orderIndex !== undefined ? Number(b.orderIndex) : 0;
          return aOrd - bOrd;
        });
        return list;
      }
    } catch (e) {
      // ignore
    }
  }

  const initial = (dbData.products as unknown as LocalProduct[]).map((p, idx) => ({
    ...p,
    orderIndex: p.orderIndex !== undefined ? p.orderIndex : idx
  }));
  initial.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
  localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(initial));
  return initial;
};

const getLocalReviews = (): LocalReview[] => {
  const stored = localStorage.getItem(KEYS.REVIEWS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) return parsed;
    } catch (e) {}
  }
  const initial: LocalReview[] =
    ((dbData as any).reviews as unknown as LocalReview[]) || [];
  localStorage.setItem(KEYS.REVIEWS, JSON.stringify(initial));
  return initial;
};

const getLocalTokens = (): LocalToken[] => {
  const stored = localStorage.getItem(KEYS.TOKENS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) return parsed;
    } catch (e) {}
  }
  const initial: LocalToken[] =
    (dbData.tokens as unknown as LocalToken[]) || [];
  localStorage.setItem(KEYS.TOKENS, JSON.stringify(initial));
  return initial;
};

const getLocalOrders = (): LocalOrder[] => {
  const stored = localStorage.getItem(KEYS.ORDERS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) return parsed;
    } catch (e) {}
  }
  const initial: LocalOrder[] =
    (dbData.orders as unknown as LocalOrder[]) || [];
  localStorage.setItem(KEYS.ORDERS, JSON.stringify(initial));
  return initial;
};

const getLocalCoupons = (): LocalCoupon[] => {
  const stored = localStorage.getItem(KEYS.COUPONS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.length > 0) return parsed;
    } catch (e) {}
  }
  const initial: LocalCoupon[] =
    (dbData.coupons as unknown as LocalCoupon[]) || [];
  localStorage.setItem(KEYS.COUPONS, JSON.stringify(initial));
  return initial;
};

const generateUUID = () => {
  return "xxxx-xxxx-xxxx-xxxx".replace(/[x]/g, () =>
    ((Math.random() * 16) | 0).toString(16),
  );
};

// Get configured backend API base URL for decoupled static hosts (like Cloudflare Pages)
const getBackendUrl = (): string => {
  try {
    const stored = localStorage.getItem("bellaura_backend_api_url");
    if (stored) return stored.trim().replace(/\/$/, "");
  } catch {}
  const viteUrl = ((import.meta as any).env?.VITE_API_URL as string) || "";
  if (viteUrl) {
    return viteUrl.trim().replace(/\/$/, "");
  }
  return "";
};

// Override fetch API to support dynamic localStorage fallback safely and transparently
const originalFetch = window.fetch;
Object.defineProperty(window, "fetch", {
  configurable: true,
  writable: true,
  value: async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const startTime = performance.now();

    // Intercept all API endpoints if simulation is active or if real API fails/redirects to index.html
    if (urlStr.includes("/api/")) {
      const isLocalSim = useLocalSimulation();

      // Determine final target URL (absolute if dynamic API is configured)
      const bUrl = getBackendUrl();
      let finalInput = input;
      if (
        bUrl &&
        (urlStr.startsWith("/") ||
          (urlStr.startsWith("http") &&
            new URL(urlStr).origin === window.location.origin))
      ) {
        const relativePath = urlStr.startsWith("/")
          ? urlStr
          : new URL(urlStr).pathname;
        const queryString = urlStr.includes("?")
          ? urlStr.substring(urlStr.indexOf("?"))
          : "";
        finalInput = `${bUrl}${relativePath}${queryString}`;
      }

      // Attempt standard fetch first if not on netlify
      if (!isLocalSim) {
        try {
          const response = await originalFetch(finalInput, init);
          const duration = performance.now() - startTime;
          if (urlStr.includes("/api/products")) {
            console.log(
              `[Performance] Product Query Time: ${duration.toFixed(2)}ms`,
            );
          } else {
            console.log(
              `[Performance] API Call (${urlStr}): ${duration.toFixed(2)}ms`,
            );
          }

          // If response is valid JSON (not HTML-fallback from router), return it
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            // If the backend returns 401 for admin routes, clear the stored token
            // but do NOT reload the page — let the component handle the auth state
            if (response.status === 401 && urlStr.includes("/api/admin")) {
              localStorage.removeItem("adminToken");
              // Dispatch a custom event so components can react without page reload
              window.dispatchEvent(new Event("adminTokenExpired"));
            }
            return response;
          }
        } catch (err) {
          console.warn(
            "Express API failed, falling back to mock emulator (no cached data — localStorage cleared on startup).",
            err,
          );
        }
      }

      // --- MOCK RESPONSE EMULATOR ---
      const method = init?.method?.toUpperCase() || "GET";
      const bodyObj =
        init?.body && typeof init.body === "string"
          ? JSON.parse(init.body)
          : {};

      let path = urlStr;
      if (path.startsWith("http")) {
        const parsedUrl = new URL(path);
        path = parsedUrl.pathname;
      } else {
        path = path.split("?")[0];
      }

      // Helper to construct a Mock Response
      const jsonResponse = (data: any, status: number = 200) => {
        const blob = new Blob([JSON.stringify(data)], {
          type: "application/json",
        });
        return new Response(blob, {
          status,
          headers: { "Content-Type": "application/json" },
        });
      };

      try {
        // Admin access is Clerk-only now — the offline mock no longer
        // fakes a username/password admin login.

        // 2. Reviews endpoints
        if (path === "/api/reviews" && method === "GET") {
          // `path` has its query string stripped above, so the filters have to be
          // read back off the original URL. They must be honoured: the product
          // page no longer filters reviews client-side (the server does it), so
          // returning everything here would list every review in the store under
          // "verified reviews for this product only" and make the rating
          // dropdown inert whenever the emulator is answering.
          const reviewQuery = new URLSearchParams(
            urlStr.includes("?") ? urlStr.slice(urlStr.indexOf("?") + 1) : "",
          );
          const wantedRefs = ["productId", "productName", "productNameEn"]
            .map((key) => (reviewQuery.get(key) || "").toLowerCase().trim())
            .filter(Boolean);
          const wantedRating = reviewQuery.get("rating")
            ? parseInt(String(reviewQuery.get("rating")), 10)
            : null;

          let localReviews = getLocalReviews();
          if (wantedRefs.length) {
            localReviews = localReviews.filter(
              (review) =>
                Array.isArray(review.products) &&
                review.products.some((ref: any) =>
                  wantedRefs.includes(String(ref ?? "").toLowerCase().trim()),
                ),
            );
          }
          if (wantedRating !== null && Number.isFinite(wantedRating)) {
            localReviews = localReviews.filter(
              (review) => Math.round(Number((review as any).rating) || 0) === wantedRating,
            );
          }

          const total = localReviews.length;
          const offsetParam = parseInt(String(reviewQuery.get("offset") || "0"), 10);
          const start = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.min(offsetParam, total) : 0;
          const limitParam = parseInt(String(reviewQuery.get("limit") || ""), 10);
          const windowed =
            Number.isFinite(limitParam) && limitParam > 0
              ? localReviews.slice(start, start + limitParam)
              : localReviews.slice(start);

          return jsonResponse({
            success: true,
            reviews: windowed,
            total,
            offset: start,
            hasMore: start + windowed.length < total,
          });
        }

        if (path === "/api/reviews/summary" && method === "GET") {
          // Same aggregate shape as the server route: { [productRef]: { count, rating } }.
          const acc: Record<string, { count: number; sum: number }> = {};
          for (const review of getLocalReviews()) {
            const rating = Number((review as any).rating);
            if (!Array.isArray(review.products) || !Number.isFinite(rating) || rating <= 0) continue;
            const seen = new Set<string>();
            for (const ref of review.products) {
              const key = String(ref ?? "").toLowerCase().trim();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              acc[key] = acc[key] || { count: 0, sum: 0 };
              acc[key].count += 1;
              acc[key].sum += rating;
            }
          }
          const summary: Record<string, { count: number; rating: number }> = {};
          for (const key of Object.keys(acc)) {
            summary[key] = {
              count: acc[key].count,
              rating: Number((acc[key].sum / acc[key].count).toFixed(1)),
            };
          }
          return jsonResponse({ success: true, summary });
        }

        if (path === "/api/reviews" && method === "POST") {
          const { token, name, rating, comment, image } = bodyObj;
          const tokens = getLocalTokens();
          const tokenIndex = tokens.findIndex((t) => t.token === token);

          if (tokenIndex === -1 || tokens[tokenIndex].status !== "pending") {
            return jsonResponse(
              { success: false, message: "Invalid or used token." },
              403,
            );
          }

          // Add review
          const reviews = getLocalReviews();
          const newReview: LocalReview = {
            id: generateUUID(),
            name,
            rating,
            comment,
            image: image || null,
            date: new Date().toISOString(),
            tokenUsed: token,
            clientComment: tokens[tokenIndex].comment || "",
            products: tokens[tokenIndex].products || [],
          };
          reviews.unshift(newReview);
          localStorage.setItem(KEYS.REVIEWS, JSON.stringify(reviews));

          // Consume token
          tokens[tokenIndex].status = "submitted";
          tokens[tokenIndex].usedAt = new Date().toISOString();
          localStorage.setItem(KEYS.TOKENS, JSON.stringify(tokens));

          return jsonResponse({
            success: true,
            message: "Review submitted successfully.",
          });
        }

        if (path.startsWith("/api/reviews/check-token/") && method === "GET") {
          const pathToken = path.split("/").pop() || "";
          const tokens = getLocalTokens();
          const tok = tokens.find((t) => t.token === pathToken);
          if (!tok || tok.status !== "pending") {
            return jsonResponse({ success: false, isValid: false }, 403);
          }
          return jsonResponse({
            success: true,
            isValid: true,
            products: tok.products,
            clientName: tok.comment,
          });
        }

        // 3. Tokens endpoints
        if (path === "/api/admin/tokens" && method === "GET") {
          return jsonResponse({ success: true, tokens: getLocalTokens() });
        }

        if (path === "/api/admin/generate-token" && method === "POST") {
          const { comment, products } = bodyObj;
          const tokenVal = "ORD-" + Math.floor(100000 + Math.random() * 900000);
          const tokens = getLocalTokens();
          const newToken: LocalToken = {
            id: generateUUID(),
            token: tokenVal,
            status: "pending",
            createdAt: new Date().toISOString(),
            comment,
            products: products || [],
          };
          tokens.unshift(newToken);
          localStorage.setItem(KEYS.TOKENS, JSON.stringify(tokens));
          return jsonResponse({
            success: true,
            token: tokenVal,
            link: `/review/${tokenVal}`,
          });
        }

        if (path.startsWith("/api/admin/tokens/") && method === "DELETE") {
          const tokenToDelete = path.split("/").pop() || "";
          let tokens = getLocalTokens();
          tokens = tokens.filter((t) => t.token !== tokenToDelete);
          localStorage.setItem(KEYS.TOKENS, JSON.stringify(tokens));

          // Delete associated reviews
          let reviews = getLocalReviews();
          reviews = reviews.filter((r) => r.tokenUsed !== tokenToDelete);
          localStorage.setItem(KEYS.REVIEWS, JSON.stringify(reviews));

          return jsonResponse({
            success: true,
            message: "Token deleted successfully.",
          });
        }

        if (path.startsWith("/api/admin/tokens/") && method === "PUT") {
          const tokenToUpdate = path.split("/").pop() || "";
          const { status } = bodyObj;
          const tokens = getLocalTokens();
          const tokenIndex = tokens.findIndex((t) => t.token === tokenToUpdate);
          if (tokenIndex !== -1) {
            tokens[tokenIndex].status = status;
            localStorage.setItem(KEYS.TOKENS, JSON.stringify(tokens));
            return jsonResponse({ success: true, token: tokens[tokenIndex] });
          }
          return jsonResponse(
            { success: false, message: "Token not found" },
            404,
          );
        }

        // Admin review endpoints
        if (path.startsWith("/api/admin/reviews/") && method === "PUT") {
          const reviewId = path.split("/").pop() || "";
          const { name, rating, comment, clientComment, image } = bodyObj;
          const reviews = getLocalReviews();
          const ri = reviews.findIndex((r) => r.id === reviewId);
          if (ri !== -1) {
            reviews[ri] = {
              ...reviews[ri],
              name,
              rating,
              comment,
              clientComment,
              image,
            };
            localStorage.setItem(KEYS.REVIEWS, JSON.stringify(reviews));
            return jsonResponse({ success: true, review: reviews[ri] });
          }
          return jsonResponse(
            { success: false, message: "Review not found" },
            404,
          );
        }

        if (path.startsWith("/api/admin/reviews/") && method === "DELETE") {
          const reviewId = path.split("/").pop() || "";
          let reviews = getLocalReviews();
          const review = reviews.find((r) => r.id === reviewId);
          if (review) {
            const tokUsed = review.tokenUsed;
            // Reactivate token status
            const tokens = getLocalTokens();
            const ti = tokens.findIndex((t) => t.token === tokUsed);
            if (ti !== -1) {
              tokens[ti].status = "pending";
              delete tokens[ti].usedAt;
              localStorage.setItem(KEYS.TOKENS, JSON.stringify(tokens));
            }
            reviews = reviews.filter((r) => r.id !== reviewId);
            localStorage.setItem(KEYS.REVIEWS, JSON.stringify(reviews));
            return jsonResponse({
              success: true,
              message: "Review deleted successfully",
            });
          }
          return jsonResponse(
            { success: false, message: "Review not found" },
            404,
          );
        }

        // 4. Products endpoints
        // NOTE: /api/products is NOT handled by the mock emulator intentionally.
        // The real backend at port 3000 always serves this from database.json (with D1 fallback).
        // Serving from localStorage would show stale/hardcoded offline data.

        if (path === "/api/admin/products/reorder" && method === "POST") {
          const { productIds } = bodyObj;
          if (!Array.isArray(productIds)) {
            return jsonResponse({ success: false, message: "Invalid productIds" }, 400);
          }
          const products = getLocalProducts();
          for (let i = 0; i < productIds.length; i++) {
            const id = String(productIds[i]);
            const idx = products.findIndex(p => String(p.id) === id);
            if (idx !== -1) {
              products[idx].orderIndex = i;
            }
          }
          products.sort((a, b) => {
            const aOrd = a.orderIndex !== undefined ? Number(a.orderIndex) : 0;
            const bOrd = b.orderIndex !== undefined ? Number(b.orderIndex) : 0;
            return aOrd - bOrd;
          });
          localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
          return jsonResponse({ success: true, message: "Products reordered successfully" });
        }

        if (path === "/api/admin/products" && method === "POST") {
          const products = getLocalProducts();
          const newProduct: LocalProduct = {
            id: generateUUID(),
            name: bodyObj.name,
            category: bodyObj.category || "Oils",
            price: bodyObj.price,
            discountPrice: bodyObj.discountPrice,
            isAvailable:
              bodyObj.isAvailable !== undefined ? bodyObj.isAvailable : true,
            image: bodyObj.image || "",
            description: bodyObj.description,
            benefits: bodyObj.benefits || [],
            usage: bodyObj.usage,
            ingredients: bodyObj.ingredients || [],
          };
          products.push(newProduct);
          localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
          return jsonResponse({ success: true, product: newProduct });
        }

        if (path.startsWith("/api/admin/products/") && method === "PUT") {
          const productId = path.split("/").pop() || "";
          const products = getLocalProducts();
          const idx = products.findIndex((p) => String(p.id) === String(productId));
          if (idx !== -1) {
            products[idx] = {
              ...products[idx],
              ...bodyObj,
              id: String(productId),
            };
            localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
            return jsonResponse({ success: true, product: products[idx] });
          } else {
            const newProd = { id: String(productId), ...bodyObj };
            products.push(newProd);
            localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
            return jsonResponse({ success: true, product: newProd });
          }
        }

        if (path.startsWith("/api/admin/products/") && method === "DELETE") {
          const productId = path.split("/").pop() || "";
          let products = getLocalProducts();
          products = products.filter((p) => p.id !== productId);
          localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(products));
          return jsonResponse({ success: true, message: "Product deleted" });
        }

        if (path === "/api/admin/products/seed" && method === "POST") {
          localStorage.removeItem(KEYS.PRODUCTS);
          return jsonResponse({ success: true, products: getLocalProducts() });
        }

        // 5. Orders endpoints
        if (path === "/api/admin/orders" && method === "GET") {
          return jsonResponse({ success: true, orders: getLocalOrders() });
        }

        if (path.startsWith("/api/admin/orders/") && method === "DELETE") {
          const orderId = path.split("/").pop() || "";
          let orders = getLocalOrders();
          orders = orders.filter((o) => o.id !== orderId);
          localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders));
          return jsonResponse({
            success: true,
            message: "Order deleted successfully",
          });
        }

        if (path.startsWith("/api/admin/orders/") && method === "PATCH") {
          const orderId = path.split("/").pop() || "";
          const { status, comment } = bodyObj;
          const orders = getLocalOrders();
          const oIndex = orders.findIndex((o) => o.id === orderId);
          if (oIndex !== -1) {
            if (status !== undefined) orders[oIndex].status = status;
            if (comment !== undefined) orders[oIndex].comment = comment;
            localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders));
            return jsonResponse({
              success: true,
              order: orders[oIndex],
              message: "Order updated successfully",
            });
          }
          return jsonResponse(
            { success: false, message: "Order not found" },
            404,
          );
        }

        // 6. Checkout endpoint
        if (path === "/api/checkout" && method === "POST") {
          const {
            customer,
            items,
            total,
            appliedCoupon,
            discountAmount,
            subtotalPrice,
          } = bodyObj;
          const orderNbr = "ORD-" + Math.floor(100000 + Math.random() * 900000);

          // Save order
          const orders = getLocalOrders();
          const newOrder: LocalOrder = {
            id: generateUUID(),
            orderNbr,
            customer,
            items,
            total,
            appliedCoupon: appliedCoupon || null,
            discountAmount: discountAmount || 0,
            subtotalPrice: subtotalPrice || total,
            status: "pending",
            comment: "",
            createdAt: new Date().toISOString(),
          };
          orders.unshift(newOrder);
          localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders));

          // Create associated invite token
          const tokens = getLocalTokens();
          const newToken: LocalToken = {
            id: generateUUID(),
            token: orderNbr,
            status: "pending",
            createdAt: new Date().toISOString(),
            comment: `${customer.firstName} ${customer.lastName}`,
            products: items.map((i: any) => i.name),
          };
          tokens.unshift(newToken);
          localStorage.setItem(KEYS.TOKENS, JSON.stringify(tokens));

          return jsonResponse({
            success: true,
            message: "Order processed successfully (Local Emulator Mode).",
            reviewLink: `/review/${orderNbr}`,
            orderNbr,
          });
        }

        // 7. Coupons endpoints
        if (path === "/api/admin/coupons" && method === "GET") {
          return jsonResponse({ success: true, coupons: getLocalCoupons() });
        }

        if (path === "/api/admin/coupons" && method === "POST") {
          const {
            code,
            discountType,
            discountValue,
            isActive,
            expiresAt,
            minCartAmount,
            applicableProducts,
          } = bodyObj;
          const coupons = getLocalCoupons();
          const exists = coupons.some(
            (c) => c.code.toUpperCase() === code.trim().toUpperCase(),
          );
          if (exists) {
            return jsonResponse(
              { success: false, message: "Coupon already exists" },
              400,
            );
          }
          const newCoupon: LocalCoupon = {
            id: generateUUID(),
            code: code.trim().toUpperCase(),
            discountType,
            discountValue: Number(discountValue),
            isActive: isActive !== undefined ? isActive : true,
            expiresAt: expiresAt || null,
            minCartAmount: minCartAmount ? Number(minCartAmount) : null,
            applicableProducts: applicableProducts || null,
          };
          coupons.push(newCoupon);
          localStorage.setItem(KEYS.COUPONS, JSON.stringify(coupons));
          return jsonResponse({ success: true, coupon: newCoupon });
        }

        if (path.startsWith("/api/admin/coupons/") && method === "PUT") {
          const cid = path.split("/").pop() || "";
          const coupons = getLocalCoupons();
          const ci = coupons.findIndex((c) => c.id === cid);
          if (ci !== -1) {
            coupons[ci] = {
              ...coupons[ci],
              code: bodyObj.code
                ? bodyObj.code.trim().toUpperCase()
                : coupons[ci].code,
              discountType: bodyObj.discountType || coupons[ci].discountType,
              discountValue:
                bodyObj.discountValue !== undefined
                  ? Number(bodyObj.discountValue)
                  : coupons[ci].discountValue,
              isActive:
                bodyObj.isActive !== undefined
                  ? !!bodyObj.isActive
                  : coupons[ci].isActive,
              expiresAt: bodyObj.expiresAt,
              minCartAmount:
                bodyObj.minCartAmount !== undefined
                  ? bodyObj.minCartAmount !== null
                    ? Number(bodyObj.minCartAmount)
                    : null
                  : coupons[ci].minCartAmount,
              applicableProducts:
                bodyObj.applicableProducts !== undefined
                  ? bodyObj.applicableProducts
                  : coupons[ci].applicableProducts,
            };
            localStorage.setItem(KEYS.COUPONS, JSON.stringify(coupons));
            return jsonResponse({ success: true, coupon: coupons[ci] });
          }
          return jsonResponse(
            { success: false, message: "Coupon not found" },
            404,
          );
        }

        if (path.startsWith("/api/admin/coupons/") && method === "DELETE") {
          const cid = path.split("/").pop() || "";
          let coupons = getLocalCoupons();
          coupons = coupons.filter((c) => c.id !== cid);
          localStorage.setItem(KEYS.COUPONS, JSON.stringify(coupons));
          return jsonResponse({ success: true, message: "Coupon deleted" });
        }

        if (path === "/api/coupons/validate" && method === "POST") {
          const { code, cartPrice, cartItems } = bodyObj;
          const coupons = getLocalCoupons();
          const coupon = coupons.find(
            (c) => c.code.toUpperCase() === code.trim().toUpperCase(),
          );

          if (!coupon) {
            return jsonResponse(
              { success: false, message: "Discount code is invalid." },
              404,
            );
          }
          if (!coupon.isActive) {
            return jsonResponse(
              { success: false, message: "This code is currently inactive" },
              400,
            );
          }
          if (coupon.expiresAt) {
            if (new Date() > new Date(coupon.expiresAt)) {
              return jsonResponse(
                { success: false, message: "This coupon code has expired" },
                400,
              );
            }
          }
          if (
            coupon.minCartAmount &&
            cartPrice !== undefined &&
            Number(cartPrice) < coupon.minCartAmount
          ) {
            return jsonResponse(
              {
                success: false,
                message: `Minimum spend of ${coupon.minCartAmount} DH is required for this code.`,
              },
              400,
            );
          }
          if (
            coupon.applicableProducts &&
            coupon.applicableProducts.length > 0 &&
            Array.isArray(cartItems)
          ) {
            const matching = cartItems.filter((it: any) =>
              coupon.applicableProducts?.includes(it.id),
            );
            if (matching.length === 0) {
              return jsonResponse(
                {
                  success: false,
                  message:
                    "This code is only applicable to specific products that are not currently in your cart.",
                },
                400,
              );
            }
          }
          return jsonResponse({ success: true, coupon });
        }

        // 8. Images Endpoints
        if (path === "/api/admin/images" && method === "GET") {
          return jsonResponse({ success: true, images: getLocalImages() });
        }

        if (path === "/api/admin/system-images" && method === "GET") {
          return jsonResponse({ success: true, images: getLocalImages() });
        }

        if (path === "/api/admin/images" && method === "DELETE") {
          const { imageUrl } = bodyObj;
          let images = getLocalImages();
          images = images.filter((i) => i !== imageUrl);
          localStorage.setItem(KEYS.IMAGES, JSON.stringify(images));
          return jsonResponse({
            success: true,
            message: "Image removed from collection",
          });
        }

        if (path === "/api/admin/images/track" && method === "POST") {
          const { imageUrl } = bodyObj;
          const images = getLocalImages();
          if (imageUrl && !images.includes(imageUrl)) {
            images.unshift(imageUrl);
            localStorage.setItem(KEYS.IMAGES, JSON.stringify(images));
          }
          return jsonResponse({ success: true });
        }

        if (path === "/api/admin/images/replace" && method === "POST") {
          // In static emulator mode, we just return success so the UI updates
          // AdminImages.tsx handles swapping the URL client-side
          return jsonResponse({
            success: true,
            message: "Replacement mocked in static host",
          });
        }

        if (path === "/api/admin/images/rename" && method === "POST") {
          const { oldUrl, newName } = bodyObj;
          let newUrlStr = oldUrl;
          if (oldUrl && newName) {
            const parts = oldUrl.split("/");
            const filename = parts[parts.length - 1];
            const ext = filename.includes(".") ? "." + filename.split(".").pop() : "";
            const finalName = newName.endsWith(ext) ? newName : newName + ext;
            parts[parts.length - 1] = finalName;
            newUrlStr = parts.join("/");
            let images = getLocalImages();
            images = images.map((i) => (i === oldUrl ? newUrlStr : i));
            localStorage.setItem(KEYS.IMAGES, JSON.stringify(images));
          }
          return jsonResponse({
            success: true,
            newUrl: newUrlStr,
            message: "Rename handled in static host",
          });
        }
      } catch (e: any) {
        console.error("Local emulator error:", e);
        return jsonResponse({ success: false, error: e.message }, 500);
      }
    }

    return originalFetch(input, init);
  },
});

// ==========================================
// RENDER APPLICATION
// ==========================================
// clerkPubKey moved to lib/clerk.tsx

const clerkPubKey = (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY || '';
const isProductionKey = clerkPubKey.startsWith('pk_live_');
const isWrongDomain = window.location.hostname !== 'bellauraoils.com' && window.location.hostname !== 'www.bellauraoils.com';

if (isProductionKey && isWrongDomain) {
  createRoot(document.getElementById("root")!).render(
    <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: '#ef4444' }}>Clerk Configuration Error</h1>
      <p>You are using a Clerk Production Key (pk_live_...) on a non-production domain.</p>
      <p>Clerk restricts production keys to run ONLY on your primary domain (bellauraoils.com).</p>
      <p>To test in this AI Studio preview environment, please update your environment variables to use your Clerk <b>Development Key</b> (pk_test_...).</p>
    </div>
  );
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ClerkProvider>
        <HelmetProvider>
          <App />
        </HelmetProvider>
      </ClerkProvider>
    </StrictMode>,
  );
}
