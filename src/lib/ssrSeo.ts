import { normalizePathname } from "./canonicalRoutes";

/**
 * Reads the title and description the server already rendered into the HTML.
 *
 * Why: on a cold page load the server resolves the SEO text from its own
 * in-memory data, then React mounts and resolves it again from data it fetches
 * itself. If the two sides hold anything different — a section row the server
 * hasn't overlaid yet, a different Accept-Language than the visitor's saved
 * language — the browser tab visibly changes after load.
 *
 * Feeding these values back into resolvePageSeo as a fallback removes the
 * change entirely: with no admin value to apply, the browser re-asserts the
 * exact string that is already in the tab.
 *
 * Captured once at module evaluation, which runs after <head> is parsed and
 * before React renders, so these are the server's values and not something a
 * component has already overwritten.
 */

const initialPath =
  typeof window !== "undefined" && window.location
    ? normalizePathname(window.location.pathname)
    : "";

const initialTitle = typeof document !== "undefined" ? document.title || "" : "";

const initialDescription =
  typeof document !== "undefined"
    ? document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") || ""
    : "";

/**
 * The server-rendered values, but only for the page that was actually loaded.
 *
 * The path check matters: after a client-side navigation the captured title
 * belongs to the *previous* page, and reusing it would label the new page with
 * the old page's title. In that case there is nothing to preserve anyway,
 * because no server render happened for the new URL.
 */
export function serverRenderedSeo(pathname: string): {
  ssrTitle: string;
  ssrDescription: string;
} {
  if (!initialPath || normalizePathname(pathname) !== initialPath) {
    return { ssrTitle: "", ssrDescription: "" };
  }
  // Keys are named to match ResolveSeoInput so callers can spread this
  // straight into resolvePageSeo().
  return { ssrTitle: initialTitle, ssrDescription: initialDescription };
}
