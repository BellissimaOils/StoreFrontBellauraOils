import { getNextAvailableProductId } from "../utils/idUtils";
import { isMaskedValue, sanitizeCredentials } from "../utils/sqlUtils";
import { executeRealD1QueryIfConfigured, getLastD1WriteError } from "./d1Client";

// Two tightly-coupled catalog/image bookkeeping helpers, factored out
// together since addImageToD1AndTrack calls addProductToCatalogForImage
// directly. Shared state (products[], d1_products[], uploadedImages[],
// d1_images[]) is injected via factory getter/setter closures, consistent
// with the route-extraction pattern used throughout this refactor —
// server.ts still owns these arrays; this module only ever mutates them
// through the passed-in references (arrays are mutated in place via
// push(), matching the original inline behavior exactly).

interface CatalogSyncState {
  getProducts: () => any[];
  getD1Products: () => any[];
  setD1Products: (v: any[]) => void;
  fetchProductsFromD1: () => Promise<any[] | null>;
  getUploadedImages: () => string[];
  getD1Images: () => any[];
  syncSqlToClassicProducts: () => void;
  syncClassicToSqlProducts: () => void;
  saveDb: () => Promise<void>;
}

export function createCatalogSyncService(state: CatalogSyncState) {
  // Auto-creates a disabled (in_catalog: 0) catalog product entry for an
  // uploaded image that isn't already linked to a product — lets an admin
  // upload an image first and assign/enable it as a product later, without
  // ever losing track of "orphan" uploaded images.
  async function addProductToCatalogForImage(
    url: string,
    filename?: string,
    createWithId?: string,
  ) {
    if (!url) return;

    // The catalog must actually be loaded before we allocate a product_nbr.
    //
    // loadDb() resets d1_products to [] every time it runs (products are
    // sourced from D1, not the local JSON snapshot) and the /api middleware
    // calls it every ~3s, so this function very often saw an empty list.
    // That broke it two ways: the "already linked to a product" guard below
    // never matched (creating duplicate placeholder products for the same
    // image), and getNextAvailableProductId([]) returns 1 — so the INSERT
    // below tried to claim product_nbr 1, which almost always already
    // exists. That INSERT has no ON CONFLICT clause, so D1 rejected it while
    // the in-memory push had already happened, leaving a phantom duplicate
    // product locally until the next D1 refresh overwrote it.
    if (!Array.isArray(state.getD1Products()) || state.getD1Products().length === 0) {
      try {
        const liveProducts = await state.fetchProductsFromD1();
        if (liveProducts && liveProducts.length > 0) {
          state.setD1Products(liveProducts);
          state.syncSqlToClassicProducts();
        }
      } catch (err) {
        console.error("[Catalog Auto-Add] Failed to refresh catalog from D1:", err);
      }
    }

    const d1_products = state.getD1Products();
    const products = state.getProducts();

    const cleanUrl = url.replace(/^(src|public)\//, "/");

    // Guard against duplicate product with this image
    const exists = d1_products.some(
      (p) =>
        p.image_url === cleanUrl ||
        p.image_url === url ||
        p.image === cleanUrl ||
        p.image === url,
    );
    if (exists) {
      console.log(
        `[Catalog Auto-Add] Catalog item already exists for ${url}. Skipping.`,
      );
      return;
    }

    // Get a elegant readable name from the filename
    let cleanName = filename || url.split("/").pop() || "Premium Formula";
    cleanName = cleanName.replace(/\.[^/.]+$/, ""); // strip extension
    cleanName = cleanName
      .replace(/[_\-]/g, " ") // replace dividers with space
      .replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize words

    let nextNbr = getNextAvailableProductId(d1_products);
    if (createWithId) {
      const customId = parseInt(createWithId, 10);
      if (!isNaN(customId)) {
        const isTaken =
          d1_products.some((p) => String(p.product_nbr) === String(customId)) ||
          products.some((p) => String(p.id) === String(customId));
        if (!isTaken) {
          nextNbr = customId;
        }
      }
    }

    const newProductObj: any = {
      product_nbr: nextNbr,
      name: cleanName,
      price: 0.0,
      discount_applicable: 0,
      discount_price: null,
      available: 0,
      // No invented size. This placeholder is created automatically for an
      // uploaded image, and nobody has chosen a size for it — writing 50 here is
      // what produced a catalogue full of rows claiming a size their owner never
      // set. Null means "unset", and the shop shows no size until one is entered.
      size_ml: null,
      description: `A masterfully crafted premium addition of ${cleanName} designed with active ingredients to restore beauty.`,
      image_url: cleanUrl,
      category: "Oils",
      show_in_swiper: 1,
      in_catalog: 0,
      benefits:
        "Deeply penetrates skin layers for active nourishment\nCold-pressed and rich in natural seed extracts\nParaben-free botanical formula",
      usage:
        "Dispense a small amount onto targeted areas twice daily or as needed.",
      ingredients: "100% pure organic extraction.",
    };

    d1_products.push(newProductObj);
    state.syncSqlToClassicProducts();
    await state.saveDb();

    const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
    const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

    const accountId = sanitizeCredentials(rawAccountId);
    const databaseId = sanitizeCredentials(rawDatabaseId);
    const apiToken = sanitizeCredentials(rawApiToken);

    if (
      accountId &&
      databaseId &&
      apiToken &&
      !isMaskedValue(accountId) &&
      !isMaskedValue(databaseId) &&
      !isMaskedValue(apiToken)
    ) {
      try {
        console.log(
          `[D1 Catalog Sync] Inserting new auto-catalog item into Cloud Database for image: ${cleanName}`,
        );

        // These no longer carry the manual quote-doubling - they hold raw
        // values and are bound through the params array below. safeName and
        // safeUrl are the two that matter: both derive from the uploaded
        // filename / object URL rather than from a constant.
        const safeName = cleanName;
        const safeDesc = `A masterfully crafted premium addition of ${cleanName} designed with active ingredients to restore beauty.`;
        const safeBenefits =
          "Deeply penetrates skin layers for active nourishment\nCold-pressed and rich in natural seed extracts\nParaben-free botanical formula";
        const safeUsage =
          "Dispense a small amount onto targeted areas twice daily or as needed.";
        const safeIngredients = "100% pure organic extraction.";
        const safeUrl = cleanUrl;

        // Deliberately a plain INSERT with no ON CONFLICT: if this
        // product_nbr is somehow already taken we want the write to fail
        // rather than DO UPDATE over a real product with this placeholder.
        //
        // The bare literals (0.0, 0, NULL, 'Oils', 1, 0) stay literals - they
        // are fixed defaults for an auto-generated placeholder product, not
        // input. size_ml is NULL rather than the 50 it used to be, for the same
        // reason as newProductObj above: no size has been chosen yet.
        const insertSql = `INSERT INTO products (
          product_nbr, name, price, discount_applicable, discount_price, available, size_ml, description, image_url, category, show_in_swiper, in_catalog, benefits, usage, ingredients
        ) VALUES (
          ?, ?, 0.0, 0, NULL, 0, NULL, ?, ?, 'Oils', 1, 0, ?, ?, ?
        );`;
        const inserted = await executeRealD1QueryIfConfigured(insertSql, [
          nextNbr,
          safeName,
          safeDesc,
          safeUrl,
          safeBenefits,
          safeUsage,
          safeIngredients,
        ]);

        if (!inserted) {
          // Roll the optimistic in-memory push back out, otherwise local
          // state keeps a placeholder product that D1 rejected — which then
          // gets re-broadcast by syncSqlToClassicProducts as a duplicate of
          // whatever real product already owns this product_nbr.
          const idx = d1_products.findIndex((p) => p.product_nbr === nextNbr);
          if (idx !== -1) d1_products.splice(idx, 1);
          state.syncSqlToClassicProducts();
          await state.saveDb();
          console.error(
            `[D1 Catalog Sync] Refused/failed to insert auto-catalog product_nbr ${nextNbr} for ${cleanUrl} — rolled back the local entry. Error: ${getLastD1WriteError() || "unknown"}`,
          );
          return;
        }

        const insertDataSql2 = `INSERT INTO products_Data (product_id, benefits, usage, ingredients, tag) VALUES (?, ?, ?, ?, '');`;
        await executeRealD1QueryIfConfigured(insertDataSql2, [
          nextNbr,
          safeBenefits,
          safeUsage,
          safeIngredients,
        ]);
      } catch (err) {
        console.error(
          "[D1 Catalog Sync Error] Failed to propagate auto-catalog product to remote Cloudflare D1:",
          err,
        );
      }
    }
  }

  // Tracks a newly uploaded image in the local uploadedImages/d1_images
  // lists, then either assigns it directly to an existing product or
  // auto-creates a new disabled catalog entry for it (see
  // addProductToCatalogForImage above).
  async function addImageToD1AndTrack(
    url: string,
    filename?: string,
    skipCatalogSync?: boolean,
    assignToProductId?: string,
    createWithId?: string,
  ) {
    if (!url) return;

    const uploadedImages = state.getUploadedImages();
    const d1_images = state.getD1Images();
    // NOTE: deliberately not caching state.getProducts() here — the assign
    // block below re-reads it after a possible D1 refresh, so a snapshot
    // taken now would be stale.

    if (!uploadedImages.includes(url)) {
      uploadedImages.push(url);
    }

    const name = filename || url.split("/").pop() || "image";
    if (!d1_images.some((img) => img.url === url)) {
      const nextId =
        d1_images.reduce((max, img) => (img.id > max ? img.id : max), 0) + 1;
      d1_images.push({
        id: nextId,
        name,
        url,
        uploaded_at: new Date().toISOString(),
      });
    }

    const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
    const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

    const accountId = sanitizeCredentials(rawAccountId);
    const databaseId = sanitizeCredentials(rawDatabaseId);
    const apiToken = sanitizeCredentials(rawApiToken);

    if (
      accountId &&
      databaseId &&
      apiToken &&
      !isMaskedValue(accountId) &&
      !isMaskedValue(databaseId) &&
      !isMaskedValue(apiToken)
    ) {
      try {
        // The "images" table has been dropped (see ensureD1OrdersTablesExist
        // in d1Client.ts, which drops the legacy table rather than creating
        // it) - image records now live on products.image_url / R2 + the
        // local uploadedImages/d1_images tracking above, so there's nothing
        // to sync into a SQL table anymore. Skipping this avoids two wasted
        // Cloudflare API calls (a DROP TABLE + a doomed INSERT) on every
        // image upload.
      } catch (err) {
        console.error(
          "[D1 Sync Image Error] Failed to propagate image storage to active D1 database:",
          err,
        );
      }
    }

    await state.saveDb();

    if (assignToProductId) {
      // The D1 write below is the authoritative one and only needs
      // assignToProductId — it must NOT be gated on finding the product in
      // the in-memory list. It used to be nested inside `if (prod)`, and
      // since loadDb() empties `products` every few seconds the lookup
      // usually missed, which meant "assign this image to product X"
      // silently did nothing at all: no local change, no D1 UPDATE, but
      // still a success response to the admin.
      const targetNbr = parseInt(assignToProductId, 10);
      if (!isNaN(targetNbr)) {
        const ok = await executeRealD1QueryIfConfigured(
          `UPDATE products SET image_url = ? WHERE product_nbr = ?;`,
          [url, targetNbr],
        );
        if (!ok) {
          console.error(
            `[Catalog] Failed to assign image ${url} to product ${targetNbr} in D1: ${getLastD1WriteError() || "unknown"}`,
          );
        }
      } else {
        console.warn(
          `[Catalog] assignToProductId "${assignToProductId}" is not numeric — cannot map it to a D1 product_nbr.`,
        );
      }

      // Mirror it into local state too, best-effort. Refresh the catalog
      // first if it's empty so this doesn't silently miss.
      if (!Array.isArray(state.getProducts()) || state.getProducts().length === 0) {
        try {
          const liveProducts = await state.fetchProductsFromD1();
          if (liveProducts && liveProducts.length > 0) {
            state.setD1Products(liveProducts);
            state.syncSqlToClassicProducts();
          }
        } catch (err) {
          console.error("[Catalog] Failed to refresh catalog from D1 before image assign:", err);
        }
      }

      const prod = state.getProducts().find(
        (p) =>
          String(p.id) === String(assignToProductId) ||
          String(p.product_nbr) === String(assignToProductId),
      );
      if (prod) {
        prod.image = url;
        state.syncClassicToSqlProducts();
        await state.saveDb();
      }
    } else if (!skipCatalogSync) {
      // Automatically add the corresponding product entry to the catalog database!
      await addProductToCatalogForImage(url, filename, createWithId);
    }
  }

  return { addProductToCatalogForImage, addImageToD1AndTrack };
}
