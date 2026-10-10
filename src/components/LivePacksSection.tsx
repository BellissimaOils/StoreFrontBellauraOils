import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import { Flame, ShoppingBag, Check, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { LivePack } from "../types";
import { useCart } from "../context/CartContext";
import { useLanguage } from "../context/LanguageContext";
import { getOptimizedImageUrl } from "../lib/imageUtils";

interface LivePacksSectionProps {
  packs: LivePack[];
  title?: string;
  subtitle?: string;
  textColor?: string;
  isStandalone?: boolean;
}

export default function LivePacksSection({
  packs,
  title,
  subtitle,
  textColor,
  isStandalone = false,
}: LivePacksSectionProps) {
  const { addLivePackToCart } = useCart();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const isFr = language === "fr";

  // Visible packs sorted by display_order
  const visiblePacks = (packs || []).filter((p) => p.status === "visible");

  if (visiblePacks.length === 0) {
    return null;
  }

  const isSingle = visiblePacks.length === 1;

  const content = (
    <div className={`${isSingle ? "max-w-2xl lg:max-w-3xl" : "max-w-4xl"} mx-auto space-y-4 sm:space-y-6`}>
      {/* Section Header */}
      <div className="text-center space-y-2 max-w-xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-600/10 border border-red-500/20 text-red-600 text-xs font-black tracking-wide">
          <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
          <span>{isAr ? "عروض البث المباشر الحصرية" : isFr ? "Offres Spéciales Direct" : "Exclusive Live Offers"}</span>
        </div>

        <h2
          className="text-2xl sm:text-3xl font-serif font-black tracking-tight"
          style={{ color: textColor || undefined }}
        >
          🔥 {title || (isAr ? "عروض اللايف الحصرية" : isFr ? "Packs Exclusifs Live" : "Exclusive Live Packs")}
        </h2>

        <p className="text-xs sm:text-sm text-primary-earth/70 font-light leading-relaxed">
          {subtitle ||
            (isAr
              ? "باقات ترويجية خاصة ومحدودة بمناسبة البث المباشر. وفر أكثر مع مجموعات زيوتنا الطبيعية الأكثر طلباً."
              : isFr
              ? "Des offres promotionnelles éphémères spécialement conçues pour notre Live. Profitez de nos meilleurs soins au prix Live."
              : "Special limited promotional bundles for our Live stream. Get your favorite pure oils at exclusive live pricing.")}
        </p>
      </div>

      {/* Vertical Stack of Packs */}
      <div className="flex flex-col gap-6 sm:gap-8">
        {visiblePacks.map((pack, index) => (
          <LivePackCard key={pack.id || index} pack={pack} index={index} />
        ))}
      </div>
    </div>
  );

  if (isStandalone) {
    return (
      <div id="live-packs-section" className="w-full pb-4" dir={isAr ? "rtl" : "ltr"}>
        {content}
      </div>
    );
  }

  return (
    <section
      id="live-packs-section"
      className="py-10 sm:py-14 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-amber-500/[0.04] via-background-soft to-background-soft border-y border-accent-gold/15"
      dir={isAr ? "rtl" : "ltr"}
    >
      {content}
    </section>
  );
}

function LivePackCard({ pack, index }: { pack: LivePack; index: number; key?: React.Key }) {
  const { addLivePackToCart } = useCart();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const isFr = language === "fr";
  const [added, setAdded] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  const discountAmount =
    pack.regular_price > pack.live_price ? pack.regular_price - pack.live_price : 0;
  const discountPercent =
    pack.regular_price > 0 && discountAmount > 0
      ? Math.round((discountAmount / pack.regular_price) * 100)
      : 0;

  const handleAddToCart = () => {
    addLivePackToCart(pack, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
  };

  const scrollCarousel = (direction: "left" | "right") => {
    if (!carouselRef.current) return;
    const scrollAmount = 200;
    const multiplier = isAr ? (direction === "left" ? 1 : -1) : (direction === "left" ? -1 : 1);
    carouselRef.current.scrollBy({ left: scrollAmount * multiplier, behavior: "smooth" });
  };

  const productsList = pack.products || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, delay: index * 0.08 }}
      className="bg-white rounded-2xl sm:rounded-3xl border border-primary-earth/10 shadow-md shadow-primary-earth/[0.03] overflow-hidden flex flex-col transition-all hover:border-accent-gold/40 hover:shadow-lg"
    >
      {/* Pack Top Bar */}
      <div className="p-4 sm:p-5 border-b border-primary-earth/5 bg-gradient-to-r from-accent-gold/[0.05] via-transparent to-accent-gold/[0.02]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-accent-gold/20 text-primary-earth font-black text-[11px] font-mono">
                PACK #{index + 1}
              </span>
              <h3 className="text-lg sm:text-xl font-bold text-primary-earth tracking-tight">
                {pack.name}
              </h3>
              {discountPercent > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-red-600 text-white shadow-xs">
                  {isAr ? `خصم ${discountPercent}%` : `-${discountPercent}%`}
                </span>
              )}
            </div>

            {pack.description && (
              <p className="text-xs text-primary-earth/70 font-light leading-relaxed max-w-2xl">
                {pack.description}
              </p>
            )}
          </div>

          {/* Quick Counter */}
          <div className="shrink-0 text-start sm:text-end">
            <span className="text-[10px] font-bold text-primary-earth/50 uppercase tracking-wider block">
              {isAr ? "محتويات الباقة" : "Pack includes"}
            </span>
            <span className="text-xs sm:text-sm font-black text-primary-earth">
              {productsList.length} {isAr ? "منتجات طبيعية" : "items"}
            </span>
          </div>
        </div>
      </div>

      {/* Products Grid or Carousel */}
      <div className="p-4 sm:p-5 space-y-3 bg-[#faf9f7]/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent-gold" />
            <span className="text-[11px] sm:text-xs font-bold text-primary-earth/80">
              {isAr
                ? "المنتجات المضمنة في الباقة:"
                : isFr
                ? "Produits inclus dans ce pack :"
                : "Products included in this pack:"}
            </span>
          </div>

          {productsList.length > 4 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollCarousel("left")}
                aria-label="Previous product"
                className="w-6 h-6 rounded-full bg-white border border-primary-earth/10 flex items-center justify-center text-primary-earth/70 hover:text-primary-earth hover:border-accent-gold transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => scrollCarousel("right")}
                aria-label="Next product"
                className="w-6 h-6 rounded-full bg-white border border-primary-earth/10 flex items-center justify-center text-primary-earth/70 hover:text-primary-earth hover:border-accent-gold transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Display Products: Clean responsive grid if <= 4 items, else Carousel */}
        {productsList.length <= 4 ? (
          <div
            className={`grid grid-cols-2 ${
              productsList.length === 3
                ? "sm:grid-cols-3"
                : productsList.length === 4
                ? "sm:grid-cols-4"
                : "sm:grid-cols-2"
            } gap-2.5 sm:gap-3`}
          >
            {productsList.map((product, pIdx) => {
              const rawPrice = product.price ? String(product.price).replace(/[^\d.]/g, "") : "";
              const formattedPrice = rawPrice ? `${Math.round(parseFloat(rawPrice))} DH` : "";

              return (
                <div
                  key={product.id || pIdx}
                  className="bg-white rounded-xl border border-primary-earth/10 p-2.5 sm:p-3 flex flex-col justify-between shadow-2xs hover:border-accent-gold/30 transition-all"
                >
                  <div className="space-y-1.5">
                    <div className="w-full aspect-square bg-[#0a0a0a] rounded-lg overflow-hidden flex items-center justify-center p-1.5 border border-primary-earth/5">
                      {product.image ? (
                        <img
                          src={getOptimizedImageUrl(product.image, "eco", 180) || product.image}
                          alt={product.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
                          Bellaura
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-[9px] font-bold text-accent-gold uppercase tracking-wider block">
                        1x {product.category || (isAr ? "زيت طبيعي" : "Pure Oil")}
                      </span>
                      <h4 className="text-xs font-semibold text-primary-earth line-clamp-2 leading-snug">
                        {product.name}
                      </h4>
                    </div>
                  </div>

                  {formattedPrice && (
                    <div className="pt-1.5 border-t border-primary-earth/5 mt-1.5 flex items-center justify-between text-[10px] text-primary-earth/60">
                      <span>{isAr ? "السعر الفردي:" : "Single:"}</span>
                      <span className="font-mono font-medium line-through">{formattedPrice}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            ref={carouselRef}
            className="flex gap-2.5 sm:gap-3 overflow-x-auto pb-1 pt-0.5 scroll-smooth snap-x snap-mandatory no-scrollbar"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {productsList.map((product, pIdx) => {
              const rawPrice = product.price ? String(product.price).replace(/[^\d.]/g, "") : "";
              const formattedPrice = rawPrice ? `${Math.round(parseFloat(rawPrice))} DH` : "";

              return (
                <div
                  key={product.id || pIdx}
                  className="w-[140px] sm:w-[160px] shrink-0 snap-start bg-white rounded-xl border border-primary-earth/10 p-2.5 flex flex-col justify-between shadow-2xs hover:shadow-sm transition-shadow"
                >
                  <div className="space-y-1.5">
                    <div className="w-full aspect-square bg-[#0a0a0a] rounded-lg overflow-hidden flex items-center justify-center p-1.5 border border-primary-earth/5">
                      {product.image ? (
                        <img
                          src={getOptimizedImageUrl(product.image, "eco", 180) || product.image}
                          alt={product.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">
                          Bellaura
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-[9px] font-bold text-accent-gold uppercase tracking-wider block">
                        1x {product.category || (isAr ? "زيت طبيعي" : "Pure Oil")}
                      </span>
                      <h4 className="text-xs font-semibold text-primary-earth line-clamp-2 leading-snug">
                        {product.name}
                      </h4>
                    </div>
                  </div>

                  {formattedPrice && (
                    <div className="pt-1.5 border-t border-primary-earth/5 mt-1.5 flex items-center justify-between text-[10px] text-primary-earth/60">
                      <span>{isAr ? "السعر الفردي:" : "Single:"}</span>
                      <span className="font-mono font-medium line-through">{formattedPrice}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pack Bottom Pricing & CTA */}
      <div className="p-4 sm:p-5 border-t border-primary-earth/10 bg-white flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Pricing block */}
        <div className="space-y-0.5">
          <div className="text-[10px] font-bold text-primary-earth/50 uppercase tracking-wider">
            {isAr ? "السعر الترويجي الخاص باللايف" : isFr ? "Prix Promotionnel Live" : "Special Live Price"}
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-xl sm:text-2xl font-black text-accent-gold font-sans tracking-tight">
              {Math.round(pack.live_price)} DH
            </span>
            {pack.regular_price > pack.live_price && (
              <span className="text-xs sm:text-sm text-primary-earth/40 line-through font-sans">
                {Math.round(pack.regular_price)} DH
              </span>
            )}
            {discountAmount > 0 && (
              <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-md border border-green-200">
                {isAr ? `توفير ${Math.round(discountAmount)} DH` : `Save ${Math.round(discountAmount)} DH`}
              </span>
            )}
          </div>
        </div>

        {/* Add Pack to Cart CTA Button */}
        <button
          type="button"
          onClick={handleAddToCart}
          className={`px-6 py-2.5 sm:py-3 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
            added
              ? "bg-emerald-600 text-white shadow-emerald-600/30 ring-2 ring-emerald-500"
              : "bg-primary-earth hover:bg-accent-gold text-white shadow-primary-earth/20 hover:shadow-lg hover:-translate-y-0.5"
          }`}
        >
          {added ? (
            <>
              <Check className="w-4 h-4 text-white" />
              <span>{isAr ? "تمت إضافة الباقة للسلة!" : "Pack Added to Cart!"}</span>
            </>
          ) : (
            <>
              <ShoppingBag className="w-4 h-4" />
              <span>{isAr ? "أضف الباقة إلى السلة" : isFr ? "Ajouter le pack au panier" : "Add Pack to Cart"}</span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
