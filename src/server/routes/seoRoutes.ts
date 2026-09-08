import express from "express";
import { normalizeSectionLinkServer } from "../utils/pathUtils";
import { SITE_ORIGIN } from "../../lib/siteUrl";
import { isNoindexPath } from "../../lib/seoContent";
import { slugify } from "../utils/seoDefaults";

// Public SEO/crawler-facing routes: robots.txt, legacy URL redirects
// (/oils, /oil, /category/*), and the dynamically generated sitemap.xml
// (home + visible sections/pages + in-stock products, each respecting
// exclude_from_sitemap / seo_priority / seo_changefreq overrides).
//
// Shared state injected via factory: siteSections[], products[],
// d1_products[] (all read-only here) plus the two fetch helpers used as a
// fallback when the in-memory lists are empty (e.g. cold serverless
// instance that hasn't loaded the DB yet).

interface SeoState {
  getSections: () => any[];
  getProducts: () => any[];
  getD1Products: () => any[];
  fetchSectionsForSitemap: () => Promise<any[] | null>;
  fetchD1Products: () => Promise<any[] | null>;
}

// Which paths must stay out of the sitemap is now answered by the same
// function the page handler uses to decide whether to emit
// `<meta name="robots" content="noindex, follow">` — see isNoindexPath in
// src/lib/seoContent.ts.
//
// This file used to keep its own regex copy of that list, with a comment
// promising it was "kept in sync". It wasn't: /leave-a-review was added as a
// noindex page without being added here, so a section row pointing at it would
// have been submitted in the sitemap and served noindex at the same time —
// the "Submitted URL marked noindex" contradiction the comment existed to
// prevent. Two lists that must agree are one list.

