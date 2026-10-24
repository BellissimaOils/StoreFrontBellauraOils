import { useEffect, useRef } from 'react';
import { useProducts } from '../context/ProductContext';
import { motion } from 'motion/react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import ProductCard from './ProductCard';
import { useIncrementalList } from '../lib/useIncrementalList';

export default function FeaturedProducts() {
  const { t, language } = useLanguage();
  const { products, loading, storeSettings } = useProducts(true);
  const viewMode = storeSettings?.featuredProductsLayout || 'grid';
  
  const gridClass = viewMode === "grid"
    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8"
    : viewMode === "vertical"
      ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6"
      : viewMode === "circular"
        ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6 sm:gap-8"
        : viewMode === "split"
          ? "grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8"
          : viewMode === "floating"
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-7 sm:gap-8"
            : viewMode === "featured"
              ? "grid grid-cols-1 md:grid-cols-2 gap-8"
              : viewMode === "banner"
                ? "flex flex-col space-y-6"
                : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8";
  const filteredProducts = products.filter(p => {
    if (!p) return false;
    const isAvailable = p.isAvailable !== false && p.isAvailable !== 0 && String(p.isAvailable) !== "0" && String(p.isAvailable) !== "false";
    const inCatalog = (p as any).in_catalog !== 0 && (p as any).in_catalog !== "0" && (p as any).in_catalog !== false && String((p as any).in_catalog) !== "false";
    
    const swiperVal = p.showInSwiper !== undefined ? p.showInSwiper : (p as any).show_in_swiper;
    const isSwiperVisible = swiperVal !== false && swiperVal !== 0 && String(swiperVal) !== "0" && String(swiperVal) !== "false" && String(swiperVal) !== "null" && String(swiperVal) !== "undefined";

    const displaySec = String(p.displaySection || (p as any).display_section || "both").toLowerCase();
    const matchesSection = displaySec !== "products" && displaySec !== "packs" && displaySec !== "none";

    return isAvailable && inCatalog && isSwiperVisible && matchesSection;
  });

  // Render the first four cards immediately, then reveal four more whenever
  // the visitor approaches the end of the grid. This is client-side windowing;
  // the shared catalog request remains unchanged.
  const { visible: visibleProducts, hasMore, showMore } = useIncrementalList(filteredProducts);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  // Automatically reveal more products without a button. Recreate the observer
  // after each batch so it can immediately load another batch when the sentinel
  // remains inside the prefetch margin (for example on a short viewport). A scroll
  // fallback covers browsers/layout transitions where IntersectionObserver misses
  // the initial intersection after client-side navigation.
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore) return;

    let scheduled = false;
    const revealNextBatch = () => {
      if (scheduled) return;
      scheduled = true;
      showMore();
      window.setTimeout(() => { scheduled = false; }, 120);
    };

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) revealNextBatch();
      }, { rootMargin: '900px 0px', threshold: 0 });
      observer.observe(sentinel);
    }

    const checkSentinelPosition = () => {
      const rect = sentinel.getBoundingClientRect();
      if (rect.top <= window.innerHeight + 900 && rect.bottom >= -900) revealNextBatch();
    };
    window.addEventListener('scroll', checkSentinelPosition, { passive: true });
    window.addEventListener('resize', checkSentinelPosition);
    // Check once after the current render so navigation into the section does not
    // require a manual refresh or an additional scroll event.
    const frame = window.requestAnimationFrame(checkSentinelPosition);

    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', checkSentinelPosition);
      window.removeEventListener('resize', checkSentinelPosition);
      window.cancelAnimationFrame(frame);
    };
  }, [hasMore, showMore, visibleProducts.length]);

  if (loading) {
    return (
      <section className="py-24 bg-white flex flex-col items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
          <p className="text-accent-gold font-medium animate-pulse">
            {language === 'ar' ? 'جاري تحميل المنتجات...' : language === 'fr' ? 'Chargement des produits...' : 'Loading products...'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Filter and Sort Header */}
        <div className="flex justify-between items-center mb-12 border-b border-primary-earth/5 pb-4">
          <div className="flex items-center space-x-6 rtl:space-x-reverse">
            <button className="flex items-center space-x-2 rtl:space-x-reverse text-sm font-light hover:text-accent-gold transition-colors">
              <SlidersHorizontal className="w-5 h-5" />
              <span>{language === 'ar' ? 'تصفية' : language === 'fr' ? 'Filtrer' : 'Filter'}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            <span className="text-sm text-primary-earth/40">{filteredProducts.length} {language === 'ar' ? 'نتائج' : language === 'fr' ? 'Résultats' : 'Results'}</span>
          </div>
          
          <div className="flex items-center">
            <button className="flex items-center space-x-2 rtl:space-x-reverse text-sm font-light hover:text-accent-gold transition-colors">
              <span>{language === 'ar' ? 'ترتيب: أبجديا، أ-ي' : language === 'fr' ? 'Trier: Alphabétiquement, A-Z' : 'Sort: Alphabetically, A-Z'}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Product Grid */}
        <div className={gridClass}>
          {visibleProducts.map((product) => (
            <ProductCard key={product.id} product={product} layoutMode={viewMode as any} />
          ))}
        </div>

        <div
          ref={loadMoreSentinelRef}
          aria-hidden="true"
          data-total={filteredProducts.length}
          data-visible={visibleProducts.length}
          className="h-px w-full"
        />
      </div>
    </section>
  );
}
