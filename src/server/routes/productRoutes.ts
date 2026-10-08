import express from "express";
import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";
import { normalizeSizeLabel } from "../../lib/sizeUtils";

// Product catalog routes for the Public Storefront.
// Only customer-facing GET /products and GET /products/:id/data are exposed.
// Admin product management (CRUD, reorder, seed, bulk import/export) belongs strictly in the Admin Dashboard.

interface ProductsState {
  getProducts: () => any[];
  getD1Products: () => any[];
  setD1Products: (v: any[]) => void;
  getD1ApiCacheProducts: () => { data: any; timestamp: number };
  setD1ApiCacheProducts: (v: { data: any; timestamp: number }) => void;
  getStoreSettings: () => any;
  refreshStoreSettings?: (force?: boolean) => Promise<void>;
  fetchProductsFromD1: () => Promise<any[] | null>;
  syncD1ToClassicProducts: () => void;
  mapD1RowToProductSchema: (row: any) => any;
  ensureProductsDataTablesExist: () => Promise<boolean>;
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
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params: sqlParams }),
      });
      const data = await resp.json();
      let row = data.result?.[0]?.results?.[0] || data.result?.results?.[0];

      let benefitsArr = [];
      if (row?.benefits) {
        benefitsArr = typeof row.benefits === "string" ? row.benefits.split("\n") : row.benefits;
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

  // Public: list products and packs for the storefront
  router.get("/products", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Accept-Encoding");

    const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
    const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
    const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

    const settingsRefresh = state.refreshStoreSettings?.() ?? Promise.resolve();
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
        size_ml: (p as any).size_ml ?? null,
        size_label: normalizeSizeLabel((p as any).size_label || (p as any).volume),
        volume: normalizeSizeLabel((p as any).size_label || (p as any).volume),
        show_size: (p as any).show_size !== 0 && (p as any).show_size !== "0" && (p as any).show_size !== false && (p as any).showSize !== false,
        showSize: (p as any).show_size !== 0 && (p as any).show_size !== "0" && (p as any).show_size !== false && (p as any).showSize !== false,
        isPack: Boolean((p as any).isPack),
        packProductIds: Array.isArray((p as any).packProductIds) ? (p as any).packProductIds : [],
      })).filter((p) => p.in_catalog !== 0 && p.in_catalog !== "0");
      return res.json({ success: true, products: safeProducts, storeSettings: await buildPublicSettings() });
    }

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

  return router;
}
