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

import { GoogleGenAI } from "@google/genai";
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
  getR2Folders: () => [],
  setR2Folders: () => {},
  getStoreSettings: () => storeSettings,
  setStoreSettings: (v) => { storeSettings = v; },
  syncSqlToClassicProducts,
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
  return {
    getProducts: () => products,
    setProducts: (v: any[]) => { products = v; },
    getOrders: () => orders,
    setOrders: (v: any[]) => { orders = v; },
    getCoupons: () => coupons,
    setCoupons: (v: any[]) => { coupons = v; },
    getCountries: () => countries,
    setCountries: (v: any[]) => { countries = v; },
    getReviews: () => reviews,
    setReviews: (v: any[]) => { reviews = v; },
    getReviewTokens: () => reviewTokens,
    setReviewTokens: (v: Map<string, ReviewToken>) => { reviewTokens = v; },
    getUploadedImages: () => [] as string[],
    setUploadedImages: () => {},
    getR2Folders: () => [] as string[],
    setR2Folders: () => {},
    getD1Products: () => d1_products,
    setD1Products: (v: any[]) => { d1_products = v; },
    getD1Cities: () => d1_cities,
    setD1Cities: (v: any[]) => { d1_cities = v; },
    getStoreSettings: () => storeSettings,
    setStoreSettings: (v: any) => { storeSettings = v; },
    refreshStoreSettingsFromD1,
    d1ApiCache,
    D1_CACHE_TTL_MS,
    invalidateD1ReviewsCache,
    saveReviewsDb,
    persistReviewsDb,
    syncSqlToClassicProducts,
    syncD1ToClassicProducts,
    syncClassicToSqlProducts,
    fetchEverythingFromD1,
    loadDb,
    saveDb,
    getLastD1WriteError,
    executeD1Query: executeRealD1QueryIfConfigured,
    fetchRealD1ProductsIfConfigured,
    fetchRealD1CountriesIfConfigured,
    fetchRealD1CouponsIfConfigured,
    fetchRealD1CitiesIfConfigured,
    mapD1RowToProductSchema,
    ensureProductsDataTablesExist,
    ensureD1OrdersTablesExist,
    autoSeedCityTableD1,
    autoSeedD1Database,
    getD1VirtualToken,
    updateD1Settings,
    isMaskedValue,
    sanitizeCredentials,
    logD1ExecutionDetails,
    isSafeUrl,
    formatNotificationTemplate,
    generateUUID,
    generateOrderNbr,
    getR2Credentials,
    getR2Client,
    isSameImageUrl,
    normalizeSectionLinkServer,
    SITE_ORIGIN,
    // Public rate limiter for review submissions
    reviewTokenLimiter: rateLimit({ windowMs: 60 * 1000, max: 10 }),
  };
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

  // CORS — only allow the public storefront domain
  const allowedOrigins = [
    "https://www.bellauraoils.com",
    "https://bellauraoils.com",
    "http://localhost:5173",
    "http://localhost:3000",
  ];
  server.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.some((o) => origin.startsWith(o))) return cb(null, true);
        cb(new Error("Not allowed by CORS"));
      },
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
    getProducts: () => products,
    getD1Products: () => d1_products,
    getSiteSections: () => siteSections,
    getStoreSettings: () => storeSettings,
    getCachedSeoIndexSync,
    fetchRealD1ProductsIfConfigured,
    fetchSectionsForSitemap: () => fetchSectionsForSitemap(siteSections),
    mapD1RowToProductSchema,
    SITE_ORIGIN,
  } as any));

  // ── Static files (Vite build output) ─────────────────────────────────
  const distDir = path.join(process.cwd(), "dist");
  const indexHtml = path.join(distDir, "index.html");

  if (fs.existsSync(distDir)) {
    // Serve built assets with long-term caching for immutable chunks
    server.use(express.static(distDir, {
      setHeaders(res, filePath) {
        if (filePath.includes("/assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));

    // SPA fallback — all unknown paths serve index.html (SEO router handles meta injection)
    server.use("*", (_req, res) => {
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send("Not found");
      }
    });
  } else {
    // Dev: Vite handles the frontend on a separate port
    server.get("/health", (_req, res) => res.json({ status: "Storefront API running" }));
  }

  return server;
})();

// Dev server entry
if (process.env.NODE_ENV !== "production") {
  app.then((server) => {
    const PORT = Number(process.env.PORT) || 3000;
    server.listen(PORT, () => {
      console.log(`[Storefront] running on http://localhost:${PORT}`);
    });
  });
}

export { app };
