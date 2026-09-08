import express from "express";
import { authenticateAdmin } from "../middleware/auth";
import { logAdminAction } from "../services/auditLog";
import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";
import { generateUUID } from "../utils/idUtils";
import {
  buildReviewTargets,
  reviewRowMatchesTarget,
  type ReviewTarget,
} from "../../lib/reviewTargets";

// A review is linked to products through its `products` JSON column, which
// holds an array of product ids OR product names (whatever the review-invite
// was generated with) — there is no product_id foreign key. So matching is a
// case-insensitive compare against every reference the caller knows for the
// product. Both the product-scoped review list and the ratings summary use
// this, so the storefront and the aggregate can never disagree.
const normalizeRef = (value: any) => String(value ?? "").toLowerCase().trim();

function reviewMatchesRefs(review: any, refs: string[]): boolean {
  if (!refs.length) return true;
  if (!Array.isArray(review?.products)) return false;
  return review.products.some((ref: any) => refs.includes(normalizeRef(ref)));
}

/**
 * Parses ?limit= / ?offset= for the public review list.
 *
 * limit is intentionally optional: omitting it returns every review, which is
 * what /api/analytics and the offline mock still expect. Only callers that ask
 * for a page get one, so adding pagination could not break an existing reader.
 */
function parseReviewPaging(query: any): { limit: number | null; offset: number } {
  const rawLimit = query?.limit;
  const rawOffset = query?.offset;

  let limit: number | null = null;
  if (rawLimit !== undefined && rawLimit !== "") {
    const parsed = parseInt(String(rawLimit), 10);
    // Cap the page size so a crafted ?limit=999999 can't be used to force the
    // server to serialise the entire table in one response.
    if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, 100);
  }

  let offset = 0;
  if (rawOffset !== undefined && rawOffset !== "") {
    const parsed = parseInt(String(rawOffset), 10);
    if (Number.isFinite(parsed) && parsed > 0) offset = parsed;
  }

  return { limit, offset };
}

// Reviews + review-token routes.
// Shared state injected via factory: reviews[], reviewTokens, orders (read),
// d1ApiCache.reviews, saveDb, saveReviewsDb, processBase64Image,
// moveReviewImagesToDeleted, getD1VirtualToken, ensureD1OrdersTablesExist,
// reviewTokenLimiter, createToken, executeD1Query, D1_CACHE_TTL_MS.

interface ReviewToken {
  id: string;
  token: string;
  status: "pending" | "processing" | "submitted";
  createdAt: string;
  usedAt?: string;
  comment?: string;
  products?: string[];
  /**
   * Purchased items with their product ids attached. Optional: tokens created
   * before this existed, and any persisted in the JSON snapshot, carry only
   * `products` (names), which the review form falls back to.
   */
  productRefs?: { id?: string | null; name: string }[];
}

type TokenProductSource = { id?: string | null; name: string };

interface ReviewsState {
  getReviews: () => any[];
  setReviews: (v: any[]) => void;
  getReviewTokens: () => Map<string, ReviewToken>;
  getOrders: () => any[];
  getD1ApiCacheReviews: () => { data: any; timestamp: number };
  setD1ApiCacheReviews: (v: { data: any; timestamp: number }) => void;
  /**
   * Drops the cached public review list. Optional so other callers of this
   * factory keep working. Call it AFTER the D1 statements for a write have
   * landed — saveReviewsDb clears the same cache, but it is awaited before
   * them, so a read in that window would cache pre-write data for a full TTL.
   */
  invalidateReviewsCache?: () => void;
  getD1CacheTtlMs: () => number;
  saveDb: () => Promise<void>;
  saveReviewsDb: () => Promise<void>;
  processBase64Image: (...args: any[]) => Promise<string | null | undefined>;
  moveReviewImagesToDeleted: (img: any, toActive?: boolean) => Promise<any>;
  getD1VirtualToken: (token: string) => Promise<ReviewToken | null>;
  ensureD1OrdersTablesExist: (accountId: string, databaseId: string, apiToken: string) => Promise<boolean>;
  reviewTokenLimiter: any;
  createToken: (
    comment?: string,
    products?: string[],
    customToken?: string,
    productRefs?: { id?: string | null; name: string }[],
  ) => Promise<string>;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
  // Needed only by the general-review-link routes below: reading the live
  // storeSettings is how a disabled link is enforced server-side rather than
  // just hidden client-side.
  getStoreSettings: () => any;
  // Re-reads the settings blob from D1 when this instance's copy is past its
  // cooldown (see refreshStoreSettingsFromD1 in server.ts). Optional, so
  // callers that don't supply it keep the previous in-memory-only behaviour.
  refreshStoreSettings?: (force?: boolean) => Promise<void>;
  // Needed only by GET /reviews, to resolve a pack's constituent product ids
  // into the extra name/id refs its reviews should be matched against.
  getProducts: () => any[];
}

