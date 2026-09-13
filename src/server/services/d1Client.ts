import fs from "fs";
import path from "path";
import { isMaskedValue, sanitizeCredentials, logD1ExecutionDetails } from "../utils/sqlUtils";
import { normalizeSizeLabel, parseSizeMlFromLabel } from "../../lib/sizeUtils";
import { getSeoIndex, overlayProductRows, overlaySectionRows } from "./seoSettings";

// Core Cloudflare D1 data-access layer: raw query execution, schema
// provisioning (CREATE TABLE / ALTER TABLE / indexes), and the
// "fetchRealD1XIfConfigured" family used to hydrate in-memory state on
// boot and on cache-miss. Extracted out of server.ts as a decoupled
// module — the only mutable state it owns internally is
// lastD1WriteError and d1OrdersTablesExistVerified (both were
// module-level `let`s in server.ts before this extraction, exposed here
// the same way plus a getter for the former since other modules read it
// via factory injection).
//
// autoSeedD1Database intentionally takes the in-memory `products` array
// as a parameter rather than importing it, since server.ts owns that
// array and only ever calls this function with its own live products —
// keeping this module free of any dependency on server.ts's global state.

// Holds the most recent D1 write failure reason, so a caller can surface the
// real cause (e.g. a permission error from a read-only-scoped API token)
// instead of only knowing "it failed". Read this immediately after a false
// return from executeRealD1QueryIfConfigured — it gets overwritten on every call.
let lastD1WriteError: string | null = null;

export function getLastD1WriteError(): string | null {
  return lastD1WriteError;
}

export async function executeRealD1QueryIfConfigured(query: string, params: any[] = []): Promise<boolean> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  if (!accountId || !databaseId || !apiToken) {
    lastD1WriteError = "D1 is not configured (missing account id, database id, or API token).";
    return false;
  }

  if (
    isMaskedValue(accountId) ||
    isMaskedValue(databaseId) ||
    isMaskedValue(apiToken)
  ) {
    console.error(
      "Cloudflare D1 Environment Warning: Detected literal masked bullet characters (•) or suffix dots in your configuration. These represent hidden placeholder values copied from the UI. Please copy and paste the actual unmasked keys from your Cloudflare dashboard into Vercel's Environment Variables.",
    );
    lastD1WriteError = "D1 credentials look like masked placeholder values, not real keys.";
    return false;
  }

  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const requestHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    logD1ExecutionDetails(query, requestHeaders, "Metadata Propagation Write");

    const cfResponse = await fetch(cloudflareUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sql: query, params }),
    });
    const data = await cfResponse.json();
    const ok = !!(cfResponse.ok && data.success);
    if (!ok) {
      // Surface Cloudflare's real error (e.g. a permission/authorization error
      // from a read-only-scoped API token) instead of silently swallowing it.
      const cfErrorMessage =
        (Array.isArray(data.errors) && data.errors[0]?.message) ||
        data.error ||
        `Cloudflare responded with HTTP ${cfResponse.status}`;
      console.error("[D1 Write Failed]", cfErrorMessage, JSON.stringify(data));
      lastD1WriteError = cfErrorMessage;
      return false;
    }
    lastD1WriteError = null;
    return true;
  } catch (err: any) {
    console.error(
      "Failed to propagate edit to Cloudflare D1 SQL database:",
      err,
    );
    lastD1WriteError = String(err?.message || err);
    return false;
  }
}

// `website_info` (where Admin > SEO > "Main Website SEO Settings" is
// supposed to persist seoTitle/seoDescription/seoKeywords) was never created
// anywhere in this codebase — there was a SELECT for it in
// fetchEverythingFromD1 and this INSERT OR REPLACE, but no CREATE TABLE.
// Every save silently failed against a table that didn't exist; the caller
// (settingsRoutes.ts) never checked the return value, so the admin got a
// "saved successfully" toast every time, and the form re-fetched empty
// settings on the next page load — which is why the textboxes appeared to
// show only their placeholder hint text and never actually held onto
// anything you typed. Same idiom as autoSeedCityTableD1's CREATE TABLE IF
// NOT EXISTS below: safe to run before every write, effectively a no-op
// once the table exists.
async function ensureWebsiteInfoTableExists(): Promise<void> {
  const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
  const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
  const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);
  if (!accountId || !databaseId || !apiToken) return;

  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  try {
    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "CREATE TABLE IF NOT EXISTS website_info (id INTEGER PRIMARY KEY, json_data TEXT);",
      }),
    });
  } catch (err) {
    // Ignore — the INSERT OR REPLACE right after this call will surface any
    // real, persistent problem (e.g. D1 unreachable) through its own return
    // value instead.
  }
}

export async function updateD1Settings(settings: any): Promise<boolean> {
  await ensureWebsiteInfoTableExists();
  // The settings blob is a single JSON TEXT column. Bound rather than
  // interpolated so no apostrophe inside any admin-entered setting (an Arabic
  // or French string with a quote in it) can terminate the literal early.
  const sql = `INSERT OR REPLACE INTO website_info (id, json_data) VALUES (1, ?);`;
  return await executeRealD1QueryIfConfigured(sql, [JSON.stringify(settings)]);
}

/**
 * Read the settings blob back out of `website_info`.
 *
 * Until this existed, the *only* place settings were ever read from D1 was
 * the `{ key: "settings" }` query inside fetchEverythingFromD1 — which runs
 * once per process, at cold boot. Every other code path read the in-memory
 * `storeSettings` object instead.
 *
 * That is fine for a single long-lived server and wrong for this deployment,
 * which runs as Vercel serverless functions (api/index.js): several instances
 * are alive at once, each with its own copy of `storeSettings` frozen at the
 * moment it booted. POST /api/admin/settings updates D1 plus the memory of
 * whichever instance happened to serve that one request; every other warm
 * instance keeps handing out its boot-time snapshot from GET /api/products
 * for as long as it stays warm. So an admin save "worked" (D1 really was
 * written, and the saving tab showed the new value because it uses the POST
 * response) yet the storefront kept serving the previous value — which is
 * exactly how a freshly saved general-review product list could keep
 * offering the old set of products indefinitely.
 *
 * Returns null on any failure, including "D1 isn't configured", so callers
 * can tell "no fresher data available" apart from a genuinely empty blob and
 * keep what they already have rather than wiping it.
 */
