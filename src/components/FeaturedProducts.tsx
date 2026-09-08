import { useProducts } from '../context/ProductContext';
import { motion } from 'motion/react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import ProductCard from './ProductCard';
import LoadMoreButton from './LoadMoreButton';
import { useIncrementalList } from '../lib/useIncrementalList';

export default function FeaturedProducts() {
  const { t, language } = useLanguage();
  const { products, loading, storeSettings } = useProducts();
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

  // Show 20 cards, then 20 more per click, instead of mounting the whole
  // catalogue — every card carries an image request and its own animation.
  // No resetKey: the layout toggle only restyles the same products, so
  // collapsing back to 20 when someone switches grid/list would throw away
  // however far they had already scrolled.
  const { visible: visibleProducts, hasMore, showMore } = useIncrementalList(filteredProducts);

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

        <LoadMoreButton
          onClick={showMore}
          hasMore={hasMore}
          loaded={visibleProducts.length}
          total={filteredProducts.length}
          className="mt-14"
        />
      </div>
    </section>
  );
}