export function createReviewRouter(state: ReviewsState) {
  const router = express.Router();

  /**
   * The purchased items on a token, in the shape buildReviewTargets expects.
   *
   * Prefers `productRefs` (name + product id, written by checkout, by the admin
   * Orders backfill and by the D1 virtual-token reconstruction) and falls back
   * to `products`, which is names only — every token created before productRefs
   * existed, plus anything restored from the JSON snapshot, is name-only.
   */
  const tokenProductSources = (
    tokenData: ReviewToken | null | undefined,
  ): TokenProductSource[] => {
    const refs = tokenData?.productRefs;
    if (Array.isArray(refs) && refs.length > 0) {
      return refs
        .filter((ref) => ref && (ref.name || ref.id))
        .map((ref) => ({ id: ref.id ?? null, name: String(ref.name ?? "") }));
    }
    return (tokenData?.products || [])
      .filter(Boolean)
      .map((name) => ({ name: String(name) }));
  };

  /**
   * Existing review rows for a token, matched one-to-one onto the products the
   * form is about, so the form can pre-fill each box with what was written for
   * that product.
   *
   * One-to-one matters: a review submitted through the old single-box form is a
   * single row listing every product in the order, and it would otherwise match
   * every target and pre-fill the same text into all of them.
   */
  const claimRowsForTargets = (
    rows: any[],
    targets: ReviewTarget[],
  ): Map<string, any> => {
    const claimedIds = new Set<string>();
    const byTargetKey = new Map<string, any>();
    for (const target of targets) {
      const row = rows.find(
        (candidate) =>
          !claimedIds.has(candidate?.id) &&
          reviewRowMatchesTarget(candidate?.products, target),
      );
      if (!row) continue;
      claimedIds.add(row.id);
      byTargetKey.set(target.key, row);
    }
    return byTargetKey;
  };

  // Pulls the visible reviews from D1 and refills the shared response cache.
  const refreshReviewsCacheFromD1 = async (
    accountId: string,
    databaseId: string,
    apiToken: string,
  ) => {
    try {
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const sql = `SELECT id, name, rating, comment, image, date, client_comment, products, admin_reply FROM reviews WHERE is_hidden = 0 OR is_hidden IS NULL ORDER BY date DESC;`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      if (resp.ok) {
        const data = await resp.json();
        let rows = data.result?.[0]?.results || data.result?.results || [];
        if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
        const publicReviews = rows.map((r: any) => {
          let parsedProducts = [];
          if (r.products) { try { parsedProducts = JSON.parse(r.products); } catch (e) {} }
          return {
            id: String(r.id),
            name: r.name ? String(r.name) : "",
            rating: Number(r.rating) || 0,
            comment: r.comment ? String(r.comment) : "",
            image: r.image ? String(r.image) : null,
            date: r.date ? String(r.date) : new Date().toISOString(),
            clientComment: r.client_comment ? String(r.client_comment) : "",
            products: parsedProducts,
            adminReply: r.admin_reply ? String(r.admin_reply) : "",
          };
        });
        state.setD1ApiCacheReviews({ data: publicReviews, timestamp: Date.now() });
      }
    } catch (err) {
      console.error("Direct D1 query for reviews failed:", err);
    }
  };

  /**
   * The full list of publicly visible reviews, from cache where possible.
   *
   * Shared by the paged list and the ratings summary so the two can never
   * disagree about what exists. Keeps the original stale-while-revalidate
   * behaviour: a cold cache is filled before responding, a stale one is
   * refreshed in the background while the current copy is served.
   *
   * The summary route relies on the blocking branch. It used to skip the D1 read
   * entirely and fall back to the in-memory snapshot, which — now that it is what
   * the storefront asks for on first load instead of /api/reviews — meant a cold
   * serverless instance could compute every product's rating from a stale
   * bundled copy and then have that answer cached at the edge for a minute.
   */
  const getPublicReviews = async (): Promise<any[]> => {
    const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
    const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
    const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

    if (!accountId || !databaseId || !apiToken || isMaskedValue(accountId)) {
      return state.getReviews().filter((r) => !r.isHidden);
    }

    const cache = state.getD1ApiCacheReviews();
    if (!cache.data || Date.now() - cache.timestamp > state.getD1CacheTtlMs()) {
      if (!cache.data) await refreshReviewsCacheFromD1(accountId, databaseId, apiToken);
      else refreshReviewsCacheFromD1(accountId, databaseId, apiToken);
    }

    const updated = state.getD1ApiCacheReviews();
    if (updated.data) return updated.data;
    return state.getReviews().filter((r) => !r.isHidden);
  };

  // Public: list visible reviews (with D1 cache).
  //
  // Supports ?limit / ?offset for "Load more", plus ?productId / ?productName /
  // ?productNameEn / ?rating so a product page fetches only its own reviews
  // instead of downloading every review in the shop and filtering in the
  // browser. Filtering and slicing happen over the already-cached full array,
  // so a page request costs no extra D1 round-trip.
  router.get("/reviews", async (req, res) => {
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    // The response body now depends on the query string, so it has to be part
    // of what a shared cache keys on. Express/CDNs key on the full URL
    // including the query, but Vary is still declared for correctness.
    res.setHeader("Vary", "Accept-Encoding");

    const { limit, offset } = parseReviewPaging(req.query);
    const refs = [req.query.productId, req.query.productName, req.query.productNameEn]
      .map(normalizeRef)
      .filter(Boolean);

    // A pack shows only the reviews written about the pack itself.
    //
    // This used to expand the requested pack into its members and pull in their
    // reviews as well. That made sense while a pack had no review of its own —
    // the form only ever asked about the individual products — but the form now
    // asks for a review of the pack as a set, above the per-product ones. So a
    // pack is a reviewable thing in its own right, with its own rating, and
    // copying its members' reviews onto it would both duplicate them (they are
    // already on each product's page) and drown out what customers said about
    // the pack.
    const uniqueRefs = Array.from(new Set(refs.filter(Boolean)));

    const ratingFilter = req.query.rating !== undefined && req.query.rating !== ""
      ? parseInt(String(req.query.rating), 10)
      : null;

    // Applies the filters and the window to a full review array, and reports
    // the pre-slice total so the client knows whether more remain.
    const respondWith = (all: any[]) => {
      let filtered = all;
      if (uniqueRefs.length) filtered = filtered.filter((r) => reviewMatchesRefs(r, uniqueRefs));
      if (ratingFilter !== null && Number.isFinite(ratingFilter)) {
        filtered = filtered.filter((r) => Math.round(Number(r.rating) || 0) === ratingFilter);
      }

      const total = filtered.length;
      const start = Math.min(offset, total);
      const page = limit === null ? filtered.slice(start) : filtered.slice(start, start + limit);

      return res.json({
        success: true,
        reviews: page,
        total,
        offset: start,
        limit,
        hasMore: start + page.length < total,
      });
    };

    return respondWith(await getPublicReviews());
  });

  // Public: per-product rating aggregate.
  //
  // Exists so the storefront can show a star rating and review count on every
  // product card without downloading the whole reviews table to compute them.
  // ProductContext used to fetch /api/reviews in full for exactly that, and
  // then joined on r.product_id / r.product_name — fields the public review
  // objects do not have, so the join silently produced nothing and every card
  // fell back to its default. This returns one small entry per product
  // reference instead.
  //
  // Keyed by every reference the reviews mention (id and/or name, lowercased),
  // because that is all the `products` column records; the client looks up its
  // product by id, then name, then English name.
  router.get("/reviews/summary", async (req, res) => {
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("Vary", "Accept-Encoding");

    const buildSummary = (all: any[]) => {
      const acc = new Map<string, { count: number; sum: number }>();
      for (const review of all) {
        if (!review || review.isHidden) continue;
        if (!Array.isArray(review.products)) continue;
        const rating = Number(review.rating);
        // A review with no usable rating is skipped entirely — it contributes to
        // neither the count nor the average. Counting it while excluding it from
        // the sum would drag every average down towards zero.
        if (!Number.isFinite(rating) || rating <= 0) continue;

        // A review can reference the same product twice (id and name); count
        // it once per product.
        const seen = new Set<string>();
        for (const ref of review.products) {
          const key = normalizeRef(ref);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const entry = acc.get(key) || { count: 0, sum: 0 };
          entry.count += 1;
          entry.sum += rating;
          acc.set(key, entry);
        }
      }

      // Deliberately no pack aggregation here.
      //
      // An earlier version rolled each pack's members' ratings up into the pack,
      // because reviews were only ever written against individual products and a
      // pack would otherwise have had no rating at all. The review form now asks
      // for a review of the pack itself, so a pack earns its own stars from its
      // own reviews — inheriting its members' would mix two different opinions
      // (how good the oil is vs. how good the set is) into one number, and would
      // count the same reviews twice across the site.

      // rating is a string with one decimal ("4.7", "5.0") because that is what
      // the product cards rendered before this endpoint existed — the old
      // client-side join produced avgRating.toFixed(1). Returning a number here
      // would quietly change a clean five-star average from "5.0" to "5".
      const summary: Record<string, { count: number; rating: string }> = {};
      for (const [key, { count, sum }] of acc) {
        summary[key] = { count, rating: (sum / count).toFixed(1) };
      }
      return res.json({ success: true, summary });
    };

    return buildSummary(await getPublicReviews());
  });

  // Public: submit a review (rate-limited by reviewTokenLimiter)
  router.post("/reviews", state.reviewTokenLimiter, async (req, res) => {
    try {
      const { token, name, rating, comment, image, images, productReviews } = req.body;
      const safeRating = Math.min(5, Math.max(1, parseInt(String(rating), 10) || 5));
      const reviewTokens = state.getReviewTokens();
      let tokenData = reviewTokens.get(token);

      if (!tokenData) {
        const virtualToken = await state.getD1VirtualToken(token);
        if (virtualToken) { tokenData = virtualToken; reviewTokens.set(token, virtualToken); }
      }

      if (!tokenData || tokenData.status !== "pending") {
        return res.status(403).json({ success: false, message: "Invalid or already used review token." });
      }

      // What is being reviewed, decided server-side.
      //
      // The customer's browser posts a comment per product, but which products
      // are legitimately reviewable comes from the token, never from the
      // request — otherwise anyone holding a review link could attach a review
      // to any product in the shop. Packs are expanded into their members here,
      // and a member that was also bought separately collapses into a single
      // entry (by product id) rather than being asked for twice.
      //
      // Worked out before the images are uploaded, because a submission with
      // nothing written in it is rejected below and doing that after the upload
      // would leave orphaned files in storage for a review that never existed.
      const targets = buildReviewTargets(tokenProductSources(tokenData), state.getProducts());

      // One planned row per product being reviewed. `match` finds the existing
      // row this entry should overwrite when a review is being edited.
      interface PlannedRow {
        comment: string;
        products: string[];
        /** Catalog id of the product, when known. Used when splitting a row. */
        productId?: string;
        /**
         * This product's own star rating. Each product in an order is rated
         * separately — a pack can be 5 stars while one bottle inside it is 3 —
         * so the rating belongs to the row, not to the submission.
         */
        rating: number;
        match: (row: any) => boolean;
      }
      const planned: PlannedRow[] = [];

      const submitted = Array.isArray(productReviews) ? productReviews : null;
      if (submitted && targets.length > 0) {
        // Iterate the server-side targets, not the posted array, so unknown
        // products in the payload are ignored instead of trusted.
        for (const target of targets) {
          const entry = submitted.find((candidate: any) => {
            const candidateId = normalizeRef(candidate?.productId);
            if (candidateId && target.id && candidateId === normalizeRef(target.id)) return true;
            return normalizeRef(candidate?.productName) === normalizeRef(target.name);
          });
          const text = String(entry?.comment ?? "").trim();
          const postedRating = parseInt(String(entry?.rating), 10) || 0;
          // Either half is a review: stars with no words still say something,
          // and words with no stars are the case the old form only had. An entry
          // with neither is simply a product the customer left alone.
          if (!text && postedRating <= 0) continue;
          // Clamped like the submission-wide rating. Falls back to that one so a
          // client that sends only a single rating (an older bundle) still
          // stores something sensible.
          const entryRating = Math.min(
            5,
            Math.max(1, postedRating || safeRating),
          );
          planned.push({
            comment: text,
            rating: entryRating,
            // Stored as the product NAME, matching every other review in the
            // table: `products` is both the matching key for product pages and
            // what gets rendered as a tag, so an id here would show up as a
            // number in the UI and break historical consistency.
            products: [target.name],
            productId: target.id,
            match: (row: any) => reviewRowMatchesTarget(row?.products, target),
          });
        }
        if (planned.length === 0) {
          // Nothing written: hand the token back so the link keeps working.
          tokenData.status = "pending";
          reviewTokens.set(token, tokenData);
          return res.status(400).json({
            success: false,
            message: "Please rate at least one product, or write a review for it.",
          });
        }
      } else {
        // Legacy shape (one comment for the whole order), and the fallback when
        // the token has no resolvable products. Unchanged behaviour: a single
        // row carrying every product the token names.
        planned.push({
          comment,
          rating: safeRating,
          products: tokenData.products || [],
          match: () => true,
        });
      }

      // Claimed only once there is something valid to write. Flipping it before
      // the work above meant any exception in there left the token stuck out of
      // "pending", and check-token refuses anything else — a permanently dead
      // review link.
      tokenData.status = "processing";
      reviewTokens.set(token, tokenData);

      let processedImages: string[] = [];
      try {
        const dateStr = new Date().toISOString().split("T")[0];
        const baseFilename = `${token}_${dateStr}`;
        if (images && Array.isArray(images)) {
          for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const explicitName = images.length > 1 ? `${baseFilename}_${i + 1}` : baseFilename;
            const processed = await state.processBase64Image(img, explicitName, "Reviews", undefined, true, true);
            if (processed) processedImages.push(processed);
          }
        } else if (image) {
          const processedImage = await state.processBase64Image(image, baseFilename, "Reviews", undefined, true, true);
          if (processedImage) processedImages.push(processedImage);
        }
      } catch (imgError) {
        tokenData.status = "pending";
        reviewTokens.set(token, tokenData);
        throw imgError;
      }

      const reviews = state.getReviews();
      const reviewImage = processedImages.length > 0 ? JSON.stringify(processedImages) : null;
      // Photos go on ONE row, not on all of them.
      //
      // The uploaded files are shared, and hiding or deleting a review calls
      // moveReviewImagesToDeleted, which physically moves the objects in
      // storage. If every row of a submission carried the same URLs, hiding one
      // product's review would break the photos on its siblings. Attaching them
      // to the first row written keeps that impossible.
      let imageRowAssigned = false;
      const takeImage = (): string | null => {
        if (reviewImage === null || imageRowAssigned) return null;
        imageRowAssigned = true;
        return reviewImage;
      };

      // Existing rows for this token, each claimable by at most one planned
      // entry. Without the claim set, a legacy row listing three products would
      // be matched by all three entries and overwritten three times, leaving
      // one comment instead of three.
      const tokenRows = reviews.filter((r) => r.tokenUsed === token);
      const claimedRowIds = new Set<string>();
      const d1Ops: { sql: string; params: any[] }[] = [];
      const touchedReviewIds: string[] = [];
      const newRows: any[] = [];
      const now = new Date().toISOString();

      for (const entry of planned) {
        const existing = tokenRows.find(
          (row) => !claimedRowIds.has(row.id) && entry.match(row),
        );
        const existingProductCount = Array.isArray(existing?.products)
          ? existing!.products.length
          : 0;

        if (existing && existingProductCount > 1 && entry.products.length > 0) {
          // The matched row is an old-style one covering several products at
          // once, and this entry is about a single product. Take that product
          // OUT of the old row and give it a row of its own.
          //
          // The obvious alternative — overwrite the old row's `products` with
          // just this product — silently deletes the review the other products
          // on that row were showing: a customer who reviewed A, B and C in one
          // box and then edits only B would wipe A's and C's reviews. Splitting
          // keeps the original text on whatever isn't being rewritten.
          const remaining = existing.products.filter(
            (ref: any) =>
              normalizeRef(ref) !== normalizeRef(entry.products[0]) &&
              !(entry.productId && normalizeRef(ref) === normalizeRef(entry.productId)),
          );
          existing.products = remaining;
          d1Ops.push({
            sql: `UPDATE reviews SET products = ? WHERE id = ?;`,
            params: [JSON.stringify(remaining), existing.id],
          });
          // Deliberately NOT added to touchedReviewIds: its comment and images
          // are untouched, so its pictures must not be rewritten.
          const splitImage = takeImage();
          const splitReview = {
            id: generateUUID(), name, rating: entry.rating, comment: entry.comment,
            image: splitImage, date: now,
            tokenUsed: token, clientComment: tokenData.comment || "",
            products: entry.products, adminReply: "", isHidden: false,
          };
          newRows.push(splitReview);
          d1Ops.push({
            sql: `INSERT INTO reviews (id, name, rating, comment, image, date, token_used, client_comment, products) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            params: [
              splitReview.id, splitReview.name, splitReview.rating, splitReview.comment,
              splitReview.image, splitReview.date, splitReview.tokenUsed,
              splitReview.clientComment, JSON.stringify(splitReview.products),
            ],
          });
          if (splitImage !== null) touchedReviewIds.push(splitReview.id);
        } else if (existing) {
          claimedRowIds.add(existing.id);
          existing.name = name;
          existing.rating = entry.rating;
          existing.comment = entry.comment;
          const updateImage = takeImage();
          if (updateImage !== null) existing.image = updateImage;
          existing.date = now;
          if (entry.products.length > 0) existing.products = entry.products;
          d1Ops.push({
            sql: `UPDATE reviews SET name = ?, rating = ?, comment = ?, image = ?, date = ?, products = ? WHERE id = ?;`,
            params: [
              existing.name,
              existing.rating,
              existing.comment,
              existing.image,
              existing.date,
              JSON.stringify(existing.products || []),
              existing.id,
            ],
          });
          if (updateImage !== null) touchedReviewIds.push(existing.id);
        } else {
          const insertImage = takeImage();
          const newReview = {
            id: generateUUID(), name, rating: entry.rating, comment: entry.comment,
            image: insertImage, date: now,
            tokenUsed: token, clientComment: tokenData.comment || "",
            products: entry.products, adminReply: "", isHidden: false,
          };
          newRows.push(newReview);
          d1Ops.push({
            sql: `INSERT INTO reviews (id, name, rating, comment, image, date, token_used, client_comment, products) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            params: [
              newReview.id,
              newReview.name,
              newReview.rating,
              newReview.comment,
              newReview.image,
              newReview.date,
              newReview.tokenUsed,
              newReview.clientComment,
              JSON.stringify(newReview.products),
            ],
          });
          if (insertImage !== null) touchedReviewIds.push(newReview.id);
        }
      }

      // Newest first, preserving the order the products were reviewed in.
      if (newRows.length > 0) reviews.unshift(...newRows);
      state.setReviews(reviews);

      tokenData.status = "submitted";
      tokenData.usedAt = new Date().toISOString();
      reviewTokens.set(token, tokenData);

      let d1OrderSql = "";
      let d1OrderParams: any[] = [];
      const orders = state.getOrders();
      const matchedOrder = orders.find((o) => o.orderNbr === token || o.order_nbr === token);
      if (matchedOrder) {
        const currentStatus = String(matchedOrder.status || "pending").toLowerCase();
        if (currentStatus === "pending" || currentStatus === "opened") {
          matchedOrder.status = "confirmed";
          d1OrderSql = `UPDATE orders SET status = 'confirmed' WHERE id = ?;`;
          d1OrderParams = [matchedOrder.id];
        }
      }

      await state.saveDb();
      await state.saveReviewsDb();

      try {
        for (const op of d1Ops) {
          await state.executeD1Query(op.sql, op.params);
        }
        if (d1OrderSql) await state.executeD1Query(d1OrderSql, d1OrderParams);
        // Pictures are attached to every row this submission wrote: the
        // customer uploads photos of their order once, and each product they
        // reviewed is part of that order.
        //
        // Only touched when images were actually submitted. The previous
        // version deleted the picture rows on every edit and then re-inserted
        // whatever was posted — so editing a review without re-uploading wiped
        // review_pictures while the `image` column kept the old URLs.
        if (processedImages.length > 0) {
          for (const reviewId of touchedReviewIds) {
            await state.executeD1Query(`DELETE FROM review_pictures WHERE review_id = ?;`, [reviewId]);
            for (const img of processedImages) {
              await state.executeD1Query(
                `INSERT INTO review_pictures (review_id, image_url) VALUES (?, ?);`,
                [reviewId, img],
              );
            }
          }
        }
      } catch (err) {
        console.error("Failed to propagate review to D1", err);
      }
      // D1 is the source for the public list, so it is only correct now.
      state.invalidateReviewsCache?.();

      res.json({ success: true, message: "Review submitted successfully." });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ success: false, message: "Failed to submit review" });
    }
  });

  // Public: check if a review token is valid (rate-limited)
  router.get("/reviews/check-token/:token", state.reviewTokenLimiter, async (req, res) => {
    const { token } = req.params;
    const reviewTokens = state.getReviewTokens();
    let tokenData = reviewTokens.get(token);

    if (!tokenData) {
      const virtualToken = await state.getD1VirtualToken(token);
      if (virtualToken) { tokenData = virtualToken; reviewTokens.set(token, virtualToken); }
    }

    const reviews = state.getReviews();
    let existingReview = reviews.find((r) => String(r.id) === token || r.tokenUsed === token);

    // If not found in memory, query D1 reviews by id or token_used
    if (!existingReview && process.env.CLOUDFLARE_D1_ACCOUNT_ID) {
      try {
        const reviewSql = `SELECT * FROM reviews WHERE id = ? OR token_used = ? LIMIT 1;`;
        const reviewRows = await state.executeD1Query(reviewSql, [token, token]);
        if (Array.isArray(reviewRows) && reviewRows.length > 0) {
          const r = reviewRows[0];
          existingReview = {
            id: String(r.id),
            name: r.name ? String(r.name) : "",
            rating: Number(r.rating) || 0,
            comment: r.comment ? String(r.comment) : "",
            image: r.image ? String(r.image) : null,
            date: r.date ? String(r.date) : new Date().toISOString(),
            tokenUsed: r.token_used ? String(r.token_used) : undefined,
            clientComment: r.client_comment ? String(r.client_comment) : undefined,
            isHidden: Boolean(r.is_hidden),
            products: r.products ? (typeof r.products === "string" ? JSON.parse(r.products || "[]") : r.products) : [],
          };
        }
      } catch (e) {
        console.error("Error looking up review by id:", e);
      }
    }

    if (!tokenData && existingReview) {
      tokenData = {
        id: existingReview.id,
        token: token,
        status: (existingReview as any).editAllowed ? "pending" : "submitted",
        createdAt: existingReview.date || new Date().toISOString(),
        products: existingReview.products || [],
        comment: existingReview.clientComment || existingReview.name,
      };
      reviewTokens.set(token, tokenData);
    }

    if (!tokenData) {
      return res.status(403).json({ success: false, isValid: false, message: "Token not found" });
    }

    // What the form should actually ask about: packs expanded into the products
    // inside them, and each product only once even when it was bought both
    // inside a pack and on its own.
    const reviewTargets = buildReviewTargets(
      tokenProductSources(tokenData),
      state.getProducts(),
    );
    const tokenRows = reviews.filter((r) => r.tokenUsed === token || String(r.id) === token);
    const claimed = claimRowsForTargets(tokenRows, reviewTargets);

    const isPending = tokenData.status === "pending";

    // If status is not pending (i.e. submitted), but an existing review is found, return details
    if (!isPending) {
      if (existingReview || tokenRows.length > 0) {
        return res.json({
          success: true,
          isValid: true,
          isSubmitted: true,
          canEdit: false,
          products: tokenData.products || existingReview?.products || [],
          clientName: existingReview ? existingReview.name : tokenData.comment,
          existingReview: existingReview
            ? { comment: existingReview.comment, rating: existingReview.rating, image: existingReview.image }
            : null,
          reviewTargets: reviewTargets.map((target) => ({
            key: target.key,
            id: target.id,
            name: target.name,
            isPack: target.isPack,
            comment: claimed.get(target.key)?.comment || existingReview?.comment || "",
            rating: Number(claimed.get(target.key)?.rating) || existingReview?.rating || 5,
          })),
        });
      }
      return res.status(403).json({ success: false, isValid: false, message: "Review link is closed" });
    }

    res.json({
      success: true,
      isValid: true,
      isSubmitted: false,
      canEdit: true,
      products: tokenData.products,
      clientName: existingReview ? existingReview.name : tokenData.comment,
      existingReview: existingReview ? { comment: existingReview.comment, rating: existingReview.rating, image: existingReview.image } : null,
      reviewTargets: reviewTargets.map((target) => ({
        key: target.key,
        id: target.id,
        name: target.name,
        isPack: target.isPack,
        comment: claimed.get(target.key)?.comment || "",
        rating: Number(claimed.get(target.key)?.rating) || 0,
      })),
    });
  });

  // Public: is the general (non-order) review link currently switched on?
  //
  // The customer-facing page checks this to decide whether to show the form
  // or the "not available" panel, but that check is a convenience only — the
  // real enforcement is the `enabled` check inside POST /reviews/general
  // below. A client that already has the page open with the form rendered
  // cannot submit anything once the admin flips this off, because the submit
  // route re-checks the same flag itself.
  router.get("/reviews/general/status", async (req, res) => {
    await state.refreshStoreSettings?.();
    const enabled = state.getStoreSettings()?.generalReviewLinkEnabled === true;
    res.json({ success: true, enabled });
  });

  // Public: submit a review through the general (non-order) link.
  //
  // Every other way to leave a review is tied to a specific order: the
  // customer follows a one-time link that already knows which product(s)
  // they bought. This route exists for customers who bought before the
  // website existed and never got one of those links — the admin shares one
  // fixed URL everywhere (WhatsApp, Instagram, in person), and the customer
  // picks which product(s) they're reviewing themselves.
  //
  // Two consequences of that:
  //   - There is no single-use token here. state.createToken()/reviewTokens
  //     enforce "used exactly once", which is the wrong shape for a link
  //     meant to be reused indefinitely by any number of different
  //     customers. This route writes reviews directly, the same way the
  //     existing POST /admin/reviews (manual admin entry) does, with
  //     token_used left NULL.
  //   - "Disabling the link stops it from working" has to be enforced here,
  //     not only by hiding the button in the admin UI or the form on the
  //     client: storeSettings.generalReviewLinkEnabled is checked below and
  //     a disabled link 404s, exactly as if the route didn't exist, so a
  //     bookmarked/shared URL goes dead the moment the toggle is switched.
  router.post("/reviews/general", state.reviewTokenLimiter, async (req, res) => {
    try {
      // Both gates below (the on/off toggle and the product allow-list) have
      // to run against the live settings, not this instance's boot-time copy,
      // or a customer can be refused a product the admin has just allowed.
      await state.refreshStoreSettings?.();
      const storeSettings = state.getStoreSettings();
      if (storeSettings?.generalReviewLinkEnabled !== true) {
        return res.status(404).json({ success: false, message: "This review link is not available." });
      }

      const {
        name, rating, comment, images, image, products, otherProductNote,
        // New shape: one comment per product (packs expanded, duplicates
        // collapsed). `comment` is still accepted for older clients.
        productReviews, otherProductComment,
      } = req.body;
      const safeRating = Math.min(5, Math.max(1, parseInt(String(rating), 10) || 5));

      // At least one product reference is required — a review with no
      // product at all can't be shown against any product page, and silently
      // accepting one would just create an orphan nobody can find later.
      let selectedProducts: string[] = Array.isArray(products)
        ? products.map((p: any) => String(p ?? "").trim()).filter(Boolean)
        : [];

      // The admin's product allow-list (Settings > General Review Link) is
      // re-checked here, not just used to build the picker on the client —
      // otherwise anyone could post an unlisted product name directly to
      // this endpoint and bypass the restriction entirely. `undefined` means
      // the admin never touched the picker, i.e. "no restriction".
      const allowedProducts = storeSettings?.generalReviewProducts;
      if (Array.isArray(allowedProducts)) {
        const allowedSet = new Set(allowedProducts.map((p: any) => String(p ?? "").trim()));
        selectedProducts = selectedProducts.filter((p) => allowedSet.has(p));
      }

      const otherNote = String(otherProductNote ?? "").trim();
      if (selectedProducts.length === 0 && !otherNote) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one product, or describe what you bought.",
        });
      }

      // Expand any selected pack into the products inside it, and collapse a
      // product that was selected both on its own and as part of a pack into a
      // single entry — by product id, since that is what pack membership is
      // recorded with. The allow-list check above still governs what may be
      // *selected*; a member of an allowed pack is reviewable because the pack
      // itself was allowed.
      const generalTargets = buildReviewTargets(
        selectedProducts.map((productName) => ({ name: productName })),
        state.getProducts(),
      );

      const submittedGeneral = Array.isArray(productReviews) ? productReviews : null;
      // Each planned row is one review: the text, and the products it is filed
      // against (empty for the "something else" note, which has no catalog
      // product to attach to).
      const plannedGeneral: {
        comment: string;
        products: string[];
        clientComment: string;
        /** Each product carries its own star rating (see the token path above). */
        rating: number;
      }[] = [];

      if (submittedGeneral) {
        for (const target of generalTargets) {
          const entry = submittedGeneral.find((candidate: any) => {
            const candidateId = normalizeRef(candidate?.productId);
            if (candidateId && target.id && candidateId === normalizeRef(target.id)) return true;
            return normalizeRef(candidate?.productName) === normalizeRef(target.name);
          });
          const text = String(entry?.comment ?? "").trim();
          const postedRating = parseInt(String(entry?.rating), 10) || 0;
          // Stars alone count, same as the token path above.
          if (!text && postedRating <= 0) continue;
          const entryRating = Math.min(
            5,
            Math.max(1, postedRating || safeRating),
          );
          plannedGeneral.push({
            comment: text,
            products: [target.name],
            clientComment: "",
            rating: entryRating,
          });
        }
        const otherText = String(otherProductComment ?? "").trim();
        if (otherNote && otherText) {
          const otherRating = Math.min(
            5,
            Math.max(1, parseInt(String(req.body?.otherProductRating), 10) || safeRating),
          );
          plannedGeneral.push({
            comment: otherText,
            products: [],
            clientComment: otherNote,
            rating: otherRating,
          });
        } else if (otherNote && plannedGeneral.length > 0) {
          // The customer described something extra but didn't write a review
          // for it. The note is still worth keeping — the old single-row path
          // always stored it — so it rides along on the first product review
          // rather than being thrown away.
          plannedGeneral[0].clientComment = otherNote;
        }
        if (plannedGeneral.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Please rate at least one product, or write a review for it.",
          });
        }
      } else {
        // Legacy single-comment shape, unchanged: one row listing every
        // selected product.
        if (!String(comment ?? "").trim()) {
          return res.status(400).json({ success: false, message: "Please write a short review." });
        }
        plannedGeneral.push({
          comment: String(comment).trim(),
          products: selectedProducts,
          clientComment: otherNote,
          rating: safeRating,
        });
      }

      // Images go through the same pipeline as the token-based submission
      // (compression already happened client-side; this uploads/normalises
      // the result and returns the stored URLs).
      let processedImages: string[] = [];
      try {
        const dateStr = new Date().toISOString().split("T")[0];
        const baseFilename = `general_${generateUUID()}_${dateStr}`;
        if (images && Array.isArray(images)) {
          for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const explicitName = images.length > 1 ? `${baseFilename}_${i + 1}` : baseFilename;
            const processed = await state.processBase64Image(img, explicitName, "Reviews", undefined, true, true);
            if (processed) processedImages.push(processed);
          }
        } else if (image) {
          const processedImage = await state.processBase64Image(image, baseFilename, "Reviews", undefined, true, true);
          if (processedImage) processedImages.push(processedImage);
        }
      } catch (imgError) {
        console.error("Failed to process images for general review", imgError);
      }

      const reviewImage = processedImages.length > 0 ? JSON.stringify(processedImages) : null;
      const reviewerName = String(name ?? "").trim() || "Anonymous";
      const submittedAt = new Date().toISOString();
      // otherNote rides in client_comment (admin-only) rather than being
      // stuffed into `products`: `products` drives the case-insensitive
      // product-page matching (reviewMatchesRefs), and a free-text sentence
      // in that array would never match anything but would show up as a
      // garbled "product tag" anywhere `products` is rendered as a list.
      const newReviews = plannedGeneral.map((entry) => ({
        id: generateUUID(),
        name: reviewerName,
        rating: entry.rating,
        comment: entry.comment,
        image: reviewImage,
        date: submittedAt,
        tokenUsed: null,
        clientComment: entry.clientComment,
        products: entry.products,
        adminReply: "",
        isHidden: false,
      }));

      const reviews = state.getReviews();
      reviews.unshift(...newReviews);
      state.setReviews(reviews);
      await state.saveDb();
      await state.saveReviewsDb();

      try {
        const d1Sql = `INSERT INTO reviews (id, name, rating, comment, image, date, token_used, client_comment, products) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?);`;
        for (const newReview of newReviews) {
          await state.executeD1Query(d1Sql, [
            newReview.id,
            newReview.name,
            newReview.rating,
            newReview.comment,
            newReview.image,
            newReview.date,
            newReview.clientComment,
            JSON.stringify(newReview.products),
          ]);
          // The same uploaded photos belong to every product reviewed in this
          // one submission — they are pictures of what the customer received.
          for (const img of processedImages) {
            await state.executeD1Query(
              `INSERT INTO review_pictures (review_id, image_url) VALUES (?, ?);`,
              [newReview.id, img],
            );
          }
        }
      } catch (err) {
        console.error("Failed to propagate general review to D1", err);
      }
      state.invalidateReviewsCache?.();

      res.json({ success: true, message: "Review submitted successfully." });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ success: false, message: "Failed to submit review" });
    }
  });

  // Admin: list all reviews (fresh from D1)
  router.get("/admin/reviews", authenticateAdmin, async (req, res) => {
    if (process.env.CLOUDFLARE_D1_ACCOUNT_ID && process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_D1_API_TOKEN) {
      if (!isMaskedValue(process.env.CLOUDFLARE_D1_ACCOUNT_ID) && !isMaskedValue(process.env.CLOUDFLARE_D1_DATABASE_ID) && !isMaskedValue(process.env.CLOUDFLARE_D1_API_TOKEN)) {
        try {
          const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
          const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
          const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

          await state.ensureD1OrdersTablesExist(accountId, databaseId, apiToken);

          const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
          const resp = await fetch(cloudflareUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ sql: "SELECT * FROM reviews ORDER BY date DESC;" }),
          });

          if (resp.ok) {
            const data = await resp.json();
            let rows = data.result?.[0]?.results || data.result?.results || [];
            if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
            if (Array.isArray(rows)) {
              const mappedReviews = rows.map((r: any) => {
                let parsedProducts = [];
                if (r.products) { try { parsedProducts = JSON.parse(r.products); } catch (e) {} }
                return {
                  id: String(r.id), name: r.name ? String(r.name) : "",
                  rating: Number(r.rating) || 0, comment: r.comment ? String(r.comment) : "",
                  image: r.image ? String(r.image) : null,
                  date: r.date ? String(r.date) : new Date().toISOString(),
                  tokenUsed: r.token_used ? String(r.token_used) : undefined,
                  clientComment: r.client_comment ? String(r.client_comment) : "",
                  products: parsedProducts, adminReply: r.admin_reply ? String(r.admin_reply) : "",
                  isHidden: r.is_hidden === 1,
                };
              });
              return res.json({ success: true, reviews: mappedReviews });
            }
          }
        } catch (err) {
          console.error("Failed to fetch D1 admin reviews, falling back to local...", err);
        }
      }
    }
    res.json({ success: true, reviews: state.getReviews() });
  });

  // Admin: create a review manually
  router.post("/admin/reviews", authenticateAdmin, async (req, res) => {
    try {
      const { name, name_en, rating, comment, clientComment, image, adminReply, isHidden } = req.body;
      const safeRating = Math.min(5, Math.max(1, parseInt(String(rating), 10) || 5));
      const id = generateUUID();

      let processedImage = image;
      try {
        if (image) {
          if (image.startsWith("[")) {
            const parsedArray = JSON.parse(image);
            const processedArray = [];
            for (const img of parsedArray) {
              const processed = await state.processBase64Image(img, undefined, "Reviews", undefined, true, true);
              if (processed) processedArray.push(processed);
            }
            processedImage = processedArray.length > 0 ? JSON.stringify(processedArray) : null;
          } else {
            processedImage = await state.processBase64Image(image, undefined, "Reviews", undefined, true, true);
          }
        }
      } catch (e) {
        console.error("Failed to process image array during admin create review", e);
      }

      const newReview = {
        id, name: name || "Anonymous", rating: safeRating, comment: comment || "",
        clientComment: clientComment || "", adminReply: adminReply || "",
        isHidden: isHidden === true, image: processedImage,
        date: new Date().toISOString(), tokenUsed: null, products: [],
      };

      const reviews = state.getReviews();
      reviews.unshift(newReview);
      state.setReviews(reviews);
      await state.saveDb();
      await state.saveReviewsDb();

      try {
        // token_used is NULL and products is '[]' — both constants for an
        // admin-created review, so they stay literals. That makes 9
        // placeholders across 11 columns.
        const d1Sql = `INSERT INTO reviews (id, name, rating, comment, image, date, token_used, client_comment, products, admin_reply, is_hidden) VALUES (
          ?, ?, ?,
          ?, ?, ?,
          NULL, ?, '[]',
          ?, ?);`;
        await state.executeD1Query(d1Sql, [
          newReview.id,
          newReview.name,
          safeRating,
          newReview.comment,
          newReview.image,
          newReview.date,
          newReview.clientComment,
          newReview.adminReply,
          newReview.isHidden ? 1 : 0,
        ]);

        if (processedImage) {
          let imgs: string[] = processedImage.startsWith("[") ? JSON.parse(processedImage) : [processedImage];
          for (const img of imgs) {
            await state.executeD1Query(
              `INSERT INTO review_pictures (review_id, image_url) VALUES (?, ?);`,
              [newReview.id, img],
            );
          }
        }
      } catch (err) {
        console.error("Failed to propagate admin-created review to D1:", err);
      }

      await logAdminAction(req, "CREATE", "review", newReview.id, `Created review by ${newReview.name} (${safeRating} stars)`);
      res.json({ success: true, review: newReview });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Failed to create review" });
    }
  });

  // Admin: update a review
  router.put("/admin/reviews/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      let { name, name_en, rating, comment, clientComment, image, adminReply, isHidden } = req.body;
      const safeRating = Math.min(5, Math.max(1, parseInt(String(rating), 10) || 5));

      let processedImage = image;
      try {
        if (image && typeof image === "string") {
          if (image.startsWith("[")) {
            const parsedArray = JSON.parse(image);
            const processedArray = [];
            for (const img of parsedArray) {
              const processed = await state.processBase64Image(img, undefined, "Reviews", undefined, true, true);
              if (processed) processedArray.push(processed);
            }
            processedImage = processedArray.length > 0 ? JSON.stringify(processedArray) : null;
          } else {
            processedImage = await state.processBase64Image(image, undefined, "Reviews", undefined, true, true);
          }
        }
      } catch (e) {
        console.error("Failed to process image array during edit", e);
      }

      const reviews = state.getReviews();
      const reviewIndex = reviews.findIndex((r) => r.id === id);
      if (reviewIndex !== -1) {
        const wasHidden = reviews[reviewIndex].isHidden;
        const newIsHidden = isHidden === true;
        let finalImage = processedImage;

        if (wasHidden !== newIsHidden) {
          finalImage = await state.moveReviewImagesToDeleted(processedImage, !newIsHidden);
        }

        reviews[reviewIndex] = { ...reviews[reviewIndex], name, name_en, rating: safeRating, comment, clientComment, image: finalImage, adminReply, isHidden: newIsHidden };
        state.setReviews(reviews);

        const tokenUsed = reviews[reviewIndex].tokenUsed;
        if (tokenUsed) {
          const reviewTokens = state.getReviewTokens();
          const tokenData = reviewTokens.get(tokenUsed);
          if (tokenData) { tokenData.comment = clientComment; reviewTokens.set(tokenUsed, tokenData); }
        }

        await state.saveDb();
        await state.saveReviewsDb();

        try {
          // Placeholder order must match the params array below exactly:
          // name, rating, comment, image, client_comment, admin_reply,
          // is_hidden, then the WHERE id.
          const updateSql = `UPDATE reviews SET 
            name = ?, rating = ?, comment = ?,
            image = ?, client_comment = ?,
            admin_reply = ?, is_hidden = ?
            WHERE id = ?;`;
          await state.executeD1Query(updateSql, [
            name,
            safeRating,
            comment,
            finalImage,
            clientComment,
            adminReply,
            newIsHidden ? 1 : 0,
            id,
          ]);
          await state.executeD1Query(`DELETE FROM review_pictures WHERE review_id = ?;`, [id]);
          if (finalImage) {
            let imgArray: string[] = [];
            try { imgArray = finalImage.startsWith("[") ? JSON.parse(finalImage) : [finalImage]; } catch (e) {}
            for (const img of imgArray) {
              if (img)
                await state.executeD1Query(
                  `INSERT INTO review_pictures (review_id, image_url) VALUES (?, ?);`,
                  [id, img],
                );
            }
          }
        } catch (err) {
          console.error("Failed to propagate review update to D1:", err);
        }

        await logAdminAction(req, "UPDATE", "review", id, `Updated review ${id}: hidden=${newIsHidden}`);
        res.json({ success: true, message: "Review updated successfully", review: reviews[reviewIndex] });
      } else {
        res.status(404).json({ success: false, message: "Review not found" });
      }
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ success: false, message: "Failed to update review" });
    }
  });

  // Admin: delete a review
  router.delete("/admin/reviews/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const reviews = state.getReviews();
    const reviewIndex = reviews.findIndex((r) => r.id === id);
    if (reviewIndex !== -1) {
      const tokenUsed = reviews[reviewIndex].tokenUsed;
      if (tokenUsed) {
        const reviewTokens = state.getReviewTokens();
        const tokenData = reviewTokens.get(tokenUsed);
        if (tokenData) { tokenData.status = "pending"; delete (tokenData as any).usedAt; reviewTokens.set(tokenUsed, tokenData); }
      }
      await state.moveReviewImagesToDeleted(reviews[reviewIndex].image);
      reviews.splice(reviewIndex, 1);
      state.setReviews(reviews);
      await state.saveDb();
      await state.saveReviewsDb();
      try {
        await state.executeD1Query(`DELETE FROM reviews WHERE id = ?;`, [id]);
        await state.executeD1Query(`DELETE FROM review_pictures WHERE review_id = ?;`, [id]);
      } catch (err) {
        console.error("Failed to propagate review deletion to D1:", err);
      }
      await logAdminAction(req, "DELETE", "review", id, `Deleted review #${id}`);
      res.json({ success: true, message: "Review deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Review not found" });
    }
  });

  // Admin: generate a review invite token
  router.post("/admin/generate-token", authenticateAdmin, async (req, res) => {
    const { comment, products } = req.body;
    const newToken = await state.createToken(comment, products);
    res.json({ success: true, token: newToken, link: `/review/${newToken}` });
  });

  // Admin: bulk-delete review tokens
  router.post("/admin/tokens/bulk-delete", authenticateAdmin, async (req, res) => {
    const { tokens } = req.body;
    if (!tokens || !Array.isArray(tokens)) {
      return res.status(400).json({ success: false, message: "Invalid or missing tokens array" });
    }

    const reviewTokens = state.getReviewTokens();
    const reviews = state.getReviews();
    let deletedCount = 0;
    for (const token of tokens) {
      if (reviewTokens.has(token)) {
        reviewTokens.delete(token);
        deletedCount++;
        for (let i = reviews.length - 1; i >= 0; i--) {
          if (reviews[i]?.tokenUsed === token) reviews.splice(i, 1);
        }
        await state.executeD1Query(`DELETE FROM reviews WHERE token_used = ?;`, [token]);
      } else {
        // Check if token matches a review ID or review token_used
        let found = false;
        for (let i = reviews.length - 1; i >= 0; i--) {
          if (String(reviews[i]?.id) === token || reviews[i]?.tokenUsed === token) {
            reviews.splice(i, 1);
            found = true;
          }
        }
        if (found) {
          deletedCount++;
          await state.executeD1Query(`DELETE FROM reviews WHERE id = ? OR token_used = ?;`, [token, token]);
        }
      }
    }
    state.setReviews(reviews);

    if (deletedCount > 0) {
      await state.saveDb();
      await state.saveReviewsDb();
      state.invalidateReviewsCache?.();
    }

    res.json({ success: true, message: `Successfully deleted ${deletedCount} review links.`, deletedCount });
  });

  // Admin: delete a single review token
  router.delete("/admin/tokens/:token", authenticateAdmin, async (req, res) => {
    const { token } = req.params;
    const reviewTokens = state.getReviewTokens();
    const reviews = state.getReviews();

    if (reviewTokens.has(token)) {
      reviewTokens.delete(token);
      for (let i = reviews.length - 1; i >= 0; i--) {
        if (reviews[i]?.tokenUsed === token) reviews.splice(i, 1);
      }
      state.setReviews(reviews);
      await state.executeD1Query(`DELETE FROM reviews WHERE token_used = ?;`, [token]);
      await state.saveDb();
      await state.saveReviewsDb();
      state.invalidateReviewsCache?.();
      return res.json({ success: true, message: "Token deleted successfully" });
    }

    // Check if token is a review ID or token_used
    let found = false;
    for (let i = reviews.length - 1; i >= 0; i--) {
      if (String(reviews[i]?.id) === token || reviews[i]?.tokenUsed === token) {
        reviews.splice(i, 1);
        found = true;
      }
    }
    if (found) {
      state.setReviews(reviews);
      await state.executeD1Query(`DELETE FROM reviews WHERE id = ? OR token_used = ?;`, [token, token]);
      await state.saveDb();
      await state.saveReviewsDb();
      state.invalidateReviewsCache?.();
      return res.json({ success: true, message: "Review deleted successfully" });
    }

    res.status(404).json({ success: false, message: "Token or review not found" });
  });

  // Admin: update a token status (toggle allow edit)
  router.put("/admin/tokens/:token", authenticateAdmin, async (req, res) => {
    const { token } = req.params;
    const { status } = req.body;
    const reviewTokens = state.getReviewTokens();
    const tokenData = reviewTokens.get(token);
    if (tokenData) {
      tokenData.status = status;
      reviewTokens.set(token, tokenData);
      await state.saveDb();
      return res.json({ success: true, message: "Token updated successfully", token: tokenData });
    }

    // Also support toggling edit status for direct reviews
    const reviews = state.getReviews();
    const reviewIndex = reviews.findIndex((r) => String(r.id) === token || r.tokenUsed === token);
    if (reviewIndex >= 0) {
      (reviews[reviewIndex] as any).editAllowed = status === "pending";
      state.setReviews(reviews);
      await state.saveReviewsDb();
      reviewTokens.set(token, {
        id: reviews[reviewIndex].id,
        token: token,
        status: status,
        createdAt: reviews[reviewIndex].date || new Date().toISOString(),
        products: reviews[reviewIndex].products || [],
        comment: reviews[reviewIndex].clientComment || reviews[reviewIndex].name,
      });
      return res.json({ success: true, message: "Review status updated successfully", status });
    }

    res.status(404).json({ success: false, message: "Token not found" });
  });

  // Admin: combined feedback-invites list (tokens + reviews merged)
  router.get("/admin/feedback-invites", authenticateAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = (req.query.search as string || "").toLowerCase();
      const statusFilter = (req.query.status as string || "all");

      let d1Reviews: any[] = [];
      if (process.env.CLOUDFLARE_D1_ACCOUNT_ID && process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_D1_API_TOKEN) {
        try {
          const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
          const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
          const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;
          const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
          const resp = await fetch(cloudflareUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ sql: "SELECT * FROM reviews ORDER BY date DESC;" }),
          });
          if (resp.ok) {
            const data = await resp.json();
            let rows = data.result?.[0]?.results || data.result?.results || [];
            if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
            if (Array.isArray(rows)) {
              d1Reviews = rows.map((r: any) => ({
                id: String(r.id), name: r.name ? String(r.name) : "",
                rating: Number(r.rating) || 0, comment: r.comment ? String(r.comment) : "",
                image: r.image ? String(r.image) : null,
                date: r.date ? String(r.date) : new Date().toISOString(),
                tokenUsed: r.token_used ? String(r.token_used) : undefined,
                clientComment: r.client_comment ? String(r.client_comment) : undefined,
                isHidden: Boolean(r.is_hidden),
                products: r.products ? (typeof r.products === "string" ? JSON.parse(r.products || "[]") : r.products) : [],
              }));
            }
          }
        } catch (e) {
          console.error("Error fetching D1 reviews for invites:", e);
        }
      } else {
        d1Reviews = state.getReviews();
      }

      const reviewTokens = state.getReviewTokens();
      const allTokens = Array.from(reviewTokens.values());
      const orphanReviews = d1Reviews.filter((r) => !r.tokenUsed || !allTokens.some((t) => t.token === r.tokenUsed));

      let combined: any[] = [
        ...allTokens.map((t) => {
          const matchingReview = d1Reviews.find((r) => r.tokenUsed === t.token);
          return { ...t, isOrphan: false, clientName: matchingReview ? matchingReview.name : t.comment, isHidden: matchingReview ? matchingReview.isHidden : false, originalReview: matchingReview, searchDate: t.createdAt };
        }),
        ...orphanReviews.map((r) => {
          const matchedTokenData = reviewTokens.get(r.tokenUsed || r.id);
          const isPending = matchedTokenData ? matchedTokenData.status === "pending" : (r as any).editAllowed === true;
          return {
            id: r.id,
            token: r.tokenUsed || r.id,
            comment: r.clientComment || r.name,
            clientName: r.name,
            createdAt: r.date,
            status: isPending ? "pending" : "submitted",
            isOrphan: true,
            isHidden: r.isHidden,
            originalReview: r,
            searchDate: r.date,
          };
        }),
      ];

      combined.sort((a, b) => new Date(b.searchDate || b.createdAt).getTime() - new Date(a.searchDate || a.createdAt).getTime());

      const filtered = combined.filter((t) => {
        const searchableFields = [t.clientName, t.token, t.comment, t.productName, t.status, t.stars?.toString(), t.id, t.date || t.createdAt];
        const searchStr = searchableFields.filter(Boolean).join(" ").toLowerCase();
        const matchesSearch = search ? searchStr.includes(search) : true;
        const matchesStatus = statusFilter === "all" || (statusFilter === "open" && t.status === "pending") || (statusFilter === "closed" && t.status === "submitted");
        return matchesSearch && matchesStatus;
      });

      const total = filtered.length;
      const paginated = filtered.slice((page - 1) * limit, page * limit);
      res.json({ success: true, combined: paginated, total, page, limit });
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
  });

  // Admin: list all review tokens
  router.get("/admin/tokens", authenticateAdmin, (req, res) => {
    const reviewTokens = state.getReviewTokens();
    const tokens = Array.from(reviewTokens.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json({ success: true, tokens });
  });

  return router;
}
