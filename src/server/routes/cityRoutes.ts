import express from "express";
import fs from "fs";
import path from "path";

// City/shipping-location routes for the Public Storefront.
// Only customer-facing GET /cities is exposed (used by checkout city selector).
// Admin management routes belong strictly in the Admin Dashboard.

interface CitiesState {
  getCities: () => any[];
  setCities: (v: any[]) => void;
  fetchCitiesFromD1: () => Promise<any[] | null>;
}

export function createCityRouter(state: CitiesState) {
  const router = express.Router();

  // Closure-level cache for the public /api/cities stale-while-revalidate pattern
  let lastCitiesSync = 0;

  // Public: list all cities (used by checkout city selector)
  router.get("/cities", async (req, res) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Vary", "Accept-Encoding");

    const now = Date.now();
    const d1_cities = state.getCities();
    const isMemoryEmpty = !d1_cities || d1_cities.length === 0;

    if (isMemoryEmpty || now - lastCitiesSync > 5000) {
      lastCitiesSync = now;
      try {
        const d1List = await state.fetchCitiesFromD1();
        if (d1List && d1List.length > 0) state.setCities(d1List);
      } catch (e) {
        console.error("Error fetching cities from D1:", e);
      }
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

  return router;
}
