import express from "express";
import rateLimit from "express-rate-limit";
import { isMaskedValue, sanitizeCredentials } from "../utils/sqlUtils";
import { formatNotificationTemplate, generateOrderNbr, generateUUID } from "../utils/idUtils";

/**
 * Dedicated rate limiter for POST /checkout (10 requests / 15 minutes / IP)
 * to protect order creation, SMS/Telegram notifications, and review token generation.
 */
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many checkout attempts from this IP. Please wait a few minutes before trying again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

interface IdempotentEntry {
  timestamp: number;
  status: "pending" | "completed";
  response?: {
    success: boolean;
    message: string;
    reviewLink: string;
    orderNbr: string;
  };
}

const idempotencyCache = new Map<string, IdempotentEntry>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanupIdempotencyCache() {
  const now = Date.now();
  for (const [key, val] of idempotencyCache.entries()) {
    if (now - val.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

/**
 * Whether to accept a client-supplied price when the product catalogue can't be
 * loaded. Defaults to FALSE — fail closed.
 *
 * This used to be unconditionally true. The reasoning was that an outage
 * shouldn't stop the store taking orders, and the risk was mitigated by logging
 * an [UNVERIFIED PRICE] warning. That mitigation doesn't hold: the log is
 * ephemeral on Vercel, nothing forces anyone to read it before dispatching, and
 * the value being trusted comes from the customer's own browser. Anyone who
 * noticed the catalogue was down — or who could make it look down — could order
 * at a price they chose.
 *
 * Refusing the order loses a sale during an outage. Accepting it can lose the
 * value of the goods, and silently. Set ALLOW_UNVERIFIED_PRICES=true to restore
 * the old behaviour if that trade is ever worth making deliberately.
 */
const ALLOW_UNVERIFIED_PRICES = process.env.ALLOW_UNVERIFIED_PRICES === "true";

// The public checkout endpoint: server-side price/coupon revalidation
// (never trusts the client-supplied total/subtotal/discount), order
// creation, D1 propagation, review-token issuance, WhatsApp/Telegram
// notifications, and a fire-and-forget Gemini-drafted confirmation email
// simulation that runs after the response has already been sent (Vercel
// halts execution right after res.json, so anything meant to run
// afterwards must be started before responding and simply not awaited).
//
// Shared state injected via factory: products[]/coupons[]/orders[]
// (push only)/storeSettings/countries[] (get+set, since a missing/empty
// countries list is lazily refetched from D1 inside this handler), plus
// d1_products + a D1 product fetcher + syncSqlToClassicProducts so the
// price-validation step below can rebuild an empty catalog on demand
// (see the long comment on that block for why that's mandatory here).

interface CheckoutState {
  getProducts: () => any[];
  getCoupons: () => any[];
  getOrders: () => any[];
  getStoreSettings: () => any;
  getCountries: () => any[];
  setCountries: (v: any[]) => void;
  setD1Products: (v: any[]) => void;
  fetchProductsFromD1: () => Promise<any[] | null>;
  syncSqlToClassicProducts: () => void;
  setCoupons: (v: any[]) => void;
  fetchCouponsFromD1: () => Promise<any[] | null>;
  getLastD1WriteError?: () => string | null;
  saveDb: () => Promise<void>;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
  ensureD1OrdersTablesExist: (accountId: string, databaseId: string, apiToken: string) => Promise<boolean>;
  fetchRealD1CountriesIfConfigured: () => Promise<any[] | null>;
  createToken: (
    comment?: string,
    products?: string[],
    customToken?: string,
    productRefs?: { id?: string | null; name: string }[],
  ) => Promise<string>;
}

export function createCheckoutRouter(state: CheckoutState) {
  const router = express.Router();

  router.post("/checkout", checkoutLimiter, async (req, res) => {
    const {
      idempotencyKey,
      customer,
      items,
      total,
      appliedCoupon,
      discountAmount,
      subtotalPrice,
    } = req.body;

    // Idempotency: synchronously check and reserve the attempt key BEFORE any async operations start.
    cleanupIdempotencyCache();
    const effectiveKey = idempotencyKey ? String(idempotencyKey).trim() : "";
    if (effectiveKey) {
      const existing = idempotencyCache.get(effectiveKey);
      if (existing) {
        if (existing.status === "completed" && existing.response) {
          console.log(
            `[Checkout Idempotency] Duplicate completed attempt for key ${effectiveKey}. Returning existing order: ${existing.response.orderNbr}`,
          );
          return res.status(200).json(existing.response);
        }
        if (existing.status === "pending") {
          console.log(
            `[Checkout Idempotency] Concurrent checkout submission in progress for key ${effectiveKey}. Rejecting race.`,
          );
          return res.status(409).json({
            success: false,
            message: "A checkout for this attempt is already being processed, please wait.",
          });
        }
      }

      // Synchronously lock this key as "pending" immediately before any await/async work begins
      idempotencyCache.set(effectiveKey, {
        timestamp: Date.now(),
        status: "pending",
      });
    }

    const releasePendingKey = () => {
      if (effectiveKey && idempotencyCache.get(effectiveKey)?.status === "pending") {
        idempotencyCache.delete(effectiveKey);
      }
    };

    // Reject empty carts outright. Without this, an empty/absent items array
    // produced a real order row with a 0 subtotal (just the shipping fee),
    // a review token, and Telegram/WhatsApp notifications — junk that then
    // had to be cleaned up by hand.
    if (!Array.isArray(items) || items.length === 0) {
      releasePendingKey();
      return res.status(400).json({
        success: false,
        message: "Your cart is empty.",
      });
    }
    if (!customer || !customer.phone) {
      releasePendingKey();
      return res.status(400).json({
        success: false,
        message: "A contact phone number is required to place an order.",
      });
    }

    const customerAddress = String(customer?.address || "").trim();
    if (!customerAddress || customerAddress.length < 20) {
      releasePendingKey();
      return res.status(400).json({
        success: false,
        message: "Please enter a detailed delivery address (at least 20 characters).",
        messageAr: "يرجى كتابة عنوان مفصل (20 حرفًا على الأقل) لضمان دقة التوصيل.",
      });
    }
    customer.address = customerAddress;

    console.log("New Order Received:", {
      customer,
      items,
      total,
      appliedCoupon,
      discountAmount,
      subtotalPrice,
    });

    const orders = state.getOrders();
    const storeSettings = state.getStoreSettings();

    // Make sure we actually have an authoritative product catalog in memory
    // before pricing anything.
    //
    // This is not optional defensive coding — without it the server-side
    // price validation below is a no-op in production. loadDb() deliberately
    // resets the in-memory products/d1_products lists to [] every time it
    // runs (products are meant to come from D1, not from the local JSON
    // snapshot), and the /api middleware calls loadDb() every ~3 seconds on
    // a warm instance. So by the time a POST /api/checkout reaches this
    // handler, `products` is almost always empty — which used to make every
    // single line item fall through to the client-supplied `item.price`,
    // i.e. the exact thing this block claims not to trust. A customer could
    // simply POST their own prices and the server would accept them.
    let products = state.getProducts();
    if (!Array.isArray(products) || products.length === 0) {
      try {
        const liveProducts = await state.fetchProductsFromD1();
        if (liveProducts && liveProducts.length > 0) {
          state.setD1Products(liveProducts);
          state.syncSqlToClassicProducts();
          products = state.getProducts();
        }
      } catch (err) {
        console.error("[Checkout] Failed to refresh product catalog from D1:", err);
      }
    }
    const catalogAvailable = Array.isArray(products) && products.length > 0;
    if (!catalogAvailable) {
      console.error(
        "[Checkout] Product catalogue is empty — prices cannot be verified against it for this request.",
      );
    }

    // Server-side price recalculation — never trust client-supplied total/subtotal
    let computedSubtotal = 0;
    const unresolvedItems: string[] = [];
    const validatedItems = (Array.isArray(items) ? items : []).map((item: any) => {
      const quantity = Math.max(1, parseInt(String(item.quantity || 1), 10));
      // Find matching product in memory / D1 catalog
      const match = (products || []).find(
        (p: any) =>
          String(p.id) === String(item.id || item.product_nbr) ||
          String(p.product_nbr) === String(item.product_nbr || item.id) ||
          (p.name && item.name && p.name.toLowerCase() === item.name.toLowerCase())
      );

      let itemPrice = 0;
      if (match) {
        const rawPriceStr = typeof match.price === "string" ? match.price.replace(/[^\d.]/g, "") : String(match.price);
        itemPrice = parseFloat(rawPriceStr) || 0;
      } else if (!catalogAvailable && ALLOW_UNVERIFIED_PRICES) {
        // Opt-in outage path, OFF by default. See the constant's comment: this
        // accepts a price the customer's own browser supplied, so it is only
        // reachable when an operator has explicitly decided that taking orders
        // during a catalogue outage matters more than pricing them correctly.
        itemPrice = parseFloat(String(item.price).replace(/[^\d.]/g, "")) || 0;
        console.error(
          `[Checkout][UNVERIFIED PRICE] Product catalog unavailable — accepting client-supplied price ${itemPrice} for "${item.name || item.product_name || item.id}". Verify this order manually before dispatching.`,
        );
      } else {
        // We have a real catalog and this item isn't in it — do not invent a
        // price and do not trust the client's. Collect it and reject below.
        unresolvedItems.push(String(item.name || item.product_name || item.id || "unknown item"));
      }

      computedSubtotal += itemPrice * quantity;
      return {
        ...item,
        price: `${itemPrice} DH`,
        quantity,
      };
    });

    if (unresolvedItems.length > 0) {
      // Distinguish the two causes. "No longer available" is true when the
      // catalogue loaded and the item genuinely isn't in it; during an outage
      // it's both misleading to the customer and misleading in the logs, and it
      // would send them to refresh a page that cannot help.
      if (!catalogAvailable) {
        releasePendingKey();
        console.error(
          "[Checkout] REJECTED: catalogue unavailable, so no price could be verified. " +
            "Set ALLOW_UNVERIFIED_PRICES=true only if accepting client-supplied prices is an accepted risk.",
        );
        return res.status(503).json({
          success: false,
          message:
            "We can't confirm prices right now, so your order wasn't placed. Nothing has been charged — please try again in a few minutes.",
        });
      }
      releasePendingKey();
      console.warn("[Checkout] Rejected order with unrecognised items:", unresolvedItems);
      return res.status(400).json({
        success: false,
        message: `Some items in your cart are no longer available: ${unresolvedItems.join(", ")}. Please refresh the page and try again.`,
      });
    }

    // Check free shipping threshold
    const freeShippingThreshold = storeSettings?.freeShippingThreshold || 500;
    const isFreeShipping = computedSubtotal >= freeShippingThreshold;
    const shippingFee = isFreeShipping ? 0 : (storeSettings?.standardShippingFee || 35);

    // Server-side coupon verification — never trust client-supplied discountAmount.
    //
    // The active/expiry/eligibility checks here must mirror the ones in
    // POST /api/coupons/validate (couponRoutes.ts). That endpoint is only a
    // pre-flight check for the UI — a request can reach /api/checkout with any
    // coupon code without ever calling it, and a coupon can also be
    // deactivated or expire between the user applying it and submitting the
    // order. So this is the authoritative gate, not that one.
    //
    // This previously tested `c.active` and `c.status`, neither of which
    // exists on a coupon object: coupons are loaded (in both d1Client.ts and
    // coreDb.ts) as { isActive, expiresAt, minCartAmount, applicableProducts }.
    // `undefined !== "inactive"` is true, so the guard passed unconditionally
    // and deactivated *and* expired coupons were still granting discounts.
    let validatedDiscount = 0;
    const rawCouponCode = appliedCoupon
      ? (typeof appliedCoupon === "object" ? appliedCoupon.code : String(appliedCoupon)).trim().toUpperCase()
      : "";

    if (rawCouponCode) {
      // Refresh coupons from D1 before honouring a discount, so a coupon the
      // admin just deactivated/edited isn't applied from a stale in-memory
      // copy. Only pays the round-trip when a coupon was actually supplied.
      let coupons = state.getCoupons();
      try {
        const liveCoupons = await state.fetchCouponsFromD1();
        if (liveCoupons !== null) {
          state.setCoupons(liveCoupons);
          coupons = liveCoupons;
        }
      } catch (err) {
        console.error("[Checkout] Failed to refresh coupons from D1, using in-memory copy:", err);
      }

      const couponMatch = (coupons || []).find(
        (c: any) => String(c.code).trim().toUpperCase() === rawCouponCode,
      );

      const isActive =
        couponMatch &&
        (couponMatch.isActive === true ||
          couponMatch.isActive === 1 ||
          couponMatch.isActive === "1");

      let notExpired = true;
      if (couponMatch?.expiresAt) {
        notExpired = new Date() <= new Date(couponMatch.expiresAt);
      }

      // Product-restricted coupons only apply if the cart contains at least
      // one eligible product.
      let productEligible = true;
      if (
        couponMatch &&
        Array.isArray(couponMatch.applicableProducts) &&
        couponMatch.applicableProducts.length > 0
      ) {
        productEligible = validatedItems.some((i: any) =>
          couponMatch.applicableProducts.includes(i.id) ||
          couponMatch.applicableProducts.includes(String(i.id)),
        );
      }

      const minCart = parseFloat(String(couponMatch?.minCartAmount || 0)) || 0;
      const meetsMinCart = computedSubtotal >= minCart;

      if (couponMatch && isActive && notExpired && productEligible && meetsMinCart) {
        const discountVal = parseFloat(String(couponMatch.discountValue || couponMatch.discount_value || 0)) || 0;
        const discType = String(couponMatch.discountType || couponMatch.discount_type || "percent").toLowerCase();

        if (discType === "percent" || discType === "percentage") {
          validatedDiscount = (computedSubtotal * Math.min(100, Math.max(0, discountVal))) / 100;
        } else {
          validatedDiscount = Math.min(computedSubtotal, Math.max(0, discountVal));
        }
      } else if (couponMatch) {
        console.warn(
          `[Checkout] Ignoring coupon "${rawCouponCode}" — active=${isActive} notExpired=${notExpired} productEligible=${productEligible} meetsMinCart=${meetsMinCart}`,
        );
      } else {
        console.warn(`[Checkout] Ignoring unknown coupon code "${rawCouponCode}"`);
      }
    }

    const computedTotal = Math.max(0, computedSubtotal - validatedDiscount + shippingFee);

    // Create a new order object with server-verified prices
    const orderNbr = generateOrderNbr();
    const newOrder = {
      id: generateUUID(),
      orderNbr,
      customer,
      items: validatedItems,
      total: computedTotal,
      appliedCoupon: appliedCoupon || null,
      discountAmount: validatedDiscount,
      subtotalPrice: computedSubtotal,
      status: "pending",
      comment: "",
      createdAt: new Date().toISOString(),
    };
    orders.unshift(newOrder); // Add to the top
    await state.saveDb();

    // Propagate automatically to live Cloudflare D1 SQL Database when active
    try {
      const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

      const accountId = sanitizeCredentials(rawAccountId);
      const databaseId = sanitizeCredentials(rawDatabaseId);
      const apiToken = sanitizeCredentials(rawApiToken);

      if (accountId && databaseId && apiToken && !isMaskedValue(accountId)) {
        console.log(
          `[Checkout D1 Sync] Propagating new order ${orderNbr} and its items to Cloudflare D1...`,
        );
        await state.ensureD1OrdersTablesExist(accountId, databaseId, apiToken);

        const orderCreatedDateObj = newOrder.createdAt;
        const couponCodeStr = appliedCoupon
          ? typeof appliedCoupon === "object"
            ? appliedCoupon.code || JSON.stringify(appliedCoupon)
            : String(appliedCoupon)
          : null;

        // Clean values to valid float numbers to prevent SQL syntactical compilation bugs
        const numericTotal =
          parseFloat(String(newOrder.total).replace(/[^\d.]/g, "")) || 0;
        const numericSubtotal =
          parseFloat(String(newOrder.subtotalPrice).replace(/[^\d.]/g, "")) ||
          0;
        const numericDiscount =
          parseFloat(String(newOrder.discountAmount).replace(/[^\d.]/g, "")) ||
          0;

        // status ('pending') and comment ('') stay literals — fixed for a new
        // order. 13 placeholders across the 15 columns, in column order.
        const orderInsertSql = `INSERT INTO orders (
          id, order_nbr, first_name, last_name, phone, address, city, zip, total, subtotal, discount_amount, coupon_applied, status, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?);`;
        const orderInsertParams = [
          newOrder.id,
          newOrder.orderNbr,
          customer.firstName,
          customer.lastName,
          customer.phone,
          customer.address,
          customer.city,
          customer.zip,
          numericTotal,
          numericSubtotal,
          numericDiscount,
          couponCodeStr,
          orderCreatedDateObj,
        ];

        // This result was previously ignored, and the "successfully
        // propagated" log below fired regardless. That mattered: GET
        // /admin/orders reads orders from D1, so an order whose INSERT failed
        // is invisible in the admin panel even though the customer completed
        // checkout. Deliberately NOT failing the request here — the order is
        // already committed to local state and the Telegram/WhatsApp
        // notification below is the owner's real alerting channel — but the
        // failure must be screamingly obvious in the logs rather than
        // reported as a success.
        const orderPropagated = await state.executeD1Query(orderInsertSql, orderInsertParams);
        if (!orderPropagated) {
          console.error(
            `[Checkout D1 Sync][CRITICAL] Order ${orderNbr} was NOT written to D1: ${state.getLastD1WriteError?.() || "unknown error"}. ` +
              `The customer's checkout succeeded and the order is in local state, but it will NOT appear in the admin orders list until it is re-synced. Reconcile this order manually.`,
          );
        }

        const failedItemInserts: string[] = [];

        // Iterate validatedItems, NOT the raw client `items`. The orders row
        // above stores the server-computed total, so writing client-supplied
        // per-item prices here would leave order_items inconsistent with its
        // parent order (line items not summing to the order total) and would
        // re-introduce the client-price trust this handler just eliminated.
        for (const item of validatedItems) {
          const rawProductNbr =
            item.product_nbr !== undefined
              ? item.product_nbr
              : item.productNbr !== undefined
                ? item.productNbr
                : null;
          const parsedProductNbr = rawProductNbr !== null ? parseInt(String(rawProductNbr), 10) : NaN;
          // null, not the string "NULL": this value is a bound parameter, so
          // "NULL" would be stored as the four-character text "NULL" in
          // order_items.product_nbr rather than a real SQL NULL. (It worked
          // before this statement was parameterized only because the old form
          // interpolated it unquoted.)
          const itemProductNbr = Number.isInteger(parsedProductNbr) ? parsedProductNbr : null;
          const numericItemPrice =
            parseFloat(String(item.price).replace(/[^\d.]/g, "")) || 0;

          const itemInsertSql = `INSERT INTO order_items (
            order_nbr, product_nbr, product_name, quantity, price
          ) VALUES (?, ?, ?, ?, ?);`;
          const itemOk = await state.executeD1Query(itemInsertSql, [
            newOrder.orderNbr,
            itemProductNbr,
            item.name || item.product_name,
            parseInt(item.quantity, 10) || 1,
            numericItemPrice,
          ]);
          if (!itemOk) {
            failedItemInserts.push(String(item.name || item.product_name || "unknown item"));
          }
        }

        if (orderPropagated && failedItemInserts.length === 0) {
          console.log(
            `[Checkout D1 Sync] Order ${orderNbr} successfully propagated to live Cloudflare D1 SQL.`,
          );
        } else if (failedItemInserts.length > 0) {
          console.error(
            `[Checkout D1 Sync][CRITICAL] Order ${orderNbr}: ${failedItemInserts.length} line item(s) failed to write to D1 (${failedItemInserts.join(", ")}). ` +
              `The order total is correct but its line items are incomplete in the database.`,
          );
        }
      }
    } catch (d1Err) {
      console.error(
        "[Checkout D1 Sync] Failed to propagate checkout order to Cloudflare D1 SQL:",
        d1Err,
      );
    }

    const customerFirstName = customer?.firstName || customer?.first_name || "";
    const customerLastName = customer?.lastName || customer?.last_name || "";
    // All downstream consumers below (review token, notifications) use
    // validatedItems rather than the raw client `items`, so that quantities
    // and prices shown to the admin match what was actually charged.
    const productNames = validatedItems.map(
      (i: any) => i?.name || i?.product_name || i?.productName || "Botanical Oil",
    );
    // The same items with their catalog ids attached. The review form needs the
    // ids to expand a purchased pack into its members and then drop the
    // duplicate when one of those members was also bought separately — a
    // comparison that only works by id. See src/lib/reviewTargets.ts.
    //
    // The id is re-resolved against the catalog rather than taken from the
    // browser's cart line: `item.id` is client-supplied, and the review form
    // uses these ids to decide which products a pack expands into. Resolving
    // here — by the same id-or-name match the price validation above uses —
    // keeps a stale or foreign id in a cart from turning into a review box for
    // the wrong product. null means "unknown", which falls back to the name.
    // Reuses `products` from the price-validation block above, which has
    // already been refreshed from D1 if this instance booted with an empty
    // catalog — calling getProducts() again here could see the empty one.
    const catalogForRefs = Array.isArray(products) ? products : [];
    const productRefs = validatedItems.map((i: any) => {
      const itemName = String(
        i?.name || i?.product_name || i?.productName || "Botanical Oil",
      );
      const matched = catalogForRefs.find(
        (p: any) =>
          String(p.id) === String(i?.id ?? i?.product_nbr ?? "") ||
          String(p.product_nbr) === String(i?.product_nbr ?? i?.id ?? "") ||
          (p.name && p.name.toLowerCase() === itemName.toLowerCase()),
      );
      return {
        id: matched ? String(matched.id) : null,
        name: itemName,
      };
    });

    // Generate a unique review token for this order using the order number as the token
    const reviewToken = await state.createToken(
      `${customerFirstName} ${customerLastName}`.trim() || "Customer",
      productNames,
      orderNbr,
      productRefs,
    );
    const reviewLink = `/review/${reviewToken}`;

    // Send to Telegram if configured
    const tgBotToken = (
      process.env.TELEGRAM_BOT_TOKEN ||
      storeSettings.orders_telegramBotToken ||
      ""
    ).trim();
    const tgChatId = (
      process.env.TELEGRAM_CHAT_ID ||
      storeSettings.orders_telegramChatId ||
      ""
    ).trim();

    if (tgBotToken && tgChatId) {
      try {
        const itemsList = validatedItems
          .map(
            (i: any) =>
              `- ${i.name || i.product_name} (x${i.quantity}): ${i.price}`,
          )
          .join("\\n");

        let couponStr = "";
        if (appliedCoupon) {
          couponStr =
            typeof appliedCoupon === "object"
              ? appliedCoupon.code || ""
              : String(appliedCoupon);
        }

        const numericSubtotal = subtotalPrice
          ? Math.round(
              parseFloat(String(subtotalPrice).replace(/[^\\d.]/g, "")),
            )
          : parseFloat(String(total).replace(/[^\\d.]/g, ""));
        const numericDiscount = discountAmount
          ? parseFloat(String(discountAmount).replace(/[^\\d.]/g, ""))
          : 0;
        const isFree = numericSubtotal - numericDiscount >= 500;

        let currentCountries = state.getCountries();
        if (!currentCountries || currentCountries.length === 0) {
          const d1Countries = await state.fetchRealD1CountriesIfConfigured();
          if (d1Countries) {
            state.setCountries(d1Countries);
            currentCountries = d1Countries;
          }
        }

        let areaCode = "";
        // Declared outside the if-block below (was previously scoped inside it with `const`,
        // which threw a silent ReferenceError whenever a customer had a country set —
        // that exception was swallowed by the outer catch and blocked the Telegram message
        // from ever being sent for those orders).
        let matchedCountry: any = null;
        if (customer.country || customer.countryId) {
          matchedCountry = currentCountries.find((c: any) =>
            (customer.countryId && String(c.id) === String(customer.countryId)) ||
            c.name_en === customer.country ||
            c.name_ar === customer.country ||
            c.name_fr === customer.country
          );
          if (matchedCountry && matchedCountry.area_code) {
            areaCode = matchedCountry.area_code.replace(/[^0-9]/g, "");
            if (areaCode && !areaCode.startsWith("00")) {
               areaCode = "00" + areaCode;
            }
          }
        }

        let shippingLabel = isFree ? "(شحن مجاني 🎉)" : "(بما في ذلك رسوم التوصيل)";
        if (matchedCountry?.is_europe || (matchedCountry && matchedCountry.name_en !== 'Morocco')) {
           shippingLabel = "(سيتم احتساب رسوم الشحن لاحقاً)";
        }

        let cleanPhone = (customer.phone || "").replace(/[^0-9+]/g, "");
        if (cleanPhone.startsWith("0") && !cleanPhone.startsWith("00")) {
          cleanPhone = cleanPhone.substring(1);
        }
        if (areaCode && !cleanPhone.startsWith(areaCode) && !cleanPhone.startsWith("+" + areaCode.replace("00", ""))) {
           cleanPhone = areaCode + cleanPhone;
        } else if (!areaCode && cleanPhone.startsWith("0") && cleanPhone.length === 10) {
           cleanPhone = "00212" + cleanPhone.substring(1); // Standardize for Morocco fallback
        }

        const templateData = {
          orderId: orderNbr || "Unassigned",
          firstName: customerFirstName,
          lastName: customerLastName,
          phone: cleanPhone || "-",
          city: customer.city || "-",
          address: customer.address || "-",
          itemsList: validatedItems.map((i: any) => `• ${i.name || i.product_name} (x${i.quantity})`).join("\n"),
          trackingNumber: "",
          totalPrice: total,
          reviewLink: ""
        };

        const defaultWaText = [
          `مرحباً بك في Bellaura Oils!`,
          `شكراً ${customerFirstName}، لقد تلقينا طلبك بنجاح.`,
          ``,
          `*تفاصيل الطلب*`,
          `──────────────`,
          orderNbr ? `رقم الطلب: ${orderNbr}` : null,
          templateData.itemsList,
          `──────────────`,
          `*المجموع الإجمالي:* ${total} ${shippingLabel}`,
          numericDiscount > 0 ? `الخصم: -${numericDiscount} درهم` : null,
          ``,
          `*عنوان التوصيل*`,
          `${customer.city || ""} — ${customer.address || ""}${customer.zip ? ` (الرمز البريدي: ${customer.zip})` : ""}`,
          ``,
          `سيتم معالجة طلبك قريباً بالكامل. يمكنك الرد على هذه الرسالة لتأكيد الطلب السريع.`
        ].filter(Boolean).join("\n");

        const whatsappSummaryLines = storeSettings.whatsappNewOrderTemplate
          ? formatNotificationTemplate(storeSettings.whatsappNewOrderTemplate, templateData)
          : defaultWaText;

        const waPhoneStr = cleanPhone.startsWith("00") ? cleanPhone.substring(2) : cleanPhone.replace("+", "");
        const whatsappForwardUrl = `https://wa.me/${waPhoneStr}?text=${encodeURIComponent(whatsappSummaryLines)}`;

        const escapeHtml = (text: string) =>
          text
            ? String(text)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
            : "";

        const safeCustomerFirstName = escapeHtml(customerFirstName);
        const safeCustomerLastName = escapeHtml(customerLastName);
        const safePhone = escapeHtml(cleanPhone || "-");
        const safeCity = escapeHtml(customer.city || "-");
        const safeAddress = escapeHtml(customer.address || "-");
        const safeZip = customer.zip ? escapeHtml(customer.zip) : "";
        const safeItemsList = validatedItems.map((i: any) => `🔸 ${escapeHtml(i.name || i.product_name)} (x${i.quantity})`).join("\n");

        const tgTemplateData = {
          ...templateData,
          firstName: safeCustomerFirstName,
          lastName: safeCustomerLastName,
          phone: safePhone,
          city: safeCity,
          address: safeAddress,
          itemsList: safeItemsList,
          totalPrice: escapeHtml(total)
        };

        const defaultTgMessage = `🛍 <b>New Order | ${escapeHtml(orderNbr || "Unassigned")}</b>

👤 <b>Customer:</b> ${safeCustomerFirstName} ${safeCustomerLastName}
📞 <b>Phone:</b> <code>${safePhone}</code>
📍 <b>City:</b> ${safeCity}
🏠 <b>Address:</b> ${safeAddress}${safeZip ? `\n📮 <b>ZIP:</b> ${safeZip}` : ""}

📦 <b>Order Details:</b>
${safeItemsList}

💸 <b>Subtotal:</b> ${escapeHtml(subtotalPrice || total)}
${numericDiscount ? `🎁 <b>Discount:</b> -${numericDiscount} DH\n` : ""}${couponStr ? `🎟 <b>Coupon:</b> <code>${escapeHtml(couponStr)}</code>\n` : ""}💳 <b>Total:</b> <b>${escapeHtml(total)}</b>`;

        const tgMessage = storeSettings.telegramNewOrderTemplate
          ? formatNotificationTemplate(storeSettings.telegramNewOrderTemplate, tgTemplateData)
          : defaultTgMessage;

        // tgBotToken and tgChatId already defined above

        try {
          const response = await fetch(
            `https://api.telegram.org/bot${tgBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: tgChatId,
                text: tgMessage,
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "💬 Chat with Customer via WhatsApp",
                        url: whatsappForwardUrl,
                      },
                    ],
                  ],
                },
              }),
            },
          );
          if (!response.ok) {
            const errBody = await response.text();
            console.error("Telegram error response:", errBody);
          } else {
            console.log("Telegram notification sent successfully.");
          }
        } catch (err) {
          console.error("Telegram async notification failed", err);
        }
      } catch (e) {
        console.error("Failed to prepare Telegram message", e);
      }
    }

    const responsePayload = {
      success: true,
      message: "Order processed.",
      reviewLink,
      orderNbr,
    };

    if (effectiveKey) {
      idempotencyCache.set(effectiveKey, {
        timestamp: Date.now(),
        status: "completed",
        response: responsePayload,
      });
    }

    // Respond now because Vercel halts execution after this response
    res.status(200).json(responsePayload);

    // Background simulation for email sending
    (async () => {
      try {
        const emailContent = `Thank you for your order, ${customerFirstName} ${customerLastName}!\nItems: ${productNames.join(", ")}\nTotal: ${total}\nReview link: ${reviewLink}`;
        console.log("--- SIMULATED ORDER NOTIFICATION ---");
        console.log(emailContent);
        console.log("-----------------------------------");
        console.log(
          "-> UNIQUE REVIEW LINK PREVIEW:",
          `http://localhost:3000${reviewLink}`,
        );
      } catch (error) {
        console.error("Async background email generation failed:", error);
      }
    })();
  });

  return router;
}
