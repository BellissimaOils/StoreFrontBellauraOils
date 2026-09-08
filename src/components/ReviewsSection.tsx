import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Star, ShieldCheck, Quote, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { getOptimizedImageUrl } from '../lib/imageUtils';
import { usePaginatedReviews, ReviewItem } from '../lib/usePaginatedReviews';
import LoadMoreButton from './LoadMoreButton';

type Review = ReviewItem;

export default function ReviewsSection() {
  const { language } = useLanguage();
  // 20 at a time instead of every review in the shop on first paint.
  const { reviews, total, hasMore, isLoading, isLoadingMore, loadMore } = usePaginatedReviews();
  const [selectedReviewImage, setSelectedReviewImage] = useState<Review | null>(null);

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

  if (isLoading) {
    return (
      <section className="py-24 bg-white overflow-hidden relative min-h-[400px] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
      </section>
    );
  }

  if (reviews.length === 0) {
    return (
      <section className="py-24 bg-white overflow-hidden relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl lg:text-5xl font-light text-primary-earth mb-4">Verified Voices</h2>
          <div className="w-16 h-px bg-accent-gold mx-auto mb-8" />
          <div className="bg-background-soft p-12 max-w-2xl mx-auto text-center border border-primary-earth/10">
            <Quote className="w-12 h-12 text-primary-earth/10 mx-auto mb-4" />
            <p className="text-primary-earth/60 font-light italic text-lg mb-2">
              {language === 'ar' ? 'كن أول من يشاركنا تجربته!' : language === 'fr' ? 'Soyez le premier à partager votre expérience !' : 'Be the first to share your experience!'}
            </p>
            <p className="text-primary-earth/40 text-sm">
              {language === 'ar' ? 'آراء عملائنا تهمنا وتساعدنا على تقديم الأفضل دائماً.' : language === 'fr' ? 'Les avis de nos clients comptent beaucoup pour nous.' : 'Our customers\' feedback means everything to us.'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-24 bg-white overflow-hidden relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-light text-primary-earth mb-4">Verified Voices</h2>
          <div className="w-16 h-px bg-accent-gold mx-auto" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {reviews.map((review, index) => (
            <motion.div
              key={review.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              // Per-page stagger — see ReviewsPage: `index * 0.1` across the
              // whole list delayed later cards by several seconds.
              transition={{ delay: (index % 20) * 0.05 }}
              className="bg-background-soft p-8 relative group flex flex-col h-full"
            >
              <Quote className="absolute top-6 right-6 w-12 h-12 text-primary-earth/5 group-hover:text-primary-earth/10 transition-colors duration-500" />
              
              <div className="flex items-center gap-1 mb-6" dir="ltr">
                {[...Array(5)].map((_, i) => (
                  <Star 
                    key={i} 
                    className={`w-4 h-4 ${i < review.rating ? 'fill-accent-gold text-accent-gold' : 'fill-transparent text-primary-earth/20'}`} 
                  />
                ))}
              </div>

              <div className="flex-grow overflow-y-auto overflow-x-hidden max-h-[220px] custom-scrollbar pr-2 mb-8">
                <p className="text-primary-earth/80 font-light leading-relaxed italic break-words whitespace-pre-wrap">
                  "{review.comment}"
                </p>
                {review.adminReply && (
                  <div className="mt-4 bg-primary-earth/5 p-4 rounded-sm border-l-2 border-accent-gold">
                    <p className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/60 mb-1">
                      {language === 'ar' ? 'رد الإدارة' : language === 'fr' ? 'Réponse de Bellaura' : 'Response from Bellaura'}
                    </p>
                    <p className="text-sm font-light text-primary-earth/90 whitespace-pre-wrap">
                      {review.adminReply}
                    </p>
                  </div>
                )}
              </div>

              {review.image && (
                <div 
                  className="mb-6 rounded overflow-hidden shadow-sm cursor-pointer"
                  onClick={() => setSelectedReviewImage(review)}
                >
                  <img 
                    src={getOptimizedImageUrl(review.image, 'eco', 600) || undefined} 
                    alt="Review attachment" 
                    loading="lazy"
                    decoding="async"
                    className="w-full h-48 object-cover hover:scale-105 transition-transform duration-700"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      if (e.currentTarget.parentElement) {
                        e.currentTarget.parentElement.style.display = 'none';
                      }
                    }}
                    referrerPolicy="no-referrer"
                  />
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
                      <span>Verified Buyer</span>
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

        <LoadMoreButton
          onClick={loadMore}
          hasMore={hasMore}
          isLoading={isLoadingMore}
          loaded={reviews.length}
          total={total}
          className="mt-14"
        />
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
            <img referrerPolicy="no-referrer" 
              src={getOptimizedImageUrl(selectedReviewImage.image, 'full') || undefined} 
              alt="Review full size" 
              className="max-w-full max-h-[70vh] object-contain rounded-md shadow-2xl mb-6" 
            />
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
    </section>
  );
}
