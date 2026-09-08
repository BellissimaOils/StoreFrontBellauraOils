import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";
import { normalizeSectionLinkServer } from "../utils/pathUtils";

// Central SEO store: the `seo_settings` D1 table is the source of truth for
// per-product and per-page (section) SEO, plus one site-wide row.
//
// History worth knowing before editing this file: SEO used to live only on
// the `products` and `sections_management` tables, edited through Admin > SEO.
// `seo_settings` existed in the live database with real rows but nothing in
// the code read or wrote it, so editing a product's SEO in the admin panel
// never changed that table, and editing that table never changed the site.
// This module closes that gap in both directions:
//
//   write: the admin SEO panel's product/section saves upsert a row here
//          (they still also write products/sections_management, which now
//          act as a fallback cache — see the overlay note below).
//   read:  product and section rows get these values overlaid onto them as
//          they enter the process, so every existing consumer (the SSR meta
//          tag injection in server.ts, sitemap.xml, /api/products,
//          CategoryPage, HomePage, DynamicSEO) picks them up without each
//          one needing to know this table exists.
//
// Row shape (matches the live table):
//   id             INTEGER PRIMARY KEY
//   page_type      'main' | 'section' | 'product'
//   page_url       'product/4/' for products (4 = products.product_nbr,
//                  which is also the `id` exposed by /api/products),
//                  the section's link_url for pages, e.g. '/skin'
//   title          human label, for the admin's benefit only
//   seo_title, seo_description, seo_keywords, seo_priority, seo_changefreq

export interface SeoSettingRow {
  id?: number | string;
  page_type?: string;
  page_url?: string;
  title?: string;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  seo_priority?: string;
  seo_changefreq?: string;
}

export interface SeoIndex {
  products: Map<string, SeoSettingRow>;
  pages: Map<string, SeoSettingRow>;
  main: SeoSettingRow | null;
}

// Internal helpers below are intentionally not exported — nothing outside this
// module needs them, and keeping the public surface small makes it obvious
// that canonical key derivation and index building are this module's job
// alone (they must stay consistent between the read and write paths, which is
// exactly what broke when they were allowed to diverge).
function getCreds() {
  const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
  const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
  const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);
  const valid = !!(accountId && databaseId && apiToken && !isMaskedValue(accountId));
  return { accountId, databaseId, apiToken, valid };
}

// The codebase had no generic row-returning D1 helper — executeD1Query
// (executeRealD1QueryIfConfigured) discards the response body and returns
// only a boolean, and every other reader is hard-coded to one table. This is
// that missing primitive, kept private to this module. The triple-shape
// unwrapping mirrors the existing readers (fetchSectionsForSitemap,
// coreDb's boot queries): D1's REST API is inconsistent about whether
// results arrive under result[0].results, result.results, or result itself.
async function queryRows(sql: string): Promise<any[] | null> {
  const { accountId, databaseId, apiToken, valid } = getCreds();
  if (!valid) return null;
  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql }),
      },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.success) return null;
    let rows = data.result?.[0]?.results || data.result?.results || [];
    if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("[seoSettings] query failed:", err);
    return null;
  }
}

async function execSql(sql: string, params: any[] = []): Promise<boolean> {
  const { accountId, databaseId, apiToken, valid } = getCreds();
  if (!valid) return false;
  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.success;
  } catch (err) {
    console.error("[seoSettings] exec failed:", err);
    return false;
  }
}

let schemaVerified = false;

// The live table already exists, so CREATE TABLE IF NOT EXISTS is normally a
// no-op — it's here so a fresh//restored database self-heals instead of
// silently failing every SEO save (which is exactly how the website_info
// table broke). The per-column ALTERs cover the other half: a table that
// exists but predates one of these columns. SQLite has no
// "ADD COLUMN IF NOT EXISTS", and ADD COLUMN errors when the column is
// already there, so each one is fired and its failure ignored — the same
// idiom already used by ensureD1ProductsSeoColumnsExist and
// ensureSectionsSeoColumnsExist.
export async function ensureSeoSettingsTableExists(): Promise<void> {
  if (schemaVerified) return;
  const { valid } = getCreds();
  if (!valid) return;

  await execSql(
    `CREATE TABLE IF NOT EXISTS seo_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_type TEXT,
      page_url TEXT,
      title TEXT,
      seo_title TEXT,
      seo_description TEXT,
      seo_keywords TEXT,
      seo_priority TEXT,
      seo_changefreq TEXT
    );`,
  );

  for (const col of [
    "page_type",
    "page_url",
    "title",
    "seo_title",
    "seo_description",
    "seo_keywords",
    "seo_priority",
    "seo_changefreq",
  ]) {
    await execSql(`ALTER TABLE seo_settings ADD COLUMN ${col} TEXT;`);
  }

  schemaVerified = true;
}

