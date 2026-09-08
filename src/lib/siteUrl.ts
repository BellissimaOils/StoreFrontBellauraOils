import { normalizePathname } from "./canonicalRoutes";

/**
 * The site's canonical origin — the single host every absolute URL the site
 * publishes must use.
 *
 * ─── This value has to match the primary domain configured in Vercel ───
 *
 * Search Console reported "Page with redirect" for `https://bellauraoils.com/`,
 * which means that host answers with a 30x rather than with the page. Vercel
 * issues that redirect itself (the project's primary domain plus its automatic
 * HTTP→HTTPS upgrade); there is no redirect anywhere in this codebase. So the
 * live setup is redirecting the exact URL that every canonical tag, og:url,
 * JSON-LD `url`, sitemap `<loc>` and robots.txt `Sitemap:` line here declares
 * to be the canonical one.
 *
 * That combination is self-contradictory and is the thing to fix: a canonical
 * URL must return 200, not a redirect. Two ways to make it consistent, and
 * exactly one of them has to be done:
 *
 *   1. Set `bellauraoils.com` as the primary domain in Vercel (Project →
 *      Settings → Domains) so `www` redirects to it instead of the other way
 *      round. Nothing in this file changes.
 *   2. Keep `www.bellauraoils.com` as the primary domain and change the
 *      constant below to `https://www.bellauraoils.com`.
 *
 * Either is fine for SEO — what matters is that the canonical host is the one
 * that actually serves the page. Whichever is chosen, everything that
 * publishes an absolute URL reads it from here, so the two can no longer drift
 * apart the way they had (product pages were canonicalising themselves to
 * whichever host the visitor happened to arrive on, so the same page claimed
 * two different canonical URLs depending on how it was reached).
 *
 * Deliberately a literal and not an env var: this module is imported by both
 * the Express server (bundled by esbuild) and the browser bundle (built by
 * Vite), and `process.env` reads don't survive into the browser bundle while
 * `import.meta.env` doesn't survive into the CommonJS server bundle. One
 * constant that both can see is worth more here than a configurable one that
 * silently differs between the two.
 */
export const SITE_ORIGIN = "https://www.bellauraoils.com";

/** Hostname form of SITE_ORIGIN, for host comparisons. */
export const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, "");

/**
 * Turn a possibly-relative asset path into an absolute URL on the canonical
 * host. Already-absolute URLs are returned untouched, so a product image
 * hosted on R2 or a CDN keeps its own origin.
 *
 * Used for og:image and JSON-LD image fields, which crawlers require to be
 * absolute — a relative one is silently dropped by most of them.
 */
export function absoluteUrl(raw: string): string {
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_ORIGIN}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

/**
 * The canonical URL for a pathname, normalised the same way the server
 * normalises it (query string, hash and trailing slash removed — see
 * normalizePathname).
 *
 * Sharing the normalisation is the point: the server injects a canonical into
 * the HTML and the client can re-declare one after hydration, and if the two
 * disagree about the trailing slash or the host then the page contradicts
 * itself. Both now derive from the same two functions.
 */
export function canonicalUrlFor(pathname: string): string {
  return `${SITE_ORIGIN}${normalizePathname(pathname)}`;
}
