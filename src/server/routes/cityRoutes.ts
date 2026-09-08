import express from "express";
import fs from "fs";
import path from "path";
import { authenticateAdmin } from "../middleware/auth";
import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";

// City/shipping-location routes. The only shared in-memory state these
// routes touch is `d1_cities` — passed in via a getter/setter pair so
// this module stays testable and decoupled from the global module scope.
//
// Usage in server.ts:
//   import { createCityRouter } from "./src/server/routes/cityRoutes";
//   app.use("/api", createCityRouter({ ... }));

interface CitiesState {
  getCities: () => any[];
  setCities: (v: any[]) => void;
  fetchCitiesFromD1: () => Promise<any[] | null>;
  autoSeedCityTable: (accountId: string, databaseId: string, apiToken: string, force?: boolean) => Promise<boolean>;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
  getLastD1WriteError?: () => string | null;
}

export function createCityRouter(state: CitiesState) {
  const router = express.Router();

  // Closure-level cache for the public /api/cities stale-while-revalidate
  // pattern — only relevant within one serverless instance lifetime, which
  // is fine since cities change rarely and the public endpoint has a 60s
  // HTTP cache anyway.
  let lastCitiesSync = 0;

  // Public: list all cities (used by checkout city selector)
  router.get("/cities", async (req, res) => {
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );

    const now = Date.now();
    const d1_cities = state.getCities();
    const isMemoryEmpty = !d1_cities || d1_cities.length === 0;

    if (isMemoryEmpty || now - lastCitiesSync > 60000) {
      lastCitiesSync = now;
      try {
        if (isMemoryEmpty) {
          const d1List = await state.fetchCitiesFromD1();
          if (d1List && d1List.length > 0) state.setCities(d1List);
        } else {
          state.fetchCitiesFromD1()
            .then((d1List) => {
              if (d1List && d1List.length > 0) state.setCities(d1List);
            })
            .catch((e) => console.error("Error in background fetch cities:", e));
        }
      } catch (e) {}
    }

    const cities = state.getCities();
    let mappedFallback = cities;
    if (cities && cities.length > 0) {
      let detailedCitiesMap: Record<string, { city_ar: string; district: string }> = {};
      try {
        const filePath = path.join(process.cwd(), "src/components/detailed_cities_map.json");
        if (fs.existsSync(filePath)) {
          detailedCitiesMap = JSON.parse(fs.readFileSync(filePath, "utf8"));
        }
      } catch (e) {}

      mappedFallback = cities.map((r: any) => {
        const dInfo = detailedCitiesMap[String(r.id)];
        return {
          ...r,
          name: dInfo ? dInfo.district : r.name || r.City || "",
          translation: dInfo ? dInfo.city_ar : r.translation || r.City_AR || "",
        };
      });
    }

    res.json(mappedFallback || []);
  });

  // Admin: paginated city-table view (raw D1 City rows)
  router.get("/admin/city-table", authenticateAdmin, async (req, res) => {
    try {
      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

      if (!accountId || !databaseId || !apiToken) {
        return res.json({ success: true, cities: [] });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string) || "";
      const offset = (page - 1) * limit;

      // `search` is a query-string value, so it is bound rather than escaped.
      // The % wildcards live inside the parameter value, which keeps the
      // contains-match semantics identical to the previous LIKE '%...%'.
      // whereClause stays a structural fragment only - it carries no values.
      let whereClause = "";
      const searchParams: any[] = [];
      if (search) {
        whereClause = `WHERE City LIKE ? OR City_AR LIKE ? OR District LIKE ?`;
        const pattern = `%${search}%`;
        searchParams.push(pattern, pattern, pattern);
      }

      const sqlCount = `SELECT count(*) as total FROM City ${whereClause};`;
      const sqlData = `SELECT * FROM City ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?;`;
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

      const [respCount, respData] = await Promise.all([
        fetch(cloudflareUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql: sqlCount, params: searchParams }),
        }),
        fetch(cloudflareUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql: sqlData, params: [...searchParams, limit, offset] }),
        }),
      ]);

      const countData = (await respCount.json()) as any;
      const data = (await respData.json()) as any;

      const totalCount = countData.success && countData.result?.[0]?.results?.[0]?.total
        ? countData.result[0].results[0].total
        : 0;
      const totalPages = Math.ceil(totalCount / limit);

      if (data.success && data.result?.[0]?.results) {
        res.json({ success: true, cities: data.result[0].results, totalCount, totalPages, currentPage: page });
      } else {
        res.json({ success: true, cities: [], totalPages: 0, totalCount: 0, currentPage: 1 });
      }
    } catch (e: any) {
      console.error("Error fetching City table:", e);
      res.status(500).json({ success: false, message: "Failed to fetch City table" });
    }
  });

  // Admin: update a city row
  router.put("/admin/city-table/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { City, City_AR, District, Price, Delivery } = req.body;

      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

      if (!accountId || !databaseId || !apiToken) {
        return res.json({ success: true, message: "Local dev mode updated" });
      }

      const sql = `UPDATE City SET City = ?, City_AR = ?, District = ?, Price = ?, Delivery = ? WHERE id = ?;`;
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params: [City, City_AR, District, Price, Delivery, id] }),
      });
      const data = (await resp.json()) as any;
      if (data.success) {
        res.json({ success: true, message: "City updated successfully" });
      } else {
        res.status(500).json({ success: false, message: "Failed to update city in database", errors: data.errors });
      }
    } catch (e: any) {
      console.error("Error updating City table:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to update City table" });
    }
  });

  // Admin: add a new city row
  router.post("/admin/city-table", authenticateAdmin, async (req, res) => {
    try {
      const { City, City_AR, District, Price, Delivery } = req.body;

      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

      if (!accountId || !databaseId || !apiToken) {
        return res.json({ success: true, message: "Local dev mode updated" });
      }

      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const maxIdRes = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT MAX(id) as maxId FROM City;" }),
      });
      const maxIdData = (await maxIdRes.json()) as any;
      let newId = 1;
      if (maxIdData.success && maxIdData.result?.[0]?.results?.[0]?.maxId) {
        newId = maxIdData.result[0].results[0].maxId + 1;
      }

      const sql = `INSERT INTO City (id, City, City_AR, District, Price, Delivery) VALUES (?, ?, ?, ?, ?, ?);`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params: [newId, City, City_AR, District, Price, Delivery] }),
      });
      const data = (await resp.json()) as any;
      if (data.success) {
        res.json({ success: true, message: "City added successfully" });
      } else {
        res.status(500).json({ success: false, message: "Failed to add city to database", errors: data.errors });
      }
    } catch (e: any) {
      console.error("Error adding to City table:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to add City" });
    }
  });

  // Admin: delete a city row
  router.delete("/admin/city-table/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

      if (!accountId || !databaseId || !apiToken) {
        return res.json({ success: true, message: "Local dev mode updated" });
      }

      const sql = `DELETE FROM City WHERE id = ?;`;
      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params: [id] }),
      });
      const data = (await resp.json()) as any;
      if (data.success) {
        res.json({ success: true, message: "City deleted successfully" });
      } else {
        res.status(500).json({ success: false, message: "Failed to delete city from database", errors: data.errors });
      }
    } catch (e: any) {
      console.error("Error deleting from City table:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to delete City" });
    }
  });

  // Admin: bulk seed city-table from a provided items array
  router.post("/admin/city-table/seed", authenticateAdmin, async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ success: false, message: "items must be an array" });
      }

      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;
      if (!accountId || !databaseId || !apiToken) {
        return res.json({ success: true, message: "Local dev mode ignores SQL execution." });
      }

      const results = [];
      const BATCH_SIZE = 10;

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const placeholders: string[] = [];
        const params: any[] = [];

        batch.forEach((item) => {
          placeholders.push(`(?, ?, ?, ?, ?, ?)`);
          params.push(item.id, item.city, item.city_ar, item.district || "", item.price || 45, item.delivery || "48h");
        });

        const sql = `INSERT OR REPLACE INTO City (id, City, City_AR, District, Price, Delivery) VALUES ${placeholders.join(", ")};`;
        const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
        const resp = await fetch(cloudflareUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql, params }),
        });
        results.push(await resp.json());
      }

      res.json({ success: true, message: `Seeded ${items.length} cities.`, results });
    } catch (e: any) {
      console.error("Error seeding City table:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to seed City table" });
    }
  });

  // Admin: bulk price update via city-table IDs
  router.put("/admin/city-table/bulk-price", authenticateAdmin, async (req, res) => {
    try {
      const { ids, price_mad } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "City IDs are required" });
      }

      const accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;
      if (!accountId || !databaseId || !apiToken) {
        return res.json({ success: true, message: "Local dev mode updated" });
      }

      const priceVal = (price_mad !== undefined && price_mad !== null && price_mad !== "")
        ? parseFloat(price_mad) : null;
      const placeholders = ids.map(() => "?").join(",");
      const sql = `UPDATE City SET Price = ? WHERE id IN (${placeholders});`;

      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
      const resp = await fetch(cloudflareUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params: [priceVal, ...ids.map((id: any) => parseInt(id))] }),
      });
      const data = (await resp.json()) as any;
      if (data.success) {
        res.json({ success: true, message: "Cities updated" });
      } else {
        res.status(500).json({ success: false, message: "Failed to bulk update cities in database", errors: data.errors });
      }
    } catch (e: any) {
      console.error("Error bulk updating City table:", e);
      res.status(500).json({ success: false, message: e.message || "Failed to bulk update cities" });
    }
  });

  // Admin: fetch all cities (admin-facing, always fresh)
  router.get("/admin/cities", authenticateAdmin, async (req, res) => {
    try {
      const d1List = await state.fetchCitiesFromD1();
      if (d1List) {
        state.setCities(d1List);
        return res.json({ success: true, cities: d1List });
      }
      res.json({ success: true, cities: state.getCities() });
    } catch (e: any) {
      console.error("Error fetching cities:", e);
      res.status(500).json({ success: false, message: "Failed to fetch cities" });
    }
  });

  // Admin: add a city via the simpler cities API
  router.post("/admin/cities", authenticateAdmin, async (req, res) => {
    try {
      const { name, translation, price_mad } = req.body;
      if (!name || !translation) {
        return res.status(400).json({ success: false, message: "Name and translation are required" });
      }

      const priceVal = (price_mad !== undefined && price_mad !== null && price_mad !== "")
        ? parseFloat(price_mad) : 35;
      // '24h' stays a literal: it's a hardcoded constant, not input.
      const sql = `INSERT INTO City (City, City_AR, District, Price, Delivery) VALUES (?, ?, ?, ?, '24h');`;
      const ok = await state.executeD1Query(sql, [name, translation, name, priceVal]);
      if (!ok) {
        return res.status(500).json({ success: false, message: `Failed to add the city to the database: ${state.getLastD1WriteError?.() || "unknown error"}.` });
      }

      const d1List = await state.fetchCitiesFromD1();
      if (d1List) state.setCities(d1List);
      res.json({ success: true, message: "City added" });
    } catch (e: any) {
      console.error("Error adding city:", e);
      res.status(500).json({ success: false, message: "Failed to add city" });
    }
  });

  // Admin: bulk price update via cities API
  router.put("/admin/cities/bulk-price", authenticateAdmin, async (req, res) => {
    try {
      const { ids, price_mad } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "City IDs are required" });
      }

      const parsedPrice = parseFloat(price_mad);
      const priceVal = (price_mad !== undefined && price_mad !== null && price_mad !== "" && !isNaN(parsedPrice))
        ? parsedPrice : 35;
      // Drop anything non-numeric rather than letting it become the literal
      // string "NaN" inside IN (...), which makes the whole statement a
      // syntax error and silently fails the entire bulk update.
      const numericIds = ids.map((id: any) => parseInt(id, 10)).filter((n: number) => Number.isInteger(n));
      if (numericIds.length === 0) {
        return res.status(400).json({ success: false, message: "No valid numeric city IDs provided" });
      }
      // One placeholder per id — an IN list can't be a single bound value.
      // Same approach as the bulk-price handler earlier in this file.
      const idPlaceholders = numericIds.map(() => "?").join(",");
      const sql = `UPDATE City SET Price = ? WHERE id IN (${idPlaceholders});`;
      const ok = await state.executeD1Query(sql, [priceVal, ...numericIds]);
      if (!ok) {
        return res.status(500).json({ success: false, message: `Failed to update the city prices: ${state.getLastD1WriteError?.() || "unknown error"}.` });
      }

      const d1List = await state.fetchCitiesFromD1();
      if (d1List) state.setCities(d1List);
      res.json({ success: true, message: "Cities updated" });
    } catch (e: any) {
      console.error("Error bulk updating cities:", e);
      res.status(500).json({ success: false, message: "Failed to update cities" });
    }
  });

  // Admin: update a single city via cities API
  router.put("/admin/cities/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, translation, price_mad } = req.body;
      if (!name || !translation) {
        return res.status(400).json({ success: false, message: "Name and translation are required" });
      }

      const cityId = Number(id);
      if (!Number.isInteger(cityId)) {
        return res.status(400).json({ success: false, message: "Invalid city id" });
      }
      const parsedPrice = parseFloat(price_mad);
      const priceVal = (price_mad !== undefined && price_mad !== null && price_mad !== "" && !isNaN(parsedPrice))
        ? parsedPrice : 35;
      const sql = `UPDATE City SET City = ?, City_AR = ?, Price = ? WHERE id = ?;`;
      const ok = await state.executeD1Query(sql, [name, translation, priceVal, cityId]);
      if (!ok) {
        return res.status(500).json({ success: false, message: `Failed to save the city changes: ${state.getLastD1WriteError?.() || "unknown error"}.` });
      }

      const d1List = await state.fetchCitiesFromD1();
      if (d1List) state.setCities(d1List);
      res.json({ success: true, message: "City updated" });
    } catch (e: any) {
      console.error("Error updating city:", e);
      res.status(500).json({ success: false, message: "Failed to update city" });
    }
  });

  // Admin: delete a city via cities API
  router.delete("/admin/cities/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const cityId = Number(id);
      if (!Number.isInteger(cityId)) {
        return res.status(400).json({ success: false, message: "Invalid city id" });
      }
      const sql = `DELETE FROM City WHERE id = ?;`;
      const ok = await state.executeD1Query(sql, [cityId]);
      if (!ok) {
        return res.status(500).json({ success: false, message: `Failed to delete the city: ${state.getLastD1WriteError?.() || "unknown error"}.` });
      }

      const d1List = await state.fetchCitiesFromD1();
      if (d1List) state.setCities(d1List);
      res.json({ success: true, message: "City deleted" });
    } catch (e: any) {
      console.error("Error deleting city:", e);
      res.status(500).json({ success: false, message: "Failed to delete city" });
    }
  });

  // Admin: seed cities from city_data.json via autoSeedCityTable
  router.post("/admin/cities/seed", authenticateAdmin, async (req, res) => {
    try {
      const { force } = req.body || {};
      const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
      const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
      const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

      const accountId = sanitizeCredentials(rawAccountId);
      const databaseId = sanitizeCredentials(rawDatabaseId);
      const apiToken = sanitizeCredentials(rawApiToken);

      if (accountId && databaseId && apiToken && !isMaskedValue(accountId) && !isMaskedValue(databaseId) && !isMaskedValue(apiToken)) {
        console.log("Synchronizing default City table to live D1 database...");
        await state.autoSeedCityTable(accountId, databaseId, apiToken, force);
      }

      const d1List = await state.fetchCitiesFromD1();
      if (d1List) state.setCities(d1List);

      res.json({ success: true, message: "Default cities and shipping prices have been synced.", cities: state.getCities() });
    } catch (err: any) {
      console.error("Error seeding cities:", err);
      res.status(500).json({ success: false, message: "Server error seeding cities." });
    }
  });

  return router;
}