// Short TTL rather than no cache: these rows are read on the hot path for
// /api/products and every server-rendered page, and they change only when an
// admin saves. Writes call invalidateSeoSettingsCache() so an admin never
// waits out the TTL to see their own edit.
const CACHE_TTL_MS = 30 * 1000;
let cache: { rows: SeoSettingRow[]; ts: number } | null = null;

export function invalidateSeoSettingsCache(): void {
  cache = null;
}

export async function fetchSeoSettings(force = false): Promise<SeoSettingRow[]> {
  const now = Date.now();
  if (!force && cache && now - cache.ts < CACHE_TTL_MS) return cache.rows;

  const { valid } = getCreds();
  if (!valid) return cache?.rows || [];

  const rows = await queryRows("SELECT * FROM seo_settings;");
  if (rows === null) {
    // Query failed (D1 hiccup, or the table genuinely doesn't exist yet).
    // Serve the last good copy rather than letting every page lose its SEO
    // for the next 30 seconds, and don't cache the failure.
    return cache?.rows || [];
  }
  cache = { rows, ts: now };
  return rows;
}

// Normalizes a page_url / link_url to a comparable key: lowercased, no
// leading or trailing slashes. '/skin' -> 'skin', 'product/4/' -> 'product/4',
// '/' -> '' (the home page).
export function normalizeSeoKey(url: string | undefined | null): string {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function productSeoPageUrl(productNbr: string | number): string {
  return `product/${productNbr}/`;
}

// Key used for page/section rows. Runs the link through the app's own
// legacy-alias normalizer first, so a seo_settings row saved against '/oils'
// or '/category/all' still matches the section that now lives at '/' or
// '/products'. Both the index build and the lookup must use this same
// function or they'd silently fail to match.
export function sectionSeoKey(link: string | undefined | null): string {
  return normalizeSeoKey(normalizeSectionLinkServer(link || "/"));
}

// The admin Database tab writes every field as a quoted string and turns a
// cleared box into '' rather than NULL, so "has the admin set this?" has to
// mean "is it a non-empty string after trimming", not just "is it not null".
function firstNonEmpty(...vals: any[]): string | undefined {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s !== "") return s;
  }
  return undefined;
}

