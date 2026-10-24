/**
 * src/App.tsx — Bellaura Oils PUBLIC STOREFRONT
 *
 * This file contains ONLY customer-facing routes.
 * No admin routes, no admin components, no admin imports.
 * Admin functionality lives at admin.bellauraoils.com
 */

import React, { Suspense, useEffect } from "react";
import { lazyRetry } from "./lib/lazyRetry";
import ChunkErrorBoundary from "./components/ChunkErrorBoundary";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Navbar from "./components/Navbar";
import { CartProvider } from "./context/CartContext";
import { LanguageProvider } from "./context/LanguageContext";
import { ProductProvider } from "./context/ProductContext";
import ScrollToTop from "./components/ScrollToTop";
import PixelTracker from "./components/PixelTracker";
import FloatingCart from "./components/FloatingCart";
import BackToTopButton from "./components/BackToTopButton";
import Footer from "./components/Footer";
import HomePage from "./components/HomePage";
import { prefetchSection } from "./lib/useSectionProducts";

// Each route downloads its own page code, including direct product visits.
const ProductDetail = lazyRetry(() => import("./components/ProductDetail"));

// All other pages are lazy-loaded per route so each visitor only downloads
// the code for the page they actually visit.
const CategoryPage    = lazyRetry(() => import("./components/CategoryPage"));
const CheckoutPage    = lazyRetry(() => import("./CheckoutPage"));
const ReviewsPage     = lazyRetry(() => import("./components/ReviewsPage"));
const AboutPage       = lazyRetry(() => import("./components/AboutPage"));
const FaqPage         = lazyRetry(() => import("./components/FaqPage"));
const LeaveReviewPage = lazyRetry(() => import("./components/LeaveReviewPage"));
const GeneralReviewPage = lazyRetry(() => import("./components/GeneralReviewPage"));

// Premium loading spinner shown while lazy chunks are fetching
function LuxuryLoader() {
  return (
    <div
      className="min-h-[50vh] flex flex-col items-center justify-center bg-background-soft"
      id="luxury-page-loader"
    >
      <div className="relative w-12 h-12 mb-4">
        <div className="absolute inset-0 rounded-full border border-primary-earth/10" />
        <div className="absolute inset-0 rounded-full border border-accent-gold border-t-transparent animate-spin" />
      </div>
      <p className="text-[10px] uppercase tracking-[0.3em] text-primary-earth/50">
        Bellaura Oils
      </p>
    </div>
  );
}

/**
 * Warm secondary route chunks only after the current route has had a chance to
 * render. On Home, the Hero image is the gate: no other route chunk competes
 * with the Hero for network bandwidth before that image has loaded. The
 * browser still downloads one chunk at a time during idle periods.
 */
function BackgroundRoutePreloader() {
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    let timerId: number | undefined;
    let queue: Array<() => Promise<unknown>> = [];
    let index = 0;
    let started = false;

    const routeImports: Array<[string, () => Promise<unknown>]> = [
      ["/products", () => import("./components/CategoryPage")],
      ["/product/", () => import("./components/ProductDetail")],
      ["/checkout", () => import("./CheckoutPage")],
      ["/reviews", () => import("./components/ReviewsPage")],
      ["/about", () => import("./components/AboutPage")],
      ["/faq", () => import("./components/FaqPage")],
      ["/review/", () => import("./components/LeaveReviewPage")],
      ["/leave-a-review", () => import("./components/GeneralReviewPage")],
    ];
    queue = routeImports.filter(([path]) => {
      if (path === "/products") return !["/products", "/skin", "/hair-and-scalp", "/packs"].includes(pathname);
      return !pathname.startsWith(path);
    }).map(([, load]) => load);
    // Product lists of the built-in sections, one at a time and only after the
    // gate above (Hero ready on Home), so switching sections later is instant.
    // They go right after the category page code, before the less-visited pages.
    const sectionLoads = ["products", "skin", "hair-and-scalp", "packs"]
      .filter((slug) => pathname !== `/${slug}`)
      .map((slug) => () => prefetchSection(slug));
    queue = [...queue.slice(0, 1), ...sectionLoads, ...queue.slice(1)];

    const runNext = () => {
      if (cancelled || index >= queue.length) return;
      const load = queue[index++];
      void load().catch(() => {}).finally(() => {
        if (cancelled) return;
        if ("requestIdleCallback" in window) {
          idleId = window.requestIdleCallback(runNext, { timeout: 2500 });
        } else {
          timerId = window.setTimeout(runNext, 700);
        }
      });
    };

    const start = () => {
      if (cancelled || started) return;
      started = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(runNext, { timeout: 2500 });
      } else {
        timerId = window.setTimeout(runNext, 1200);
      }
    };

    if (pathname === "/" || pathname === "") {
      window.addEventListener("bellaura:hero-ready", start, { once: true });
      // Do not let a missing/broken hero permanently prevent useful preloading.
      timerId = window.setTimeout(start, 6000);
    } else {
      // On direct product links, give the product content/image the first turn.
      timerId = window.setTimeout(start, pathname.startsWith("/product/") ? 3500 : 1800);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("bellaura:hero-ready", start);
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (idleId !== undefined && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    };
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <Router>
      <BackgroundRoutePreloader />
      <ScrollToTop />
      <PixelTracker />
      <LanguageProvider>
        <ProductProvider>
          <CartProvider>
            <Toaster position="bottom-right" />
            <div className="min-h-screen">
              <div className="print:hidden">
                <Navbar />
              </div>

              {/* Catches lazy page load failures after a deploy
                  (chunk filename no longer exists). Reloads once. */}
              <ChunkErrorBoundary>
                <Suspense fallback={<LuxuryLoader />}>
                  <Routes>
                    {/* ── Customer routes ────────────────────────────── */}
                    <Route path="/"               element={<HomePage />} />
                    <Route path="/products"       element={<CategoryPage />} />
                    <Route path="/skin"           element={<CategoryPage />} />
                    <Route path="/hair-and-scalp" element={<CategoryPage />} />
                    <Route path="/packs"          element={<CategoryPage />} />
                    <Route path="/product/:id"    element={<ProductDetail />} />
                    <Route path="/reviews"        element={<ReviewsPage />} />
                    <Route path="/checkout"       element={<CheckoutPage />} />
                    <Route path="/about"          element={<AboutPage />} />
                    <Route path="/faq"            element={<FaqPage />} />

                    {/* ── Review submission (token-gated) ───────────── */}
                    <Route path="/review/:token"  element={<LeaveReviewPage />} />
                    <Route path="/leave-a-review" element={<GeneralReviewPage />} />

                    {/* ── Catch-all: handles dynamic section slugs ──── */}
                    {/* CategoryPage asks canonicalRoutes.resolvePath and
                        renders NotFoundPage itself when the slug isn't
                        a real section — so genuine 404s still 404. */}
                    <Route path="*" element={<CategoryPage />} />
                  </Routes>
                </Suspense>
              </ChunkErrorBoundary>

              <div className="print:hidden">
                <Footer />
              </div>
              <FloatingCart />
              <BackToTopButton />
            </div>
          </CartProvider>
        </ProductProvider>
      </LanguageProvider>
    </Router>
  );
}
