import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star, CheckCircle, ShieldCheck, Upload, X, MessageCircleQuestion, Check } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useProducts } from '../context/ProductContext';
import toast from 'react-hot-toast';
import { compressImage } from '../lib/imageUtils';
import { buildReviewTargets, type ReviewTarget } from '../lib/reviewTargets';

/**
 * The general review link — one fixed, shareable URL (unlike /review/:token,
 * which is single-use and tied to a specific order). Meant for customers who
 * bought before the website existed and never received an order-linked
 * review link, so they pick which product(s) they bought themselves instead
 * of the link already knowing.
 *
 * `storeSettings.generalReviewLinkEnabled` gates this on the client purely so
 * a disabled link shows a clear message instead of a broken form — the real
 * enforcement is server-side in POST /api/reviews/general, which refuses the
 * same way regardless of what this page renders. Flipping the admin toggle
 * off makes the link stop working even if someone already has the form open.
 */
export default function GeneralReviewPage() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { products, storeSettings, loading: productsLoading } = useProducts();
  const isAr = language === 'ar';
  const isRtl = isAr;
  const isFr = language === 'fr';

  const enabled = storeSettings?.generalReviewLinkEnabled === true;

  // `generalReviewProducts` is the admin's allow-list from Settings. `undefined`
  // means it was never touched — same as "all products" — so a store that
  // hasn't opened that section yet keeps behaving the way this page always
  // did. Once the admin has an explicit array (including an empty one), only
  // those names are offered here; the server independently re-checks the same
  // list on submit, so this can't be bypassed by editing the request.
  // All products are shown regardless of stock status — a customer who bought
  // sesame oil when it was in stock should still be able to review it now that
  // it is out of stock. The server independently validates the submitted names.
  const allProductNames = products
    .filter((p: any) => p && (p as any).in_catalog !== 0)
    .map((p: any) => p.name)
    .filter(Boolean);
  const allowedProducts: string[] | undefined = storeSettings?.generalReviewProducts;
  const AVAILABLE_PRODUCTS = Array.isArray(allowedProducts)
    ? allProductNames.filter((name: string) => allowedProducts.includes(name))
    : allProductNames;

  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [otherProductNote, setOtherProductNote] = useState('');
  // One comment per product, keyed by ReviewTarget.key, plus one for the
  // free-text "something else" note.
  const [targetComments, setTargetComments] = useState<Record<string, string>>({});
  const [otherProductComment, setOtherProductComment] = useState('');
  // A rating per product (and one for the "something else" note). A pack and the
  // products inside it are rated independently.
  const [targetRatings, setTargetRatings] = useState<Record<string, number>>({});
  const [hoveredTargetRating, setHoveredTargetRating] = useState<Record<string, number>>({});
  const [otherProductRating, setOtherProductRating] = useState(5);
  const [rating, setRating] = useState(5);
  const [name, setName] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // What the customer is actually reviewing.
  //
  // Selecting a pack means reviewing the products inside it, and picking a pack
  // plus one of the products it contains must not ask about that product twice
  // — the de-duplication is by product id, which is what pack membership is
  // stored as. The server recomputes this identically from the same helper when
  // the form is submitted, so the browser's copy is only ever about rendering.
  const reviewTargets = useMemo(
    () => buildReviewTargets(selectedProducts.map((n: string) => ({ name: n })), products as any[]),
    [selectedProducts, products],
  );
  const hasAnyProductComment = reviewTargets.some(
    (target: ReviewTarget) =>
      (targetComments[target.key] || '').trim().length > 0 ||
      (targetRatings[target.key] || 0) > 0,
  );
  const hasOtherComment = otherProductNote.trim().length > 0 && otherProductComment.trim().length > 0;
  // Every box joined into one string, labelled per product. Only used as the
  // fallback `comment` for a server that doesn't split reviews per product.
  const combinedComment = [
    ...reviewTargets
      .map((target: ReviewTarget) => {
        const text = (targetComments[target.key] || '').trim();
        return text ? `${target.name}: ${text}` : '';
      })
      .filter(Boolean),
    otherProductComment.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

  const toggleProduct = (name: string) => {
    setSelectedProducts((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
  };

  const handleImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      if (images.length + files.length > 5) {
        toast.error(
          isAr
            ? 'يمكنك تحميل 5 صور كحد أقصى'
            : isFr
              ? 'Vous pouvez téléverser 5 images au maximum'
              : 'You can upload a maximum of 5 images',
        );
        return;
      }
      const newImages: string[] = [];
      for (const file of Array.from(files as Iterable<File>)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(
            isAr
              ? 'يجب أن يكون حجم كل صورة أقل من 10 ميغابايت'
              : isFr
                ? 'Chaque image doit peser moins de 10 Mo'
                : 'Each image must be smaller than 10MB',
          );
          continue;
        }
        try {
          const compressed = await compressImage(file, 800, 800, 0.6);
          newImages.push(compressed);
        } catch (err) {
          console.warn('Failed to compress image, using fallback', err);
          const raw = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          newImages.push(raw);
        }
      }
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedProducts.length === 0 && !otherProductNote.trim()) {
      toast.error(
        isAr
          ? 'يرجى تحديد منتج واحد على الأقل أو وصف ما اشتريته'
          : isFr
            ? 'Veuillez sélectionner au moins un produit ou décrire votre achat'
            : 'Please select at least one product, or describe what you bought',
      );
      return;
    }
    if (!hasAnyProductComment && !hasOtherComment) {
      toast.error(
        isAr
          ? 'يرجى تقييم منتج واحد على الأقل أو كتابة رأيك عنه'
          : isFr
            ? 'Veuillez noter au moins un produit ou rédiger un avis'
            : 'Please rate at least one product, or write a review for it',
      );
      return;
    }

    setIsSubmitting(true);
    setStatus('idle');
    setErrorMessage('');

    try {
      const response = await fetch('/api/reviews/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Anonymous',
          rating,
          images,
          products: selectedProducts,
          otherProductNote: otherProductNote.trim(),
          // Still sent, and still meaningful on its own: a server build that
          // doesn't understand productReviews yet (or the offline mock) reads
          // only this field, and rejects the submission without it. The current
          // server ignores it whenever productReviews is present.
          comment: combinedComment,
          // One review per product. The server re-derives the same list from
          // the selected products and ignores anything here that isn't on it.
          productReviews: reviewTargets
            .map((target: ReviewTarget) => ({
              productId: target.id,
              productName: target.name,
              comment: (targetComments[target.key] || '').trim(),
              // 0 = not rated; the stars start empty so an untouched product is
              // not given a five-star review nobody chose.
              rating: targetRatings[target.key] || 0,
            }))
            // Stars on their own are a review worth keeping.
            .filter(
              (entry: { comment: string; rating: number }) =>
                entry.comment.length > 0 || entry.rating > 0,
            ),
          otherProductComment: otherProductComment.trim(),
          otherProductRating,
        }),
      });

      const data = await response.json();

      if (data.success) {
        window.scrollTo(0, 0);
        setStatus('success');
      } else if (response.status === 404) {
        // The admin disabled the link between page load and submit — treat it
        // exactly like the disabled-state panel below rather than a generic error.
        setStatus('error');
        setErrorMessage(
          isAr
            ? 'هذا الرابط غير متاح حالياً.'
            : isFr
              ? "Ce lien n'est actuellement pas disponible."
              : 'This review link is not currently available.',
        );
      } else {
        setStatus('error');
        // Not `data.message`: the API replies in English only, so relaying it
        // showed an English error to a customer reading Arabic or French.
        setErrorMessage(
          isAr
            ? 'تعذر إرسال التقييم. حاول مرة أخرى.'
            : isFr
              ? "Échec de l'envoi de l'avis. Veuillez réessayer."
              : 'Failed to submit review. Please try again.',
        );
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        isAr
          ? 'حدث خطأ في الشبكة. حاول مرة أخرى.'
          : isFr
            ? 'Une erreur réseau est survenue. Veuillez réessayer.'
            : 'Network error occurred. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (productsLoading) {
    return (
      <div className="min-h-screen bg-background-soft flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Disabled state — the admin has switched the link off. Server-side,
  // POST /reviews/general refuses independently of this, so a customer who
  // already had the form open when it was toggled off still can't submit.
  if (!enabled) {
    return (
      <div className="min-h-screen bg-background-soft pt-32 pb-24 flex items-center justify-center px-4" dir={isRtl ? 'rtl' : 'ltr'}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-12 max-w-lg w-full text-center shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <MessageCircleQuestion className="w-16 h-16 text-primary-earth/20" />
          </div>
          <h1 className="text-2xl font-light text-primary-earth mb-4">
            {isAr ? 'هذا الرابط غير متاح حالياً' : isFr ? "Ce lien n'est pas disponible" : 'This link is not available'}
          </h1>
          <p className="text-primary-earth/70 mb-8 leading-relaxed">
            {isAr
              ? 'يرجى التواصل معنا مباشرة إذا كنت ترغب في مشاركة رأيك.'
              : isFr
                ? 'Veuillez nous contacter directement si vous souhaitez partager votre avis.'
                : 'Please contact us directly if you would like to share your feedback.'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="bg-primary-earth text-white px-8 py-4 text-sm font-bold uppercase tracking-widest hover:bg-accent-gold transition-colors duration-300"
          >
            {isAr ? 'العودة للمتجر' : isFr ? 'Retour à la boutique' : 'Return to Store'}
          </button>
        </motion.div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-background-soft pt-32 pb-24 flex items-center justify-center px-4" dir={isRtl ? 'rtl' : 'ltr'}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-12 max-w-lg w-full text-center shadow-2xl"
        >
          <div className="flex justify-center mb-6">
            <CheckCircle className="w-16 h-16 text-green-600" />
          </div>
          <h1 className="text-3xl font-light text-primary-earth mb-4">
            {isAr ? 'شكراً لك' : isFr ? 'Merci' : 'Thank You'}
          </h1>
          <p className="text-primary-earth/70 mb-8 leading-relaxed">
            {isAr
              ? 'تم استلام رأيك بنجاح. نقدر ثقتك ودعمك لنا.'
              : isFr
                ? 'Votre avis a été reçu avec succès. Nous vous remercions pour votre confiance.'
                : 'Your review has been received. We truly appreciate your feedback and support.'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="bg-primary-earth text-white px-8 py-4 text-sm font-bold uppercase tracking-widest hover:bg-accent-gold transition-colors duration-300"
          >
            {isAr ? 'العودة للمتجر' : isFr ? 'Retour à la boutique' : 'Return to Store'}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-soft pt-32 pb-24 px-4" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 md:p-12 shadow-xl relative"
        >
          <div className="absolute top-0 right-0 bg-accent-gold text-primary-earth text-[10px] uppercase font-bold tracking-[0.2em] px-4 py-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            {isAr ? 'عميل موثوق' : isFr ? 'Client de confiance' : 'Trusted Customer'}
          </div>

          <div className="text-center mb-10 mt-4">
            <h1 className="text-3xl md:text-4xl font-light text-primary-earth mb-4">
              {isAr ? 'شاركنا تجربتك' : isFr ? 'Partagez votre expérience' : 'Rate Your Experience'}
            </h1>
            <p className="text-primary-earth/60 font-light">
              {isAr
                ? 'إذا كنت من عملائنا السابقين، أخبرنا برأيك في المنتج الذي جربته.'
                : isFr
                  ? 'Si vous êtes déjà client, dites-nous ce que vous avez pensé du ou des produits essayés.'
                  : "If you're a past customer, tell us what you thought of the product(s) you tried."}
            </p>
          </div>

          {status === 'error' && errorMessage ? (
            <div className="bg-red-50 text-red-800 p-4 mb-8 text-sm text-center border border-red-200">
              {errorMessage}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Product picker — all products shown as tappable pills.
                  No search bar, no dropdown: the customer sees everything at
                  once and just taps what they bought. Out-of-stock products
                  are included so past buyers can still leave a review. */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-primary-earth/80 mb-3">
                  {isAr
                    ? `ما هي المنتجات التي جربتها؟${selectedProducts.length > 0 ? ` (${selectedProducts.length} محدد)` : ''}`
                    : isFr
                      ? `Quel(s) produit(s) avez-vous essayé(s) ?${selectedProducts.length > 0 ? ` (${selectedProducts.length} sélectionné(s))` : ''}`
                      : `Which product(s) did you try?${selectedProducts.length > 0 ? ` (${selectedProducts.length} selected)` : ''}`}
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_PRODUCTS.length === 0 ? (
                    <p className="text-xs text-primary-earth/50 py-2">
                      {isAr ? 'لا توجد منتجات متاحة حالياً' : isFr ? 'Aucun produit disponible' : 'No products available'}
                    </p>
                  ) : (
                    AVAILABLE_PRODUCTS.map((p: string) => {
                      const isSelected = selectedProducts.includes(p);
                      return (
                        <button
                          type="button"
                          key={p}
                          onClick={() => toggleProduct(p)}
                          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all duration-150 ${
                            isSelected
                              ? 'bg-primary-earth text-white border-primary-earth shadow-sm'
                              : 'bg-white text-primary-earth/70 border-primary-earth/20 hover:border-primary-earth/50 hover:text-primary-earth'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                          {p}
                        </button>
                      );
                    })
                  )}
                </div>
                <input
                  type="text"
                  value={otherProductNote}
                  onChange={(e) => setOtherProductNote(e.target.value)}
                  placeholder={
                    isAr
                      ? 'منتج آخر أو تفاصيل إضافية (اختياري)'
                      : isFr
                        ? 'Autre produit ou précisions (facultatif)'
                        : 'Something else, or extra details (optional)'
                  }
                  className="w-full border-b border-primary-earth/30 py-3 mt-4 bg-transparent focus:border-accent-gold focus:outline-none transition-colors duration-300 font-light placeholder:text-primary-earth/30 text-sm"
                />
              </div>

              {/* No shared rating block here.
                  
                  Every box on this page carries its own stars, and the only
                  state in which a single overall rating could have applied is
                  the one where nothing is selected — which has no review to rate
                  at all, and where the per-product default would have overridden
                  it anyway. `rating` is still sent in the payload as the
                  fallback an older server build reads. */}

              <div className="space-y-6 pt-6 border-t border-primary-earth/10">
                <div>
                  <label htmlFor="name" className="block text-xs font-bold uppercase tracking-widest text-primary-earth/80 mb-2">
                    {isAr ? 'الاسم المعروض (اختياري)' : isFr ? "Nom d'affichage (facultatif)" : 'Display Name (Optional)'}
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={isAr ? 'كيف تريد أن يظهر اسمك' : "How you'd like to appear"}
                    className="w-full border-b border-primary-earth/30 py-3 bg-transparent focus:border-accent-gold focus:outline-none transition-colors duration-300 font-light placeholder:text-primary-earth/30"
                  />
                </div>

                {/* One box per product. A selected pack appears as the
                    products inside it, and a product chosen both on its own and
                    as part of a pack appears once. Nothing is required
                    individually — one filled box is enough to submit. */}
                {(reviewTargets.length > 0 || otherProductNote.trim()) ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-primary-earth/80">
                        {isAr ? 'رأيك' : isFr ? 'Votre avis' : 'Your Review'}
                      </p>
                      {reviewTargets.length > 1 && (
                        <p className="text-xs text-primary-earth/50 mt-1 font-light">
                          {isAr
                            ? 'خانة لكل عنصر — للباك خانة خاصة به ككل، وخانة لكل منتج داخله. اكتب عن ما تريد واترك الباقي فارغاً.'
                            : isFr
                              ? "Une case par article — un pack a sa propre case pour l'ensemble, plus une case par produit qu'il contient."
                              : 'One box per item — a pack has its own box for the set as a whole, plus a box for each product inside it.'}
                        </p>
                      )}
                    </div>
                    {reviewTargets.map((target: ReviewTarget) => (
                      // A pack's own box is set apart: it is a different
                      // question from the per-product ones, and it is the review
                      // that will be shown on the pack's page.
                      <div
                        key={target.key}
                        className={
                          target.isPack
                            ? 'bg-[#faf8f5] border border-accent-gold/30 p-4'
                            : undefined
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <label
                            htmlFor={`comment-${target.key}`}
                            className="text-xs font-bold text-primary-earth"
                          >
                            {target.name}
                            {target.isPack && (
                              <span className="ms-2 text-[10px] font-bold uppercase tracking-widest text-accent-gold">
                                {isAr ? 'تقييم الباك' : isFr ? 'Avis sur le pack' : 'Pack review'}
                              </span>
                            )}
                          </label>
                          <div className="flex items-center gap-0.5" dir="ltr">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() =>
                                  setTargetRatings((prev) => ({ ...prev, [target.key]: star }))
                                }
                                onMouseEnter={() =>
                                  setHoveredTargetRating((prev) => ({ ...prev, [target.key]: star }))
                                }
                                onMouseLeave={() =>
                                  setHoveredTargetRating((prev) => ({ ...prev, [target.key]: 0 }))
                                }
                                aria-label={`${star} / 5 — ${target.name}`}
                                className="focus:outline-none transition-transform hover:scale-110 p-0.5"
                              >
                                <Star
                                  className={`w-5 h-5 ${
                                    star <=
                                    (hoveredTargetRating[target.key] ||
                                      targetRatings[target.key] ||
                                      0)
                                      ? 'fill-accent-gold text-accent-gold'
                                      : 'fill-transparent text-primary-earth/25'
                                  } transition-colors duration-150`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        {target.isPack && (
                          <p className="text-[11px] text-primary-earth/50 font-light mb-2">
                            {isAr
                              ? 'كيف كان الباك ككل؟ المنتجات التي يحتويها لها خانات خاصة أدناه.'
                              : isFr
                                ? "Comment avez-vous trouvé le pack dans son ensemble ? Les produits qu'il contient ont leurs propres cases ci-dessous."
                                : 'How was the pack as a whole? The products inside it have their own boxes below.'}
                          </p>
                        )}
                        <textarea
                          id={`comment-${target.key}`}
                          rows={3}
                          value={targetComments[target.key] || ''}
                          onChange={(e) =>
                            setTargetComments((prev) => ({ ...prev, [target.key]: e.target.value }))
                          }
                          placeholder={
                            target.isPack
                              ? isAr
                                ? `ما رأيك في ${target.name} بشكل عام؟`
                                : isFr
                                  ? `Qu'avez-vous pensé de ${target.name} dans l'ensemble ?`
                                  : `What did you think of ${target.name} overall?`
                              : isAr
                                ? `ما رأيك في ${target.name}؟`
                                : isFr
                                  ? `Qu'avez-vous pensé de ${target.name} ?`
                                  : `What did you think of ${target.name}?`
                          }
                          className="w-full border-2 border-purple-300 bg-[#f8f5fc] p-4 text-primary-earth rounded-xl focus:border-purple-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-200 transition-all duration-300 resize-none font-normal placeholder:text-purple-900/40 shadow-2xs"
                        />
                      </div>
                    ))}
                    {otherProductNote.trim() && (
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <label htmlFor="comment-other" className="text-xs font-bold text-primary-earth">
                            {otherProductNote.trim()}
                          </label>
                          <div className="flex items-center gap-0.5" dir="ltr">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setOtherProductRating(star)}
                                aria-label={`${star} / 5`}
                                className="focus:outline-none transition-transform hover:scale-110 p-0.5"
                              >
                                <Star
                                  className={`w-5 h-5 ${
                                    star <= otherProductRating
                                      ? 'fill-accent-gold text-accent-gold'
                                      : 'fill-transparent text-primary-earth/25'
                                  } transition-colors duration-150`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <textarea
                          id="comment-other"
                          rows={3}
                          value={otherProductComment}
                          onChange={(e) => setOtherProductComment(e.target.value)}
                          placeholder={
                            isAr
                              ? 'ما رأيك في هذا؟'
                              : isFr
                                ? "Qu'en avez-vous pensé ?"
                                : 'What did you think of it?'
                          }
                          className="w-full border-2 border-purple-300 bg-[#f8f5fc] p-4 text-primary-earth rounded-xl focus:border-purple-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-200 transition-all duration-300 resize-none font-normal placeholder:text-purple-900/40 shadow-2xs"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-purple-900/90 font-medium border-2 border-dashed border-purple-300 bg-[#f8f5fc] p-5 text-center rounded-xl shadow-2xs">
                    {isAr
                      ? 'اختر منتجاً أعلاه لكتابة رأيك عنه.'
                      : isFr
                        ? 'Sélectionnez un produit ci-dessus pour écrire votre avis.'
                        : 'Pick a product above to write your review.'}
                  </p>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-primary-earth/80 mb-2">
                    {isAr
                      ? 'أضف صوراً (اختياري، 5 كحد أقصى)'
                      : isFr
                        ? 'Ajouter des photos (facultatif, 5 max)'
                        : 'Add Pictures (Optional, max 5)'}
                  </label>
                  <div className="flex flex-wrap gap-4 mt-2">
                    {images.map((img, index) => img && (
                      <div key={index} className="relative inline-block">
                        <img referrerPolicy="no-referrer" src={img || undefined} alt={`Preview ${index + 1}`} className="w-24 h-24 sm:w-32 sm:h-32 object-cover border border-primary-earth/20" />
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-sm border border-primary-earth/10 text-primary-earth hover:text-red-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {images.length < 5 && (
                      <div className="text-primary-earth/60 flex-shrink-0">
                        <label className="flex flex-col items-center justify-center w-24 h-24 sm:w-32 sm:h-32 border border-primary-earth/30 border-dashed hover:border-accent-gold hover:text-accent-gold transition-colors cursor-pointer text-sm">
                          <Upload className="w-5 h-5 mb-2" />
                          <span className="text-xs text-center px-1">{isAr ? 'تحميل' : isFr ? 'Téléverser' : 'Upload'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleImagesChange}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary-earth text-white py-5 text-sm font-bold uppercase tracking-widest hover:bg-accent-gold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed mt-8"
              >
                {isSubmitting
                  ? (isAr ? 'جاري الإرسال...' : isFr ? 'Envoi...' : 'Submitting...')
                  : (isAr ? 'نشر التقييم' : isFr ? "Publier l'avis" : 'Post Review')}
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
