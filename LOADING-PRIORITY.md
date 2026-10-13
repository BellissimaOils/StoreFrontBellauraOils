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
