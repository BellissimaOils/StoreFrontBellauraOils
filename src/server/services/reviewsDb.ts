import fs from "fs";
import { REVIEWS_DB_PATH, getWritableReviewsDbPath } from "../utils/pathUtils";
import { syncReviewsDbToR2, syncReviewsDbFromR2 } from "../utils/r2Client";

// Persistence pair for the reviews-only JSON store (separate from the main
// saveDb/loadDb, which persists everything else). Shared state injected
// via factory: reviews[] (get+set), matching the getter/setter pattern
// used throughout this refactor.

interface ReviewsDbState {
  getReviews: () => any[];
  setReviews: (v: any[]) => void;
}

export function createReviewsDbService(state: ReviewsDbState) {
  async function saveReviewsDb() {
    try {
      const data = { reviews: state.getReviews() };
      const jsonStr = JSON.stringify(data, null, 2);
      const writablePath = getWritableReviewsDbPath();
      await fs.promises.writeFile(writablePath, jsonStr, "utf-8");
      if (writablePath !== REVIEWS_DB_PATH) {
        try {
          await fs.promises.writeFile(REVIEWS_DB_PATH, jsonStr, "utf-8");
        } catch {}
      }
      await syncReviewsDbToR2();
    } catch (e) {
      console.error(e);
    }
  }

  async function loadReviewsDb() {
    try {
      await syncReviewsDbFromR2();
      // Prefer the writable path (/tmp on Vercel) if it exists — it holds
      // the most recently saved data. Only fall back to the read-only
      // bundled REVIEWS_DB_PATH for a fresh cold start that hasn't written
      // anything yet.
      const writablePath = getWritableReviewsDbPath();
      const targetPath = fs.existsSync(writablePath)
        ? writablePath
        : REVIEWS_DB_PATH;
      if (fs.existsSync(targetPath)) {
        const rawData = await fs.promises.readFile(targetPath, "utf-8");
        const data = JSON.parse(rawData);
        if (data.reviews) state.setReviews(data.reviews);
      }
    } catch (e) {
      console.error(e);
    }
  }

  return { saveReviewsDb, loadReviewsDb };
}
