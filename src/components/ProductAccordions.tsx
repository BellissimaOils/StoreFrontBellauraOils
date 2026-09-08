import React, { useState, useEffect } from 'react';
import StarRating from "./StarRating";
import { Info, Leaf, Droplets, Heart, ChevronUp, ChevronDown, ShieldCheck, Star } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { parseBenefitsList } from '../types';
import LoadMoreButton from './LoadMoreButton';

export default function ProductAccordions({
  displayProduct,
  product,
  productReviews,
  loadingReviews,
  handleReviewImageClick,
  totalReviews = 0,
  hasMoreReviews = false,
  loadingMoreReviews = false,
  onLoadMoreReviews,
  ratingFilter = null,
  onRatingFilterChange,
}: any) {
  const { t, language } = useLanguage();
  const [openSection, setOpenSection] = useState<string | null>('desc');
  // Transition is intentionally deferred until after the first render.
  // On initial mount every closed panel would otherwise animate from
  // max-h-[9999px] → max-h-0, producing the "shows then disappears" flash.
  // Once mounted, user-driven toggles animate normally.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Reviews arrive already filtered by product AND by rating, and already
  // windowed to one page, so there is no local slicing left to do. Previously
  // this component held its own `ratingFilter` and a `visibleCount` of 5 and
  // applied both to whatever the parent had loaded — which only worked because
  // the parent had downloaded every review in the shop. With paged loading, a
  // client-side rating filter would silently hide matching reviews still sitting
  // on a later page, so the filter is owned by the parent and sent to the server.
  const displayedReviews = productReviews || [];

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section);
  };

  // Uses the shared parser from ../types instead of a local copy. Besides
  // de-duplicating, this adds handling for benefits stored as a JSON-array
  // string, which the local version silently returned as a single blob.
  const getBenefitsList = parseBenefitsList;

  /**
   * Splits an admin-entered block of text into one entry per line.
   *
   * Benefits already rendered as a marked list, one item per line, which is far
   * easier to scan than a paragraph — this applies the same treatment to "how
   * to use" and "ingredients", which were rendered as one undifferentiated
   * whitespace-preserved blob.
   *
   * Blank lines are dropped, and a leading bullet the admin typed themselves
   * ("- ", "• ", "1. ") is stripped so it isn't shown twice next to the marker
   * this component adds.
   */
  const toDisplayLines = (value: any): string[] =>
    String(value ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-–—*•·]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);

  // Average and count for the reviews header, taken from the SAME source the
  // product title and the cards use: the ratings summary carried on the product.
  //
  // It used to prefer `totalReviews` (the row count from GET /reviews), which is
  // built from a different reference set and counts reviews the summary skips —
  // so the header and the rating under the title could show two different
  // numbers for the same product. `totalReviews` is kept only as the fallback
  // for when the summary hasn't arrived.
  const ratingValue = Number(displayProduct?.rating ?? product?.rating) || 0;
  const summaryCount = Number(displayProduct?.reviews ?? product?.reviews) || 0;
  const reviewCount = summaryCount > 0 ? summaryCount : Number(totalReviews) || 0;
  
  const maskName = (name: string) => {
    if (!name || typeof name !== 'string') return "Client(e)";
    const parts = name.split(' ');
    if (parts.length > 1) {
      return `${parts[0]} ${parts[1][0]}.`;
    }
    return name;
  };
  
  const parseReviewImages = (imgStr: any) => {
    if (!imgStr) return [];
    if (Array.isArray(imgStr)) return imgStr;
    if (typeof imgStr === 'string') {
      const trimmed = imgStr.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          return JSON.parse(trimmed);
        } catch (e) {
          return [imgStr];
        }
      }
      return imgStr.split(',').map((url: string) => url.trim()).filter((url: string) => url.length > 0);
    }
    return [];
  };
  
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(language === 'ar' ? 'ar-MA' : language === 'fr' ? 'fr-FR' : 'en-GB', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // CSS-only accordion — keeps the DOM stable so there is no mount/unmount
  // race that shows both sections simultaneously.
  //
  // The old code used `{openSection === 'x' && <Content />}` which mounts and
  // unmounts the content on every toggle. During the brief window where React
  // is removing one child and adding another in the same commit, and the parent
  // `transition-all duration-300` is still running, both panels can be visible
  // at the same time.
  //
  // Switching to max-h transitions keeps every panel's DOM node alive at all
  // times. Only `max-height` and `opacity` change, which the GPU handles in a
  // single, flicker-free animation — no double-visibility possible.
  const panelClass = (section: string) =>
    `overflow-hidden ${mounted ? 'transition-[max-height,opacity] duration-300 ease-in-out' : ''} ${
      openSection === section
        ? 'max-h-[9999px] opacity-100'
        : 'max-h-0 opacity-0'
    }`;

  return (
    <div className="mt-10 space-y-3.5 border-t border-gray-200 pt-10">
      {displayProduct?.showBenefits !== false && getBenefitsList(displayProduct?.benefits || product.benefits).length > 0 && (
        <div className="border border-gray-150 rounded-xl bg-white overflow-hidden">
          <button 
            onClick={() => toggleSection('desc')}
            className="w-full px-5 py-4.5 flex items-center justify-between text-left rtl:text-right font-black uppercase tracking-widest text-xs text-gray-900 hover:bg-gray-50 cursor-pointer"
          >
            <span className="flex items-center gap-2"><Info className="w-4.5 h-4.5 text-accent-gold" /> {t('products.benefitsTitle')}</span>
            {openSection === 'desc' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          <div className={panelClass('desc')}>
            <div className="px-5 pb-5 pt-1 text-gray-600 text-sm border-t border-gray-50">
              <ul className="space-y-2.5">
                {getBenefitsList(displayProduct?.benefits || product.benefits).map((benefit, i) => (
                  <li key={i} className="flex items-start gap-2.5 leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-green-50 text-green-700 border border-green-200 flex items-center justify-center flex-shrink-0 text-[10.5px] font-bold mt-0.5">✓</span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {displayProduct?.showUsage !== false && Boolean(displayProduct?.usage || product.usage) && (
        <div className="border border-gray-150 rounded-xl bg-white overflow-hidden">
          <button 
            onClick={() => toggleSection('usage')}
            className="w-full px-5 py-4.5 flex items-center justify-between text-left rtl:text-right font-black uppercase tracking-widest text-xs text-gray-900 hover:bg-gray-50 cursor-pointer"
          >
            <span className="flex items-center gap-2"><Leaf className="w-4.5 h-4.5 text-accent-gold" /> {language === 'ar' ? 'طريقة الاستخدام وتوجيهات التطبيق' : 'Applicazione - How to Use'}</span>
            {openSection === 'usage' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          <div className={panelClass('usage')}>
            <div className="px-5 pb-5 pt-2 text-gray-600 text-sm leading-relaxed border-t border-gray-50">
              {/* Numbered, because "how to use" is a sequence — but only when
                  more than one line was written. Numbering a single paragraph
                  "1." would look like a mistake, so that case stays prose. */}
              {toDisplayLines(displayProduct?.usage || product.usage).length > 1 ? (
                <ol className="space-y-2.5">
                  {toDisplayLines(displayProduct?.usage || product.usage).map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="w-4 h-4 rounded-full bg-accent-gold/15 text-accent-gold border border-accent-gold/40 flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="whitespace-pre-wrap">{displayProduct?.usage || product.usage}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {displayProduct?.showIngredients !== false && Boolean(displayProduct?.ingredients || product.ingredients) && (
        <div className="border border-gray-150 rounded-xl bg-white overflow-hidden">
          <button 
            onClick={() => toggleSection('ingredients')}
            className="w-full px-5 py-4.5 flex items-center justify-between text-left rtl:text-right font-black uppercase tracking-widest text-xs text-gray-900 hover:bg-gray-50 cursor-pointer"
          >
            <span className="flex items-center gap-2"><Droplets className="w-4.5 h-4.5 text-accent-gold" /> {language === 'ar' ? 'المكونات والتركيب المخبري' : 'Inci / Ingredients'}</span>
            {openSection === 'ingredients' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          <div className={panelClass('ingredients')}>
            <div className="px-5 pb-5 pt-2 text-gray-600 text-sm leading-relaxed border-t border-gray-50">
              {/* A droplet marker per line, matching the benefits list. Single
                  paragraph INCI lists (one long comma-separated line) keep the
                  monospaced treatment, since marking one line adds nothing. */}
              {toDisplayLines(displayProduct?.ingredients || product.ingredients).length > 1 ? (
                <ul className="space-y-2.5">
                  {toDisplayLines(displayProduct?.ingredients || product.ingredients).map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 leading-relaxed">
                      <span className="w-4 h-4 rounded-full bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Droplets className="w-2.5 h-2.5" />
                      </span>
                      <span className="font-mono text-[12.5px] tracking-wide">{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="whitespace-pre-wrap font-mono text-[12.5px] tracking-wide">
                  {displayProduct?.ingredients || product.ingredients}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="border border-gray-150 rounded-xl bg-white overflow-hidden">
        <button 
          onClick={() => toggleSection('reviews')}
          className="w-full px-5 py-4.5 flex items-center justify-between text-left rtl:text-right font-black uppercase tracking-widest text-xs text-gray-900 hover:bg-gray-50 cursor-pointer"
        >
          <span className="flex items-center gap-2 flex-wrap">
            <Heart className="w-4.5 h-4.5 text-accent-gold" />
            {language === 'ar' ? 'آراء وتجارب العملاء المؤكدة' : 'Recensioni - Verified Customer Feedback'}
            {/* The score and the count, on the closed header — previously you
                had to open the section and count the cards to know either. */}
            {reviewCount > 0 && (
              <span className="flex items-center gap-1.5 normal-case tracking-normal">
                {/* Shared component, so a 4.5 shows a half star here exactly as
                    it does on the cards instead of rounding to a whole one. */}
                <StarRating
                  value={ratingValue}
                  count={reviewCount}
                  size="sm"
                  showValue
                  className="text-accent-gold"
                />
                <span className="text-[11px] font-normal text-gray-500">
                  {language === 'ar'
                    ? `(${reviewCount} تقييم)`
                    : language === 'fr'
                      ? `(${reviewCount} avis)`
                      : `(${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'})`}
                </span>
              </span>
            )}
          </span>
          {openSection === 'reviews' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        <div className={panelClass('reviews')}>
          <div className="px-5 pb-5 pt-3 text-gray-600 text-sm border-t border-gray-50 space-y-4 max-h-[380px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200 hover:scrollbar-thumb-gray-300 scrollbar-track-transparent">
            {loadingReviews ? (
              <div className="flex justify-center items-center py-4">
                <div className="w-5 h-5 rounded-full border-2 border-accent-gold border-t-transparent animate-spin" />
              </div>
            ) : displayedReviews.length > 0 || ratingFilter !== null ? (
              /*
                `|| ratingFilter !== null` keeps this branch — and with it the
                rating dropdown — on screen when a filter matches nothing. The
                list is filtered server-side now, so without it a "3 stars"
                selection with no matches would fall through to the "no reviews
                for this product" panel, taking the dropdown with it and leaving
                no way to clear the filter.
              */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <p className="text-[11px] text-[#2c5836] font-bold bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg inline-block m-0">
                    {language === 'ar' 
                      ? '✓ يعرض المراجعات المؤكدة الخاصة بهذا المنتج فقط' 
                      : '✓ Showing verified purchase reviews for this product only'}
                  </p>
                  <div className="flex items-center justify-end">
                    <div className="relative inline-block">
                      <select
                        value={ratingFilter === null ? "all" : ratingFilter}
                        onChange={(e) => {
                          const val = e.target.value;
                          onRatingFilterChange?.(val === "all" ? null : Number(val));
                        }}
                        className="appearance-none bg-gray-50 border border-gray-200 text-gray-700 text-[10px] sm:text-xs font-bold py-1.5 pl-3 pr-8 rounded-full shadow-sm focus:outline-none focus:ring-1 focus:ring-accent-gold cursor-pointer"
                      >
                        <option value="all">{language === 'ar' ? 'جميع التقييمات' : 'All Reviews'}</option>
                        <option value="5">5 {language === 'ar' ? 'نجوم' : 'Stars'}</option>
                        <option value="4">4 {language === 'ar' ? 'نجوم' : 'Stars'}</option>
                        <option value="3">3 {language === 'ar' ? 'نجوم' : 'Stars'}</option>
                        <option value="2">2 {language === 'ar' ? 'نجوم' : 'Stars'}</option>
                        <option value="1">1 {language === 'ar' ? 'نجمة' : 'Star'}</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                        <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                      </div>
                    </div>
                  </div>
                </div>
                {displayedReviews.length === 0 && (
                  <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl text-center space-y-2.5">
                    <p className="text-xs text-gray-600 font-semibold">
                      {language === 'ar'
                        ? 'لا توجد مراجعات بهذا التقييم لهذا المنتج.'
                        : language === 'fr'
                          ? 'Aucun avis avec cette note pour ce produit.'
                          : 'No reviews with this rating for this product.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => onRatingFilterChange?.(null)}
                      className="text-[11px] font-bold text-accent-gold hover:underline cursor-pointer"
                    >
                      {language === 'ar'
                        ? 'عرض جميع التقييمات'
                        : language === 'fr'
                          ? 'Afficher tous les avis'
                          : 'Show all ratings'}
                    </button>
                  </div>
                )}
                {displayedReviews.map((review: any) => {
                  const reviewImages = parseReviewImages(review.image);
                  return (
                    <div key={review.id} className="bg-gray-50/70 p-4 rounded-xl border border-black/[0.02]">
                      <div className="flex flex-wrap justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-800 text-xs">{maskName(review.name)}</span>
                          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200">
                            <ShieldCheck className="w-3 h-3 stroke-[2.5]" />
                            {language === 'ar' ? 'شراء مؤكد' : language === 'fr' ? 'Achat vérifié' : 'Verified Purchase'}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">{formatDate(review.date)}</span>
                      </div>
                      
                      <div className="flex items-center gap-0.5 mt-2.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star 
                            key={i} 
                            className={`w-3.5 h-3.5 ${i < Math.round(Number(review.rating) || 5) ? 'fill-accent-gold text-accent-gold' : 'fill-gray-200 text-gray-200'}`} 
                          />
                        ))}
                      </div>
                        
                      <p className="italic text-gray-700 leading-relaxed font-sans text-xs mt-2.5 break-words whitespace-pre-wrap">
                        « {review.comment} »
                      </p>

                      {reviewImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {reviewImages.map((imgUrl: string, imgIndex: number) => (
                            <img 
                              key={imgIndex}
                              src={imgUrl || undefined}
                              alt="Customer efficacy proof"
                              loading="lazy"
                              decoding="async"
                              className="w-14 h-14 object-cover border border-gray-200 rounded-lg shadow-sm hover:scale-105 active:scale-95 duration-200 transition-transform cursor-pointer bg-white"
                              onClick={() => handleReviewImageClick(imgUrl)}
                              referrerPolicy="no-referrer"
                            />
                          ))}
                        </div>
                      )}
                        
                      {review.adminReply && (
                        <div className="mt-3 bg-white p-3 rounded-lg border border-gray-100 text-[11px] text-gray-600">
                          <p className="font-bold text-gray-700 mb-1">{language === 'ar' ? 'رد الإدارة:' : 'Admin Reply:'}</p>
                          <p className="italic">« {review.adminReply} »</p>
                        </div>
                      )}
                    </div>
                  );
                })}
                <LoadMoreButton
                  onClick={() => onLoadMoreReviews?.()}
                  hasMore={hasMoreReviews}
                  isLoading={loadingMoreReviews}
                  loaded={displayedReviews.length}
                  total={totalReviews}
                  variant="subtle"
                  className="pt-2"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-amber-50/40 border border-amber-500/10 rounded-xl text-center space-y-2">
                  <p className="text-xs text-amber-900 font-semibold leading-relaxed">
                    {language === 'ar' 
                      ? 'لا توجد آراء مؤكدة لهذا المنتج بالتحديد حتى الآن.' 
                      : 'No verified purchase reviews left for this specific bottle yet.'}
                  </p>
                  <p className="text-[11.5px] text-gray-500 leading-relaxed font-light">
                    {language === 'ar' 
                      ? 'فقط العملاء الذين أتموا الشراء بالفعل يتلقون رمزاً آمناً لكتابة المراجعات لضمان المصداقية المطلقة.' 
                      : 'Only clients with a real purchase token can submit reviews to prevent counterfeit feedback.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
