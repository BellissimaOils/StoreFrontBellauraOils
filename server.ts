// server.ts — Bellaura Oils PUBLIC STOREFRONT
//
// This server exposes ONLY public-facing routes.
// No admin routes. No Sendit. No Telegram credentials. No image management.
// Admin operations belong to admin.bellauraoils.com
//
// Public route summary:
//   GET  /products, /products/:id/data
//   GET  /sections, /homepage-sections
//   GET  /reviews, /reviews/summary, /reviews/check-token/:token
//   GET  /reviews/general/status
//   POST /reviews (token-gated), /reviews/general
//   POST /checkout
//   GET  /cities, /countries
//   POST /coupons/validate
//   GET  /faq
//   GET  /sitemap.xml, /robots.txt
//   GET  /* → pre-rendered HTML SPA shell (with SSR SEO injection)

import fs from "fs";
import path from "path";
import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

import {
  isSafeUrl,
  formatNotificationTemplate,
  generateUUID,
  generateOrderNbr,
} from "./src/server/utils/idUtils";
import {
  getR2Credentials,
  getR2Client,
} from "./src/server/utils/r2Client";
import {
  DB_PATH,
  getWritableDbPath,
  isSameImageUrl,
  normalizeSectionLinkServer,
} from "./src/server/utils/pathUtils";
import {
  isMaskedValue,
  sanitizeCredentials,
  logD1ExecutionDetails,
} from "./src/server/utils/sqlUtils";
import {
  getLastD1WriteError,
  executeRealD1QueryIfConfigured,
  updateD1Settings,
  fetchD1SettingsIfConfigured,
  mapD1RowToProductSchema,
  fetchRealD1ProductsIfConfigured,
  fetchRealD1CountriesIfConfigured,
  fetchRealD1CouponsIfConfigured,
  fetchRealD1CitiesIfConfigured,
  fetchSectionsForSitemap,
  ensureProductsDataTablesExist,
  ensureD1OrdersTablesExist,
  autoSeedCityTableD1,
  autoSeedD1Database,
  getD1VirtualToken,
} from "./src/server/services/d1Client";
import { createCatalogSyncService } from "./src/server/services/catalogSync";
import { createReviewsDbService } from "./src/server/services/reviewsDb";
import { createCoreDbService } from "./src/server/services/coreDb";
import { createProductSyncService } from "./src/server/services/productSync";
import { serveUnicodeStatic } from "./src/server/utils/staticFiles";
import { getCachedSeoIndexSync } from "./src/server/services/seoSettings";
import { createSeoRouter } from "./src/server/routes/seoRoutes";
import { createProductRouter } from "./src/server/routes/productRoutes";
import { createSectionRouter } from "./src/server/routes/sectionRoutes";
import { createReviewRouter } from "./src/server/routes/reviewRoutes";
import { createCityRouter } from "./src/server/routes/cityRoutes";
import { createCountryRouter } from "./src/server/routes/countryRoutes";
import { createCouponRouter } from "./src/server/routes/couponRoutes";
import { createFaqRouter } from "./src/server/routes/faqRoutes";
import { createCheckoutRouter } from "./src/server/routes/checkoutRoutes";
import { resolvePageSeo } from "./src/lib/seoContent";
import { SITE_ORIGIN, absoluteUrl } from "./src/lib/siteUrl";
import {
  resolvePath,
  collectSectionPaths,
  collectProductSlugs,
  normalizePathname,
} from "./src/lib/canonicalRoutes";
import { getProductSlug } from "./src/types";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
interface ReviewToken {
  id: string;
  token: string;
  status: "pending" | "processing" | "submitted";
  createdAt: string;
  usedAt?: string;
  comment?: string;
  products?: string[];
  productRefs?: { id?: string | null; name: string }[];
}

let reviewTokens = new Map<string, ReviewToken>();
let reviews: any[] = [];

const { saveReviewsDb: persistReviewsDb, loadReviewsDb } = createReviewsDbService({
  getReviews: () => reviews,
  setReviews: (v) => { reviews = v; },
});

let products: any[] = [];
let orders: any[] = [];
let coupons: any[] = [];
let countries: any[] = [];
let d1_products: any[] = [];
let d1_cities: any[] = [];
let storeSettings: any = {};

const STORE_SETTINGS_D1_TTL_MS = 10 * 1000;
let lastStoreSettingsD1Read = 0;