export async function fetchD1SettingsIfConfigured(): Promise<any | null> {
  const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
  const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
  const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

  if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
    return null;
  }

  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const response = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT json_data FROM website_info WHERE id = 1 LIMIT 1;" }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.success === false) return null;
    let rows = data.result?.[0]?.results || data.result?.results || [];
    if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
    const raw = Array.isArray(rows) && rows.length > 0 ? rows[0].json_data : null;
    if (!raw) return null;
    const parsed = JSON.parse(String(raw));
    // Only a real object is usable as a settings blob. A stored `null`, an
    // array or a bare string would otherwise replace the whole settings
    // object with something no consumer can read a field off.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.error("[settings] Failed to read website_info from D1:", err);
    return null;
  }
}

export function mapD1RowToProductSchema(d1p: any) {
  if (!d1p) return null;
  const d1Id = String(
    d1p.product_nbr !== undefined && d1p.product_nbr !== null
      ? d1p.product_nbr
      : (d1p.id || 0)
  );
  const rawPrice = parseFloat(String(d1p.price || 0).replace(/[^\d.]/g, "")) || 0;
  const rawDiscountPrice = parseFloat(String(d1p.discount_price || 0).replace(/[^\d.]/g, "")) || 0;
  const isSale = d1p.discount_applicable === 1 || d1p.discount_applicable === true || d1p.discount_applicable === "1";
  const benefitsArr = d1p.benefits
    ? (typeof d1p.benefits === "string"
        ? d1p.benefits.split("\n").map((s: string) => s.trim()).filter(Boolean)
        : d1p.benefits)
    : [];

  const rawSwiper = d1p.show_in_swiper !== undefined ? d1p.show_in_swiper : d1p.showInSwiper;
  const showInSwiper = rawSwiper === 1 || rawSwiper === "1" || rawSwiper === true || rawSwiper === "true";

  const rawAvailable = d1p.available !== undefined ? d1p.available : d1p.isAvailable;
  const isAvailable = rawAvailable !== 0 && rawAvailable !== "0" && rawAvailable !== false && rawAvailable !== "false";

  // size_ml / size_label were missing from this mapper entirely, which is why
  // the size an admin typed never came back out of /api/products or
  // /api/admin/products even on the rows where it had been stored. size_ml
  // stays null rather than defaulting to 50 — a wrong number is worse than no
  // number, and the UI already handles the empty case.
  const rawSizeMl = d1p.size_ml;
  const sizeMlNum =
    rawSizeMl === undefined || rawSizeMl === null || rawSizeMl === ""
      ? null
      : Number.isFinite(Number(rawSizeMl))
        ? Number(rawSizeMl)
        : null;
  // Deliberately NOT derived from size_ml. Every pre-existing row carries the
  // hardcoded size_ml = 50 that the create route used to write, so deriving a
  // label from it would stamp "50 ml" onto the entire catalogue — including
  // packs, which currently show "Full Kit". An empty label means "nothing was
  // entered", and the card falls back to its existing behaviour.
  const sizeLabel = normalizeSizeLabel(d1p.size_label);

  const isPackFlag = d1p.is_pack === 1 || d1p.is_pack === "1" || d1p.is_pack === true;
  let packProductIds: string[] = [];
  if (d1p.pack_product_ids) {
    try {
      const parsed = typeof d1p.pack_product_ids === "string" ? JSON.parse(d1p.pack_product_ids) : d1p.pack_product_ids;
      if (Array.isArray(parsed)) packProductIds = parsed.map((id: any) => String(id));
    } catch {
      // Malformed JSON in this column just means "no constituent products
      // recorded" — the pack still renders, it just can't pull in their
      // reviews until the admin re-saves the picker.
    }
  }

  return {
    id: d1Id,
    name: d1p.name || "",
    name_en: d1p.name_en || d1p.name || "",
    price: `${Math.round(rawPrice)} DH`,
    originalPrice: isSale && rawDiscountPrice > rawPrice ? `${Math.round(rawDiscountPrice)} DH` : null,
    image: d1p.image_url || d1p.image || "",
    category: d1p.category || "Oils",
    description: d1p.description || "",
    benefits: benefitsArr,
    usage: d1p.usage || "",
    ingredients: d1p.ingredients || "",
    isSale: Boolean(isSale),
    isAvailable: Boolean(isAvailable),
    showInSwiper: Boolean(showInSwiper),
    displaySection: d1p.display_section || d1p.displaySection || "both",
    tag: d1p.tag !== undefined && d1p.tag !== null ? String(d1p.tag).trim() : null,
    orderIndex: d1p.order_index !== undefined ? Number(d1p.order_index) : 0,
    in_catalog: d1p.in_catalog !== undefined && d1p.in_catalog !== null ? Number(d1p.in_catalog) : 1,
    exclude_from_sitemap: d1p.exclude_from_sitemap === 1 || d1p.exclude_from_sitemap === "1" || d1p.exclude_from_sitemap === true ? 1 : 0,
    seo_title: d1p.seo_title || "",
    seo_description: d1p.seo_description || "",
    seo_priority: d1p.seo_priority || "",
    seo_changefreq: d1p.seo_changefreq || "",
    slug: d1p.slug || "",
    size_ml: sizeMlNum,
    size_label: sizeLabel,
    // `volume` is the field the storefront already reads (types.ts, the
    // ProductDetail sticky bar). It was declared but nothing ever populated
    // it; it is the same concept as size_label, so it is filled from the same
    // value instead of introducing a third name for one thing.
    volume: sizeLabel,
    show_size: d1p.show_size !== 0 && d1p.show_size !== "0" && d1p.show_size !== false && (d1p as any).showSize !== false ? 1 : 0,
    showSize: d1p.show_size !== 0 && d1p.show_size !== "0" && d1p.show_size !== false && (d1p as any).showSize !== false,
    isPack: isPackFlag,
    packProductIds,
  };
}