export function createSeoRouter(state: SeoState) {
  const router = express.Router();

  router.get("/robots.txt", (req, res) => {
    res.header("Content-Type", "text/plain");
    // Static content that changes essentially never, but crawlers re-request it
    // constantly. Cheap to serve, still pointless to serve from the origin
    // every time.
    res.setHeader("Cache-Control", "public, max-age=86400");
    // /app.html is disallowed because it is the raw SPA shell.
    //
    // The build renames dist/index.html to dist/app.html so that "/" reaches
    // the Express handler instead of being served as a static file (see
    // scripts/postbuild-html.mjs). The side effect is that the shell is still
    // a real static file at /app.html, served by Vercel before any of our code
    // runs — so it answers 200 with the homepage's markup, no injected
    // canonical, no description and no robots directive. That is a duplicate of
    // the homepage that we cannot add a meta tag to, so it has to be excluded
    // here instead.
    res.send(
      `User-agent: *\nAllow: /\nDisallow: /app.html\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
    );
  });

  // The /oils, /oil and /category/* 301 handlers that used to live here are
  // gone on purpose. They kept every category page alive at several URLs at
  // once (/category/hair-and-scalp forwarded to /hair-and-scalp, so the alias
  // still "worked"). Alias paths are no longer defined anywhere, so they fall
  // through to the SPA fallback in server.ts and are answered with a genuine
  // 404 driven by src/lib/canonicalRoutes.ts. Nothing needs to list them.

  router.get("/sitemap.xml", async (req, res) => {
    try {
      const rawHost = req.get("x-forwarded-host") || req.get("host") || "bellauraoils.com";
      const isLocal = rawHost.includes("localhost") || rawHost.includes("127.0.0.1");
      // Production always emits the canonical host, never the host the
      // request arrived on: a sitemap served at www must still list the
      // canonical URLs, or it advertises URLs that redirect.
      const domain = isLocal ? `http://${rawHost}` : SITE_ORIGIN;

      // NOTE: no <lastmod> is emitted anywhere in this sitemap, deliberately.
      // Every entry used to claim `lastmod = today`, which is simply untrue —
      // it asserted that all pages and all products change every single day.
      // Google's documented guidance is that lastmod must be the genuine last
      // modification date and should be omitted if accurate values aren't
      // available; a value that is obviously wrong gets ignored and can reduce
      // trust in the sitemap overall. Neither the products nor the
      // sections_management table carries an updated_at column (only `orders`
      // has created_at), so there is no accurate value to emit. If a
      // modification timestamp is added to those tables later, reinstate
      // lastmod using it.
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

      const addedUrls = new Set<string>();

      // 1. Home
      xml += `\n  <url>\n    <loc>${domain}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`;
      addedUrls.add("/");

      // 2. Sections / Pages
      let currentSections = state.getSections();
      if (!currentSections || currentSections.length === 0) {
        const fetchedSections = await state.fetchSectionsForSitemap();
        if (fetchedSections && fetchedSections.length > 0) {
          currentSections = fetchedSections;
        }
      }
      const activeSections =
        currentSections && currentSections.length > 0
          ? currentSections
          : [
              {
                link_url: "/products",
                is_visible: 1,
                seo_priority: "0.8",
                seo_changefreq: "weekly",
              },
              {
                link_url: "/skin",
                is_visible: 1,
                seo_priority: "0.8",
                seo_changefreq: "weekly",
              },
              {
                link_url: "/hair-and-scalp",
                is_visible: 1,
                seo_priority: "0.8",
                seo_changefreq: "weekly",
              },
              {
                link_url: "/reviews",
                is_visible: 1,
                seo_priority: "0.7",
                seo_changefreq: "weekly",
              },
            ];

      activeSections.forEach((sec: any) => {
        if (sec.is_visible !== 0 && sec.is_visible !== false && sec.exclude_from_sitemap !== 1) {
          let link = normalizeSectionLinkServer(sec.link_url);
          if (!link) return;
          if (!link.startsWith("/")) link = "/" + link;
          if (link === "/") return;

          // Never list a URL that the SPA fallback in server.ts serves with
          // `noindex`. Doing so is self-contradictory — the sitemap asks Google
          // to index the URL while the page itself forbids it — and Search
          // Console reports it as the error "Submitted URL marked 'noindex'".
          // /reviews in particular was hitting this, because it's both in the
          // default section list above AND marked noindex by the server.
          if (isNoindexPath(link)) return;

          if (!addedUrls.has(link)) {
            addedUrls.add(link);
            const priority = sec.seo_priority || "0.8";
            const changefreq = sec.seo_changefreq || "weekly";
            xml += `\n  <url>\n    <loc>${domain}${link}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
          }
        }
      });

      // 3. Products
      const d1_products = state.getD1Products();
      const products = state.getProducts();
      let currentProducts = d1_products && d1_products.length > 0 ? d1_products : products;
      if (!currentProducts || currentProducts.length === 0) {
        const fetchedProds = await state.fetchD1Products();
        if (fetchedProds && fetchedProds.length > 0) {
          currentProducts = fetchedProds;
        }
      }
      const allProds = currentProducts && currentProducts.length > 0 ? currentProducts : [];

      allProds.forEach((p: any) => {
        if (p.isAvailable !== false && p.exclude_from_sitemap !== 1) {
          const slug =
            p.slug || (p.name_en ? slugify(p.name_en) : slugify(p.name));
          const prodUrl = `/product/${slug || p.id || p.product_nbr}`;
          if (!addedUrls.has(prodUrl)) {
            addedUrls.add(prodUrl);
            const priority = p.seo_priority || "0.9";
            const changefreq = p.seo_changefreq || "weekly";
            xml += `\n  <url>\n    <loc>${domain}${prodUrl}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
          }
        }
      });

      xml += `\n</urlset>`;

      res.header("Content-Type", "application/xml");
      // This handler walks every section and every product to build the XML on
      // each request, and it had no cache headers at all — so every crawler hit
      // paid the full cost at the origin. An hour at the edge is far fresher
      // than any crawler's own recrawl interval, and stale-while-revalidate
      // means a hit just after expiry is still served instantly.
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      res.send(xml);
    } catch (err) {
      // Never let a failed generation get cached as if it were the sitemap.
      res.setHeader("Cache-Control", "no-store");
      res.status(500).send("Error generating sitemap");
    }
  });

  return router;
}
