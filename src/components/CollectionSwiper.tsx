import React, { useRef, useState, useEffect, useMemo } from 'react';
import StarRating from "./StarRating";
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import { motion } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { ChevronLeft, ChevronRight, ShoppingBag, Star, Sparkles, Leaf } from 'lucide-react';
import { getOptimizedImageUrl } from '../lib/imageUtils';

interface CollectionSwiperProps {
  title?: string;
  subtitle?: string;
  content?: string;
}

/**
 * Redesign notes (professional look + animation pass):
 *
 * - Cards are now real product cards: badge (tag/discount), name, price
 *   (with strike-through original price + %off), rating stars when reviews
 *   exist, and a quick "Add to Cart" affordance — none of that existed
 *   before (the old card was just an image + name + hairline).
 * - Desktop mouse drag-to-scroll was added on top of the existing native
 *   touch/trackpad scrolling (touch is left completely alone — dragging is
 *   gated to `pointerType === 'mouse'` so phones keep their native, more
 *   reliable momentum scroll instead of a hand-rolled one).
 * - Pagination dots are now clickable (they were purely decorative before)
 *   via `scrollIntoView({ inline: 'center' })`, which — unlike manually
 *   computing an offset — is direction-aware and needs no separate RTL branch.
 * - Entrance animation changed from a flat opacity+y fade to a slightly
 *   staggered scale+blur-in with a spring easing, and the left/right scroll
 *   edges get a soft mask-image fade to hint there's more to scroll to.
 * - Loading state changed from a spinner to shimmering skeleton cards shaped
 *   like the real ones, so the section's height doesn't jump once data
 *   arrives.
 *
 * Preserved on purpose: the same `{ title, subtitle, content }` prop
 * contract HomePage.tsx already calls this with, and the exact product
 * filter predicate (showInSwiper / displaySection / isAvailable /
 * in_catalog) — this only changes how matching products are displayed and
 * animated, not which ones are selected.
 */