export async function fetchRealD1ProductsIfConfigured(
  getProductsForSeeding?: () => any[],
): Promise<any[] | null> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  if (!accountId || !databaseId || !apiToken) {
    return null;
  }

  if (
    isMaskedValue(accountId) ||
    isMaskedValue(databaseId) ||
    isMaskedValue(apiToken)
  ) {
    console.error(
      "Cloudflare D1 Environment Warning: Detected literal masked bullet characters (•) or suffix dots in your configuration. These represent hidden placeholder values copied from the UI. Please copy and paste the actual unmasked keys from your Cloudflare dashboard into Vercel's Environment Variables.",
    );
    return null;
  }

  try {
    await ensureD1OrdersTablesExist(accountId, databaseId, apiToken);
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const requestHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    logD1ExecutionDetails(
      "SELECT p.*, pd.tag as tag FROM products p LEFT JOIN products_Data pd ON p.product_nbr = pd.product_id ORDER BY p.order_index ASC, p.product_nbr ASC;",
      requestHeaders,
      "Products Auto-Fetch",
    );

    const cfResponse = await fetch(cloudflareUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        sql: "SELECT p.*, pd.tag as tag FROM products p LEFT JOIN products_Data pd ON p.product_nbr = pd.product_id ORDER BY p.order_index ASC, p.product_nbr ASC;",
      }),
    });

    if (cfResponse.ok) {
      const data = await cfResponse.json();
      if (data.success) {
        let resultData = data.result?.[0] || data.result || null;
        if (
          resultData &&
          resultData.results &&
          Array.isArray(resultData.results)
        ) {
          resultData = resultData.results;
        }
        if (Array.isArray(resultData)) {
          // Overlay the central seo_settings values onto the raw product rows
          // here, at the single point where they enter the process. Every
          // product consumer derives from these rows — the classic products
          // array (via both productSync converters), the /api/products
          // response cache (via mapD1RowToProductSchema), the admin list,
          // the server-rendered meta tags and sitemap.xml — so this one call
          // is what makes seo_settings authoritative for products without
          // touching any of those call sites.
          overlayProductRows(resultData, await getSeoIndex());
          // If Connected to D1 but table 'products' returns empty (0 rows),
          // auto-seed it immediately so they don't see a blank page!
          if (resultData.length === 0) {
            console.log(
              "Cloudflare D1 products table is empty. Triggering automated catalog seed...",
            );
            const seedOk = await autoSeedD1Database(
              accountId,
              databaseId,
              apiToken,
              getProductsForSeeding ? getProductsForSeeding() : [],
            );
            if (seedOk) {
              const finalFetch = await fetch(cloudflareUrl, {
                method: "POST",
                headers: requestHeaders,
                body: JSON.stringify({
                  sql: "SELECT p.*, pd.tag as tag FROM products p LEFT JOIN products_Data pd ON p.product_nbr = pd.product_id ORDER BY p.order_index ASC, p.product_nbr ASC;",
                }),
              });
              if (finalFetch.ok) {
                const finalData = await finalFetch.json();
                let rows = finalData.result?.[0] || finalData.result || null;
                if (rows && rows.results && Array.isArray(rows.results)) {
                  rows = rows.results;
                }
                if (Array.isArray(rows) && rows.length > 0) {
                  return rows;
                }
              }
            }
          }
          return resultData;
        }
      }
    }
  } catch (err) {
    console.error("Error fetching live products from Cloudflare D1:", err);
  }
  return null;
}

// (fetchRealD1ImagesIfConfigured removed — the `images` D1 table is retired,
// so it had already been reduced to a stub that parsed credentials and then
// unconditionally returned null. Image listings come from R2 + the local
// uploadedImages/d1_images tracking instead.)

export async function fetchRealD1CountriesIfConfigured(): Promise<any[] | null> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
    return null;
  }
  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const response = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT * FROM countries" }),
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.result && data.result[0] && data.result[0].results) {
        return data.result[0].results;
      }
    }
  } catch (err) {}
  return null;
}

export async function fetchRealD1CouponsIfConfigured(): Promise<any[] | null> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  if (!accountId || !databaseId || !apiToken) {
    return null;
  }

  if (
    isMaskedValue(accountId) ||
    isMaskedValue(databaseId) ||
    isMaskedValue(apiToken)
  ) {
    return null;
  }

  try {
    await ensureD1OrdersTablesExist(accountId, databaseId, apiToken);

    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const requestHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const cfRes = await fetch(cloudflareUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sql: "SELECT * FROM coupons ORDER BY code ASC;" }),
    });

    if (cfRes.ok) {
      const data = await cfRes.json();
      if (data.success && data.result?.[0]?.results) {
        return data.result[0].results.map((row: any) => {
          let appProducts = null;
          if (row.applicableProducts) {
            try {
              appProducts = JSON.parse(row.applicableProducts);
            } catch (e) {
              appProducts = null;
            }
          }
          return {
            id: row.id,
            code: row.code,
            discountType: row.discountType,
            discountValue: parseFloat(row.discountValue),
            isActive: Boolean(row.isActive),
            expiresAt: row.expiresAt || null,
            minCartAmount:
              row.minCartAmount !== null && row.minCartAmount !== undefined
                ? parseFloat(row.minCartAmount)
                : null,
            applicableProducts: appProducts,
          };
        });
      }
    }
  } catch (err) {
    console.error("Error fetching live coupons from Cloudflare D1:", err);
  }
  return null;
}

async function ensureD1ProductsDataTagColumnExists(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<boolean> {
  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const response = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "ALTER TABLE products_Data ADD COLUMN tag TEXT;",
      }),
    });
    return response.ok;
  } catch (err) {
    // Ignore error
  }
  return false;
}

