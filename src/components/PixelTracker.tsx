/**
 * Router-aware pixel & first-party behavioral tracker
 *
 * - Fires page_view on every route change
 * - Fires time_on_page for previous route on navigation
 * - Tracks useful scroll milestones (25%, 50%, 75%, 90%) without spamming
 * - Preserves third-party pixel tracking
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { initPixels, trackPageView } from "../lib/pixel";
import { tracker } from "../lib/tracker";

const SCROLL_MILESTONES = [25, 50, 75, 90] as const;

export default function PixelTracker() {
  const { pathname, search } = useLocation();
  const isInitialMount = useRef(true);
  const prevPathRef = useRef<string>(pathname);
  const reportedMilestonesRef = useRef<Set<number>>(new Set());

  // Initialise pixels and first-party tracker once on first mount.
  useEffect(() => {
    initPixels();
    tracker.init();
  }, []);

  // Track page_view and time_on_page on route changes
  useEffect(() => {
    // Record time on page for the route being exited
    if (!isInitialMount.current && prevPathRef.current && prevPathRef.current !== pathname) {
      const activeDuration = tracker.getAndResetActiveDuration();
      if (activeDuration >= 1000) {
        tracker.track("time_on_page", {
          path: prevPathRef.current,
          activeDurationMs: activeDuration,
          metadata: { seconds: Math.round(activeDuration / 1000) },
        });
      }
    }

    prevPathRef.current = pathname;
    reportedMilestonesRef.current = new Set();

    // Fire normalized page_view event
    tracker.track("page_view", { path: pathname });

    // Track search event if query param present
    if (search) {
      try {
        const params = new URLSearchParams(search);
        const q = params.get("q") || params.get("search") || params.get("query");
        if (q) {
          tracker.trackSearch(q, pathname);
        }
      } catch {}
    }

    // Skip the very first render for third-party pixels — initPixels needs a tick
    // for vendor scripts to settle, and initial PageView is fired automatically by vendor SDKs.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    trackPageView();
  }, [pathname, search]);

  // Throttled scroll milestones observer
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        ticking = false;
        const docElem = document.documentElement;
        const totalHeight = docElem.scrollHeight - window.innerHeight;
        if (totalHeight <= 0) return;

        const currentScroll = window.scrollY || window.pageYOffset || docElem.scrollTop || 0;
        const percent = Math.min(100, Math.round((currentScroll / totalHeight) * 100));

        for (const milestone of SCROLL_MILESTONES) {
          if (percent >= milestone && !reportedMilestonesRef.current.has(milestone)) {
            reportedMilestonesRef.current.add(milestone);
            tracker.track("scroll", {
              path: pathname,
              metadata: { depth: milestone },
            });
          }
        }
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [pathname]);

  return null;
}
