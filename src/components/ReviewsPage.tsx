import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star, ShieldCheck, Quote, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useProducts } from '../context/ProductContext';
import { getProductSlug } from '../types';
import { getOptimizedImageUrl } from '../lib/imageUtils';
import { usePaginatedReviews, ReviewItem } from '../lib/usePaginatedReviews';
import LoadMoreButton from './LoadMoreButton';

type Review = ReviewItem;

export default function ReviewsPage() {
  const { language, t } = useLanguage();
  const { products } = useProducts();
  // 20 at a time instead of every review in the shop on first paint.
  const { reviews, total, hasMore, isLoading, isLoadingMore, loadMore } = usePaginatedReviews();
  const [selectedReviewImage, setSelectedReviewImage] = useState<Review | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);

  const getProductLink = (productName: string): string => {
    if (!productName) return '#';
    const trimmed = productName.trim().toLowerCase();
    const found = products.find(p => 
      p.id?.toLowerCase() === trimmed ||
      p.name?.toLowerCase() === trimmed ||
      p.name_en?.toLowerCase() === trimmed ||
      (p as any).name_ar?.toLowerCase() === trimmed
    );
    if (found) {
      const slug = found.name_en ? getProductSlug(found.name_en) : getProductSlug(found.name);
      return `/product/${slug}`;
    }
    return `/product/${getProductSlug(productName)}`;
  };

  const getReviewImages = (review: Review): string[] => {
    if (!review.image) return [];
    try {
      const parsed = JSON.parse(review.image as string);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not a JSON string, must be a legacy single image URL
    }
    return [review.image as string];
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString(language === 'ar' ? 'ar-EG-u-nu-latn' : 'fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (e) {
      return '';
    }
  };

  const maskName = (name: string) => {
    if (!name) return "Anonymous";
    const parts = name.trim().split(' ');
    if (parts.length === 1) {
      if (name.length <= 2) return name + "***";
      return name.substring(0, 2) + "***";
    }
    return parts[0] + " " + parts[1].charAt(0) + "."; 
  };

  return (
    <div className="pt-32 pb-24 min-h-screen bg-background-soft">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl lg:text-5xl font-light text-primary-earth mb-4 uppercase tracking-widest"
          >
            {t('reviewsPage.title')}
          </motion.h1>
          <div className="w-16 h-px bg-accent-gold mx-auto mb-6" />
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-primary-earth/70 max-w-2xl mx-auto"
          >
            {t('reviewsPage.subtitle')}
          </motion.p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
            <p className="text-accent-gold font-medium animate-pulse text-sm">
              {language === "ar"
                ? "جاري تحميل التقييمات..."
                : language === "fr"
                  ? "Chargement des avis..."
                  : "Loading reviews..."}
            </p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-24 text-primary-earth/50">
            <p>{t('reviewsPage.noReviews')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {reviews.map((review, index) => (
              <motion.div
                key={review.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                // Staggered per page, not per list. `index * 0.1` over the whole
                // list meant the 30th card waited three seconds before fading in,
                // and each loaded page made it worse. Modulo the page size so the
                // stagger restarts for every batch.
                transition={{ delay: (index % 20) * 0.05 }}
                className="bg-white p-8 relative group border border-primary-earth/5 shadow-sm flex flex-col h-full"
              >
                <Quote className="absolute top-6 right-6 w-12 h-12 text-primary-earth/5 group-hover:text-primary-earth/10 transition-colors duration-500" />
                
                <div className="flex items-center gap-1 mb-4" dir="ltr">
                  {[...Array(5)].map((_, i) => (
                    <Star 
                      key={i} 
                      className={`w-4 h-4 ${i < review.rating ? 'fill-accent-gold text-accent-gold' : 'fill-transparent text-primary-earth/20'}`} 
                    />
                  ))}
                </div>

                {review.products && review.products.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1 text-[10px] uppercase tracking-widest text-primary-earth/60">
                    {review.products.map((prod, pIdx) => {
                      const link = getProductLink(prod);
                      return (
                        <span key={pIdx} className="inline-flex items-center">
                          <Link
                            to={link}
                            className="hover:text-accent-gold transition-colors underline decoration-primary-earth/20 underline-offset-2 hover:decoration-accent-gold"
                          >
                            {prod}
                          </Link>
                          {pIdx < review.products.length - 1 && (
                            <span className="text-primary-earth/30 mx-1">,</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="flex-grow overflow-y-auto overflow-x-hidden max-h-[220px] custom-scrollbar pr-2 mb-8">
                  <p className="text-primary-earth/80 font-light leading-relaxed italic break-words whitespace-pre-wrap">
                    "{review.comment}"
                  </p>
                  {review.adminReply && (
                    <div className="mt-4 bg-primary-earth/5 p-4 rounded-sm border-l-2 border-accent-gold">
                      <p className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/60 mb-1">
                        {t('reviewsPage.adminResponse')}
                      </p>
                      <p className="text-sm font-light text-primary-earth/90 whitespace-pre-wrap">
                        {review.adminReply}
                      </p>
                    </div>
                  )}
                </div>

                {getReviewImages(review).length > 0 && (
                  <div className="mb-6 rounded overflow-hidden shadow-sm">
                    <div className={`grid gap-2 ${getReviewImages(review).length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                      {getReviewImages(review).slice(0, 4).map((img, idx) => img && (
                        <div 
                          key={idx}
                          className="cursor-pointer overflow-hidden relative"
                          onClick={() => { setSelectedReviewImage(review); setSelectedImageIndex(idx); }}
                        >
                          <img 
                            src={getOptimizedImageUrl(img, 'eco', 600) || undefined} 
                            alt={`Review attachment ${idx + 1}`} 
                            loading="lazy"
                            decoding="async"
                            className="w-full h-32 md:h-48 object-cover hover:scale-105 transition-transform duration-700"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              if (e.currentTarget.parentElement) {
                                e.currentTarget.parentElement.style.display = 'none';
                              }
                            }}
                            referrerPolicy="no-referrer"
                          />
                          {getReviewImages(review).length > 4 && idx === 3 && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-bold text-xl">
                              +{getReviewImages(review).length - 4}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 mt-auto">
                  <div className="w-8 h-8 rounded-full bg-primary-earth flex items-center justify-center text-white text-xs font-bold">
                    {review.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-primary-earth">{maskName(review.name)}</p>
                    <div className="flex items-center flex-wrap gap-2 mt-1 text-[10px] uppercase tracking-widest">
                      <div className="flex items-center gap-1 text-accent-gold">
                        <ShieldCheck className="w-3 h-3" />
                        <span>{t('reviewsPage.verified')}</span>
                      </div>
                      {review.date && (
                        <span className="text-primary-earth/40 font-mono text-[9px] lowercase">
                          • {formatDate(review.date)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {reviews.length > 0 && (
          <LoadMoreButton
            onClick={loadMore}
            hasMore={hasMore}
            isLoading={isLoadingMore}
            loaded={reviews.length}
            total={total}
            className="mt-14"
          />
        )}
      </div>

      {selectedReviewImage && (
        <div 
          className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center p-4"
          onClick={() => setSelectedReviewImage(null)}
        >
          <button 
            className="absolute top-4 right-4 md:top-8 md:right-8 text-white/70 hover:text-white transition-colors"
            onClick={(e) => { e.stopPropagation(); setSelectedReviewImage(null); }}
          >
            <X className="w-8 h-8" />
          </button>
          <div 
            className="max-w-4xl w-full flex flex-col items-center justify-center pt-8 overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            {getReviewImages(selectedReviewImage).length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto max-w-full pb-2">
                {getReviewImages(selectedReviewImage).map((img, idx) => img && (
                  <img 
                    key={idx}
                    src={img || undefined}
                    alt={`Thumbnail ${idx + 1}`}
                    className={`w-16 h-16 object-cover cursor-pointer hover:opacity-100 transition-opacity rounded-sm ${idx === selectedImageIndex ? 'border-2 border-accent-gold opacity-100' : 'opacity-50'}`}
                    onClick={() => setSelectedImageIndex(idx)}
                    referrerPolicy="no-referrer"
                  />
                ))}
              </div>
            )}
            {getReviewImages(selectedReviewImage)[selectedImageIndex] && (
              <img referrerPolicy="no-referrer" 
                src={getOptimizedImageUrl(getReviewImages(selectedReviewImage)[selectedImageIndex], 'full') || undefined} 
                alt="Review full size" 
                className="max-w-full max-h-[60vh] object-contain rounded-md shadow-2xl mb-6" 
              />
            )}
            <div className="bg-white/10 backdrop-blur-sm p-6 rounded-lg text-white max-w-2xl w-full shadow-lg">
              <div className="flex space-x-1 mb-4 justify-center">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className={`w-4 h-4 ${i < selectedReviewImage.rating ? 'fill-accent-gold text-accent-gold' : 'text-white/20'}`} />
                ))}
              </div>
              <p className="text-white/90 text-center text-lg italic leading-relaxed whitespace-pre-wrap break-words">
                "{selectedReviewImage.comment}"
              </p>
              <div className="text-center mt-4">
                <span className="font-bold tracking-widest text-sm text-accent-gold uppercase">{maskName(selectedReviewImage.name)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