// The `products` table (created in autoSeedD1Database, below) never had
// seo_title/seo_description/seo_priority/seo_changefreq/slug columns —
// AdminSEO.tsx's per-product SEO form has been writing these fields for a
// while, but PUT/POST /admin/products silently discarded them because
// there was nowhere in D1 to put them. That's why every product page ends
// up showing the same generic fallback description: the custom SEO text an
// admin types in never actually persists.
//
// SQLite/D1 ALTER TABLE ADD COLUMN fails if the column already exists, and
// there's no "IF NOT EXISTS" for columns, so — same idiom as
// ensureD1ProductsDataTagColumnExists above — each ALTER is fired and its
// error ignored; only the very first run on a given database does real
// work, every run after is a harmless no-op.
async function ensureD1ProductsSeoColumnsExist(
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
    "ALTER TABLE products ADD COLUMN seo_title TEXT;",
    "ALTER TABLE products ADD COLUMN seo_description TEXT;",
    "ALTER TABLE products ADD COLUMN seo_priority TEXT;",
    "ALTER TABLE products ADD COLUMN seo_changefreq TEXT;",
    "ALTER TABLE products ADD COLUMN slug TEXT;",
  ];
  for (const sql of columns) {
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ sql }),
      });
    } catch (err) {
      // Ignore — column already exists, or D1 is briefly unavailable and
      // the next call to ensureProductsDataTablesExist (run before every
      // product create/update) will retry.
    }
  }
}

// size_label is the free-text size/volume an admin types for a product —
// "100 ml", "3 x 50 ml", "طقم 4 زيوت". It is deliberately a separate TEXT
// column rather than a reuse of size_ml: size_ml is an INTEGER holding a
// single millilitre figure, which cannot represent a pack ("2 x 50 ml") at
// all. Storing the text in size_ml instead would have relied on SQLite's
// INTEGER being a mere affinity, and every numeric consumer in the tree
// (Number(size_ml), the "(50 ml)" labels, the raw-SQL console's parseInt
// coercion) would then read back NaN.
async function ensureD1ProductsSizeLabelColumnExists(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<void> {
  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  try {
    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "ALTER TABLE products ADD COLUMN size_label TEXT;",
      }),
    });
  } catch (err) {
    // Ignore — same contract as ensureD1ProductsSeoColumnsExist: the column
    // already exists, or D1 blipped and the next product create/update will
    // run this again.
  }
}

// A pack is a product row that bundles several other products together
// ("Combo Pack", "Full Kit"). Before this, "is it a pack" was pure string
// guessing on the id/name (see ProductCard.tsx's `isPack`) with no record of
// which individual products a given pack actually contains — so pack pages
// could never show reviews for their contents, only reviews naming the pack
// itself. `is_pack` makes the admin's intent explicit; `pack_product_ids` is
// a JSON array of the constituent products' ids (as strings, matching
// Product.id's type) chosen in the admin picker.
async function ensureD1ProductsPackColumnsExist(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<void> {
  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const columns = [
    "ALTER TABLE products ADD COLUMN is_pack INTEGER DEFAULT 0;",
    "ALTER TABLE products ADD COLUMN pack_product_ids TEXT;",
  ];
  for (const sql of columns) {
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql }),
      });
    } catch (err) {
      // Ignore — same contract as the size_label column above.
    }
  }
}

async function ensureD1ProductsShowSizeColumnExists(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<void> {
  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  try {
    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "ALTER TABLE products ADD COLUMN show_size INTEGER DEFAULT 1;",
      }),
    });
  } catch (err) {
    // Ignore — column already exists.
  }
}

export async function ensureProductsDataTablesExist(): Promise<boolean> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  if (!accountId || !databaseId || !apiToken) return false;
  if (isMaskedValue(accountId)) return false;

  const createProductsDataSql = `CREATE TABLE IF NOT EXISTS products_Data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL UNIQUE,
    benefits TEXT,
    usage TEXT,
    ingredients TEXT,
    FOREIGN KEY(product_id) REFERENCES products(product_nbr) ON DELETE CASCADE
  );`;

  const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  try {
    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createProductsDataSql }),
    });
    await ensureD1ProductsDataTagColumnExists(accountId, databaseId, apiToken);
    await ensureD1ProductsSeoColumnsExist(accountId, databaseId, apiToken);
    await ensureD1ProductsSizeLabelColumnExists(accountId, databaseId, apiToken);
    await ensureD1ProductsPackColumnsExist(accountId, databaseId, apiToken);
    await ensureD1ProductsShowSizeColumnExists(accountId, databaseId, apiToken);
    return true;
  } catch (e) {
    console.error("Failed creating products_Data table", e);
    return false;
  }
}

// Fetches visible, non-excluded sections for sitemap generation. Falls
// back to the caller's own in-memory sections list (passed as
// fallbackSections) if D1 isn't configured or the request fails — same
// behavior as the original inline function, which fell back to the
// module-level `siteSections` variable directly.
export async function fetchSectionsForSitemap(fallbackSections: any[]): Promise<any[]> {
  try {
    const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
    const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;
    const accountId = sanitizeCredentials(rawAccountId);
    const databaseId = sanitizeCredentials(rawDatabaseId);
    const apiToken = sanitizeCredentials(rawApiToken);

    if (accountId && databaseId && apiToken) {
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const sql = `SELECT * FROM sections_management WHERE is_visible = 1 AND (exclude_from_sitemap IS NULL OR exclude_from_sitemap = 0) ORDER BY order_index ASC;`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql }),
      });
      if (resp.ok) {
        const data = await resp.json();
        let rows = data.result?.[0]?.results || data.result?.results || [];
        if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
        // This function bypasses sectionRoutes' setSections entirely (the
        // sitemap calls it directly), so it needs its own seo_settings
        // overlay or sitemap priority/changefreq would ignore the central
        // table that every other read path now honours.
        overlaySectionRows(rows, await getSeoIndex());
        return rows;
      }
    }
  } catch (e) {
    console.error(e);
  }
  return fallbackSections;
}

