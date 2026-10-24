# BellAura Oils storefront — featured image and tracking update

This archive contains storefront and its public API only. It does not include or modify the admin dashboard.

## Home featured products

- Home starts requesting the featured collection as soon as the homepage sections identify it; the request no longer waits for the hero image.
- Added a bounded `/api/products/featured` response so Home does not download the full product catalog just to render its first cards. Product detail and catalog routes remain unchanged.
- The first featured image receives high browser priority. Only the first two carousel cards are eager; the rest stay lazy. A lightweight skeleton remains while featured data is loading.
- The server keeps a short in-memory featured response cache.

## First-party tracking

- Exit beacons now send `application/json`, so Express can parse the request.
- Failed analytics requests are put back into a bounded queue and retried on a later flush. Small requests use `keepalive` so checkout events can survive navigation.
- A direct or internal visit within an active session no longer overwrites campaign attribution. Full UTM fields are retained for that session, and referrer host matching uses exact domains/subdomains.
- The tracker now sends the session landing page, and the intake route stores the referrer, validates event values/timestamps, and updates active session duration from saved page-view events.

## Limits

The storefront archive cannot resize existing originals already stored in R2; this repo has no image-upload/variant pipeline, and that workflow belongs to the separate dashboard. If the featured endpoint and eager priority still leave image bytes taking several seconds after deployment, the dashboard upload pipeline needs to produce and save smaller card-sized variants. No production deployment or live timing measurement was performed here.

The previous v2 validation notes do not cover these latest changes. This revision has not been run through a build or browser session in this turn.

## Deployment

Deploy the storefront and its API together from this source. Preserve the environment variables configured in production; this archive contains no production secrets.

---

## Update: Hero priority + per-section loading

### Home hero
- The server now loads the homepage rows itself when it builds the Home HTML (max 1.5s wait on a cold instance, instant + background refresh on a warm one). Before, the hero `<link rel="preload">` only existed if that instance already had the rows in memory, so on a cold start the browser discovered the hero image only after HTML -> JS -> `/api/homepage-sections`.
- The injected preload now matches the `<img>` (`referrerpolicy="no-referrer"`) and a plain `preconnect` to the image host is added. The old `crossorigin` preconnect could not be reused by `<img>` requests.
- Everything below the Hero (other sections, their JS chunks, featured products, their images) now waits until the Hero image is ready (5s safety timeout, and it opens at once if the page has no Hero). The Hero no longer competes with them.

### Sections (/products, /skin, /hair-and-scalp, /packs, custom)
- New `GET /api/products/section/:slug`: returns only that section's products, without `description`/`usage`/`ingredients`. Uses one small D1 query (no `SELECT *`, no table checks) cached 30s on the server and shared by all sections. The matching rule moved to `src/lib/categoryMatch.ts` so server and page use the same one.
- `CategoryPage` no longer calls `useProducts(true)` (full catalogue). It uses `useSectionProducts` (`src/lib/useSectionProducts.ts`), which keeps lists in memory (re-entering a section is instant, refreshed in the background).
- Section data is prefetched: on nav hover/touch, after the Hero is ready (one section at a time), and at startup on a direct section URL.
- Featured query now also selects `display_section`, which the featured route already filtered on but was never selected.

Not run: no live Vercel/D1 timing. Verified here with a type-check of the changed files, a production build, and a mocked-D1 run (section filtering, stripped text, hero preload in HTML).
