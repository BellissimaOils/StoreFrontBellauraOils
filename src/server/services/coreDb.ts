import fs from "fs";
import path from "path";
import { isMaskedValue, sanitizeCredentials } from "../utils/sqlUtils";
import { DB_PATH, getWritableDbPath } from "../utils/pathUtils";
import { getSeoIndex, overlayProductRows, overlaySectionRows } from "./seoSettings";
import { syncDbFromR2, syncDbToR2 } from "../utils/r2Client";
import {
  autoSeedD1Database,
  autoSeedCityTableD1,
  fetchRealD1ProductsIfConfigured,
  fetchRealD1CitiesIfConfigured,
} from "./d1Client";

// The three top-level DB orchestrators: fetchEverythingFromD1 (boot-time
// bulk hydration from Cloudflare D1, with auto-seed fallbacks for empty
// products/City tables), loadDb (reads the local JSON snapshot — R2 or
// bundled file — as a fallback/complement to the D1 fetch), and saveDb
// (writes that same JSON snapshot back out, then syncs it to R2).
//
// These three touch nearly every shared module-level array at once, so
// unlike most other extractions in this refactor they need getter+setter
// injection for almost everything: reviewTokens Map, products[],
// d1_products[], orders[], coupons[], uploadedImages[], d1_images[],
// d1_cities[], reviews[], storeSettings. All three functions are wired
// up together via one factory since they share this same state shape.

interface CoreDbState {
  getReviewTokens: () => Map<string, any>;
  setReviewTokens: (v: Map<string, any>) => void;
  getProducts: () => any[];
  // (no setProducts: loadDb no longer clears the classic products array, and
  // the D1 hydration path writes it through syncD1ToClassicProducts instead)
  getD1Products: () => any[];
  setD1Products: (v: any[]) => void;
  getOrders: () => any[];
  setOrders: (v: any[]) => void;
  getCoupons: () => any[];
  setCoupons: (v: any[]) => void;
  getUploadedImages: () => string[];
  setUploadedImages: (v: string[]) => void;
  getD1Images: () => any[];
  setD1Images: (v: any[]) => void;
  getD1Cities: () => any[];
  setD1Cities: (v: any[]) => void;
  getReviews: () => any[];
  setReviews: (v: any[]) => void;
  getStoreSettings: () => any;
  setStoreSettings: (v: any) => void;
  // Sections were deliberately absent here until the SPA fallback started
  // deciding 200-vs-404 from real data. Without boot hydration siteSections
  // held only its 5 hardcoded seed rows until something called /api/sections,
  // so a cold serverless instance would answer 404 for every admin-created
  // page - including to crawlers, which is the one visitor that never warms
  // the cache first.
  setSections: (v: any[]) => void;
  syncD1ToClassicProducts: () => void;
  syncClassicToSqlProducts: () => void;
}