export async function fetchRealD1CitiesIfConfigured(): Promise<any[] | null> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  let detailedCitiesMap: Record<string, { city_ar: string; district: string }> =
    {};
  try {
    const filePath = path.join(
      process.cwd(),
      "src/components/detailed_cities_map.json",
    );
    if (fs.existsSync(filePath)) {
      detailedCitiesMap = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    console.error(
      "Failed to load detailed_cities_map.json inside fetchRealD1Cities:",
      e,
    );
  }

  if (!accountId || !databaseId || !apiToken) return null;
  if (
    isMaskedValue(accountId) ||
    isMaskedValue(databaseId) ||
    isMaskedValue(apiToken)
  )
    return null;

  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    // Standard City table query
    const newCfRes = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT * FROM City ORDER BY id ASC;" }),
    });

    if (newCfRes.ok) {
      const data = await newCfRes.json();
      if (data.success && data.result?.[0]?.results) {
        let newRows = data.result[0].results;
        if (newRows.length === 0) {
          console.log(
            "Cloudflare D1 City table is empty. Triggering automated City seeding...",
          );
          await autoSeedCityTableD1(accountId, databaseId, apiToken);
          const finalFetch = await fetch(cloudflareUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sql: "SELECT * FROM City ORDER BY id ASC;",
            }),
          });
          if (finalFetch.ok) {
            const finalData = await finalFetch.json();
            if (finalData.success && finalData.result?.[0]?.results) {
              newRows = finalData.result[0].results;
            }
          }
        }
        return newRows.map((r: any) => {
          const dInfo = detailedCitiesMap[String(r.id)];
          const nameVal = r.District || r.City || (dInfo ? dInfo.district : "");
          const translationVal = r.City_AR || (dInfo ? dInfo.city_ar : "");
          return {
            id: r.id,
            name: nameVal,
            translation: translationVal,
            price_mad: r.Price,
            district: r.District || r.City || "",
            delivery: r.Delivery,
          };
        });
      }
    }
  } catch (err) {
    console.error("Error fetching live cities from Cloudflare D1:", err);
  }
  return null;
}

export interface D1VirtualReviewToken {
  id: string;
  token: string;
  status: "pending" | "processing" | "submitted";
  createdAt: string;
  usedAt?: string;
  comment?: string;
  products?: string[];
  /**
   * The same purchased items as `products`, but carrying the product id
   * alongside the name.
   *
   * `products` is names only, which is enough to render "you are reviewing X"
   * but not enough to tell whether a separately-bought item is the same
   * product as one inside a purchased pack — that comparison has to be by id
   * (see src/lib/reviewTargets.ts). Kept as a second field rather than
   * changing `products`, because tokens are persisted in a JSON snapshot and
   * older ones only have the names.
   */
  productRefs?: { id?: string | null; name: string }[];
}

// Reconstructs a review-invite "token" purely from live D1 data (order +
// reviews + order_items tables) for orders that exist in Cloudflare D1 but
// aren't in the in-memory reviewTokens Map — e.g. after a cold serverless
// restart wiped that in-process Map. Returns null if D1 isn't configured
// or the order can't be found, so callers can fall back to their normal
// "token not found" handling.
export async function getD1VirtualToken(token: string): Promise<D1VirtualReviewToken | null> {
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  const accountId = sanitizeCredentials(rawAccountId);
  const databaseId = sanitizeCredentials(rawDatabaseId);
  const apiToken = sanitizeCredentials(rawApiToken);

  if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
    return null;
  }

  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const requestHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    // 1. Get the order details
    // `token` is public input - it arrives on GET /api/reviews/check-token/:token
    // - so these three reads bind it rather than escaping it inline.
    const orderSql = `SELECT first_name, last_name, status, created_at FROM orders WHERE order_nbr = ? LIMIT 1;`;
    const orderRes = await fetch(cloudflareUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sql: orderSql, params: [token] }),
    });

    if (!orderRes.ok) return null;
    const orderData = await orderRes.json();
    if (!orderData || !orderData.success) return null;

    const ordersResult =
      orderData.result?.[0]?.results || orderData.result?.results || [];
    if (!ordersResult || ordersResult.length === 0) {
      return null;
    }

    const orderRow = ordersResult[0];
    const customerName =
      `${orderRow.first_name || ""} ${orderRow.last_name || ""}`.trim();
    const orderStatus = String(orderRow.status || "").toLowerCase();

    // 2. See if there is already a review
    const reviewSql = `SELECT id FROM reviews WHERE token_used = ? LIMIT 1;`;
    const reviewRes = await fetch(cloudflareUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sql: reviewSql, params: [token] }),
    });

    let isUsed = false;
    if (reviewRes.ok) {
      const reviewData = await reviewRes.json();
      const reviewsResult =
        reviewData.result?.[0]?.results || reviewData.result?.results || [];
      if (reviewsResult && reviewsResult.length > 0) {
        isUsed = true;
      }
    }

    // 3. Check if order status is confirmed (review links are only active AFTER confirmation)
    const isCancelledOrRemoved =
      orderStatus.includes("cancel") ||
      orderStatus.includes("delete") ||
      orderStatus.includes("remove");
    const isConfirmed = orderStatus.includes("confirm");

    let status: "pending" | "processing" | "submitted" = "pending";
    if (isUsed || isCancelledOrRemoved || !isConfirmed) {
      status = "submitted";
    }

    // 4. Get items/products for this order.
    //
    // product_nbr is selected as well as the name: it is the id the review form
    // needs to recognise that a separately-purchased item and a member of a
    // purchased pack are the same product. It is nullable (checkout writes null
    // when a line item couldn't be matched to the catalog), so the name is kept
    // as the fallback.
    const itemsSql = `SELECT product_nbr, product_name FROM order_items WHERE order_nbr = ?;`;
    const itemsRes = await fetch(cloudflareUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ sql: itemsSql, params: [token] }),
    });

    const productsList: string[] = [];
    const productRefs: { id?: string | null; name: string }[] = [];
    if (itemsRes.ok) {
      const itemsData = await itemsRes.json();
      const itemsResult =
        itemsData.result?.[0]?.results || itemsData.result?.results || [];
      if (Array.isArray(itemsResult)) {
        itemsResult.forEach((item: any) => {
          if (item.product_name) {
            productsList.push(item.product_name);
            productRefs.push({
              id:
                item.product_nbr !== undefined && item.product_nbr !== null
                  ? String(item.product_nbr)
                  : null,
              name: String(item.product_name),
            });
          }
        });
      }
    }

    return {
      id: token,
      token,
      status,
      createdAt: orderRow.created_at || new Date().toISOString(),
      comment: customerName,
      products: productsList,
      productRefs,
    };
  } catch (err) {
    console.error("Failed to fetch virtual D1 token:", err);
    return null;
  }
}

