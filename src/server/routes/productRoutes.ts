import express from "express";
import path from "path";
import fs from "fs";
import { authenticateAdmin } from "../middleware/auth";
import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";
import { normalizeSizeLabel, resolveProductSize } from "../../lib/sizeUtils";
import { buildMandatoryProductSeo } from "../utils/seoDefaults";
import { upsertSeoSetting, productSeoPageUrl, invalidateSeoSettingsCache } from "../services/seoSettings";
import { logAdminAction } from "../services/auditLog";

// Product CRUD + catalog routes.
// Shared state injected via factory: products[], d1_products[],
// d1ApiCache.products (get+set), uploadedImages[], d1_images[],
// lastD1WriteError (get), plus all the helper functions each route needs.
//
// NOT included in this router (left in server.ts, interspersed with
// unrelated dev/diagnostic endpoints): /api/dev/update-names,
// /api/dev/raw-products, /api/admin/force-select, /api/admin/force-alter,
// /api/admin/translate. Those are scattered between product routes in the
// original file and aren't part of the core product CRUD flow.

interface ProductsState {
  getProducts: () => any[];
  getD1Products: () => any[];
  setD1Products: (v: any[]) => void;
  getD1ApiCacheProducts: () => { data: any; timestamp: number };
  setD1ApiCacheProducts: (v: { data: any; timestamp: number }) => void;
  getUploadedImages: () => string[];
  getD1Images: () => any[];
  getLastD1WriteError: () => string | null;
  getStoreSettings: () => any;
  // Re-reads the settings blob from D1 if this instance's copy is older than
  // its cooldown; see refreshStoreSettingsFromD1 in server.ts for why an
  // in-memory copy is not enough here. Optional so any other caller of this
  // factory keeps working unchanged.
  refreshStoreSettings?: (force?: boolean) => Promise<void>;
  fetchProductsFromD1: () => Promise<any[] | null>;
  syncD1ToClassicProducts: () => void;
  syncClassicToSqlProducts: () => void;
  mapD1RowToProductSchema: (row: any) => any;
  ensureProductsDataTablesExist: () => Promise<boolean>;
  processBase64Image: (...args: any[]) => Promise<string | null | undefined>;
  saveDb: () => Promise<void>;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
}

