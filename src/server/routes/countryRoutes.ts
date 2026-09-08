import express from "express";
import { authenticateAdmin } from "../middleware/auth";


// Country routes. Only shared state: the `countries` in-memory array.
// Passed in via getter/setter to keep this module decoupled from server.ts globals.

interface CountriesState {
  getCountries: () => any[];
  setCountries: (v: any[]) => void;
  fetchCountriesFromD1: () => Promise<any[] | null>;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
}

export function createCountryRouter(state: CountriesState) {
  const router = express.Router();

  // Re-hydrate the in-memory countries list after any write. Without this the
  // array stays stale until something happens to re-read it, and both
  // checkoutRoutes and orderRoutes read it directly to resolve dialling
  // codes for order notifications — so a newly added or edited country
  // wouldn't be picked up there. cityRoutes already does this after writes;
  // this brings countries in line.
  const refreshCountries = async () => {
    try {
      const fresh = await state.fetchCountriesFromD1();
      if (fresh !== null) state.setCountries(fresh);
    } catch (e) {
      console.error("[Countries] Failed to refresh in-memory list after write:", e);
    }
  };

  router.get("/countries", async (req, res) => {
    // Public shipping-destination list. It had no cache headers at all, so
    // every checkout page load hit the origin and made a D1 round-trip for
    // data that changes maybe a few times a year. Cached at the edge in line
    // with the other public read endpoints (/products, /sections, /cities).
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    try {
      const d1Countries = await state.fetchCountriesFromD1();
      if (d1Countries) state.setCountries(d1Countries);
      res.json(state.getCountries().filter((c: any) => c.is_active !== 0));
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch countries" });
    }
  });

  router.get("/admin/countries", authenticateAdmin, async (req, res) => {
    try {
      const d1Countries = await state.fetchCountriesFromD1();
      if (d1Countries) state.setCountries(d1Countries);
      res.json(state.getCountries());
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch countries" });
    }
  });

  router.post("/admin/countries", authenticateAdmin, async (req, res) => {
    try {
      const { name_en, name_ar, name_fr, is_europe, is_active, area_code } = req.body;
      const sql = `INSERT INTO countries (name_en, name_ar, name_fr, is_europe, is_active, area_code) VALUES (?, ?, ?, ?, ?, ?)`;
      const ok = await state.executeD1Query(sql, [
        name_en,
        name_ar,
        name_fr,
        is_europe ? 1 : 0,
        is_active ? 1 : 0,
        area_code || "",
      ]);
      if (!ok) {
        return res.status(500).json({ error: "Failed to add country" });
      }
      await refreshCountries();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to add country" });
    }
  });

  router.put("/admin/countries/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name_en, name_ar, name_fr, is_europe, is_active, area_code } = req.body;
      const countryId = parseInt(id, 10);
      if (!Number.isInteger(countryId)) {
        return res.status(400).json({ error: "Invalid country id" });
      }
      const sql = `UPDATE countries SET name_en = ?, name_ar = ?, name_fr = ?, is_europe = ?, is_active = ?, area_code = ? WHERE id = ?`;
      const ok = await state.executeD1Query(sql, [
        name_en,
        name_ar,
        name_fr,
        is_europe ? 1 : 0,
        is_active ? 1 : 0,
        area_code || "",
        countryId,
      ]);
      if (!ok) {
        return res.status(500).json({ error: "Failed to update country" });
      }
      await refreshCountries();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update country" });
    }
  });

  router.delete("/admin/countries/:id", authenticateAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const countryId = parseInt(id, 10);
      if (!Number.isInteger(countryId)) {
        return res.status(400).json({ error: "Invalid country id" });
      }
      const sql = `DELETE FROM countries WHERE id = ?`;
      const ok = await state.executeD1Query(sql, [countryId]);
      if (!ok) {
        return res.status(500).json({ error: "Failed to delete country" });
      }
      await refreshCountries();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete country" });
    }
  });

  return router;
}