export function createCoreDbService(state: CoreDbState) {
  async function fetchEverythingFromD1(): Promise<boolean> {
    const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
    const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

    const accountId = sanitizeCredentials(rawAccountId);
    const databaseId = sanitizeCredentials(rawDatabaseId);
    const apiToken = sanitizeCredentials(rawApiToken);

    if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
      return false;
    }

    try {
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const requestHeaders = {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      };

      // Parallel fetch from D1 tables
      const queries = [
        {
          key: "products",
          sql: "SELECT p.*, pd.tag as tag FROM products p LEFT JOIN products_Data pd ON p.product_nbr = pd.product_id ORDER BY p.order_index ASC, p.product_nbr ASC;",
        },
        { key: "reviews", sql: "SELECT * FROM reviews ORDER BY date DESC;" },
        { key: "review_pictures", sql: "SELECT * FROM review_pictures;" },
        { key: "coupons", sql: "SELECT * FROM coupons ORDER BY code ASC;" },
        // (No `images` query — that D1 table is retired. Image records live
        // on products.image_url + R2, and the local uploadedImages/d1_images
        // tracking is restored by loadDb() from the JSON snapshot instead.)
        { key: "City", sql: "SELECT * FROM City ORDER BY id ASC;" },
        // Pinned to id = 1, the row updateD1Settings writes (INSERT OR
        // REPLACE ... VALUES (1, ?)). A bare `SELECT * ... LIMIT 1` returns an
        // arbitrary row, so a stray row left by a manual insert or a partial
        // restore could have this boot read load a different blob than the
        // TTL re-read in fetchD1SettingsIfConfigured, making settings appear
        // to change on their own at the cooldown boundary.
        { key: "settings", sql: "SELECT json_data FROM website_info WHERE id = 1 LIMIT 1;" },
        {
          key: "sections",
          sql: "SELECT * FROM sections_management ORDER BY order_index ASC;",
        },
      ];

      // null = the query FAILED (network error / non-OK response).
      // [] = the query SUCCEEDED and the table is genuinely empty.
      //
      // These two must not be conflated. Previously both produced [], and
      // several consumers below used a bare `if (results[key])` — which is
      // truthy for [] — so a transient D1 failure silently wiped the
      // corresponding in-memory list (coupons and reviews both did this).
      // It also meant a failed products/City query looked like "table is
      // empty" and triggered a full auto-seed off the back of a network
      // blip.
      const results: Record<string, any[] | null> = {};

      await Promise.all(
        queries.map(async (q) => {
          try {
            const resp = await fetch(cloudflareUrl, {
              method: "POST",
              headers: requestHeaders,
              body: JSON.stringify({ sql: q.sql }),
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.success === false) {
                console.error(
                  `[Boot] D1 rejected the ${q.key} query:`,
                  JSON.stringify(data.errors || data),
                );
                results[q.key] = null;
                return;
              }
              let rows = data.result?.[0]?.results || data.result?.results || [];
              if (!Array.isArray(rows) && Array.isArray(data.result))
                rows = data.result;
              results[q.key] = Array.isArray(rows) ? rows : [];
            } else {
              console.error(
                `[Boot] D1 returned HTTP ${resp.status} for the ${q.key} query — leaving existing in-memory data untouched.`,
              );
              results[q.key] = null;
            }
          } catch (err) {
            console.error(`Error loading ${q.key} from startup D1:`, err);
            results[q.key] = null;
          }
        }),
      );

      // Map Products
      if (results["products"] === null) {
        // Query failed — keep whatever we already have and do NOT auto-seed.
        console.warn("[Boot] Skipping product hydration/seed — the D1 products query failed.");
      } else if (results["products"]!.length > 0) {
        // This branch runs its own inline products query rather than going
        // through fetchRealD1ProductsIfConfigured, so it needs the same
        // seo_settings overlay that function applies. Without it, a cold boot
        // would hydrate the in-memory catalog with pre-overlay SEO values,
        // and any page server-rendered before the first /api/products refresh
        // would show the older products-table text instead of what's in
        // seo_settings. (The auto-seed branch below is already covered, since
        // it goes through fetchRealD1ProductsIfConfigured.)
        overlayProductRows(results["products"]!, await getSeoIndex());
        state.setD1Products(results["products"]!);
        state.syncD1ToClassicProducts();
        state.syncClassicToSqlProducts();
      } else {
        // Table genuinely empty (query succeeded, zero rows) — auto-seed it.
        console.log("D1 products empty on boot. Seeding...");
        const seeded = await autoSeedD1Database(accountId, databaseId, apiToken, state.getProducts());
        if (seeded) {
          const d1List = await fetchRealD1ProductsIfConfigured(() => state.getProducts());
          if (d1List) {
            state.setD1Products(d1List);
            state.syncD1ToClassicProducts();
            state.syncClassicToSqlProducts();
          }
        }
      }

      // Map Images
      // NOTE: this used to be
      //   if (results["images"]) { setD1Images(...); setUploadedImages(...) }
      // fed by a `SELECT * FROM images` that always failed (the table is
      // retired). On failure results[key] is set to [], and `if ([])` is
      // truthy in JS — so every boot overwrote d1_images and uploadedImages
      // with empty arrays, destroying the tracking loadDb() had just restored
      // from the JSON snapshot moments earlier. Image listings were therefore
      // empty right after a cold start until the next loadDb() ran.
      // Both lists are now owned solely by loadDb()/saveDb().

      // Map Cities
      if (results["City"] === null) {
        console.warn("[Boot] Skipping city hydration/seed — the D1 City query failed.");
      } else if (results["City"]!.length > 0) {
        let detailedCitiesMap: Record<
          string,
          { city_ar: string; district: string }
        > = {};
        try {
          const filePath = path.join(
            process.cwd(),
            "src/components/detailed_cities_map.json",
          );
          if (fs.existsSync(filePath)) {
            detailedCitiesMap = JSON.parse(fs.readFileSync(filePath, "utf8"));
          }
        } catch (e) {}

        state.setD1Cities(
          results["City"].map((r: any) => {
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
          }),
        );
      } else {
        console.log("D1 City table empty on boot. Seeding...");
        const seeded = await autoSeedCityTableD1(accountId, databaseId, apiToken);
        if (seeded) {
          const d1List = await fetchRealD1CitiesIfConfigured();
          if (d1List) {
            state.setD1Cities(d1List);
          }
        }
      }

      // Map Coupons — only overwrite when the query actually succeeded.
      // A bare `if (results["coupons"])` used to be truthy for [], so a
      // transient D1 failure wiped every coupon from memory, after which
      // checkout would find no matching coupon and silently apply no
      // discount until the next successful boot/refresh.
      if (results["coupons"] !== null) {
        state.setCoupons(
          results["coupons"]!.map((row: any) => {
            let appProducts = null;
            if (row.applicableProducts) {
              try {
                appProducts = JSON.parse(row.applicableProducts);
              } catch (e) {}
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
          }),
        );
      }

      // Map Reviews
      const pictureMap = new Map<string, string[]>();
      if (results["review_pictures"] !== null) {
        results["review_pictures"]!.forEach((pic: any) => {
          const list = pictureMap.get(pic.review_id) || [];
          list.push(pic.image_url);
          pictureMap.set(pic.review_id, list);
        });
      }

      // Same fix as coupons above: only overwrite on a successful query, so
      // a failed reviews fetch no longer blanks every review on the site.
      //
      // Guard against the partial-failure case too: if review_pictures
      // failed while reviews succeeded, pictureMap is empty, and blindly
      // mapping would drop each review's images. Fall back to the row's own
      // `image` column in that case rather than nulling it.
      const picturesFailed = results["review_pictures"] === null;
      if (results["reviews"] !== null) {
        state.setReviews(
          results["reviews"]!.map((r: any) => {
            let parsedProducts = [];
            if (r.products) {
              try {
                parsedProducts = JSON.parse(r.products);
              } catch (e) {}
            }
            // If the review_pictures query failed we have no picture data at
            // all, so trust the row's own `image` column instead of treating
            // "no pictures found" as "this review has no images".
            const picURLs = picturesFailed ? [] : (pictureMap.get(r.id) || []);
            return {
              id: String(r.id),
              name: r.name ? String(r.name) : "",
              rating: Number(r.rating) || 0,
              comment: r.comment ? String(r.comment) : "",
              image:
                picURLs.length > 0
                  ? JSON.stringify(picURLs)
                  : r.image
                    ? String(r.image)
                    : null,
              date: r.date ? String(r.date) : new Date().toISOString(),
              tokenUsed: r.token_used ? String(r.token_used) : undefined,
              clientComment: r.client_comment ? String(r.client_comment) : "",
              products: parsedProducts,
              adminReply: r.admin_reply ? String(r.admin_reply) : "",
              isHidden: r.is_hidden === 1,
            };
          }),
        );
      }

      if (results["settings"] && results["settings"].length > 0) {
        try {
          state.setStoreSettings(JSON.parse(results["settings"][0].json_data));
        } catch (e) {
          console.error("Failed to parse settings from D1", e);
        }
      }

      // Sections. `null` means the query failed, in which case the existing
      // in-memory list is left alone rather than being replaced with []. An
      // empty list would make the SPA fallback treat every section page as
      // non-existent, so this distinction matters more here than elsewhere.
      if (results["sections"] === null) {
        console.warn(
          "[Boot] Skipping section hydration — the D1 sections_management query failed.",
        );
      } else if (results["sections"]!.length > 0) {
        // Same seo_settings overlay GET /api/sections applies, so a page
        // rendered before the first API call shows the same meta text.
        overlaySectionRows(results["sections"]!, await getSeoIndex());
        state.setSections(results["sections"]!);
      }

      return true;
    } catch (err) {
      console.error("Failed to load everything from D1 on boot:", err);
    }
    return false;
  }

  // Serialises loadDb: concurrent callers await the same run instead of each
  // starting their own.
  //
  // There are two callers — boot and the /api middleware — and the middleware
  // stamps its cooldown *before* awaiting, so a second request inside the same
  // 3s window proceeds without waiting for the load already in flight. Two
  // overlapping runs both fetch database.json from R2 and both writeFile the
  // same /tmp/database.json, so one can truncate the file the other is reading
  // (JSON.parse then throws into the catch below and that run restores
  // nothing), and both replace orders/coupons/tokens wholesale. A handler
  // running against the empty result and then calling saveDb() would upload a
  // snapshot with the orders missing.
  let inFlightLoad: Promise<void> | null = null;

  async function loadDb(_force?: boolean): Promise<void> {
    if (inFlightLoad) return inFlightLoad;
    inFlightLoad = loadDbOnce().finally(() => {
      inFlightLoad = null;
    });
    return inFlightLoad;
  }

  async function loadDbOnce() {
    try {
      await syncDbFromR2();
      // Prefer the writable path (/tmp on Vercel) if it exists — it holds the
      // most recently saved data. Only fall back to the read-only bundled
      // DB_PATH for a fresh cold start that hasn't written anything yet.
      const writablePath = getWritableDbPath();
      const readPath = fs.existsSync(writablePath) ? writablePath : DB_PATH;
      if (fs.existsSync(readPath)) {
        const rawData = await fs.promises.readFile(readPath, "utf-8");
        const data = JSON.parse(rawData);
        if (data.reviewTokens) state.setReviewTokens(new Map(data.reviewTokens));

        // Deliberately do NOT touch products / d1_products here.
        //
        // This used to do `setProducts([]); setD1Products([])`. The intent was
        // right — products are sourced from D1, so they should not be restored
        // from this JSON snapshot, which can be stale. But *clearing* them was
        // the wrong way to express that: loadDb() runs from the /api middleware
        // roughly every 3 seconds, so on a warm instance the live catalog was
        // being wiped out from under request handlers constantly. That single
        // line was the root cause of four separate bugs (checkout falling back
        // to client-supplied prices, image upload colliding on product_nbr 1,
        // duplicate placeholder products, and image-to-product assignment
        // silently doing nothing).
        //
        // Not restoring and not clearing is the correct behaviour: on a cold
        // start these arrays are already empty and fetchEverythingFromD1()
        // fills them; on a warm instance they keep the last known-good D1 data.
        // Nothing uses "products is empty" as a refetch signal — refresh is
        // driven by the d1ApiCache TTL — so leaving them intact changes no
        // caching behaviour and does not extend staleness.
        if (data.orders) state.setOrders(data.orders);
        if (data.coupons) state.setCoupons(data.coupons);
        if (data.uploadedImages) state.setUploadedImages(data.uploadedImages);
        if (data.d1_images) state.setD1Images(data.d1_images);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function saveDb() {
    try {
      const data = {
        reviewTokens: Array.from(state.getReviewTokens().entries()),
        products: state.getProducts(),
        orders: state.getOrders(),
        coupons: state.getCoupons(),
        uploadedImages: state.getUploadedImages(),
        d1_products: state.getD1Products(),
        d1_images: state.getD1Images(),
      };
      const jsonStr = JSON.stringify(data, null, 2);
      const writablePath = getWritableDbPath();
      await fs.promises.writeFile(writablePath, jsonStr, "utf-8");
      if (writablePath !== DB_PATH) {
        try {
          await fs.promises.writeFile(DB_PATH, jsonStr, "utf-8");
        } catch {}
      }
      await syncDbToR2();
    } catch (e) {
      console.error("saveDb error:", e);
    }
  }

  return { fetchEverythingFromD1, loadDb, saveDb };
}