async function refreshStoreSettingsFromD1(force = false): Promise<void> {
  if (!force && Date.now() - lastStoreSettingsD1Read < STORE_SETTINGS_D1_TTL_MS) return;
  lastStoreSettingsD1Read = Date.now();
  const fresh = await fetchD1SettingsIfConfigured();
  if (fresh) storeSettings = fresh;
}

// D1 cache for products and reviews (30s TTL)
const d1ApiCache = {
  products: { data: null as any, timestamp: 0 },
  reviews:  { data: null as any, timestamp: 0 },
};
const D1_CACHE_TTL_MS = 30 * 1000;

const invalidateD1ReviewsCache = () => {
  d1ApiCache.reviews.data = null;
  d1ApiCache.reviews.timestamp = 0;
};

const saveReviewsDb = async () => {
  invalidateD1ReviewsCache();
  await persistReviewsDb();
};

const { syncSqlToClassicProducts, syncD1ToClassicProducts, syncClassicToSqlProducts } =
  createProductSyncService({
    getProducts: () => products,
    setProducts: (v) => { products = v; },
    getD1Products: () => d1_products,
    setD1Products: (v) => { d1_products = v; },
  });

let siteSections: any[] = [];
let homepageSections: any[] = [];
let lastDbLoadTime = 0;

const { fetchEverythingFromD1, loadDb, saveDb } = createCoreDbService({
  getReviewTokens: () => reviewTokens,
  setReviewTokens: (v) => { reviewTokens = v; },
  getProducts: () => products,
  getD1Products: () => d1_products,
  setD1Products: (v) => { d1_products = v; },
  getOrders: () => orders,
  setOrders: (v) => { orders = v; },
  getReviews: () => reviews,
  setReviews: (v) => { reviews = v; },
  getUploadedImages: () => [],
  setUploadedImages: () => {},
  getD1Images: () => [],
  setD1Images: () => {},
  getD1Cities: () => d1_cities,
  setD1Cities: (v) => { d1_cities = v; },
  getCoupons: () => coupons,
  setCoupons: (v) => { coupons = v; },
  getStoreSettings: () => storeSettings,
  setStoreSettings: (v) => { storeSettings = v; },
  syncD1ToClassicProducts,
  persistReviewsDb,
  saveDb: async () => {},
  DB_PATH,
  getWritableDbPath,
  isMaskedValue,
  sanitizeCredentials,
  logD1ExecutionDetails,
  fetchRealD1ProductsIfConfigured,
  mapD1RowToProductSchema,
  ensureProductsDataTablesExist,
  ensureD1OrdersTablesExist,
  autoSeedCityTableD1,
  autoSeedD1Database,
  getD1VirtualToken,
  fetchD1SettingsIfConfigured,
  updateD1Settings,
  getLastD1WriteError,
  executeD1Query: executeRealD1QueryIfConfigured,
});

