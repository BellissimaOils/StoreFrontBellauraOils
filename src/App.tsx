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

// Each route downloads its own page code, including direct product visits.
const ProductDetail = lazyRetry(() => import("./components/ProductDetail"));

// All other pages are lazy-loaded per route so each visitor only downloads
// the code for the page they actually visit.
const HomePage        = lazyRetry(() => import("./components/HomePage"));
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

export default function App() {
  // Keep the Home route's first render/network work ahead of every other page.
  // Once the initial view has settled, warm one non-home route chunk at a time
  // during idle periods so navigation feels instant without competing with Home.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    const preloads: Array<() => Promise<unknown>> = [
      () => import("./components/CategoryPage"),
      () => import("./components/ReviewsPage"),
      () => import("./components/AboutPage"),
      () => import("./components/FaqPage"),
      () => import("./CheckoutPage"),
      () => import("./components/LeaveReviewPage"),
      () => import("./components/GeneralReviewPage"),
      () => import("./components/ProductDetail"),
    ];
    let index = 0;

    const scheduleNext = () => {
      if (cancelled || index >= preloads.length) return;
      const runOne = () => {
        idleId = undefined;
        if (cancelled || index >= preloads.length) return;
        const load = preloads[index++];
        // Ignore background preload failures; lazyRetry handles actual navigation.
        void load().catch(() => {}).finally(() => {
          if (!cancelled) timer = setTimeout(scheduleNext, 650);
        });
      };
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(runOne, { timeout: 4000 });
      } else {
        timer = setTimeout(runOne, 900);
      }
    };

    // Give Home's hero, text and first data requests a head start.
    timer = setTimeout(scheduleNext, 2200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);

  return (
    <Router>
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
