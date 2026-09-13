/**
 * src/App.tsx — Bellaura Oils PUBLIC STOREFRONT
 *
 * This file contains ONLY customer-facing routes.
 * No admin routes, no admin components, no admin imports.
 * Admin functionality lives at admin.bellauraoils.com
 */

import React, { Suspense } from "react";
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
import DebugBanner from "./components/DebugBanner";

// ProductDetail is statically imported so direct product links render
// instantly with top priority — no Suspense delay on direct visits.
import ProductDetail from "./components/ProductDetail";

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
const NotFoundPage    = lazyRetry(() => import("./components/NotFoundPage"));

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
              <DebugBanner />
            </div>
          </CartProvider>
        </ProductProvider>
      </LanguageProvider>
    </Router>
  );
}