// Guards against re-running the (expensive) schema-provisioning routine
// on every single request that happens to need it — once verified in
// this process's lifetime, later calls short-circuit to true.
let d1OrdersTablesExistVerified = false;

export async function ensureD1OrdersTablesExist(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<boolean> {
  if (d1OrdersTablesExistVerified) {
    return true;
  }
  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    const createOrdersSql = `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_nbr TEXT UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      zip TEXT,
      total REAL NOT NULL,
      subtotal REAL,
      discount_amount REAL DEFAULT 0,
      coupon_applied TEXT,
      status TEXT DEFAULT 'pending',
      comment TEXT,
      shipping_tracking TEXT,
      dispatched_nbr TEXT,
      created_at TEXT NOT NULL
    );`;

    const response1 = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createOrdersSql }),
    });

    // Safely attempt to add comment column in case table already exists
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "ALTER TABLE orders ADD COLUMN comment TEXT;",
        }),
      });
    } catch (e) {
      console.log(
        "Safe check for comment column alter table in server.ts failed",
        e,
      );
    }

    // Safely attempt to add shipping_tracking column in case table already exists
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "ALTER TABLE orders ADD COLUMN shipping_tracking TEXT;",
        }),
      });
    } catch (e) {
      console.log(
        "Safe check for shipping_tracking column alter table in server.ts failed",
        e,
      );
    }

    // Safely attempt to add dispatched_nbr column in case table already exists
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "ALTER TABLE orders ADD COLUMN dispatched_nbr TEXT;",
        }),
      });
    } catch (e) {
      console.log(
        "Safe check for dispatched_nbr column alter table in server.ts failed",
        e,
      );
    }

    const createItemsSql = `CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_nbr TEXT NOT NULL,
      product_nbr INTEGER,
      product_name TEXT,
      quantity INTEGER,
      price REAL,
      FOREIGN KEY (order_nbr) REFERENCES orders (order_nbr) ON DELETE CASCADE
    );`;

    const response2 = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createItemsSql }),
    });

    const createReviewsSql = `CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT,
      rating INTEGER,
      comment TEXT,
      image TEXT,
      date TEXT,
      token_used TEXT,
      client_comment TEXT,
      products TEXT,
      admin_reply TEXT,
      is_hidden INTEGER DEFAULT 0
    );`;

    const response3 = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createReviewsSql }),
    });

    // Create Indexes to optimize exact-match searches, preventing full table scans
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "CREATE INDEX IF NOT EXISTS idx_order_items_order_nbr ON order_items (order_nbr);",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "CREATE INDEX IF NOT EXISTS idx_reviews_token_used ON reviews (token_used);",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "CREATE INDEX IF NOT EXISTS idx_reviews_is_hidden ON reviews (is_hidden);",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "CREATE INDEX IF NOT EXISTS idx_products_image_url ON products (image_url);",
        }),
      });
      // (No idx_images_url index — the `images` table is retired.)
    } catch (e) {}

    const dropCitiesSql = `DROP TABLE IF EXISTS cities;`;

    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: dropCitiesSql }),
    });

    const createNewCitySql = `CREATE TABLE IF NOT EXISTS City (
      id INTEGER PRIMARY KEY,
      City TEXT NOT NULL,
      City_AR TEXT NOT NULL,
      District TEXT,
      Price REAL,
      Delivery TEXT
    );`;

    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createNewCitySql }),
    });

    // Auto-seed the City table from city_data.json if it is empty!
    await autoSeedCityTableD1(accountId, databaseId, apiToken);

    const createReviewPicturesSql = `CREATE TABLE IF NOT EXISTS review_pictures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews (id) ON DELETE CASCADE
    );`;

    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createReviewPicturesSql }),
    });

    const createCouponsSql = `CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discountType TEXT NOT NULL,
      discountValue REAL NOT NULL,
      isActive INTEGER DEFAULT 1,
      expiresAt TEXT,
      minCartAmount REAL,
      applicableProducts TEXT
    );`;

    const responseCoupons = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createCouponsSql }),
    });

    const createCountriesSql = `CREATE TABLE IF NOT EXISTS countries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_en TEXT,
      name_ar TEXT,
      name_fr TEXT,
      is_europe INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );`;

    await fetch(cloudflareUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: createCountriesSql }),
    });

    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "ALTER TABLE countries ADD COLUMN area_code TEXT DEFAULT '';" }),
      });
    } catch(e) {}

    try {
        const seedCheck = await fetch(cloudflareUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ sql: "SELECT COUNT(*) as count FROM countries" }),
        });
        const seedCheckData = await seedCheck.json();
        if (seedCheckData?.result?.[0]?.results?.[0]?.count === 0) {
            const seedSql = `
                INSERT INTO countries (name_en, name_ar, name_fr, is_europe, is_active) VALUES 
                ('Morocco', 'المغرب', 'Maroc', 0, 1),
                ('France', 'فرنسا', 'France', 1, 1),
                ('Spain', 'إسبانيا', 'Espagne', 1, 1),
                ('Belgium', 'بلجيكا', 'Belgique', 1, 1);
            `;
            await fetch(cloudflareUrl, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ sql: seedSql }),
            });
        }
    } catch (e) {}

    const createProductsDataSql = `CREATE TABLE IF NOT EXISTS products_Data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      benefits TEXT,
      usage TEXT,
      ingredients TEXT,
      FOREIGN KEY(product_id) REFERENCES products(product_nbr) ON DELETE CASCADE
    );`;

    await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: createProductsDataSql }),
    });

    // Attempt to add new columns to existing tables (silently fails if already exist)
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "ALTER TABLE reviews ADD COLUMN admin_reply TEXT;",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "ALTER TABLE reviews ADD COLUMN is_hidden INTEGER DEFAULT 0;",
        }),
      });
    } catch (e) {}

    const ok =
      response1.ok && response2.ok && response3.ok && responseCoupons.ok;
    if (ok) {
      d1OrdersTablesExistVerified = true;
    }
    return ok;
  } catch (err) {
    console.error(
      "[ensureD1OrdersTablesExist Error] Failed to create orders tables:",
      err,
    );
  }
  return false;
}

