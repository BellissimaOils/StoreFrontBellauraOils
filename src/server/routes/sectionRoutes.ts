import express from "express";
import { authenticateAdmin } from "../middleware/auth";
import { logAdminAction } from "../services/auditLog";
import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";
import { normalizeSectionLinkServer } from "../utils/pathUtils";
import { buildMandatorySectionSeo } from "../utils/seoDefaults";
import { upsertSeoSetting, normalizeSeoKey, getSeoIndex, overlaySectionRows, invalidateSeoSettingsCache } from "../services/seoSettings";

// sections_management never had seo_title/seo_description/seo_priority/
// seo_changefreq columns, but AdminSEO.tsx's "Sections & Category Pages
// SEO" tab has been writing them for a while. Same story as the identical
// products-table bug fixed alongside this one: the INSERT OR REPLACE below
// didn't even mention these columns, and since INSERT OR REPLACE deletes the
// existing row before inserting the new one, every single section save
// (including a plain visibility toggle or drag-reorder, which round-trip
// through this same endpoint) was silently resetting them to NULL — not
// just failing to persist new edits, but erasing any that had somehow
// stuck before. ensureSectionsSeoColumnsExist() is the idempotent
// "ALTER TABLE ADD COLUMN, ignore the error if it already exists" fix,
// same idiom as ensureD1ProductsSeoColumnsExist in d1Client.ts.
async function ensureSectionsSeoColumnsExist(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<void> {
  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  const columns = [
    "ALTER TABLE sections_management ADD COLUMN seo_title TEXT;",
    "ALTER TABLE sections_management ADD COLUMN seo_description TEXT;",
    "ALTER TABLE sections_management ADD COLUMN seo_priority TEXT;",
    "ALTER TABLE sections_management ADD COLUMN seo_changefreq TEXT;",
  ];
  for (const sql of columns) {
    try {
      await fetch(cloudflareUrl, { method: "POST", headers, body: JSON.stringify({ sql }) });
    } catch (err) {
      // Ignore — column already exists, or D1 is briefly unavailable and
      // the next save attempt will retry.
    }
  }
}

// Same idempotent ALTER idiom as above, for homepage_sections. The hero
// overlay text/button, the per-device image sizing+crop settings, and the
// quote section's typography/spacing settings are each stored as a single
// JSON TEXT column rather than dozens of flat columns, specifically because
// of the INSERT OR REPLACE hazard documented above: every column has to be
// repeated in the hardcoded write list below, and any that is forgotten
// gets nulled on every save, toggle and reorder. A handful of JSON columns
// keeps that list short and lets future options ship without another
// migration. See src/lib/heroConfig.ts and src/lib/quoteConfig.ts for the
// shapes and parsing.
async function ensureHomepageSectionColumnsExist(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<void> {
  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  const columns = [
    "ALTER TABLE homepage_sections ADD COLUMN overlay_config TEXT;",
    "ALTER TABLE homepage_sections ADD COLUMN image_config TEXT;",
    "ALTER TABLE homepage_sections ADD COLUMN quote_config TEXT;",
    "ALTER TABLE homepage_sections ADD COLUMN paragraph_config TEXT;",
  ];
  for (const sql of columns) {
    try {
      await fetch(cloudflareUrl, { method: "POST", headers, body: JSON.stringify({ sql }) });
    } catch (err) {
      // Ignore — column already exists, or D1 is briefly unavailable and the
      // next save attempt will retry.
    }
  }
}

// Normalizes a config value for SQL interpolation. The admin form holds these
// as objects in local state, while a row read back from D1 is a JSON string;
// both must land in the column as JSON text.
function serializeConfigForSql(value: unknown): string {
  if (value === null || value === undefined) return "{}";
  if (typeof value === "string") return value.trim() || "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

// Sections + homepage-sections routes.
// Shared state: siteSections, homepageSections, lastDbLoadTime, DB_LOAD_COOLDOWN
// — all passed in via factory so this module stays decoupled from server.ts globals.

interface SectionsState {
  getSections: () => any[];
  setSections: (v: any[]) => void;
  getHomepageSections: () => any[];
  setHomepageSections: (v: any[]) => void;
  getLastDbLoadTime: () => number;
  setLastDbLoadTime: (t: number) => void;
  getDbLoadCooldown: () => number;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
  getLastD1WriteError?: () => string | null;
}

export function createSectionRouter(state: SectionsState) {
  const router = express.Router();

  // Public: sections list (used by navbar, category pages, SEO)
  router.get("/sections", async (req, res) => {
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
                // Overlay the central seo_settings values onto these rows
                // before they become the shared siteSections array. Doing it
                // here means the server-rendered meta tags, sitemap.xml,
                // CategoryPage and HomePage all pick up seo_settings without
                // each of them needing to know that table exists.
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

  // Admin: fetch sections (always fresh from D1)
  router.get("/admin/sections", authenticateAdmin, async (req, res) => {
    // No CDN/browser caching on an admin list, and drop the seo_settings cache
    // first: it's per serverless instance and only cleared on the instance
    // that handled the save, so a reload landing elsewhere could still hold
    // pre-save rows. Since the overlay below applies seo_settings on top of
    // each section's own columns, those stale rows would override the fresh
    // values the save just wrote — showing the admin their old text back.
    res.setHeader("Cache-Control", "no-store");
    invalidateSeoSettingsCache();
    try {
      const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
      const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
      const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

      if (accountId && databaseId && apiToken) {
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
          // Same overlay as the public route, so the admin SEO panel shows
          // the values that are actually live (seo_settings wins) rather
          // than the older sections_management copy.
          overlaySectionRows(rows, await getSeoIndex());
          state.setSections(rows);
        }
      }
      const cleaned = state.getSections().map((s) => ({
        ...s,
        link_url: normalizeSectionLinkServer(s.link_url),
      }));
      res.json({ success: true, sections: cleaned });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Admin: upsert a section
  router.post("/admin/sections", authenticateAdmin, async (req, res) => {
    try {
      const section = req.body;
      if (!section.id) section.id = "custom_" + Date.now();
      section.link_url = normalizeSectionLinkServer(section.link_url);

      const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
      const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
      const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);
      if (accountId && databaseId && apiToken) {
        await ensureSectionsSeoColumnsExist(accountId, databaseId, apiToken);
      }

      // SEO is mandatory here too: every section/category page always gets a
      // real seo_title/seo_description, generated from its own title/link
      // when the admin leaves the field blank — this also covers plain
      // visibility toggles and drag-reorders, which submit the section's
      // full existing object right back through this same endpoint, so a
      // section that already had custom SEO text keeps it rather than
      // having it regenerated from scratch each time.
      const generatedSeo = buildMandatorySectionSeo({
        title_en: section.title_en, title_ar: section.title_ar, title_fr: section.title_fr,
        link_url: section.link_url,
        requestedSeoTitle: section.seo_title, requestedSeoDescription: section.seo_description,
        requestedSeoPriority: section.seo_priority, requestedSeoChangefreq: section.seo_changefreq,
      });
      section.seo_title = generatedSeo.seo_title;
      section.seo_description = generatedSeo.seo_description;
      section.seo_priority = generatedSeo.seo_priority;
      section.seo_changefreq = generatedSeo.seo_changefreq;

      // 14 columns, 14 placeholders, 14 params — in the same order as the
      // column list above.
      const sqlStr = `
        INSERT OR REPLACE INTO sections_management 
        (id, type, title_ar, title_fr, title_en, link_url, is_visible, order_index, exclude_from_sitemap, available_layouts, seo_title, seo_description, seo_priority, seo_changefreq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const sqlParams = [
        section.id || "",
        section.type || "link",
        section.title_ar || "",
        section.title_fr || "",
        section.title_en || "",
        section.link_url || "",
        section.is_visible !== false && section.is_visible !== 0 ? 1 : 0,
        Number(section.order_index) || 0,
        section.exclude_from_sitemap ? 1 : 0,
        section.available_layouts ? JSON.stringify(section.available_layouts) : "",
        section.seo_title,
        section.seo_description,
        section.seo_priority,
        section.seo_changefreq,
      ];
      // D1 is authoritative for sections (every read path re-fetches from it),
      // so reporting success on a failed write means the edit vanishes on the
      // next page load — the classic "I saved it and it didn't stick".
      const ok = await state.executeD1Query(sqlStr, sqlParams);
      if (!ok) {
        return res.status(500).json({
          success: false,
          message: `Failed to save the section to the database: ${state.getLastD1WriteError?.() || "unknown error"}. Your changes were not saved.`,
        });
      }

      const sections = state.getSections();
      const idx = sections.findIndex((s) => s.id === section.id);
      if (idx !== -1) sections[idx] = section;
      else sections.push(section);
      state.setSections(sections);

      // Mirror this page's SEO into the central seo_settings table (see
      // src/server/services/seoSettings.ts). The home page is stored with
      // page_type 'main' rather than 'section', matching how the existing
      // rows in that table are already laid out.
      //
      // Non-fatal for the same reason as the product routes: the
      // INSERT OR REPLACE above already persisted these values onto
      // sections_management, and the read-side overlay only overrides a
      // section's own values when seo_settings has a non-empty one — so a
      // failed mirror degrades to the sections_management value instead of
      // losing the admin's edit.
      const seoMirrored = await upsertSeoSetting({
        page_type: normalizeSeoKey(section.link_url) === "" ? "main" : "section",
        page_url: section.link_url || "/",
        title: section.title_en || section.title_ar || section.title_fr || "",
        seo_title: section.seo_title,
        seo_description: section.seo_description,
        seo_priority: section.seo_priority,
        seo_changefreq: section.seo_changefreq,
      });
      if (!seoMirrored) {
        console.warn(
          `[seo_settings] Could not mirror SEO for section "${section.id}" (${section.link_url}). sections_management was updated, so the change is still live via the fallback path.`,
        );
      }

      await logAdminAction(req, "UPSERT", "section", section.id, `Saved section ${section.title_en || section.id}`);
      res.json({ success: true, section });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Admin: delete a section
  router.delete("/admin/sections/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const ok = await state.executeD1Query(`DELETE FROM sections_management WHERE id = ?;`, [id]);
      if (!ok) {
        return res.status(500).json({
          success: false,
          message: `Failed to delete the section from the database: ${state.getLastD1WriteError?.() || "unknown error"}.`,
        });
      }
      state.setSections(state.getSections().filter((s) => s.id !== id));
      await logAdminAction(req, "DELETE", "section", id, `Deleted section #${id}`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Public: homepage layout sections
  router.get("/homepage-sections", async (req, res) => {
    // This is the content of the most-visited page on the site, and it was
    // explicitly uncacheable (no-store + Pragma + Expires: 0). That forced
    // every single homepage visitor past the CDN to the origin, which then
    // often made a D1 round-trip as well — pure added TTFB on the page that
    // matters most.
    //
    // Nothing here requires that: the handler already has its own staleness
    // cooldown (isStale / getDbLoadCooldown) governing when it re-reads from
    // D1, and the sibling public endpoint GET /sections has always used
    // s-maxage=30. Matching it makes the two consistent. Admin edits appear
    // within ~30s at the edge, and the admin panel reads the separate
    // /admin/homepage-sections route, which stays uncached.
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

  // Admin: fetch homepage sections (always fresh from D1 when configured)
  router.get("/admin/homepage-sections", authenticateAdmin, async (req, res) => {
    try {
      const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
      const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
      const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

      if (accountId && databaseId && apiToken) {
        const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
        const sql = `SELECT * FROM homepage_sections ORDER BY order_index ASC;`;
        const resp = await fetch(cloudflareUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        if (resp.ok) {
          const data = await resp.json();
          let rows = data.result?.[0]?.results || data.result?.results || [];
          if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
          state.setHomepageSections(rows);
        }
      }
      res.json({ success: true, sections: state.getHomepageSections() });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Admin: upsert a homepage section
  router.post("/admin/homepage-sections", authenticateAdmin, async (req, res) => {
    try {
      const section = req.body;
      if (!section.id) section.id = "home_" + Date.now();

      const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
      const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
      const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);
      if (accountId && databaseId && apiToken) {
        await ensureHomepageSectionColumnsExist(accountId, databaseId, apiToken);
      }

      // 23 columns, 23 placeholders, 23 params — same order as the column list.
      // The four *_config values are JSON strings; serializeConfigForSql still
      // produces them, it just no longer needs its output quote-escaped.
      const sqlStr = `
        INSERT OR REPLACE INTO homepage_sections 
        (id, type, title_ar, title_fr, title_en, subtitle_ar, subtitle_fr, subtitle_en, content_ar, content_fr, content_en, image_url, image_position, image_fit, image_align, bg_color, text_color, is_visible, order_index, overlay_config, image_config, quote_config, paragraph_config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const sqlParams = [
        section.id || "",
        section.type || "paragraph",
        section.title_ar || "",
        section.title_fr || "",
        section.title_en || "",
        section.subtitle_ar || "",
        section.subtitle_fr || "",
        section.subtitle_en || "",
        section.content_ar || "",
        section.content_fr || "",
        section.content_en || "",
        section.image_url || "",
        section.image_position || "left",
        section.image_fit || "cover",
        section.image_align || "center",
        section.bg_color || "",
        section.text_color || "",
        section.is_visible !== false && section.is_visible !== 0 ? 1 : 0,
        Number(section.order_index) || 0,
        serializeConfigForSql(section.overlay_config),
        serializeConfigForSql(section.image_config),
        serializeConfigForSql(section.quote_config),
        serializeConfigForSql(section.paragraph_config),
      ];
      const ok = await state.executeD1Query(sqlStr, sqlParams);
      if (!ok) {
        return res.status(500).json({
          success: false,
          message: `Failed to save the homepage section to the database: ${state.getLastD1WriteError?.() || "unknown error"}. Your changes were not saved.`,
        });
      }

      const homepageSections = state.getHomepageSections();
      const idx = homepageSections.findIndex((s) => s.id === section.id);
      if (idx !== -1) homepageSections[idx] = section;
      else homepageSections.push(section);

      homepageSections.sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0));
      state.setHomepageSections(homepageSections);

      await logAdminAction(req, "UPSERT", "homepage-section", section.id, `Saved homepage section ${section.id}`);
      res.json({ success: true, section });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Admin: delete a homepage section
  router.delete("/admin/homepage-sections/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const sqlStr = `DELETE FROM homepage_sections WHERE id = ?;`;
      const ok = await state.executeD1Query(sqlStr, [id]);
      if (!ok) {
        return res.status(500).json({
          success: false,
          message: `Failed to delete the homepage section from the database: ${state.getLastD1WriteError?.() || "unknown error"}.`,
        });
      }

      state.setHomepageSections(state.getHomepageSections().filter((s) => s.id !== id));
      await logAdminAction(req, "DELETE", "homepage-section", id, `Deleted homepage section #${id}`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
}