export default function CollectionSwiper({ title, subtitle, content }: CollectionSwiperProps) {
  const { t, language } = useLanguage();
  const { products, loading, storeSettings } = useProducts();
  const { addToCart } = useCart();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [addedId, setAddedId] = useState<string | null>(null);
  const isAr = language === 'ar';

  const displayProducts = useMemo(() => products.filter(p => {
    if (!p) return false;
    const isAvailable = p.isAvailable !== false && p.isAvailable !== 0 && String(p.isAvailable) !== "0" && String(p.isAvailable) !== "false";
    const inCatalog = (p as any).in_catalog !== 0 && (p as any).in_catalog !== "0" && (p as any).in_catalog !== false && String((p as any).in_catalog) !== "false";

    const swiperVal = p.showInSwiper !== undefined ? p.showInSwiper : (p as any).show_in_swiper;
    const isSwiperVisible = swiperVal !== false && swiperVal !== 0 && String(swiperVal) !== "0" && String(swiperVal) !== "false" && String(swiperVal) !== "null" && String(swiperVal) !== "undefined";

    const displaySec = String(p.displaySection || (p as any).display_section || "both").toLowerCase();
    const matchesSection = displaySec !== "products" && displaySec !== "packs" && displaySec !== "none";

    return isAvailable && inCatalog && isSwiperVisible && matchesSection;
  }), [products]);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    const absScroll = Math.abs(scrollLeft);
    const maxScroll = scrollWidth - clientWidth;

    if (maxScroll > 0) {
      const index = Math.round((absScroll / maxScroll) * (displayProducts.length - 1));
      setActiveIndex(index);
    }

    const isRtl = language === 'ar';
    const atStart = absScroll < 20;
    const atEnd = absScroll > maxScroll - 20;

    if (isRtl) {
      setShowRightArrow(!atStart);
      setShowLeftArrow(!atEnd);
    } else {
      setShowLeftArrow(!atStart);
      setShowRightArrow(!atEnd);
    }
  };

  useEffect(() => {
    if (loading) return;
    checkScroll();
    let resizeTimer: number | undefined;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(checkScroll, 100);
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [displayProducts, loading]);

  // Desktop mouse drag-to-scroll. Deliberately gated to pointerType==='mouse'
  // so touch devices keep the browser's own native scroll/momentum — adding
  // custom pointer handling for touch tends to fight the OS's scrolling and
  // makes it feel worse, not better.
  const dragState = useRef({ down: false, startX: 0, startScroll: 0, moved: false });
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !scrollRef.current) return;
    // Do not capture drag if target is a button or interactive child
    if ((e.target as HTMLElement).closest('button, a, input, select, [role="button"]')) {
      return;
    }
    dragState.current = { down: true, startX: e.clientX, startScroll: scrollRef.current.scrollLeft, moved: false };
    setIsDragging(true);
    scrollRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current.down || !scrollRef.current) return;
    const dx = e.clientX - dragState.current.startX;
    if (Math.abs(dx) > 3) dragState.current.moved = true;
    scrollRef.current.scrollLeft = dragState.current.startScroll - dx;
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragState.current.down) return;
    dragState.current.down = false;
    setIsDragging(false);
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser — harmless.
    }
  };
  // Suppress the click-through on a card right after a real
  // drag, so dragging the strip doesn't trigger clicks.
  const onClickCapture = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, [role="button"]')) {
      dragState.current.moved = false;
      return;
    }
    if (dragState.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragState.current.moved = false;
    }
  };

  const goToIndex = (index: number) => {
    const child = scrollRef.current?.children[index] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = 400;
    const move = direction === 'left' ? -scrollAmount : scrollAmount;
    scrollRef.current.scrollBy({ left: move, behavior: 'smooth' });
  };

  const handleQuickAdd = (e: React.MouseEvent, product: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (product.isAvailable === false) return;
    
    // Normalize price string for CartContext
    const priceNum = Math.round(parseFloat(String(product.price || "0").replace(/[^\d.]/g, "")) || 0);
    const safeProduct = {
      ...product,
      price: `${priceNum} DH`,
    };

    addToCart(safeProduct);
    setAddedId(product.id);
    setTimeout(() => setAddedId((current) => (current === product.id ? null : current)), 1500);
  };

  if (loading) {
    return (
      <section className="py-10 sm:py-16 bg-background-soft overflow-hidden relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8 flex flex-col items-center text-center gap-3">
          <div className="h-3 w-32 rounded-full bg-primary-earth/[0.06] bo-shimmer" />
          <div className="h-9 w-72 rounded-lg bg-primary-earth/[0.06] bo-shimmer" />
        </div>
        <div className="flex gap-6 overflow-x-hidden px-4 sm:px-[10%]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex-shrink-0 w-[72vw] sm:w-[280px]">
              <div className="aspect-[4/5] rounded-2xl bg-primary-earth/[0.06] bo-shimmer mb-3" />
              <div className="h-3.5 w-3/4 mx-auto rounded bg-primary-earth/[0.06] bo-shimmer mb-2" />
              <div className="h-3 w-1/3 mx-auto rounded bg-primary-earth/[0.06] bo-shimmer" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (displayProducts.length === 0) {
    return null;
  }

  return (
    <section className="py-10 sm:py-16 bg-background-soft overflow-hidden relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8 sm:mb-10">
        <div className="flex flex-col items-center text-center gap-3">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-2 text-accent-gold"
          >
            <Leaf className="w-3.5 h-3.5" />
            <span className="text-[11px] font-bold uppercase tracking-[0.25em]">
              {isAr ? 'مجموعتنا المختارة' : language === 'fr' ? 'Notre Sélection' : 'Our Curated Selection'}
            </span>
            <Leaf className="w-3.5 h-3.5" />
          </motion.div>

          <div className="max-w-2xl flex flex-col items-center">
            <h2 className="text-4xl lg:text-5xl font-light mb-3 leading-[1.05] tracking-tight text-primary-earth">
              {title || t('products.collectionPacksTitle')}
            </h2>
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: '4rem' }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
              className={`h-px bg-accent-gold ${subtitle || content ? 'mb-5' : 'mb-1'}`}
            />
            {subtitle && (
              <p className="text-lg sm:text-xl text-primary-earth/70 leading-relaxed font-light mb-2 max-w-xl break-words">
                {subtitle}
              </p>
            )}
            {content && (
              <p className="text-sm text-primary-earth/60 leading-relaxed font-light whitespace-pre-wrap max-w-xl break-words">
                {content}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="relative group/swiper">
        <button
          onClick={() => scroll('left')}
          className={`absolute left-1 sm:left-4 top-[38%] -translate-y-1/2 z-20 p-2.5 sm:p-3.5 rounded-full bg-white shadow-lg shadow-primary-earth/10 text-primary-earth hover:bg-accent-gold hover:text-white transition-all duration-300 cursor-pointer ${!showLeftArrow ? 'opacity-0 pointer-events-none -translate-x-2' : 'opacity-100'}`}
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          onClick={() => scroll('right')}
          className={`absolute right-1 sm:right-4 top-[38%] -translate-y-1/2 z-20 p-2.5 sm:p-3.5 rounded-full bg-white shadow-lg shadow-primary-earth/10 text-primary-earth hover:bg-accent-gold hover:text-white transition-all duration-300 cursor-pointer ${!showRightArrow ? 'opacity-0 pointer-events-none translate-x-2' : 'opacity-100'}`}
          aria-label="Scroll right"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Edge fade hints there is more to scroll to; purely visual (mask-image),
            sits as its own layer so it never blocks pointer/drag interaction. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 sm:w-24 z-10 bg-gradient-to-r from-background-soft to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 sm:w-24 z-10 bg-gradient-to-l from-background-soft to-transparent" />

        <div
          ref={scrollRef}
          onScroll={checkScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onClickCapture={onClickCapture}
          className={`flex gap-5 sm:gap-7 overflow-x-auto pb-4 pt-2 px-4 sm:px-[10%] no-scrollbar snap-x snap-mandatory select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {displayProducts.map((pack, index) => {
            const priceNum = Math.round(parseFloat(String(pack.price || "0").replace(/[^\d.]/g, "")) || 0);
            const originalNum = pack.originalPrice
              ? parseFloat(String(pack.originalPrice).replace(/[^\d.]/g, ""))
              : NaN;
            const hasDiscount = Boolean(pack.isSale) && !isNaN(originalNum) && originalNum > priceNum;
            const discountPct = hasDiscount ? Math.round(((originalNum - priceNum) / originalNum) * 100) : 0;

            const rawTag = pack.tag !== undefined && pack.tag !== null ? String(pack.tag).trim() : "";
            const badgeLabel = hasDiscount
              ? `-${discountPct}%`
              : rawTag && rawTag.toLowerCase() !== "none"
                ? rawTag
                : null;

            const hasReviews = (pack.reviews || 0) > 0;
            const isOutOfStock = pack.isAvailable === false;
            const isAdded = addedId === pack.id;

            return (
              <motion.div
                key={pack.id}
                initial={{ opacity: 0, y: 24, scale: 0.96, filter: 'blur(4px)' }}
                whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                transition={{ delay: Math.min(index, 6) * 0.07, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                className="flex-shrink-0 w-[72vw] sm:w-[280px] snap-center group"
              >
                {/*
                  This is a show-only collection card by design — clicking it
                  must NOT navigate to a product page (previously wrapped in
                  a <Link to={`/product/...`}>). Everything else — badges,
                  price, rating, hover zoom, and the quick "Add to Cart"
                  button — is unchanged; only navigation was removed.
                */}
                <div draggable={false}>
                  <div className="relative aspect-[4/5] overflow-hidden rounded-2xl mb-3 bg-gradient-to-br from-white to-accent-lilac/25 border border-primary-earth/[0.06] shadow-sm transition-all duration-500 group-hover:shadow-xl group-hover:shadow-primary-earth/10 group-hover:-translate-y-1">
                    {badgeLabel && (
                      <span
                        className={`absolute top-3 z-10 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shadow-sm ${
                          hasDiscount
                            ? 'bg-primary-earth text-white right-3'
                            : 'bg-white/95 text-primary-earth border border-accent-gold/40 left-3'
                        }`}
                      >
                        {!hasDiscount && <Sparkles className="w-3 h-3 text-accent-gold" />}
                        {badgeLabel}
                      </span>
                    )}

                    {pack.image && (
                      <img
                        src={getOptimizedImageUrl(pack.image, 'eco', 500) || undefined}
                        alt={pack.name}
                        loading={index < 3 ? "eager" : "lazy"}
                        fetchPriority={index < 3 ? "high" : "low"}
                        decoding="async"
                        draggable={false}
                        className="w-full h-full object-contain p-4 transition-transform duration-700 ease-out group-hover:scale-[1.08]"
                        referrerPolicy="no-referrer"
                      />
                    )}

                    {/* Quick-add slides up on hover (desktop) and stays visible and clickable */}
                    <div className="absolute inset-x-0 bottom-0 p-3 z-20 opacity-95 sm:opacity-0 group-hover:opacity-100 translate-y-0 sm:translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => handleQuickAdd(e, pack)}
                        disabled={isOutOfStock}
                        aria-label={isAr ? 'أضف إلى السلة' : 'Add to cart'}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide shadow-lg transition-colors duration-200 cursor-pointer ${
                          isOutOfStock
                            ? 'bg-white/80 text-primary-earth/40 cursor-not-allowed'
                            : isAdded
                              ? 'bg-green-600 text-white'
                              : 'bg-white text-primary-earth hover:bg-accent-gold hover:text-white'
                        }`}
                      >
                        {isOutOfStock ? (
                          <span>
                            {language === 'ar'
                              ? (storeSettings?.outOfStockTextAr || 'نفذت الكمية')
                              : language === 'fr'
                                ? (storeSettings?.outOfStockTextFr || 'Rupture')
                                : (storeSettings?.outOfStockTextEn || 'Out of Stock')}
                          </span>
                        ) : isAdded ? (
                          <span>{isAr ? 'تم الإضافة!' : 'Added!'}</span>
                        ) : (
                          <>
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>{t('common.addToCart')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="text-center px-2">
                    <h3 className="text-base sm:text-lg font-light mb-1 tracking-wide uppercase text-primary-earth line-clamp-1">
                      {pack.name}
                    </h3>

                    {/* Five real stars instead of one glyph plus a number that
                        fell back to 5 when there was no rating at all. */}
                    <div className="flex items-center justify-center mb-1.5">
                      <StarRating
                        value={pack.rating}
                        count={(pack as any).reviews}
                        size="xs"
                        showValue
                        showCount={hasReviews}
                        className="text-amber-500"
                      />
                    </div>

                    <div className="flex items-center justify-center gap-2" dir="ltr">
                      <span className="text-accent-gold font-extrabold text-base">{priceNum}</span>
                      <span className="text-accent-gold/80 font-bold text-[11px] uppercase">DH</span>
                      {hasDiscount && (
                        <span className="text-primary-earth/35 line-through text-xs">
                          {Math.round(originalNum)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="max-w-7xl mx-auto px-4 flex justify-center mt-5">
          <div className="flex gap-2 items-center">
            {displayProducts.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goToIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${activeIndex === i ? 'w-8 bg-accent-gold' : 'w-1.5 bg-primary-earth/15 hover:bg-primary-earth/30'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
