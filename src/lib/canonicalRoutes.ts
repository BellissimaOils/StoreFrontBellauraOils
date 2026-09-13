/**
 * The single source of truth for which URLs exist on this site.
 *
 * Why this module exists
 * ----------------------
 * Every page used to be reachable at several URLs at once. /hair-and-scalp was
 * also served at /category/hair-and-scalp, /products/hair-and-scalp, /hair,
 * /Category/hair-and-scalp and /Products/hair-and-scalp. Some of those were
 * 301 redirects, some served a byte-identical copy at HTTP 200, and on top of
 * that CategoryPage would *invent* a category page for any slug that merely
 * fuzzy-matched a product's text (/body, /face, /oil ...). Three different
 * layers each had their own idea of which paths were real: Vercel's redirect
 * table, an Express redirect table, and React Router's route list.
 *
 * That is the root cause, and duplicating the rules a fourth time would not
 * fix it. Instead, "which URLs exist" is defined once, here, in a module with
 * no React and no Node dependencies so that both the Express SPA fallback and
 * the browser can import it and agree by construction.
 *
 * The rule is an allow-list: a path is valid only if it is a known static
 * page, a real product, or a visible admin-created section. Anything else is
 * NOT_FOUND. Aliases are not listed, so they stop resolving without needing
 * to be enumerated anywhere.
 */

/** Category listing pages that always exist. */
export const CANONICAL_CATEGORY_PATHS = [
  "/products",
  "/skin",
  "/hair-and-scalp",
  "/packs",
] as const;

/** Indexable content pages that always exist. */
export const CANONICAL_CONTENT_PATHS = ["/", "/reviews", "/about", "/faq"] as const;

/**
 * Real pages that must return 200 but must never be indexed. Kept separate
 * from the lists above so callers can apply `noindex` without re-deriving it.
 */
/**
 * Real pages that must return 200 but must never be indexed. Kept separate
 * from the lists above so callers can apply `noindex` without re-deriving it.
 *
 * `/leave-a-review` is the general review link the admin shares by hand
 * (WhatsApp, Instagram, in person). It was missing from every list here while
 * existing as a React route, so `resolvePath` fell through to "not-found" and
 * the server answered the shared link with a genuine HTTP 404 — the page still
 * rendered, because React Router matched it client-side, which is exactly why
 * it looked fine in a browser. Crawlers and link-preview bots saw only the 404.
 * It belongs here rather than in CANONICAL_CONTENT_PATHS: it should return 200
 * for the customers it's sent to, and stay out of search results.
 */
export const PRIVATE_EXACT_PATHS = ["/checkout", "/leave-a-review"] as const;

export type PathKind =
  /** A known static page. */
  | "page"
  /** /product/<slug> resolving to a real product. */
  | "product"
  /** An admin-created section page. */
  | "section"
  /** Real page, but noindex (checkout, admin, review links). */
  | "private"
  /** Does not exist. Must be served as a genuine 404. */
  | "not-found";

export interface ResolveOptions {
  /**
   * Canonical paths of currently visible sections, e.g. ["/skin", "/gifts"].
   * Build with `collectSectionPaths` so the server and client derive these
   * identically.
   */
  sectionPaths?: string[];
  /** Lowercased product slugs AND ids. Build with `collectProductSlugs`. */
  productSlugs?: string[];
  /**
   * Set false while products/sections are still loading. A missing catalog
   * must never be mistaken for "this page doesn't exist" — that would 404 the
   * whole site on a cold serverless instance or during the first client
   * render. When false, product and single-segment paths are given the
   * benefit of the doubt.
   */
  dataReady?: boolean;
}

/** Strips query/hash leftovers and trailing slashes, preserving case. */
export function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  let p = pathname.split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

