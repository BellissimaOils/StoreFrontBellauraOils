/**
 * Router-aware pixel tracker — fires a page-view on every route change.
 *
 * Follows the same pattern as ScrollToTop.tsx: mounted once inside
 * <Router>, uses useLocation, renders nothing.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { initPixels, trackPageView } from "../lib/pixel";

export default function PixelTracker() {
  const { pathname } = useLocation();
  const isInitialMount = useRef(true);

  // Initialise once on first mount.
  useEffect(() => {
    initPixels();
  }, []);

  // Fire a page-view on every route change (including the first).
  useEffect(() => {
    // Skip the very first render — initPixels needs a tick for the vendor
    // scripts to settle, and the first PageView is fired automatically by
    // both SDKs after init anyway.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    trackPageView();
  }, [pathname]);

  return null;
}
