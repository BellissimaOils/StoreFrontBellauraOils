import path from "path";
import { normalizeLinkUrl } from "../../lib/urlUtils";

// Small, pure, stateless helpers with no dependency on any shared in-memory
// app state (products/orders/storeSettings, etc.) — safe to import anywhere.

export const DB_PATH = path.join(process.cwd(), "database.json");
export const REVIEWS_DB_PATH = path.join(process.cwd(), "reviews_table.json");

// On Vercel (and similar serverless platforms), the deployed app directory
// (process.cwd(), e.g. /var/task) is READ-ONLY. Only /tmp is writable, and
// it's wiped whenever the instance recycles. This used to just return
// DB_PATH unchanged, which silently failed every save with EROFS.
export const getWritableDbPath = () => {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/database.json";
  }
  return DB_PATH;
};

export const getWritableReviewsDbPath = () => {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/reviews_table.json";
  }
  return REVIEWS_DB_PATH;
};

// Compares two image URLs/paths for equivalence, tolerating differences in
// query string, a leading "./" or "/", and absolute vs. relative form (e.g.
// a full R2 URL vs. just its pathname) — used when reconciling image
// references across products/reviews/D1 after a move/rename.
export function isSameImageUrl(url1?: string | null, url2?: string | null): boolean {
  if (!url1 || !url2) return false;
  if (url1 === url2) return true;
  const clean1 = String(url1).split('?')[0].trim();
  const clean2 = String(url2).split('?')[0].trim();
  if (clean1 === clean2) return true;

  const norm1 = clean1.replace(/^(\.\/|\/)+/, '');
  const norm2 = clean2.replace(/^(\.\/|\/)+/, '');
  if (norm1 === norm2) return true;

  let path1 = norm1;
  let path2 = norm2;
  if (clean1.startsWith('http')) {
    try { path1 = new URL(clean1).pathname.replace(/^\/+/, ''); } catch (e) {}
  }
  if (clean2.startsWith('http')) {
    try { path2 = new URL(clean2).pathname.replace(/^\/+/, ''); } catch (e) {}
  }
  if (path1 === path2) return true;

  return false;
}

// Normalizes a section's stored link_url into the canonical route the SPA
// actually serves — collapsing legacy/duplicate aliases (e.g. /category/skin,
// /oils, /category/all) onto their real route (/skin, /, /products) so
// sitemap generation and section-lookup matching stay consistent regardless
// of which historical URL form got saved in the sections_management table.
// This was a near-copy of the browser's normalizeLinkUrl, and the two had
// already drifted: the client mapped bare aliases like /hair to
// /hair-and-scalp and flattened /products/<sub>, while this one left both
// untouched. That drift is dangerous now that section links decide which URLs
// return 200 — the server and the browser would disagree about which pages
// exist. So this delegates to the one shared implementation instead.
//
// src/lib/urlUtils.ts is a pure module with no imports, so it is safe to pull
// into the server bundle.
export function normalizeSectionLinkServer(link: string | undefined | null): string {
  return normalizeLinkUrl(link);
}