export async function autoSeedCityTableD1(
  accountId: string,
  databaseId: string,
  apiToken: string,
  force = false,
): Promise<boolean> {
  try {
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const requestHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    if (!force) {
      // Check if already has data
      const checkRes = await fetch(cloudflareUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ sql: "SELECT COUNT(*) as count FROM City;" }),
      });
      if (checkRes.ok) {
        const data = await checkRes.json();
        const count = data.result?.[0]?.results?.[0]?.count || 0;
        if (count > 0) {
          return true; // Already has data
        }
      }
    } else {
      // Clear first if forced
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ sql: "DELETE FROM City;" }),
      });
    }

    console.log("[Auto-Seed D1] Seeding City table from city_data.json...");
    const cityDataPath = path.join(
      process.cwd(),
      "src/components/city_data.json",
    );
    if (!fs.existsSync(cityDataPath)) {
      console.error("city_data.json not found, cannot seed City table");
      return false;
    }

    const items = JSON.parse(fs.readFileSync(cityDataPath, "utf8"));
    const BATCH_SIZE = 45;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const placeholders: string[] = [];
      const params: any[] = [];

      batch.forEach((item: any) => {
        placeholders.push(`(?, ?, ?, ?, ?, ?)`);
        params.push(
          item.id,
          item.city || "",
          item.city_ar || "",
          item.district || "",
          item.price !== undefined && item.price !== null
            ? parseFloat(item.price)
            : 35,
          item.delivery || "24h",
        );
      });

      const sql = `INSERT OR REPLACE INTO City (id, City, City_AR, District, Price, Delivery) VALUES ${placeholders.join(", ")};`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ sql, params }),
      });
      if (!resp.ok) {
        console.error("Failed to seed City batch:", await resp.text());
      }
    }
    console.log("[Auto-Seed D1] City table seeded successfully!");
    return true;
  } catch (err) {
    console.error("Error seeding City table:", err);
    return false;
  }
}

// findFeaturedProductMatch always returns null now that the hardcoded
// catalog it used to match against was removed upstream — kept as a
// local no-op stub purely so autoSeedD1Database's per-product fallback
// lookups (`fp?.description`, `fp?.category`, etc.) keep working exactly
// as before without every call site needing to be rewritten.
function findFeaturedProductMatch(_p: any) {
  return null;
}