// ---------------------------------------------------------------------------
// Shared state object passed to route factories
// ---------------------------------------------------------------------------
function buildState() {
  const stateObj: any = {
    // Products
    getProducts: () => products,
    setProducts: (v: any[]) => { products = v; },
    getD1Products: () => d1_products,
    setD1Products: (v: any[]) => { d1_products = v; },
    fetchProductsFromD1: () => fetchRealD1ProductsIfConfigured(),
    fetchRealD1ProductsIfConfigured,
    getD1ApiCacheProducts: () => d1ApiCache.products,
    setD1ApiCacheProducts: (v: any) => { d1ApiCache.products = v; },
    syncSqlToClassicProducts,
    syncD1ToClassicProducts,
    syncClassicToSqlProducts,
    mapD1RowToProductSchema,
    ensureProductsDataTablesExist,

    // Orders
    getOrders: () => orders,
    setOrders: (v: any[]) => { orders = v; },
    ensureD1OrdersTablesExist,

    // Coupons
    getCoupons: () => coupons,
    setCoupons: (v: any[]) => { coupons = v; },
    fetchCouponsFromD1: () => fetchRealD1CouponsIfConfigured(),
    fetchRealD1CouponsIfConfigured,

    // Countries
    getCountries: () => countries,
    setCountries: (v: any[]) => { countries = v; },
    fetchCountriesFromD1: () => fetchRealD1CountriesIfConfigured(),
    fetchRealD1CountriesIfConfigured,

    // Cities
    getCities: () => d1_cities,
    setCities: (v: any[]) => { d1_cities = v; },
    getD1Cities: () => d1_cities,
    setD1Cities: (v: any[]) => { d1_cities = v; },
    fetchCitiesFromD1: () => fetchRealD1CitiesIfConfigured(),
    fetchRealD1CitiesIfConfigured,
    autoSeedCityTable: autoSeedCityTableD1,
    autoSeedCityTableD1,

    // Sections
    getSections: () => siteSections,
    setSections: (v: any[]) => { siteSections = v; },
    getHomepageSections: () => homepageSections,
    setHomepageSections: (v: any[]) => { homepageSections = v; },
    getLastDbLoadTime: () => lastDbLoadTime,
    setLastDbLoadTime: (t: number) => { lastDbLoadTime = t; },
    getDbLoadCooldown: () => 10000,

    // Reviews
    getReviews: () => reviews,
    setReviews: (v: any[]) => { reviews = v; },
    getReviewTokens: () => reviewTokens,
    setReviewTokens: (v: Map<string, ReviewToken>) => { reviewTokens = v; },
    getD1ApiCacheReviews: () => d1ApiCache.reviews,
    setD1ApiCacheReviews: (v: any) => { d1ApiCache.reviews = v; },
    invalidateReviewsCache: invalidateD1ReviewsCache,
    invalidateD1ReviewsCache,
    getD1CacheTtlMs: () => D1_CACHE_TTL_MS,
    D1_CACHE_TTL_MS,
    saveReviewsDb,
    persistReviewsDb,
    moveReviewImagesToDeleted: async () => null,
    getD1VirtualToken,
    reviewTokenLimiter: rateLimit({ windowMs: 60 * 1000, max: 10 }),
    createToken: async () => "",

    // Settings
    getStoreSettings: () => storeSettings,
    setStoreSettings: (v: any) => { storeSettings = v; },
    refreshStoreSettings: refreshStoreSettingsFromD1,
    refreshStoreSettingsFromD1,
    updateD1Settings,

    // Images / R2 (dummy / harmless for storefront)
    getUploadedImages: () => [] as string[],
    setUploadedImages: () => {},
    getD1Images: () => [] as any[],
    getR2Folders: () => [] as string[],
    setR2Folders: () => {},
    processBase64Image: async () => null,
    getR2Credentials,
    getR2Client,
    isSameImageUrl,

    // Db / D1 utils
    loadDb,
    saveDb,
    fetchEverythingFromD1,
    autoSeedD1Database,
    executeD1Query: executeRealD1QueryIfConfigured,
    getLastD1WriteError,
    logD1ExecutionDetails,
    isMaskedValue,
    sanitizeCredentials,

    // Helpers
    isSafeUrl,
    formatNotificationTemplate,
    generateUUID,
    generateOrderNbr,
    normalizeSectionLinkServer,
    SITE_ORIGIN,
    d1ApiCache,
  };
  return stateObj;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app: Promise<express.Express> = (async () => {
  const server = express();

  server.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS — allow public storefront domain, localhost, and Vercel preview URLs
  server.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  // Global rate limit — generous for a public storefront
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 500 });
  server.use("/api/", apiLimiter);

  server.use(compression());
  server.use(express.json({ limit: "1mb" }));
  server.use(express.urlencoded({ extended: true }));

  const state = buildState();

  // ── Cold-start: load data from D1 ──────────────────────────────────
  try {
    await refreshStoreSettingsFromD1(true);
    const d1Prods = await fetchRealD1ProductsIfConfigured();
    if (d1Prods) { d1_products = d1Prods; syncD1ToClassicProducts(); }
    const d1Countries = await fetchRealD1CountriesIfConfigured();
    if (d1Countries) countries = d1Countries;
    const d1Coupons = await fetchRealD1CouponsIfConfigured();
    if (d1Coupons) coupons = d1Coupons;
    const d1Cities = await fetchRealD1CitiesIfConfigured();
    if (d1Cities) d1_cities = d1Cities;

    const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
    const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
    const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);
    if (accountId && databaseId && apiToken) {
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const [secRes, hpRes] = await Promise.allSettled([
        fetch(cloudflareUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql: "SELECT * FROM sections_management ORDER BY order_index ASC;" }),
        }).then((r) => r.json()),
        fetch(cloudflareUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql: "SELECT * FROM homepage_sections ORDER BY order_index ASC;" }),
        }).then((r) => r.json()),
      ]);
      if (secRes.status === "fulfilled" && secRes.value?.success) {
        let rows = secRes.value.result?.[0]?.results || secRes.value.result?.results || [];
        if (!Array.isArray(rows) && Array.isArray(secRes.value.result)) rows = secRes.value.result;
        siteSections = rows;
      }
      if (hpRes.status === "fulfilled" && hpRes.value?.success) {
        let rows = hpRes.value.result?.[0]?.results || hpRes.value.result?.results || [];
        if (!Array.isArray(rows) && Array.isArray(hpRes.value.result)) rows = hpRes.value.result;
        homepageSections = rows;
      }
      lastDbLoadTime = Date.now();
    }
  } catch (e) {
    console.warn("[Storefront] D1 cold-start init failed:", e);
  }

  try { await loadReviewsDb(); } catch (e) {
    console.warn("[Storefront] Reviews load failed:", e);
  }

  // ── Public API routes ────────────────────────────────────────────────
  // Products — GET /products, /products/:id/data  (admin CRUD stays in dashboard)
  server.use("/api", createProductRouter(state as any));

  // Sections — GET /sections, /homepage-sections
  server.use("/api", createSectionRouter(state as any));

  // Reviews — GET /reviews, POST /reviews, /reviews/general  (admin review management in dashboard)
  server.use("/api", createReviewRouter(state as any));

  // Checkout — POST /checkout
  server.use("/api", createCheckoutRouter(state as any));

  // Cities — GET /cities  (admin city management in dashboard)
  server.use("/api", createCityRouter(state as any));

  // Countries — GET /countries
  server.use("/api", createCountryRouter(state as any));

  // Coupons — POST /coupons/validate  (admin coupon management in dashboard)
  server.use("/api", createCouponRouter(state as any));

  // FAQ — GET /faq
  server.use("/api", createFaqRouter(state as any));

  // ── SEO: sitemap.xml, robots.txt, and pre-rendered HTML ─────────────
  server.use("/", createSeoRouter({
    getSections: () => siteSections,
    getSiteSections: () => siteSections,
    getProducts: () => products,
    getD1Products: () => d1_products,
    fetchD1Products: fetchRealD1ProductsIfConfigured,
    fetchRealD1ProductsIfConfigured,
    fetchSectionsForSitemap: () => fetchSectionsForSitemap(siteSections),
    getStoreSettings: () => storeSettings,
    getCachedSeoIndexSync,
    mapD1RowToProductSchema,
    SITE_ORIGIN,
  } as any));

  // ── Static files (Vite build output) ─────────────────────────────────
  const distCandidates = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "dist"),
    path.join(__dirname, "../dist"),
  ];
  const distDir = distCandidates.find((d) => fs.existsSync(d));

  const getHtmlShell = (): string | null => {
    if (!distDir) return null;
    const candidates = [
      path.join(distDir, "app.html"),
      path.join(distDir, "index.html"),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  };

  if (distDir) {
    // Serve built assets with long-term caching for immutable chunks
    server.use(express.static(distDir, {
      setHeaders(res, filePath) {
        if (filePath.includes("/assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));

    // SPA fallback — all unknown paths serve HTML shell
    server.use("*", (req, res) => {
      const htmlPath = getHtmlShell();
      if (!htmlPath) {
        return res.status(404).send("Not found");
      }
      const sectionPaths = collectSectionPaths(siteSections, normalizeSectionLinkServer);
      const productSlugs = collectProductSlugs(products, getProductSlug);
      const pathKind = resolvePath(req.path, {
        sectionPaths,
        productSlugs,
        dataReady: siteSections.length > 0 || products.length > 0,
      });
      if (pathKind === "not-found") {
        res.status(404);
      }
      res.sendFile(htmlPath);
    });
  } else {
    // Dev: Vite handles the frontend on a separate port
    server.get("/health", (_req, res) => res.json({ status: "Storefront API running" }));
  }

  return server;
})();

// Dev server entry
if (!process.env.VERCEL && process.env.NODE_ENV !== "production") {
  app.then((server) => {
    const PORT = Number(process.env.PORT) || 3000;
    server.listen(PORT, () => {
      console.log(`[Storefront] running on http://localhost:${PORT}`);
    });
  });
}

export { app };
