import express from "express";
import { sanitizeCredentials } from "../utils/sqlUtils";
import { normalizeSectionLinkServer } from "../utils/pathUtils";
import { getSeoIndex, overlaySectionRows } from "../services/seoSettings";

// Section routes for the Public Storefront.
// Only customer-facing GET /sections and GET /homepage-sections are exposed.
// Admin section/homepage management belongs strictly in the Admin Dashboard.

interface SectionsState {
  getSections: () => any[];
  setSections: (v: any[]) => void;
  getHomepageSections: () => any[];
  setHomepageSections: (v: any[]) => void;
  getLastDbLoadTime: () => number;
  setLastDbLoadTime: (t: number) => void;
  getDbLoadCooldown: () => number;
}

export function createSectionRouter(state: SectionsState) {
  const router = express.Router();

  // Public: sections list (used by navbar, category pages, SEO)
  router.get("/sections", async (_req, res) => {
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    res.setHeader("Vary", "Accept-Encoding");
    try {
      const now = Date.now();
      const isStale = now - state.getLastDbLoadTime() > state.getDbLoadCooldown();
      const isFirstLoad = state.getLastDbLoadTime() === 0;

      if (isStale) {
        const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
        const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
        const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

        if (accountId && databaseId && apiToken) {
          const fetchFromD1 = async () => {
            try {
              const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
              const resp = await fetch(cloudflareUrl, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ sql: "SELECT * FROM sections_management ORDER BY order_index ASC;" }),
              });
              if (resp.ok) {
                const data = await resp.json();
                let rows = data.result?.[0]?.results || data.result?.results || [];
                if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
                overlaySectionRows(rows, await getSeoIndex());
                state.setSections(rows);
                state.setLastDbLoadTime(Date.now());
              }
            } catch (err) {
              console.error("Failed to background fetch sections:", err);
            }
          };
          if (isFirstLoad || state.getDbLoadCooldown() === 0) {
            await fetchFromD1();
          } else {
            fetchFromD1();
          }
        }
      }

      const cleaned = state.getSections().map((s) => ({
        ...s,
        link_url: normalizeSectionLinkServer(s.link_url),
      }));
      return res.json({ success: true, sections: cleaned });
    } catch (e: any) {
      return res.json({ success: false, message: e.message });
    }
  });

  // Public: homepage layout sections
  router.get("/homepage-sections", async (_req, res) => {
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    try {
      const now = Date.now();
      const isStale = now - state.getLastDbLoadTime() > state.getDbLoadCooldown();
      const isFirstLoad = state.getLastDbLoadTime() === 0;

      if (isStale) {
        const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
        const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
        const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

        if (accountId && databaseId && apiToken) {
          const fetchFromD1 = async () => {
            try {
              const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
              const resp = await fetch(cloudflareUrl, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ sql: "SELECT * FROM homepage_sections ORDER BY order_index ASC;" }),
              });
              if (resp.ok) {
                const data = await resp.json();
                let rows = data.result?.[0]?.results || data.result?.results || [];
                if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
                state.setHomepageSections(rows);
                state.setLastDbLoadTime(Date.now());
              }
            } catch (err) {
              console.error("Failed to background fetch homepage-sections:", err);
            }
          };
          if (isFirstLoad || state.getDbLoadCooldown() === 0) {
            await fetchFromD1();
          } else {
            fetchFromD1();
          }
        }
      }

      return res.json({ success: true, sections: state.getHomepageSections() });
    } catch (e: any) {
      return res.json({ success: false, message: e.message });
    }
  });

  return router;
}
