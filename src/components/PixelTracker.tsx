/**
 * Router-aware pixel tracker — fires a page-view on every route change.
 *
 * Follows the same pattern as ScrollToTop.tsx: mounted once inside
 * <Router>, uses useLocation, renders nothing.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { initPixels, trackPageView } from "../lib/pixel";
import { tracker } from "../lib/tracker";

export default function PixelTracker() {
  const { pathname } = useLocation();
  const isInitialMount = useRef(true);

  // Initialise pixels and first-party tracker once on first mount.
  useEffect(() => {
    initPixels();
    tracker.init();
  }, []);

  // Fire a page-view on every route change (including the first).
  useEffect(() => {
    tracker.track("page_view", { path: pathname });

    // Skip the very first render for third-party pixels — initPixels needs a tick
    // for vendor scripts to settle, and initial PageView is fired automatically by vendor SDKs.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    trackPageView();
  }, [pathname]);

  return null;
}