// THE canonical identity of a seo_settings row: which page it controls.
//
// Both the read index and the write upsert must derive a row's identity
// through this one function. They previously used different logic, and that
// caused a real bug: the live table has the home page stored twice, once as
// page_type 'main' and once as 'section', both pointing at '/'. The upsert
// looked for a match scoped to `WHERE page_type = 'main'`, so it could only
// ever update the 'main' row, while the index builder let the later 'section'
// row overwrite the 'main' one under the same key. Saving therefore wrote to
// one row and the page read back from the other — the admin's edit landed in
// the table but the panel kept showing the old text.
//
// Products resolve to 'product/<product_nbr>'. Everything else resolves to its
// normalized path, with a 'main' row and the root path both collapsing to ''.
export function canonicalSeoKey(
  pageType: string | undefined | null,
  pageUrl: string | undefined | null,
): string {
  const type = String(pageType || "").trim().toLowerCase();
  const raw = normalizeSeoKey(pageUrl);

  if (type === "product" || raw.startsWith("product/")) {
    const nbr = raw.replace(/^product\//, "").replace(/\/.*$/, "");
    return nbr ? `product/${nbr}` : "";
  }
  // 'main' is the site-wide/home row; page_url is often '/' or the literal
  // 'main'. Both mean the home page.
  if (type === "main" && (raw === "" || raw === "main")) return "";
  return sectionSeoKey(pageUrl);
}

function seoRowId(row: SeoSettingRow | undefined | null): number {
  const n = Number(row?.id);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function buildSeoIndex(rows: SeoSettingRow[]): SeoIndex {
  const products = new Map<string, SeoSettingRow>();
  const pages = new Map<string, SeoSettingRow>();
  let main: SeoSettingRow | null = null;

  for (const row of rows || []) {
    if (!row) continue;
    const type = String(row.page_type || "").trim().toLowerCase();

    // Lowest id wins on a collision, deliberately. This used to be
    // last-row-wins, which made the effective SEO depend on the order D1
    // happened to return rows in. Lowest id is both stable and the same row
    // upsertSeoSetting reports as its primary match, so what you save is what
    // you read back.
    if (type === "main" && seoRowId(row) < seoRowId(main)) main = row;

    const key = canonicalSeoKey(row.page_type, row.page_url);

    if (key.startsWith("product/")) {
      const nbr = key.slice("product/".length);
      const prev = products.get(nbr);
      if (!prev || seoRowId(row) < seoRowId(prev)) products.set(nbr, row);
      continue;
    }

    const prev = pages.get(key);
    if (!prev || seoRowId(row) < seoRowId(prev)) pages.set(key, row);
  }

  return { products, pages, main };
}

export async function getSeoIndex(force = false): Promise<SeoIndex> {
  return buildSeoIndex(await fetchSeoSettings(force));
}

// Synchronous, network-free variant for hot paths that must not add a D1
// round-trip — specifically the server-rendered HTML handler, which runs on
// every single page request. Returns null when nothing has been cached yet,
// so the caller can fall back rather than block.
//
// In practice the cache is warm: it's populated at boot (coreDb's product
// hydration) and refreshed by /api/products and /sections, which are hit
// constantly. Deliberately ignores the TTL — slightly stale SEO text is a far
// better trade here than making page rendering wait on Cloudflare.
export function getCachedSeoIndexSync(): SeoIndex | null {
  if (!cache) return null;
  return buildSeoIndex(cache.rows);
}

// Overlays seo_settings values onto raw `products` D1 rows, in place.
// Applied where those rows enter the process, so the classic products array,
// the /api/products cache, the admin list and sitemap.xml all inherit it
// without each having to know about this table. A field the admin never
// filled in leaves whatever the product row already had, so this can only
// add or override real values, never blank existing ones out.
export function overlayProductRows(rows: any[], index: SeoIndex): any[] {
  if (!Array.isArray(rows) || index.products.size === 0) return rows;
  for (const row of rows) {
    if (!row) continue;
    const nbr = String(row.product_nbr ?? row.id ?? "").trim();
    if (!nbr) continue;
    const seo = index.products.get(nbr);
    if (!seo) continue;

    const title = firstNonEmpty(seo.seo_title);
    const desc = firstNonEmpty(seo.seo_description);
    const priority = firstNonEmpty(seo.seo_priority);
    const changefreq = firstNonEmpty(seo.seo_changefreq);
    const keywords = firstNonEmpty(seo.seo_keywords);

    if (title !== undefined) row.seo_title = title;
    if (desc !== undefined) row.seo_description = desc;
    if (priority !== undefined) row.seo_priority = priority;
    if (changefreq !== undefined) row.seo_changefreq = changefreq;
    if (keywords !== undefined) row.seo_keywords = keywords;
  }
  return rows;
}

// Section/page equivalent of overlayProductRows, keyed on link_url.
export function overlaySectionRows(rows: any[], index: SeoIndex): any[] {
  if (!Array.isArray(rows) || index.pages.size === 0) return rows;
  for (const row of rows) {
    if (!row) continue;
    const seo = index.pages.get(sectionSeoKey(row.link_url));
    if (!seo) continue;

    const title = firstNonEmpty(seo.seo_title);
    const desc = firstNonEmpty(seo.seo_description);
    const priority = firstNonEmpty(seo.seo_priority);
    const changefreq = firstNonEmpty(seo.seo_changefreq);
    const keywords = firstNonEmpty(seo.seo_keywords);

    if (title !== undefined) row.seo_title = title;
    if (desc !== undefined) row.seo_description = desc;
    if (priority !== undefined) row.seo_priority = priority;
    if (changefreq !== undefined) row.seo_changefreq = changefreq;
    if (keywords !== undefined) row.seo_keywords = keywords;
  }
  return rows;
}

export interface UpsertSeoInput {
  page_type: "main" | "section" | "product";
  page_url: string;
  title?: string;
  seo_title?: string;
  seo_description?: string;
  seo_keywords?: string;
  seo_priority?: string;
  seo_changefreq?: string;
}

// Upsert keyed on page_url. Deliberately a SELECT-then-UPDATE/INSERT rather
// than INSERT OR REPLACE or ON CONFLICT: both of those need a UNIQUE
// constraint on page_url, and this table already exists in production with
// unknown constraints, so assuming one risks either an error or (worse, the
// INSERT OR REPLACE failure mode already hit on sections_management)
// wiping columns that weren't listed. Matching on the normalized key also
// means '/skin' and 'skin/' resolve to the same row instead of silently
// creating a duplicate.
export async function upsertSeoSetting(input: UpsertSeoInput): Promise<boolean> {
  const { valid } = getCreds();
  if (!valid) return false;

  await ensureSeoSettingsTableExists();

  const targetKey = canonicalSeoKey(input.page_type, input.page_url);
  // Deliberately NOT scoped by page_type. The live table holds the home page
  // twice — once as 'main', once as 'section' — and the previous
  // `WHERE page_type = ?` lookup could only ever find one of them, so the save
  // updated that row while the read resolved to the other one and showed the
  // admin their old text back. Identity is the page, not the type label.
  const existing = await queryRows(`SELECT id, page_url, page_type FROM seo_settings;`);

  const matchIds: number[] = [];
  if (Array.isArray(existing)) {
    for (const row of existing) {
      if (canonicalSeoKey(row.page_type, row.page_url) !== targetKey) continue;
      const n = Number(row.id);
      if (Number.isFinite(n)) matchIds.push(n);
    }
  }
  matchIds.sort((a, b) => a - b);

  // setField appends the SQL fragment and its bound value together, so the two
  // lists cannot drift out of alignment as conditions are added or removed.
  const assignments: string[] = [];
  const assignParams: any[] = [];
  const setField = (fragment: string, value: any) => {
    assignments.push(fragment);
    assignParams.push(value);
  };

  setField("page_type = ?", input.page_type);
  setField("page_url = ?", input.page_url);
  // Only write the fields the caller actually supplied, so a save coming
  // from a form that doesn't include (say) seo_keywords can't erase a value
  // an admin set directly in the Database tab.
  if (input.title !== undefined) setField("title = ?", input.title);
  if (input.seo_title !== undefined) setField("seo_title = ?", input.seo_title);
  if (input.seo_description !== undefined) setField("seo_description = ?", input.seo_description);
  if (input.seo_keywords !== undefined) setField("seo_keywords = ?", input.seo_keywords);
  if (input.seo_priority !== undefined) setField("seo_priority = ?", input.seo_priority);
  if (input.seo_changefreq !== undefined) setField("seo_changefreq = ?", input.seo_changefreq);

  let ok: boolean;
  if (matchIds.length > 0) {
    // One row per page, keeping the lowest id.
    //
    // The live table had the home page stored twice (id 1 as 'main', id 2 as
    // 'section'), which is what let a save and a read land on different rows.
    // Writing to every duplicate made that harmless, but leaving them around
    // is still confusing to look at in the Database tab, so they're collapsed:
    // the lowest id is updated with the new values and any extra rows for the
    // same page are deleted.
    //
    // Ordering matters for safety. The UPDATE runs first and is checked, so
    // the surviving row is known to hold the new values before anything is
    // removed; if the UPDATE fails, nothing is deleted. The DELETE is also
    // scoped to ids that were positively matched to this exact page, never a
    // broad predicate.
    const primaryId = matchIds[0];
    const duplicateIds = matchIds.slice(1);

    ok = await execSql(
      `UPDATE seo_settings SET ${assignments.join(", ")} WHERE id = ?;`,
      [...assignParams, primaryId],
    );

    if (ok && duplicateIds.length > 0) {
      const pruned = await execSql(
        `DELETE FROM seo_settings WHERE id IN (${duplicateIds.map(() => "?").join(", ")});`,
        duplicateIds,
      );
      if (pruned) {
        console.log(
          `[seo_settings] Collapsed duplicate row(s) ${duplicateIds.join(", ")} into id ${primaryId} for "${input.page_url}".`,
        );
      } else {
        // Not fatal: the surviving row already has the new values, so reads
        // are correct either way. The stale duplicates just remain visible
        // until the next save retries this.
        console.warn(
          `[seo_settings] Could not delete duplicate row(s) ${duplicateIds.join(", ")} for "${input.page_url}". id ${primaryId} holds the current values.`,
        );
      }
    }
  } else {
    const cols = ["page_type", "page_url", "title", "seo_title", "seo_description", "seo_keywords", "seo_priority", "seo_changefreq"];
    const vals = [
      input.page_type,
      input.page_url,
      input.title ?? "",
      input.seo_title ?? "",
      input.seo_description ?? "",
      input.seo_keywords ?? "",
      input.seo_priority ?? "",
      input.seo_changefreq ?? "",
    ];
    ok = await execSql(
      `INSERT INTO seo_settings (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")});`,
      vals,
    );
  }

  if (ok) invalidateSeoSettingsCache();
  return ok;
}