export function createProductRouter(state: ProductsState) {
  const router = express.Router();

  // Public: single product's long-form text fields (description/benefits/etc)
  router.get("/products/:id/data", async (req, res) => {
    await state.ensureProductsDataTablesExist();
    const { id } = req.params;
    const products = state.getProducts();
    const localProduct = products.find((p) => p.id === id || String(p.id) === id);

    const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
    const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
    const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

    const targetNbr = !isNaN(Number(id))
      ? Number(id)
      : localProduct
        ? products.findIndex((p) => p.id === localProduct.id) + 1
        : 0;

    if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
      return res.json({
        success: true,
        data: {
          description: localProduct?.description || "",
          benefits: localProduct?.benefits || [],
          usage: localProduct?.usage || "",
          ingredients: localProduct?.ingredients || "",
          tag: localProduct?.tag || "",
          showDescription: localProduct ? localProduct.showDescription !== false : true,
          showBenefits: localProduct ? localProduct.showBenefits !== false : true,
          showUsage: localProduct ? localProduct.showUsage !== false : true,
          showIngredients: localProduct ? localProduct.showIngredients !== false : true,
          show_size: localProduct ? localProduct.show_size !== 0 && localProduct.show_size !== "0" && localProduct.show_size !== false && (localProduct as any).showSize !== false : true,
          showSize: localProduct ? localProduct.show_size !== 0 && localProduct.show_size !== "0" && localProduct.show_size !== false && (localProduct as any).showSize !== false : true,
        },
      });
    }

    try {
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      // This is a public route and `id` is a path parameter, so both branches
      // bind their value. targetNbr was already isNaN-guarded above; the name
      // branch previously relied on manual quote-doubling. The % wildcards go
      // inside the parameter value to keep the LIKE semantics identical.
      let sql: string;
      let sqlParams: any[];
      if (targetNbr) {
        sql = `SELECT p.description, p.benefits, p.usage, p.ingredients, pd.tag FROM products p LEFT JOIN products_Data pd ON p.product_nbr = pd.product_id WHERE p.product_nbr = ?;`;
        sqlParams = [targetNbr];
      } else {
        sql = `SELECT p.description, p.benefits, p.usage, p.ingredients, pd.tag FROM products p LEFT JOIN products_Data pd ON p.product_nbr = pd.product_id WHERE p.name LIKE ?;`;
        sqlParams = [`%${localProduct?.name_en || id}%`];
      }

      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params: sqlParams }),
      });
      const data = await resp.json();
      let rows = data.result?.[0]?.results || data.result?.results || [];
      if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

      let benefitsArr: string[] = [];
      if (row?.benefits) {
        benefitsArr = typeof row.benefits === "string"
          ? row.benefits.split("\n").map((b: string) => b.trim()).filter(Boolean)
          : row.benefits;
      } else if (localProduct?.benefits) {
        benefitsArr = localProduct.benefits;
      }

      res.json({
        success: true,
        data: {
          description: row?.description ?? localProduct?.description ?? "",
          benefits: benefitsArr,
          usage: row?.usage ?? localProduct?.usage ?? "",
          ingredients: row?.ingredients ?? localProduct?.ingredients ?? "",
          tag: row?.tag ?? localProduct?.tag ?? "",
          showDescription: localProduct ? localProduct.showDescription !== false : true,
          showBenefits: localProduct ? localProduct.showBenefits !== false : true,
          showUsage: localProduct ? localProduct.showUsage !== false : true,
          showIngredients: localProduct ? localProduct.showIngredients !== false : true,
          show_size: localProduct ? localProduct.show_size !== 0 && localProduct.show_size !== "0" && localProduct.show_size !== false && (localProduct as any).showSize !== false : true,
          showSize: localProduct ? localProduct.show_size !== 0 && localProduct.show_size !== "0" && localProduct.show_size !== false && (localProduct as any).showSize !== false : true,
        },
      });
    } catch (e: any) {
      res.json({
        success: true,
        data: {
          description: localProduct?.description || "",
          benefits: localProduct?.benefits || [],
          usage: localProduct?.usage || "",
          ingredients: localProduct?.ingredients || "",
          tag: localProduct?.tag || "",
          showDescription: localProduct ? localProduct.showDescription !== false : true,
          showBenefits: localProduct ? localProduct.showBenefits !== false : true,
          showUsage: localProduct ? localProduct.showUsage !== false : true,
          showIngredients: localProduct ? localProduct.showIngredients !== false : true,
        },
      });
    }
  });

  // Admin: reorder products by an ordered array of product IDs
  router.post("/admin/products/reorder", authenticateAdmin, async (req, res) => {
    try {
      const { productIds } = req.body;
      if (!Array.isArray(productIds)) {
        return res.status(400).json({ success: false, message: "productIds must be an array" });
      }

      const products = state.getProducts();
      for (let i = 0; i < products.length; i++) {
        const pId = String(products[i].id);
        const idx = productIds.indexOf(pId);
        if (idx !== -1) {
          products[i].orderIndex = idx;
        } else {
          products[i].orderIndex = products[i].orderIndex !== undefined ? products[i].orderIndex : 9999 + i;
        }
      }

      products.sort((a, b) => {
        const aOrd = a.orderIndex !== undefined ? Number(a.orderIndex) : 0;
        const bOrd = b.orderIndex !== undefined ? Number(b.orderIndex) : 0;
        return aOrd - bOrd;
      });

      state.setD1ApiCacheProducts({ data: null, timestamp: 0 });
      state.syncClassicToSqlProducts();
      await state.saveDb();

      try {
        const updatePromises = productIds.map((pId: any, idx: number) => {
          const nextNbr = Number(pId);
          if (!isNaN(nextNbr)) {
            // Order matters: idx binds to the first ?, nextNbr to the second.
            return state.executeD1Query(
              `UPDATE products SET order_index = ? WHERE product_nbr = ?;`,
              [idx, nextNbr],
            );
          }
          return Promise.resolve();
        });
        await Promise.all(updatePromises);
      } catch (err) {
        console.error("Failed to propagate order change to D1 Cloud Database:", err);
      }

      await logAdminAction(req, "REORDER", "product", null, `Reordered ${productIds.length} products`);
      res.json({ success: true, message: "Products reordered successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Failed to reorder products" });
    }
  });

  // Public: main storefront product list (cached)
  router.get("/products", async (req, res) => {
    // Deliberately NOT edge-cacheable, despite this being the busiest endpoint
    // on the site. It used to send `public, s-maxage=30,
    // stale-while-revalidate=60`, which contradicted vercel.json's `no-store`
    // for `/api/:path*` — and whichever of the two won, a shared cache is
    // wrong for this response, because the body carries the live settings blob
    // (language toggles, availability copy, the general-review product
    // allow-list). Caching it meant an admin change could keep being served
    // from a CDN node for up to 90 seconds after it was saved, per node, which
    // is indistinguishable from "the save didn't work" and cannot be shortened
    // by any server-side refresh.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Accept-Encoding");

    const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
    const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
    const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

    // Started here but awaited only where the response is assembled, so on a
    // request that misses both this cooldown and the 300s product cache the
    // settings read overlaps the product fetch instead of adding a second
    // sequential D1 round-trip to a storefront page load. Internally
    // rate-limited, so it's a no-op on all but ~one request per window.
    const settingsRefresh = state.refreshStoreSettings?.() ?? Promise.resolve();
    // Not awaited here, so an unhandled rejection would take down the process
    // on some Node versions; refreshStoreSettingsFromD1 already swallows its
    // own errors, and this is belt-and-braces for any future implementation.
    settingsRefresh.catch(() => {});

    const buildPublicSettings = async () => {
      await settingsRefresh;
      const storeSettings = state.getStoreSettings();
      const publicSettings: any = {
        enableAr: storeSettings.enableAr !== undefined ? storeSettings.enableAr : true,
        enableEn: storeSettings.enableEn !== undefined ? storeSettings.enableEn : false,
        enableFr: storeSettings.enableFr !== undefined ? storeSettings.enableFr : false,
        ...storeSettings,
      };
      delete publicSettings.orders_telegramBotToken;
      delete publicSettings.orders_telegramChatId;
      return publicSettings;
    };

    if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
      const products = state.getProducts();
      const safeProducts = products.map((p) => ({
        id: p.id, name: p.name, name_en: p.name_en, name_ar: p.name_ar || "", name_fr: p.name_fr || "",
        price: p.price, originalPrice: p.originalPrice, image: p.image, category: p.category,
        description: p.description, benefits: p.benefits, usage: p.usage, ingredients: p.ingredients,
        isSale: p.isSale, isAvailable: p.isAvailable, showInSwiper: p.showInSwiper,
        in_catalog: (p as any).in_catalog !== undefined && (p as any).in_catalog !== null ? (p as any).in_catalog : 1,
        tag: p.tag, displaySection: p.displaySection || "both",
        seo_title: (p as any).seo_title || "", seo_description: (p as any).seo_description || "",
        seo_priority: (p as any).seo_priority || "", seo_changefreq: (p as any).seo_changefreq || "",
        slug: (p as any).slug || "",
        // Without these two the storefront could never show a size, no matter
        // what was stored: this whitelist is what the no-D1 path returns.
        size_ml: (p as any).size_ml ?? null,
        size_label: normalizeSizeLabel((p as any).size_label || (p as any).volume),
        volume: normalizeSizeLabel((p as any).size_label || (p as any).volume),
        show_size: (p as any).show_size !== 0 && (p as any).show_size !== "0" && (p as any).show_size !== false && (p as any).showSize !== false,
        showSize: (p as any).show_size !== 0 && (p as any).show_size !== "0" && (p as any).show_size !== false && (p as any).showSize !== false,
        // Same reasoning as size_ml/size_label above: without these in the
        // whitelist, a pack's product page could never know which reviews to
        // pull in for its constituent products.
        isPack: Boolean((p as any).isPack),
        packProductIds: Array.isArray((p as any).packProductIds) ? (p as any).packProductIds : [],
      })).filter((p) => p.in_catalog !== 0 && p.in_catalog !== "0");
      return res.json({ success: true, products: safeProducts, storeSettings: await buildPublicSettings() });
    }

    // Matches D1_CACHE_TTL_MS in server.ts (30s). At 300s a warm instance that
    // didn't serve the admin's write kept handing out its own five-minute-old
    // copy of the catalogue, which is what made product edits appear late and
    // inconsistently depending on which instance answered.
    const D1_CACHE_TTL_MS = 30 * 1000;
    const cache = state.getD1ApiCacheProducts();
    const needsRefresh = !cache.data || Date.now() - cache.timestamp > D1_CACHE_TTL_MS;

    if (needsRefresh) {
      const liveProducts = await state.fetchProductsFromD1();
      if (liveProducts && liveProducts.length > 0) {
        state.setD1Products(liveProducts);
        state.syncD1ToClassicProducts();
        const mapped = liveProducts.map(state.mapD1RowToProductSchema).filter(Boolean);
        state.setD1ApiCacheProducts({ data: mapped, timestamp: Date.now() });
      }
    }

    const updatedCache = state.getD1ApiCacheProducts();
    if (updatedCache.data && updatedCache.data.length > 0) {
      const activeProducts = updatedCache.data.filter((p: any) => p.in_catalog !== 0 && p.in_catalog !== "0" && p.in_catalog !== false);
      return res.json({ success: true, products: activeProducts, storeSettings: await buildPublicSettings() });
    }

    const d1_products = state.getD1Products();
    if (Array.isArray(d1_products) && d1_products.length > 0) {
      const activeD1 = d1_products.filter((r: any) => r.in_catalog !== 0 && r.in_catalog !== "0");
      const mapped = activeD1.map((r: any) => {
        const rawPrice = parseFloat(String(r.price).replace(/[^\d.]/g, "")) || 0;
        const rawDiscountPrice = parseFloat(String(r.discount_price || 0).replace(/[^\d.]/g, "")) || 0;
        const isSale = r.discount_applicable === 1 || r.discount_applicable === true;
        return {
          id: String(r.product_nbr || r.id), name: r.name || "", name_en: r.name_en || r.name || "",
          price: `${Math.round(rawPrice)} DH`,
          originalPrice: (isSale && rawDiscountPrice > rawPrice) ? `${Math.round(rawDiscountPrice)} DH` : null,
          image: r.image_url || r.image || "", category: r.category || "Oils", description: r.description || "",
          benefits: r.benefits ? (typeof r.benefits === "string" ? r.benefits.split("\n") : r.benefits) : [],
          usage: r.usage || "", ingredients: r.ingredients || "", isSale: Boolean(isSale),
          isAvailable: r.available !== 0, showInSwiper: r.show_in_swiper !== 0, displaySection: r.display_section || "both",
          tag: r.tag !== undefined && r.tag !== null ? String(r.tag).trim() : null,
          seo_title: r.seo_title || "", seo_description: r.seo_description || "",
          seo_priority: r.seo_priority || "", seo_changefreq: r.seo_changefreq || "",
          slug: r.slug || "",
          size_ml: r.size_ml ?? null,
          size_label: normalizeSizeLabel(r.size_label),
          volume: normalizeSizeLabel(r.size_label),
          show_size: r.show_size !== 0 && r.show_size !== "0" && r.show_size !== false && (r as any).showSize !== false,
          showSize: r.show_size !== 0 && r.show_size !== "0" && r.show_size !== false && (r as any).showSize !== false,
          isPack: r.is_pack === 1 || r.is_pack === true || r.is_pack === "1",
          packProductIds: (() => {
            if (!r.pack_product_ids) return [];
            try {
              const parsed = typeof r.pack_product_ids === "string" ? JSON.parse(r.pack_product_ids) : r.pack_product_ids;
              return Array.isArray(parsed) ? parsed.map((id: any) => String(id)) : [];
            } catch {
              return [];
            }
          })(),
        };
      });
      return res.json({ success: true, products: mapped, storeSettings: await buildPublicSettings() });
    }

    return res.json({ success: true, products: [], storeSettings: await buildPublicSettings() });
  });

  // Admin: seed products (no-op guard preserved from original — always
  // reports "already present" since the hardcoded featured-products
  // catalog was removed upstream; kept for API compatibility)
  router.post("/admin/products/seed", authenticateAdmin, async (req, res) => {
    try {
      const { force } = req.body;
      const products = state.getProducts();
      if (products.length === 0 || force) {
        await state.saveDb();
        return res.json({
          success: true,
          message: "Database refilled with featured products (currently disabled) and propagated to Cloudflare D1.",
          products,
        });
      }
      res.json({ success: true, message: "All default featured products are already present in your database." });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to seed products" });
    }
  });

  // Admin: paginated/filtered product list (always fresh from D1 — see
  // comment inline about why this must never serve from d1ApiCache)
  router.get("/admin/products", authenticateAdmin, async (req, res) => {
    // Never let a CDN or browser hold on to an admin list; the whole point of
    // this route is that it reflects the database right now.
    res.setHeader("Cache-Control", "no-store");
    // Drop the seo_settings cache before reading. That cache is per serverless
    // instance and is only invalidated on whichever instance handled the save,
    // so a reload landing elsewhere could still hold the pre-save rows — and
    // because the overlay applies seo_settings on top of the product's own
    // columns, those stale rows would override the fresh values the save had
    // just written, showing the admin their old text back. Same reasoning as
    // the d1ApiCache note below: this route is authenticated and low-traffic,
    // so correctness beats saving a round-trip.
    invalidateSeoSettingsCache();
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 1000;
      const search = (req.query.search as string || "").toLowerCase();
      const category = (req.query.category as string || "All Categories");

      let fullProducts: any[] = [];
      const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
      const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
      const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

      if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
        fullProducts = state.getProducts();
      } else {
        // The admin panel must never serve from d1ApiCache. That cache is
        // an in-memory object living inside a single serverless function
        // instance — on Vercel, concurrent requests can land on different
        // instances that each hold their own separate copy, with no shared
        // state between them. A save/delete only clears the cache on the
        // instance that handled that request; every other instance keeps
        // serving its own stale copy for up to 5 minutes. That's exactly
        // why an edit could appear to "not save" until a reload happened
        // to land on the right instance. The admin view is low-traffic and
        // authenticated-only, so correctness here matters far more than
        // saving one D1 round-trip — always fetch fresh.
        const liveProducts = await state.fetchProductsFromD1();
        if (liveProducts && liveProducts.length > 0) {
          state.setD1Products(liveProducts);
          state.syncD1ToClassicProducts();
          const mapped = liveProducts.map(state.mapD1RowToProductSchema).filter(Boolean);
          state.setD1ApiCacheProducts({ data: mapped, timestamp: Date.now() });
          fullProducts = mapped;
        } else {
          fullProducts = state.getD1ApiCacheProducts().data || state.getProducts();
        }
      }

      let filtered = fullProducts;
      if (category && category !== "All Categories") {
        filtered = filtered.filter((p) => p.category === category);
      }
      if (search) {
        filtered = filtered.filter((p) => {
          const str = `${p.name} ${p.name_ar} ${p.name_fr} ${p.description}`.toLowerCase();
          return str.includes(search);
        });
      }

      const total = filtered.length;
      const paginated = filtered.slice((page - 1) * limit, page * limit);
      res.json({ success: true, products: paginated, total, page, limit });
    } catch (e: any) {
      console.error("Error in GET /api/admin/products", e);
      res.json({ success: false, message: e.message });
    }
  });

  // Admin: create a new product
  router.post("/admin/products", authenticateAdmin, async (req, res) => {
    await state.ensureProductsDataTablesExist();
    try {
      let { name, name_en, category, price, originalPrice, isAvailable, showInSwiper, image, description, benefits, usage, ingredients, tag, showDescription, showBenefits, showUsage, showIngredients, show_size, showSize, exclude_from_sitemap, displaySection, seo_title, seo_description, seo_priority, seo_changefreq, slug, size_ml, size_label, isPack, packProductIds } = req.body;
      image = await state.processBase64Image(image);
      const isSale = !!originalPrice && originalPrice.toString().trim() !== "";

      const finalShowSize = show_size !== undefined ? (show_size === true || show_size === 1 || show_size === "1") : (showSize !== undefined ? !!showSize : true);

      // size_ml / size_label used to be missing from the destructuring above,
      // and the INSERT below wrote the literal 50 — so the size an admin typed
      // was dropped on the floor with no error, for every product ever created.
      const resolvedSize = resolveProductSize({ size_ml, size_label });

      // A pack with no products selected is meaningless (there would be
      // nothing to pull reviews from), so the flag is normalised against the
      // list rather than trusted on its own: `isPack` only sticks if there's
      // at least one id to go with it.
      const safePackProductIds: string[] = Array.isArray(packProductIds)
        ? packProductIds.map((id: any) => String(id)).filter(Boolean)
        : [];
      const finalIsPack = Boolean(isPack) && safePackProductIds.length > 0;

      state.syncD1ToClassicProducts();
      const products = state.getProducts();
      let maxId = products.reduce((max, p) => Math.max(max, !isNaN(Number(p.id)) ? Number(p.id) : 0), 0);
      const d1_products = state.getD1Products();
      if (Array.isArray(d1_products)) {
        maxId = d1_products.reduce((max, p) => Math.max(max, !isNaN(Number(p.product_nbr)) ? Number(p.product_nbr) : 0), maxId);
      }

      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID ? String(process.env.CLOUDFLARE_D1_ACCOUNT_ID).trim() : "";
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID ? String(process.env.CLOUDFLARE_D1_DATABASE_ID).trim() : "";
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN ? String(process.env.CLOUDFLARE_D1_API_TOKEN).trim() : "";

      if (accountId && databaseId && apiToken && !accountId.includes("•")) {
        try {
          const sql = "SELECT MAX(product_nbr) as max_id FROM products;";
          const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
          const maxResp = await fetch(cloudflareUrl, {
            method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ sql }),
          });
          if (maxResp.ok) {
            const maxData = await maxResp.json();
            const trueMaxId = Number(maxData.result?.[0]?.results?.[0]?.max_id ?? maxData.result?.[0]?.max_id) || 0;
            maxId = Math.max(maxId, trueMaxId);
          }
        } catch (e) {
          console.error("Failed to query live max product_nbr from D1:", e);
        }
      }

      const nextIdNum = maxId + 1;

      // SEO is mandatory for new products too — same generated-default logic
      // as the update route below, so a product created without ever
      // opening Admin > SEO still gets a real, non-empty, per-product title/
      // description/slug instead of relying on a client-side fallback that
      // (until this fix) never made it past the request into D1 anyway.
      const existingSlugs = products.map((p: any) => p.slug).filter(Boolean);
      const generatedSeo = buildMandatoryProductSeo(
        {
          name, name_en, description, category,
          requestedSlug: slug, requestedSeoTitle: seo_title,
          requestedSeoDescription: seo_description,
          requestedSeoPriority: seo_priority, requestedSeoChangefreq: seo_changefreq,
        },
        existingSlugs,
      );
      slug = generatedSeo.slug;
      seo_title = generatedSeo.seo_title;
      seo_description = generatedSeo.seo_description;
      seo_priority = generatedSeo.seo_priority;
      seo_changefreq = generatedSeo.seo_changefreq;

      const newProduct = {
        id: String(nextIdNum), name, name_en, category, price, originalPrice, isSale,
        isAvailable: isAvailable !== undefined ? isAvailable : true, showInSwiper,
        image: image ? image.replace(/^(src|public)\//, "/") : "",
        description, benefits, usage, ingredients, tag,
        showDescription: showDescription !== undefined ? !!showDescription : true,
        showBenefits: showBenefits !== undefined ? !!showBenefits : true,
        showUsage: showUsage !== undefined ? !!showUsage : true,
        showIngredients: showIngredients !== undefined ? !!showIngredients : true,
        exclude_from_sitemap: exclude_from_sitemap ? 1 : 0,
        displaySection: displaySection || "both",
        seo_title, seo_description, seo_priority, seo_changefreq, slug,
        size_ml: resolvedSize.size_ml ?? null,
        size_label: resolvedSize.size_label ?? "",
        volume: resolvedSize.size_label ?? "",
        show_size: finalShowSize ? 1 : 0,
        showSize: finalShowSize,
        isPack: finalIsPack,
        packProductIds: safePackProductIds,
      };
      products.push(newProduct);
      state.setD1ApiCacheProducts({ data: null, timestamp: 0 });
      state.syncClassicToSqlProducts();
      await state.saveDb();

      try {
        const nextNbr = Number(newProduct.id);
        const parsedPrice = parseFloat(price ? price.toString().replace(" DH", "") : "60.0");
        const activePriceNum = isNaN(parsedPrice) ? 60.0 : parsedPrice;
        let origPriceNum = activePriceNum;
        if (originalPrice) {
          origPriceNum = parseFloat(originalPrice.toString().replace(" DH", "")) || activePriceNum;
        }
        // RAW values — bound as query parameters below, so quote-escaping here
        // would write literal '' pairs into the product name/description. The
        // image path rewrite stays: that's a real transform, not escaping.
        const safeBenefits = Array.isArray(benefits) ? benefits.join("\n") : benefits || "";
        const safeName = name || "";
        const safeNameEn = name_en || "";
        const safeDesc = description || "";
        const safeImg = image ? image.replace(/^(src|public)\//, "/") : "";
        const safeCategory = category || "Oils";
        const safeUsage = usage || "";
        const safeIng = ingredients || "";
        const safeTag = tag || "";

        const finalAvailable = isAvailable !== false && isAvailable !== "false" && isAvailable !== 0 && isAvailable !== "0";
        const finalShowInSwiper = showInSwiper === true || showInSwiper === "true" || showInSwiper === 1 || showInSwiper === "1";
        const nextOrderIndex = products.length;
        // in_catalog (1) stays a literal — a fixed value, not input. size_ml
        // used to be a literal 50 here too, which is exactly why the size never
        // saved; it and size_label are now bound parameters. That gives 24
        // placeholders across the 25 columns, in column order. The ON CONFLICT
        // clause reads from excluded.*, so it needs none.
        const insertSql = `INSERT INTO products (product_nbr, name, name_en, price, discount_applicable, discount_price, available, size_ml, size_label, description, image_url, category, show_in_swiper, in_catalog, benefits, usage, ingredients, order_index, exclude_from_sitemap, display_section, seo_title, seo_description, seo_priority, seo_changefreq, slug, is_pack, pack_product_ids, show_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(product_nbr) DO UPDATE SET name=excluded.name, name_en=excluded.name_en, price=excluded.price, discount_applicable=excluded.discount_applicable, discount_price=excluded.discount_price, available=excluded.available, size_ml=excluded.size_ml, size_label=excluded.size_label, description=excluded.description, image_url=excluded.image_url, category=excluded.category, show_in_swiper=excluded.show_in_swiper, benefits=excluded.benefits, usage=excluded.usage, ingredients=excluded.ingredients, exclude_from_sitemap=excluded.exclude_from_sitemap, display_section=excluded.display_section, seo_title=excluded.seo_title, seo_description=excluded.seo_description, seo_priority=excluded.seo_priority, seo_changefreq=excluded.seo_changefreq, slug=excluded.slug, is_pack=excluded.is_pack, pack_product_ids=excluded.pack_product_ids, show_size=excluded.show_size;`;
        const sqlSuccess = await state.executeD1Query(insertSql, [
          nextNbr,
          safeName,
          safeNameEn,
          isSale ? origPriceNum : activePriceNum,
          isSale ? 1 : 0,
          // was `isSale ? activePriceNum : "NULL"` — the string "NULL" only
          // worked because it was interpolated unquoted; as a parameter it must
          // be a real null.
          isSale ? activePriceNum : null,
          finalAvailable ? 1 : 0,
          resolvedSize.size_ml ?? null,
          resolvedSize.size_label ?? null,
          safeDesc,
          safeImg,
          safeCategory,
          finalShowInSwiper ? 1 : 0,
          safeBenefits,
          safeUsage,
          safeIng,
          nextOrderIndex,
          exclude_from_sitemap ? 1 : 0,
          displaySection || "both",
          seo_title,
          seo_description,
          seo_priority,
          seo_changefreq,
          slug,
          finalIsPack ? 1 : 0,
          JSON.stringify(safePackProductIds),
          finalShowSize ? 1 : 0,
        ]);
        const sqlError = state.getLastD1WriteError();

        const insertDataSql = `INSERT INTO products_Data (product_id, benefits, usage, ingredients, tag) VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET benefits=excluded.benefits, usage=excluded.usage, ingredients=excluded.ingredients, tag=excluded.tag;`;
        const dataSqlSuccess = await state.executeD1Query(insertDataSql, [
          nextNbr,
          safeBenefits,
          safeUsage,
          safeIng,
          safeTag,
        ]);
        const dataSqlError = state.getLastD1WriteError();

        if (!sqlSuccess || !dataSqlSuccess) {
          products.pop();
          const reason = !sqlSuccess ? sqlError : dataSqlError;
          return res.status(500).json({ success: false, message: `Failed to save to the main database: ${reason || "unknown error"}. Product was not created.` });
        }

        // Give the new product a seo_settings row immediately, so it shows up
        // in the central SEO table without waiting for someone to open
        // Admin > SEO and re-save it. Same non-fatal reasoning as the update
        // route: the INSERT above already stored these values on the product
        // itself, which the overlay falls back to.
        const seoMirrored = await upsertSeoSetting({
          page_type: "product",
          page_url: productSeoPageUrl(nextNbr),
          title: name || name_en || "",
          seo_title,
          seo_description,
          seo_priority,
          seo_changefreq,
        });
        if (!seoMirrored) {
          console.warn(
            `[seo_settings] Could not create the SEO row for new product_nbr ${nextNbr}. The product itself saved fine.`,
          );
        }
      } catch (err) {
        console.error("Failed to propagate classic insertion to D1 Cloud Database:", err);
        products.pop();
        return res.status(500).json({ success: false, message: `Failed to save to the main database: ${state.getLastD1WriteError() || String(err)}. Product was not created.` });
      }

      await logAdminAction(req, "CREATE", "product", newProduct.id, `Created product "${name || name_en || newProduct.id}"`);
      res.json({ success: true, product: newProduct });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ success: false, message: "Failed to create product: " + (e.message || "Unknown error") });
    }
  });

  // Bulk text import: each item is either created as a new product or, if it
  // matches an existing product (matchedId set by the frontend preview step),
  // updates that product's text fields. Every row is D1-required, same as the
  // single create/update endpoints — a row that fails to save is reported as
  // failed, never silently skipped.
  router.post("/admin/products/bulk-import", authenticateAdmin, async (req, res) => {
    await state.ensureProductsDataTablesExist();
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "No items provided." });
    }
    if (items.length > 200) {
      return res.status(400).json({ success: false, message: "Maximum 200 products per import." });
    }

    const results: { name: string; status: "created" | "updated" | "failed"; message?: string }[] = [];
    state.syncD1ToClassicProducts();

    const products = state.getProducts();
    let currentMaxId = products.reduce((max: number, p: any) => Math.max(max, !isNaN(Number(p.id)) ? Number(p.id) : 0), 0);
    const d1_products = state.getD1Products();
    if (Array.isArray(d1_products)) {
      currentMaxId = d1_products.reduce((max: number, p: any) => Math.max(max, !isNaN(Number(p.product_nbr)) ? Number(p.product_nbr) : 0), currentMaxId);
    }

    const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID ? String(process.env.CLOUDFLARE_D1_ACCOUNT_ID).trim() : "";
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID ? String(process.env.CLOUDFLARE_D1_DATABASE_ID).trim() : "";
    const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN ? String(process.env.CLOUDFLARE_D1_API_TOKEN).trim() : "";

    if (accountId && databaseId && apiToken && !accountId.includes("•")) {
      try {
        const sql = "SELECT MAX(product_nbr) as max_id FROM products;";
        const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
        const maxResp = await fetch(cloudflareUrl, {
          method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        if (maxResp.ok) {
          const maxData = await maxResp.json();
          const trueMaxId = Number(maxData.result?.[0]?.results?.[0]?.max_id) || 0;
          currentMaxId = Math.max(currentMaxId, trueMaxId);
        }
      } catch (e) {
        console.error("Failed to fetch true max ID", e);
      }
    }

    for (const raw of items) {
      const name = String(raw.name || "").trim();
      if (!name) {
        results.push({ name: "(unnamed)", status: "failed", message: "Missing product name." });
        continue;
      }
      const category = String(raw.category || "Oils").trim() || "Oils";
      const priceNum = parseFloat(String(raw.price || "").replace(/[^\d.]/g, ""));
      const finalPrice = isNaN(priceNum) ? 60 : priceNum;
      const description = String(raw.description || "");
      const ingredients = String(raw.ingredients || "");
      const usageText = String(raw.usage || "");
      const benefitsArr = Array.isArray(raw.benefits) ? raw.benefits : String(raw.benefits || "").split("|").map((s: string) => s.trim()).filter(Boolean);
      const benefitsStr = benefitsArr.join("\n");
      const tag = String(raw.tag || "");

      // RAW values — see the note on the create handler; these are bound as
      // parameters, not interpolated.
      const safeName = name;
      const safeCategory = category;
      const safeDesc = description;
      const safeIng = ingredients;
      const safeUsage = usageText;
      const safeBenefits = benefitsStr;
      const safeTag = tag;

      let matched: any = null;
      if (raw.isExisting && raw.id) {
        matched = products.find((p: any) => String(p.id) === String(raw.id));
      }
      if (!matched) {
        matched = products.find(
          (p: any) => String(p.name || "").trim().toLowerCase() === name.toLowerCase() ||
            String(p.name_en || "").trim().toLowerCase() === name.toLowerCase() ||
            String(p.name_ar || "").trim().toLowerCase() === name.toLowerCase() ||
            String(p.name_fr || "").trim().toLowerCase() === name.toLowerCase(),
        );
      }

      try {
        if (matched) {
          const targetNbr = Number(matched.id);
          const updateSql = `UPDATE products SET name=?, price=?, description=?, category=?, benefits=?, usage=?, ingredients=? WHERE product_nbr=?;`;
          const sqlSuccess = await state.executeD1Query(updateSql, [
            safeName,
            finalPrice,
            safeDesc,
            safeCategory,
            safeBenefits,
            safeUsage,
            safeIng,
            targetNbr,
          ]);
          const sqlError = state.getLastD1WriteError();
          if (!sqlSuccess) {
            results.push({ name, status: "failed", message: sqlError || "Database update failed." });
            continue;
          }
          const upsertDataSql = `INSERT INTO products_Data (product_id, benefits, usage, ingredients, tag) VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET benefits=excluded.benefits, usage=excluded.usage, ingredients=excluded.ingredients, tag=excluded.tag;`;
          await state.executeD1Query(upsertDataSql, [
            targetNbr,
            safeBenefits,
            safeUsage,
            safeIng,
            safeTag,
          ]);

          matched.price = `${finalPrice} DH`;
          matched.description = description;
          matched.category = category;
          matched.benefits = benefitsArr;
          matched.usage = usageText;
          matched.ingredients = ingredients;
          matched.tag = tag;

          if (Array.isArray(d1_products)) {
            const d1Matched = d1_products.find((p: any) => String(p.product_nbr) === String(targetNbr) || String(p.id) === String(targetNbr));
            if (d1Matched) {
              d1Matched.price = finalPrice;
              d1Matched.description = description;
              d1Matched.category = category;
              d1Matched.benefits = benefitsStr;
              d1Matched.usage = usageText;
              d1Matched.ingredients = ingredients;
              d1Matched.tag = tag;
            }
          }
          results.push({ name, status: "updated" });
        } else {
          currentMaxId++;
          const nextNbr = currentMaxId;
          const nextOrderIndex = products.length;

          // The constants (0, NULL, 1, NULL, '', 0, 1, 0, 'both') stay literals —
          // 8 placeholders for the 8 real values, in column order. size_ml is
          // NULL rather than the 50 it used to be: the bulk text import has no
          // size column, so claiming 50 ml invented a figure nobody entered.
          const insertSql = `INSERT INTO products (product_nbr, name, name_en, price, discount_applicable, discount_price, available, size_ml, description, image_url, category, show_in_swiper, in_catalog, benefits, usage, ingredients, order_index, exclude_from_sitemap, display_section) VALUES (?, ?, ?, ?, 0, NULL, 1, NULL, ?, '', ?, 0, 1, ?, ?, ?, ?, 0, 'both');`;
          const sqlSuccess = await state.executeD1Query(insertSql, [
            nextNbr,
            safeName,
            safeName,
            finalPrice,
            safeDesc,
            safeCategory,
            safeBenefits,
            safeUsage,
            safeIng,
            nextOrderIndex,
          ]);
          const sqlError = state.getLastD1WriteError();
          if (!sqlSuccess) {
            results.push({ name, status: "failed", message: sqlError || "Database insert failed." });
            continue;
          }
          const insertDataSql = `INSERT INTO products_Data (product_id, benefits, usage, ingredients, tag) VALUES (?, ?, ?, ?, ?);`;
          await state.executeD1Query(insertDataSql, [
            nextNbr,
            safeBenefits,
            safeUsage,
            safeIng,
            safeTag,
          ]);

          products.push({
            id: String(nextNbr), name, name_en: name, category, price: `${finalPrice} DH`,
            isAvailable: true, image: "", description, benefits: benefitsArr, usage: usageText, ingredients, tag,
            showDescription: true, showBenefits: true, showUsage: true, showIngredients: true,
            exclude_from_sitemap: 0, displaySection: "both",
          });

          if (Array.isArray(d1_products)) {
            d1_products.push({
              product_nbr: nextNbr, id: nextNbr, name, name_en: name, category, price: finalPrice,
              description, benefits: benefitsStr, usage: usageText, ingredients, tag,
            });
          }
          results.push({ name, status: "created" });
        }
      } catch (err: any) {
        console.error("[Bulk Import Row Failed]", name, err);
        results.push({ name, status: "failed", message: String(err?.message || err) });
      }
    }

    state.setD1ApiCacheProducts({ data: null, timestamp: 0 });
    state.syncClassicToSqlProducts();
    await state.saveDb();

    await logAdminAction(req, "BULK_IMPORT", "product", null, `Imported ${results.length} items (${results.filter((r) => r.status === "created").length} created, ${results.filter((r) => r.status === "updated").length} updated)`);
    res.json({ success: true, results });
  });

  // Admin: update a product
  router.put("/admin/products/:id", authenticateAdmin, async (req, res) => {
    await state.ensureProductsDataTablesExist();
    try {
      const { id } = req.params;
      let { name, name_en, category, price, originalPrice, isAvailable, showInSwiper, image, description, benefits, usage, ingredients, tag, showDescription, showBenefits, showUsage, showIngredients, show_size, showSize, exclude_from_sitemap, displaySection, seo_title, seo_description, seo_priority, seo_changefreq, slug, size_ml, size_label, isPack, packProductIds } = req.body;

      const showSizeProvided = show_size !== undefined || showSize !== undefined;
      const finalShowSize = show_size !== undefined ? (show_size === true || show_size === 1 || show_size === "1") : (showSize !== undefined ? !!showSize : undefined);

      // Neither size field was read from the body here, and the UPDATE ... SET
      // statement below had no size column in it, so editing a product could
      // never change its size — the request succeeded and the value vanished.
      const resolvedSize = resolveProductSize({ size_ml, size_label });

      // `undefined` (the field wasn't in this request at all) leaves the pack
      // flag/list untouched, same contract as size_ml/size_label above — a
      // partial update (or an older client) must not blank out an existing
      // pack's product list. Sending `packProductIds` without `isPack` is
      // still treated as "update the list", since the admin picker always
      // sends both together; only an actually-empty list turns a pack back
      // into a plain product (finalIsPack below).
      const packProductIdsProvided = packProductIds !== undefined;
      const safePackProductIds: string[] = packProductIdsProvided && Array.isArray(packProductIds)
        ? packProductIds.map((pid: any) => String(pid)).filter(Boolean)
        : [];
      const isPackProvided = isPack !== undefined || packProductIdsProvided;
      const finalIsPack = isPackProvided ? (Boolean(isPack) && safePackProductIds.length > 0) : undefined;

      if (image && typeof image === "string") {
        let trimmed = image.trim();
        if (trimmed && !trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("/") && !trimmed.startsWith("./")) {
          if (trimmed.includes(".r2.dev") || trimmed.includes(".cloudflarestorage.com") || trimmed.includes(".s3") || trimmed.includes(".")) {
            trimmed = `https://${trimmed}`;
          }
        }
        image = trimmed;
      }

      const isSale = !!originalPrice && originalPrice.toString().trim() !== "";
      const finalAvailable = isAvailable === true || isAvailable === "true" || isAvailable === 1 || isAvailable === "1" || isAvailable === undefined || isAvailable === null;
      const finalShowInSwiper = showInSwiper === true || showInSwiper === "true" || showInSwiper === 1 || showInSwiper === "1";

      state.syncD1ToClassicProducts();
      const products = state.getProducts();
      let index = products.findIndex((p) => String(p.id) === String(id));

      // SEO is mandatory: an admin can type a custom seo_title/seo_description/
      // slug, but if any of those are left blank, a real per-product default is
      // generated here rather than persisting an empty field (which is what
      // silently produced the "every product shows the same generic
      // description" symptom once combined with the D1 write-path bug fixed
      // below). existingSlugs excludes this product's own current slug so a
      // no-op re-save doesn't get treated as a collision with itself.
      const existingSlugs = products
        .filter((p) => String(p.id) !== String(id))
        .map((p: any) => p.slug)
        .filter(Boolean);
      const generatedSeo = buildMandatoryProductSeo(
        {
          name, name_en, description, category,
          requestedSlug: slug, requestedSeoTitle: seo_title,
          requestedSeoDescription: seo_description,
          requestedSeoPriority: seo_priority, requestedSeoChangefreq: seo_changefreq,
        },
        existingSlugs,
      );
      slug = generatedSeo.slug;
      seo_title = generatedSeo.seo_title;
      seo_description = generatedSeo.seo_description;
      seo_priority = generatedSeo.seo_priority;
      seo_changefreq = generatedSeo.seo_changefreq;

      const updatedProduct = {
        ...(index !== -1 ? products[index] : {}),
        id: String(id), name, name_en, category, price, originalPrice, isSale,
        isAvailable: finalAvailable, showInSwiper: finalShowInSwiper,
        image: image ? image.replace(/^(src|public)\//, "/") : "",
        description, benefits, usage, ingredients, tag,
        showDescription: showDescription !== undefined ? !!showDescription : true,
        showBenefits: showBenefits !== undefined ? !!showBenefits : true,
        showUsage: showUsage !== undefined ? !!showUsage : true,
        showIngredients: showIngredients !== undefined ? !!showIngredients : true,
        exclude_from_sitemap: exclude_from_sitemap ? 1 : 0,
        displaySection: displaySection || "both",
        seo_title, seo_description, seo_priority, seo_changefreq, slug,
        // `undefined` means the client didn't send that field at all — spread
        // from the existing product above and leave it untouched. The two fields
        // are decided separately for the same reason as the SET clause below: a
        // size_ml-only request must not blank the label.
        ...(resolvedSize.size_ml !== undefined ? { size_ml: resolvedSize.size_ml } : {}),
        ...(resolvedSize.size_label !== undefined
          ? { size_label: resolvedSize.size_label ?? "", volume: resolvedSize.size_label ?? "" }
          : {}),
        ...(showSizeProvided ? { show_size: finalShowSize ? 1 : 0, showSize: finalShowSize } : {}),
        ...(isPackProvided ? { isPack: finalIsPack, packProductIds: safePackProductIds } : {}),
      };

      if (index !== -1) {
        products[index] = updatedProduct;
      } else {
        products.push(updatedProduct);
      }

      state.setD1ApiCacheProducts({ data: null, timestamp: 0 });

      const targetNbr = Number(id);
      const d1_products = state.getD1Products();
      if (!isNaN(targetNbr) && Array.isArray(d1_products)) {
        const d1Idx = d1_products.findIndex((p) => p.product_nbr === targetNbr);
        const benefitsStr = Array.isArray(benefits) ? benefits.join("\n") : benefits || "";
        if (d1Idx !== -1) {
          d1_products[d1Idx] = {
            ...d1_products[d1Idx], name, name_en, category, description,
            image_url: image ? image.replace(/^(src|public)\//, "/") : "",
            available: finalAvailable ? 1 : 0, show_in_swiper: finalShowInSwiper ? 1 : 0, in_catalog: 1,
            benefits: benefitsStr, usage, ingredients, tag,
            exclude_from_sitemap: exclude_from_sitemap ? 1 : 0, display_section: displaySection || "both",
            seo_title, seo_description, seo_priority, seo_changefreq, slug,
            ...(resolvedSize.size_ml !== undefined ? { size_ml: resolvedSize.size_ml } : {}),
            ...(resolvedSize.size_label !== undefined ? { size_label: resolvedSize.size_label } : {}),
            ...(showSizeProvided ? { show_size: finalShowSize ? 1 : 0 } : {}),
            ...(isPackProvided ? { is_pack: finalIsPack ? 1 : 0, pack_product_ids: JSON.stringify(safePackProductIds) } : {}),
          };
        }
      }

      state.syncClassicToSqlProducts();
      await state.saveDb();

      // Declared out here, not inside the block below, so the final res.json
      // can report it: it stays `undefined` (no warning) for the classic/no-D1
      // path and for an unparseable id, and is only ever set to `false` on the
      // one write it actually describes.
      let productsDataMirrorFailed = false;

      if (!isNaN(targetNbr)) {
        try {
          const parsedPrice = parseFloat(price ? price.toString().replace(" DH", "") : "60.0");
          const activePriceNum = isNaN(parsedPrice) ? 60.0 : parsedPrice;
          let origPriceNum = activePriceNum;
          if (originalPrice) {
            origPriceNum = parseFloat(originalPrice.toString().replace(" DH", "")) || activePriceNum;
          }
          // RAW values — bound as parameters, see the create handler's note.
          const safeBenefits = Array.isArray(benefits) ? benefits.join("\n") : benefits || "";
          const safeName = name || "";
          const safeNameEn = name_en || "";
          const safeDesc = description || "";
          const safeImg = image ? image.replace(/^(src|public)\//, "/") : "";
          const safeCategory = category || "Oils";
          const safeUsage = usage || "";
          const safeIng = ingredients || "";
          const safeTag = tag || "";

          // The size columns are appended only when the request actually carried
          // a size, so a client that doesn't know about the field (or a partial
          // update) leaves the stored value alone instead of blanking it. The
          // clause and its parameters are built as a pair so they cannot drift.
          // Each column is decided on its own. Treating them as a pair meant a
          // body carrying size_ml but no size_label (an older client, or a stale
          // admin bundle still posting the numeric field) entered this branch
          // and wrote size_label = NULL — silently erasing the size text the
          // shop displays. `undefined` from resolveProductSize means "the caller
          // said nothing about this column", and now genuinely leaves it alone.
          const sizeSetClause: string[] = [];
          const sizeSetParams: any[] = [];
          if (resolvedSize.size_ml !== undefined) {
            sizeSetClause.push("size_ml=?");
            sizeSetParams.push(resolvedSize.size_ml);
          }
          if (resolvedSize.size_label !== undefined) {
            sizeSetClause.push("size_label=?");
            sizeSetParams.push(resolvedSize.size_label);
          }
          if (showSizeProvided) {
            sizeSetClause.push("show_size=?");
            sizeSetParams.push(finalShowSize ? 1 : 0);
          }
          // Same conditional-append contract as size_ml/size_label just
          // above: only touch these columns when the request actually
          // carried pack data, so an edit made from a form that doesn't
          // know about packs can't blank out an existing pack's product list.
          if (isPackProvided) {
            sizeSetClause.push("is_pack=?", "pack_product_ids=?");
            sizeSetParams.push(finalIsPack ? 1 : 0, JSON.stringify(safePackProductIds));
          }

          // in_catalog=1 stays a literal; every other assignment is a parameter,
          // then the WHERE value last.
          const updateSql = `UPDATE products SET name=?, name_en=?, price=?, discount_applicable=?, discount_price=?, available=?, description=?, image_url=?, category=?, show_in_swiper=?, in_catalog=1, benefits=?, usage=?, ingredients=?, exclude_from_sitemap=?, display_section=?, seo_title=?, seo_description=?, seo_priority=?, seo_changefreq=?, slug=?${sizeSetClause.length ? `, ${sizeSetClause.join(", ")}` : ""} WHERE product_nbr=?;`;
          const sqlSuccess = await state.executeD1Query(updateSql, [
            safeName,
            safeNameEn,
            isSale ? origPriceNum : activePriceNum,
            isSale ? 1 : 0,
            // See the create handler: the literal string "NULL" has to become a
            // real null once it's a bound value.
            isSale ? activePriceNum : null,
            finalAvailable ? 1 : 0,
            safeDesc,
            safeImg,
            safeCategory,
            finalShowInSwiper ? 1 : 0,
            safeBenefits,
            safeUsage,
            safeIng,
            exclude_from_sitemap ? 1 : 0,
            displaySection || "both",
            seo_title,
            seo_description,
            seo_priority,
            seo_changefreq,
            slug,
            ...sizeSetParams,
            targetNbr,
          ]);
          const sqlError = state.getLastD1WriteError();
          const upsertDataSql = `INSERT INTO products_Data (product_id, benefits, usage, ingredients, tag) VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET benefits=excluded.benefits, usage=excluded.usage, ingredients=excluded.ingredients, tag=excluded.tag;`;
          const dataSqlSuccess = await state.executeD1Query(upsertDataSql, [
            targetNbr,
            safeBenefits,
            safeUsage,
            safeIng,
            safeTag,
          ]);
          const dataSqlError = state.getLastD1WriteError();

          if (!sqlSuccess) {
            return res.status(500).json({ success: false, message: `Failed to save to the main database: ${sqlError || "unknown error"}. Changes were not saved.` });
          }
          if (safeImg) {
            try {
              // The legacy `images` D1 table is retired — the INSERT/dedupe
              // pair that used to run here was two guaranteed-failing D1
              // round-trips on every single product save. The image URL is
              // already persisted on products.image_url by the UPDATE above;
              // the local tracking below is what the admin listing reads.
              const uploadedImages = state.getUploadedImages();
              if (!uploadedImages.includes(safeImg)) uploadedImages.push(safeImg);
              const d1_images = state.getD1Images();
              if (!d1_images.some((img) => img.url === safeImg)) {
                d1_images.push({ id: Date.now(), url: safeImg, name: safeName, uploaded_at: new Date().toISOString() });
              }
            } catch (e) {}
          }

          if (!dataSqlSuccess) {
            // Not fatal for the same reason the SEO mirror below isn't: the
            // main `products` row already has the tag the admin set, and the
            // storefront reads from there. But this table IS what the edit
            // modal re-fetches the tag from on open (GET /products/:id/data),
            // so leaving it stale here is exactly what previously made the
            // Tag/Badge radio in AdminProductModal appear to "select itself" —
            // the admin would reopen the product and see the wrong radio
            // checked, from a `tag` this write never actually applied. Surfaced
            // to the client as a warning rather than a failure, so the
            // request that DID succeed doesn't get reported as if it hadn't.
            console.warn("Failed to update products_Data (legacy table), but main products table updated. Error:", dataSqlError);
            productsDataMirrorFailed = true;
          }

          // Mirror this product's SEO into the central seo_settings table,
          // which is the source of truth the public read paths overlay from
          // (see src/server/services/seoSettings.ts). Without this, editing a
          // product's SEO here left the seo_settings row untouched, so the
          // admin's change never showed up in that table.
          //
          // Deliberately not fatal: the UPDATE above already persisted the
          // same values onto products.seo_title/seo_description, and the
          // overlay only replaces a product's own values when seo_settings
          // actually has a non-empty one. So if this mirror fails, the edit
          // still takes effect from the products table — it just isn't
          // centralized yet. Failing the request here would throw away a
          // save that genuinely succeeded.
          const seoMirrored = await upsertSeoSetting({
            page_type: "product",
            page_url: productSeoPageUrl(targetNbr),
            title: name || name_en || "",
            seo_title,
            seo_description,
            seo_priority,
            seo_changefreq,
          });
          if (!seoMirrored) {
            console.warn(
              `[seo_settings] Could not mirror SEO for product_nbr ${targetNbr}. The products table was updated, so the change is still live via the fallback path.`,
            );
          }
        } catch (err) {
          console.error("Failed to propagate classic update to D1 Cloud Database:", err);
          return res.status(500).json({ success: false, message: `Failed to save to the main database: ${state.getLastD1WriteError() || String(err)}. Changes were not saved.` });
        }
      }

      await logAdminAction(req, "UPDATE", "product", id, `Updated product "${name || name_en || id}"`);
      res.json({
        success: true,
        product: updatedProduct,
        ...(productsDataMirrorFailed
          ? { warning: "Saved, but the tag/benefits mirror table did not update — reopening this product may show the previous tag until the next successful save." }
          : {}),
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ success: false, message: "Failed to update product: " + (e.message || "Unknown error") });
    }
  });

  // Admin: hard-delete a product
  router.delete("/admin/products/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const targetNbr = Number(id);

    state.syncD1ToClassicProducts();
    const products = state.getProducts();
    const index = products.findIndex((p) => String(p.id) === String(id));
    if (index !== -1) products.splice(index, 1);

    const d1_products = state.getD1Products();
    if (!isNaN(targetNbr)) {
      const d1Idx = d1_products.findIndex((p) => p.product_nbr === targetNbr);
      if (d1Idx !== -1) d1_products.splice(d1Idx, 1);
    }

    state.setD1ApiCacheProducts({ data: null, timestamp: 0 });
    state.syncClassicToSqlProducts();
    await state.saveDb();

    if (!isNaN(targetNbr)) {
      try {
        const d1DataSuccess = await state.executeD1Query(`DELETE FROM products_Data WHERE product_id=?;`, [targetNbr]);
        const d1Success = await state.executeD1Query(`DELETE FROM products WHERE product_nbr=?;`, [targetNbr]);
        if (!d1DataSuccess || !d1Success) {
          console.warn("Cloudflare D1 deletion skipped or returned warning, product deleted from local database.");
        }
      } catch (err) {
        console.warn("Cloudflare D1 delete warning (deleted locally):", err);
      }
    }

    await logAdminAction(req, "DELETE", "product", id, `Deleted product #${id}`);
    res.json({ success: true, message: "Product deleted" });
  });

  // ---------------------------------------------------------------
  // Bulk actions on many products at once
  //
  // Both handlers below chunk their id list. Cloudflare D1 rejects a query
  // carrying more than 100 bound parameters, so a single `IN (?, ?, …)` built
  // from the whole selection would fail outright once an admin selects enough
  // products — and it would fail for the entire batch, not just the overflow.
  // 50 per statement leaves headroom for the SET clause's own parameters.
  // ---------------------------------------------------------------
  const ID_CHUNK_SIZE = 50;

  const chunkIds = (ids: number[], size: number): number[][] => {
    const groups: number[][] = [];
    for (let i = 0; i < ids.length; i += size) groups.push(ids.slice(i, i + size));
    return groups;
  };

  /**
   * Normalises the request's productIds into product_nbr integers, de-duped.
   *
   * Non-numeric entries are dropped rather than passed through: a NaN inside
   * `IN (...)` is a SQL syntax error that fails the whole statement, which is
   * the trap already documented on the city bulk-price route.
   */
  const parseProductIds = (raw: any): number[] => {
    if (!Array.isArray(raw)) return [];
    const out = new Set<number>();
    for (const id of raw) {
      const n = parseInt(String(id), 10);
      if (Number.isInteger(n)) out.add(n);
    }
    return Array.from(out);
  };

  const asBool = (v: any): boolean =>
    v === true || v === "true" || v === 1 || v === "1";

  // Admin: apply the same field change to many products at once
  router.post("/admin/products/bulk-update", authenticateAdmin, async (req, res) => {
    try {
      const { productIds, changes } = req.body || {};
      const ids = parseProductIds(productIds);
      if (ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "productIds must be a non-empty array of numeric product ids",
        });
      }
      if (!changes || typeof changes !== "object") {
        return res.status(400).json({ success: false, message: "changes must be an object" });
      }

      // The SQL fragment and its bound value are appended together so the two
      // lists cannot fall out of alignment as fields are added here.
      const setFragments: string[] = [];
      const setParams: any[] = [];
      const setField = (fragment: string, value: any) => {
        setFragments.push(fragment);
        setParams.push(value);
      };

      // The equivalent patch in the classic in-memory shape. Kept beside each
      // SET so the two representations cannot disagree — the column is 0/1 and
      // the in-memory field is a boolean (see mapD1RowToProductSchema).
      const patch: Record<string, any> = {};

      if (changes.isAvailable !== undefined) {
        const v = asBool(changes.isAvailable);
        setField("available = ?", v ? 1 : 0);
        patch.isAvailable = v;
      }
      if (changes.showInSwiper !== undefined) {
        const v = asBool(changes.showInSwiper);
        setField("show_in_swiper = ?", v ? 1 : 0);
        patch.showInSwiper = v;
      }
      if (changes.excludeFromSitemap !== undefined) {
        const v = asBool(changes.excludeFromSitemap);
        setField("exclude_from_sitemap = ?", v ? 1 : 0);
        // This one is 1/0 rather than a boolean on the classic object too.
        patch.exclude_from_sitemap = v ? 1 : 0;
      }
      if (typeof changes.category === "string" && changes.category.trim() !== "") {
        setField("category = ?", changes.category.trim());
        patch.category = changes.category.trim();
      }
      if (typeof changes.displaySection === "string" && changes.displaySection.trim() !== "") {
        setField("display_section = ?", changes.displaySection.trim());
        patch.displaySection = changes.displaySection.trim();
      }

      // in_catalog is deliberately not offered here. It is an internal flag
      // rather than a catalog field, and price/name are excluded too because
      // setting one value across many products is never what you want for them.
      if (setFragments.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "No supported field to change. Supported: isAvailable, showInSwiper, excludeFromSitemap, category, displaySection.",
        });
      }

      // Same ordering every product write route follows: merge fresh D1 rows in
      // before mutating, then invalidate the response cache, rebuild the D1
      // shape from the classic array, and persist — skipping any of these is
      // the documented cause of an edit appearing to save and then reverting.
      state.syncD1ToClassicProducts();
      const products = state.getProducts();
      const idSet = new Set(ids.map(String));
      let matchedLocally = 0;
      for (const p of products) {
        if (!p || !idSet.has(String(p.id))) continue;
        Object.assign(p, patch);
        matchedLocally++;
      }

      state.setD1ApiCacheProducts({ data: null, timestamp: 0 });
      state.syncClassicToSqlProducts();
      await state.saveDb();

      let failedIds: number[] = [];
      for (const group of chunkIds(ids, ID_CHUNK_SIZE)) {
        const placeholders = group.map(() => "?").join(", ");
        const ok = await state.executeD1Query(
          `UPDATE products SET ${setFragments.join(", ")} WHERE product_nbr IN (${placeholders});`,
          [...setParams, ...group],
        );
        if (!ok) failedIds = failedIds.concat(group);
      }

      const d1Error =
        failedIds.length > 0 ? state.getLastD1WriteError?.() || "unknown error" : null;
      if (d1Error) {
        console.error(
          `[products/bulk-update] D1 rejected ${failedIds.length} of ${ids.length} id(s): ${d1Error}`,
        );
      }

      await logAdminAction(req, "BULK_UPDATE", "product", null, `Bulk updated ${ids.length - failedIds.length} products`);
      res.json({
        success: failedIds.length === 0,
        updatedCount: ids.length - failedIds.length,
        failedCount: failedIds.length,
        matchedLocally,
        changed: Object.keys(patch),
        ...(d1Error
          ? {
              message: `Applied locally, but the database rejected ${failedIds.length} of ${ids.length} product(s): ${d1Error}`,
            }
          : {}),
      });
    } catch (err: any) {
      console.error("[products/bulk-update] failed:", err);
      res.status(500).json({
        success: false,
        message: "Failed to apply bulk changes: " + (err?.message || "unknown error"),
      });
    }
  });

  // Admin: delete many products at once
  router.post("/admin/products/bulk-delete", authenticateAdmin, async (req, res) => {
    try {
      const ids = parseProductIds(req.body?.productIds);
      if (ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: "productIds must be a non-empty array of numeric product ids",
        });
      }

      await state.ensureProductsDataTablesExist();
      state.syncD1ToClassicProducts();

      const products = state.getProducts();
      const idSet = new Set(ids.map(String));
      let removedLocally = 0;
      for (let i = products.length - 1; i >= 0; i--) {
        if (products[i] && idSet.has(String(products[i].id))) {
          products.splice(i, 1);
          removedLocally++;
        }
      }

      // d1_products has to be spliced explicitly. syncClassicToSqlProducts
      // merges the classic array *into* the existing d1_products map and never
      // drops entries, so a row left here would be re-added on the next sync —
      // i.e. the deleted products would come back.
      const d1_products = state.getD1Products();
      const idNumSet = new Set(ids);
      for (let i = d1_products.length - 1; i >= 0; i--) {
        if (d1_products[i] && idNumSet.has(Number(d1_products[i].product_nbr))) {
          d1_products.splice(i, 1);
        }
      }

      state.setD1ApiCacheProducts({ data: null, timestamp: 0 });
      state.syncClassicToSqlProducts();
      await state.saveDb();

      let failedIds: number[] = [];
      for (const group of chunkIds(ids, ID_CHUNK_SIZE)) {
        const placeholders = group.map(() => "?").join(", ");
        // products_Data first — it keys off product_nbr, so clearing the child
        // rows before the parent avoids leaving orphans behind if the second
        // statement fails.
        const okData = await state.executeD1Query(
          `DELETE FROM products_Data WHERE product_id IN (${placeholders});`,
          group,
        );
        const okMain = await state.executeD1Query(
          `DELETE FROM products WHERE product_nbr IN (${placeholders});`,
          group,
        );
        if (!okMain) {
          failedIds = failedIds.concat(group);
        } else if (!okData) {
          console.warn(
            `[products/bulk-delete] products rows deleted but products_Data cleanup failed for ${group.length} id(s)`,
          );
        }
      }

      const d1Error =
        failedIds.length > 0 ? state.getLastD1WriteError?.() || "unknown error" : null;
      if (d1Error) {
        console.error(
          `[products/bulk-delete] D1 rejected ${failedIds.length} of ${ids.length} id(s): ${d1Error}`,
        );
      }

      await logAdminAction(req, "BULK_DELETE", "product", null, `Bulk deleted ${ids.length - failedIds.length} products`);
      res.json({
        success: failedIds.length === 0,
        deletedCount: ids.length - failedIds.length,
        failedCount: failedIds.length,
        removedLocally,
        ...(d1Error
          ? {
              message: `Removed locally, but the database rejected ${failedIds.length} of ${ids.length} product(s): ${d1Error}`,
            }
          : {}),
      });
    } catch (err: any) {
      console.error("[products/bulk-delete] failed:", err);
      res.status(500).json({
        success: false,
        message: "Failed to delete the selected products: " + (err?.message || "unknown error"),
      });
    }
  });

  return router;
}
