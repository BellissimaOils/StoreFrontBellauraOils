import { lazy, type ComponentType } from "react";

type ModuleFactory<T> = () => Promise<{ default: T }>;

/**
 * `React.lazy` with the network retried before giving up.
 *
 * Two things make a plain `lazy(() => import(...))` fragile, and together they
 * are why a page could refuse to load until it was manually refreshed:
 *
 *  1. Every page in this app is code-split, so opening one fetches a separate
 *     JS file. On a phone — which is how most of this store's traffic arrives —
 *     a single request being dropped mid-load is ordinary, not exceptional.
 *
 *  2. React caches the promise the factory returns, including a rejected one.
 *     So the first failure is permanent for that page view: re-rendering,
 *     navigating away and back, or opening the section again all reuse the same
 *     rejected promise. Nothing recovers except a full page reload, which is
 *     exactly the workaround that was being used by hand.
 *
 * Retrying inside the factory means React only ever sees the final outcome, so
 * a transient failure is invisible instead of terminal. Three attempts with a
 * short backoff covers a dropped request without making a genuinely missing
 * file (a chunk from a superseded deployment) take noticeably longer to fail —
 * that case is handled by ChunkErrorBoundary reloading once, which fetches the
 * current filenames.
 */
export function lazyRetry<T extends ComponentType<any>>(
  factory: ModuleFactory<T>,
  attempts = 3,
  baseDelayMs = 350,
) {
  return lazy(() => loadWithRetry(factory, attempts, baseDelayMs));
}

async function loadWithRetry<T>(
  factory: ModuleFactory<T>,
  attempts: number,
  baseDelayMs: number,
): Promise<{ default: T }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await factory();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      // Linear backoff: 350ms, then 700ms. Long enough for a flaky connection
      // to recover, short enough that the page doesn't feel stuck.
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)));
    }
  }

  // Out of attempts: let it reject so ChunkErrorBoundary can decide whether a
  // reload is the right recovery.
  console.error("[lazyRetry] gave up loading a page chunk", lastError);
  throw lastError;
}
