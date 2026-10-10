import express from "express";
import { fetchVisibleLivePacksFromD1 } from "../services/d1Client";

interface LivePackState {
  getStoreSettings: () => any;
  refreshStoreSettings?: (force?: boolean) => Promise<void>;
  getProducts: () => any[];
}

export function createLivePackRouter(state: LivePackState) {
  const router = express.Router();

  // In-memory cache for live packs (3s TTL)
  let cachedResponse: { timestamp: number; data: any } = { timestamp: 0, data: null };
  const CACHE_TTL_MS = 3000;

  // GET /api/live-packs — Public endpoint for the storefront
  router.get("/live-packs", async (_req, res) => {
    try {
      // 1. Refresh store settings to get fresh live_packs_enabled status
      await state.refreshStoreSettings?.();
      const settings = state.getStoreSettings() || {};
      const livePacksEnabled = settings.live_packs_enabled === true;

      // Global Master Switch check
      if (!livePacksEnabled) {
        return res.json({
          success: true,
          enabled: false,
          packs: [],
        });
      }

      // Check short in-memory cache
      const now = Date.now();
      if (cachedResponse.data && now - cachedResponse.timestamp < CACHE_TTL_MS) {
        return res.json(cachedResponse.data);
      }

      // 2. Fetch visible packs from D1
      const rawPacks = await fetchVisibleLivePacksFromD1();
      const catalog = state.getProducts() || [];

      // 3. Resolve existing products inside each pack
      const resolvedPacks = (rawPacks || []).map((pack: any) => {
        let productIds: string[] = [];
        try {
          productIds = typeof pack.product_ids === "string" ? JSON.parse(pack.product_ids) : (pack.product_ids || []);
        } catch {
          productIds = [];
        }

        const products = productIds
          .map((id: string) => {
            const found = catalog.find(
              (p: any) =>
                String(p.id) === String(id) ||
                String(p.product_nbr) === String(id) ||
                (p.name && p.name.toLowerCase() === id.toLowerCase())
            );
            if (found) {
              return {
                id: String(found.id),
                name: found.name,
                name_en: found.name_en || found.name,
                name_ar: found.name_ar || found.name,
                image: found.image || "",
                price: found.price || "",
                originalPrice: found.originalPrice || null,
                category: found.category || "",
                volume: found.volume || found.size_label || "",
              };
            }
            return null;
          })
          .filter(Boolean);

        return {
          id: String(pack.id),
          name: String(pack.name || ""),
          description: String(pack.description || ""),
          product_ids: productIds,
          regular_price: Number(pack.regular_price) || 0,
          live_price: Number(pack.live_price) || 0,
          status: pack.status === "hidden" ? "hidden" : "visible",
          display_order: Number(pack.display_order) || 0,
          products,
        };
      });

      const responsePayload = {
        success: true,
        enabled: true,
        packs: resolvedPacks,
      };

      cachedResponse = { timestamp: now, data: responsePayload };
      return res.json(responsePayload);
    } catch (err: any) {
      console.error("[Storefront Live Packs] GET failed:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch live packs" });
    }
  });

  return router;
}
