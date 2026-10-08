import express from "express";

// Country routes for the Public Storefront.
// Only customer-facing GET /countries is exposed (used by checkout country selector).
// Admin country management belongs strictly in the Admin Dashboard.

interface CountriesState {
  getCountries: () => any[];
  setCountries: (v: any[]) => void;
  fetchCountriesFromD1: () => Promise<any[] | null>;
}

export function createCountryRouter(state: CountriesState) {
  const router = express.Router();

  router.get("/countries", async (_req, res) => {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    try {
      const d1Countries = await state.fetchCountriesFromD1();
      if (d1Countries) state.setCountries(d1Countries);
      res.json(state.getCountries().filter((c: any) => c.is_active !== 0));
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch countries" });
    }
  });

  return router;
}