/**
 * Turns raw section rows into canonical paths.
 *
 * `normalize` is injected because the client and server each already own an
 * equivalent normaliser (normalizeLinkUrl / normalizeSectionLinkServer) and
 * importing either one across the boundary would drag the wrong module into
 * the wrong bundle.
 */
export function collectSectionPaths(
  rows: any[] | null | undefined,
  normalize: (link: string) => string,
): string[] {
  if (!Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const row of rows) {
    if (!row) continue;
    // Hidden sections are not pages. The old server-side section lookup
    // ignored is_visible entirely, which let a hidden row keep a URL alive.
    if (row.is_visible === 0 || row.is_visible === false) continue;
    const raw = typeof row.link_url === "string" ? row.link_url : "";
    if (!raw) continue;
    // Sections may point at an external URL; those are never site paths.
    const lower = raw.trim().toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) continue;
    const normalized = normalizePathname(normalize(raw)).toLowerCase();
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** Collects every string that may legitimately appear as /product/<x>. */
export function collectProductSlugs(
  products: any[] | null | undefined,
  slugify: (name: string) => string,
): string[] {
  if (!Array.isArray(products)) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (v === null || v === undefined) return;
    const s = String(v).toLowerCase().trim();
    if (s && !out.includes(s)) out.push(s);
  };
  for (const p of products) {
    if (!p) continue;
    push(p.id);
    push(p.slug);
    if (p.name) push(slugify(p.name));
    if (p.name_en) push(slugify(p.name_en));
  }
  return out;
}

/**
 * Decides what a path is. See PathKind.
 *
 * Order matters: the private prefixes are checked before the lowercase rule,
 * because review tokens and admin sub-paths can legitimately contain capitals
 * while every public URL this site generates is lowercase.
 */
export function resolvePath(
  pathname: string,
  opts: ResolveOptions = {},
): PathKind {
  const p = normalizePathname(pathname);
  const { sectionPaths, productSlugs, dataReady = true } = opts;

  // --- Private but real -----------------------------------------------
  if (p.startsWith("/review/") && p.length > "/review/".length) return "private";
  if ((PRIVATE_EXACT_PATHS as readonly string[]).includes(p)) return "private";

  // --- Casing --------------------------------------------------------
  // Every public URL the site emits is lowercase, so /Products and
  // /Category/skin are not "the same page with different capitalisation" —
  // they are URLs this site never produces. They used to 301 to the lowercase
  // form, which is what kept them alive as duplicates.
  if (p !== p.toLowerCase()) return "not-found";

  // --- Static pages --------------------------------------------------
  if (p === "/") return "page";
  if ((CANONICAL_CONTENT_PATHS as readonly string[]).includes(p)) return "page";
  if ((CANONICAL_CATEGORY_PATHS as readonly string[]).includes(p)) return "page";

  // --- Products ------------------------------------------------------
  if (p.startsWith("/product/")) {
    const slug = p.slice("/product/".length);
    if (!slug) return "not-found";
    // Without a loaded catalog we cannot tell a deleted product from a cold
    // cache, so assume it exists rather than 404 a real product page.
    if (!dataReady || !productSlugs || productSlugs.length === 0) return "product";
    return productSlugs.includes(slug) ? "product" : "not-found";
  }

  // --- Admin-created sections ----------------------------------------
  if (sectionPaths && sectionPaths.includes(p)) return "section";

  // A single-segment path is the shape a section uses. If sections haven't
  // loaded we can't rule it out yet; deeper paths (/a/b) are never sections,
  // so they can be rejected immediately either way.
  const segments = p.split("/").filter(Boolean);
  if (!dataReady && segments.length === 1) return "section";

  return "not-found";
}

/** Convenience wrapper: does this path exist at all? */
export function pathExists(pathname: string, opts: ResolveOptions = {}): boolean {
  return resolvePath(pathname, opts) !== "not-found";
}

/** Should this path carry `noindex`? */
export function isPrivatePath(pathname: string): boolean {
  return resolvePath(pathname) === "private";
}