export async function autoSeedD1Database(
  accountId: string,
  databaseId: string,
  apiToken: string,
  products: any[],
  force = false,
): Promise<boolean> {
  try {
    const productsToSeed =
      Array.isArray(products) && products.length > 0 ? products : [];
    if (!productsToSeed || productsToSeed.length === 0) {
      console.log("No products available to seed to D1");
      return false;
    }

    console.log(
      `[Auto-Seed D1] Starting Cloudflare D1 database seeding process. Seeding ${productsToSeed.length} products...`,
    );
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    const createTableSql = `CREATE TABLE IF NOT EXISTS products (
      product_nbr INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      discount_applicable INTEGER DEFAULT 0,
      discount_price REAL,
      available INTEGER DEFAULT 1,
      size_ml INTEGER,
      size_label TEXT,
      description TEXT,
      image_url TEXT,
      show_in_swiper INTEGER DEFAULT 1,
      in_catalog INTEGER DEFAULT 1,
      category TEXT,
      benefits TEXT,
      usage TEXT,
      ingredients TEXT,
      order_index INTEGER DEFAULT 0,
      exclude_from_sitemap INTEGER DEFAULT 0,
      name_en TEXT,
      seo_title TEXT,
      seo_description TEXT,
      seo_priority TEXT,
      seo_changefreq TEXT,
      slug TEXT,
      is_pack INTEGER DEFAULT 0,
      pack_product_ids TEXT,
      show_size INTEGER DEFAULT 1
    );`;

    const createHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const createResponse = await fetch(cloudflareUrl, {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify({ sql: createTableSql }),
    });

    // Attempt to add missing columns to the products table.
    //
    // This block used to also back-fill products.image_url from the legacy
    // `images` table and then DROP that table. Both are gone: the images
    // table is retired, that migration has long since run, and re-issuing it
    // was two guaranteed-failing D1 calls on every seed.
    try {
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({
          sql: "ALTER TABLE products ADD COLUMN image_url TEXT;",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({
          sql: "ALTER TABLE products ADD COLUMN show_in_swiper INTEGER DEFAULT 1;",
        }),
      });
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({
          sql: "ALTER TABLE products ADD COLUMN in_catalog INTEGER DEFAULT 1;",
        }),
      });
    } catch (e) {}

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      console.error(
        "[Auto-Seed D1] Failed to verify/create products table schema on Cloudflare D1:",
        errText,
      );
      return false;
    }

    if (force) {
      console.log(
        "[Auto-Seed D1] Forcing clean re-seed, dropping old products array.",
      );
      await fetch(cloudflareUrl, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({ sql: "DELETE FROM products;" }),
      });
    }

    for (let idx = 0; idx < productsToSeed.length; idx++) {
      const p = productsToSeed[idx];
      const pRawPrice =
        typeof p.price === "string"
          ? p.price.replace(" DH", "")
          : String(p.price);
      const activePrice = isNaN(parseFloat(pRawPrice))
        ? 60.0
        : parseFloat(pRawPrice);

      let origPrice = activePrice;
      if (p.originalPrice) {
        const pRawOrig =
          typeof p.originalPrice === "string"
            ? p.originalPrice.replace(" DH", "")
            : String(p.originalPrice);
        origPrice = parseFloat(pRawOrig) || activePrice;
      }

      const isSale =
        p.isSale === true || (p.originalPrice && activePrice < origPrice);

      const fp = findFeaturedProductMatch(p);

      let benefitsStr = "";
      if (Array.isArray(p.benefits) && p.benefits.length > 0) {
        benefitsStr = p.benefits.join("\n");
      } else if (p.benefits) {
        benefitsStr = String(p.benefits);
      } else if (fp && Array.isArray((fp as any).benefits) && (fp as any).benefits.length > 0) {
        benefitsStr = (fp as any).benefits.join("\n");
      }

      const isPureNumericId = /^\d+$/.test(String(p.id));
      const targetNbr = isPureNumericId ? parseInt(String(p.id), 10) : idx + 1;

      // These *Val names used to hold escapeSqlString()-quoted SQL fragments;
      // they now hold RAW values that get bound through the params array below.
      // Keeping the names keeps this diff readable. Two defects this closes
      // beyond removing the interpolation:
      //
      //   size_ml was interpolated UNQUOTED with no numeric coercion, so
      //   whatever sat in p.size_ml landed at that position as bare SQL text.
      //   SQLite's INTEGER is only a type affinity, not a constraint, so a
      //   non-numeric value really can be stored in that column and read back
      //   out by fetchProductsFromD1 - which made this the one spot in the
      //   tree where a stored value could alter the statement around it.
      //   Binding it as a parameter neutralises that. It no longer falls back
      //   to 50 either: this push runs over the whole in-memory catalogue, so
      //   a `|| 50` here silently rewrote every product an admin had given a
      //   real size back to 50 on the next sync.
      //
      //   discount_price used the STRING "NULL", which only behaved as SQL NULL
      //   because it was interpolated unquoted. Bound as a parameter that would
      //   have written the four-character text "NULL", so it becomes real null.
      const nameVal = p.name ?? null;
      const priceVal = isSale ? origPrice : activePrice;
      const discountApplicableVal = isSale ? 1 : 0;
      const discountPriceVal = isSale ? activePrice : null;
      const availableVal =
        p.isAvailable === false ||
        p.isAvailable === "false" ||
        p.isAvailable === 0 ||
        p.isAvailable === "0"
          ? 0
          : 1;
      const sizeLabelVal = normalizeSizeLabel((p as any).size_label || (p as any).volume) || null;
      const rawSizeMl = (p as any).size_ml;
      const sizeMlVal =
        rawSizeMl !== undefined && rawSizeMl !== null && rawSizeMl !== "" && Number.isFinite(Number(rawSizeMl))
          ? Math.round(Number(rawSizeMl))
          : parseSizeMlFromLabel(sizeLabelVal);
      const descVal = p.description || (fp as any)?.description || "";
      const imageUrlVal = p.image || (fp as any)?.image || "";
      const isSwiperVal = p.showInSwiper ? 1 : 0;
      const inCatalogVal = 1;
      const catVal = p.category || (fp as any)?.category || "Oils";
      const usageVal = p.usage || (fp as any)?.usage || "";
      const ingVal = p.ingredients || (fp as any)?.ingredients || "";

      const ordVal = p.orderIndex !== undefined ? Number(p.orderIndex) : idx;
      const tagVal = p.tag || (fp as any)?.tag || "";
      const isPackVal = (p as any).isPack ? 1 : 0;
      const packProductIdsVal = JSON.stringify(Array.isArray((p as any).packProductIds) ? (p as any).packProductIds : []);

      // 19 columns, 19 placeholders, 19 params - order matches the column list.
      const insertSql = `INSERT INTO products (
        product_nbr, name, price, discount_applicable, discount_price, available, size_ml, size_label, description, image_url, show_in_swiper, in_catalog, category, benefits, usage, ingredients, order_index, is_pack, pack_product_ids
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON CONFLICT(product_nbr) DO UPDATE SET
        description=excluded.description,
        benefits=excluded.benefits,
        usage=excluded.usage,
        ingredients=excluded.ingredients;`;
      const insertParams = [
        targetNbr,
        nameVal,
        priceVal,
        discountApplicableVal,
        discountPriceVal,
        availableVal,
        sizeMlVal,
        sizeLabelVal,
        descVal,
        imageUrlVal,
        isSwiperVal,
        inCatalogVal,
        catVal,
        benefitsStr,
        usageVal,
        ingVal,
        ordVal,
        isPackVal,
        packProductIdsVal,
      ];

      // Both of these writes previously ignored their response entirely, so a
      // rejected statement (the malformed-size_ml case above produced exactly
      // that) left no trace and the loop reported success at the end regardless.
      // Logging only - the control flow is deliberately unchanged.
      const insertResp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({ sql: insertSql, params: insertParams }),
      });
      if (!insertResp.ok) {
        console.error(
          `[Auto-Seed D1] products upsert failed for product_nbr ${targetNbr}: HTTP ${insertResp.status}`,
        );
      }

      const insertDataSql = `INSERT INTO products_Data (product_id, benefits, usage, ingredients, tag) VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET benefits=excluded.benefits, usage=excluded.usage, ingredients=excluded.ingredients, tag=excluded.tag;`;
      const insertDataResp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify({
          sql: insertDataSql,
          params: [targetNbr, benefitsStr, usageVal, ingVal, tagVal],
        }),
      });
      if (!insertDataResp.ok) {
        console.error(
          `[Auto-Seed D1] products_Data upsert failed for product_id ${targetNbr}: HTTP ${insertDataResp.status}`,
        );
      }
    }

    console.log(
      `[Auto-Seed D1] Seeding of ${productsToSeed.length} records succeeded.`,
    );
    return true;
  } catch (err) {
    console.error(
      "[Auto-Seed D1] Error during database seeding orchestration:",
      err,
    );
    return false;
  }
}
