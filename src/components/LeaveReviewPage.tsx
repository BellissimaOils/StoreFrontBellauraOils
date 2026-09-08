import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star, CheckCircle, ShieldCheck, Upload, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import toast from 'react-hot-toast';
import { compressImage } from '../lib/imageUtils';
import type { ReviewTarget } from '../lib/reviewTargets';

export default function LeaveReviewPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();

  const [rating, setRating] = useState(5);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  // One comment per product being reviewed, keyed by ReviewTarget.key.
  //
  // A pack is reviewed as its contents, not as a single thing: buying a pack of
  // three oils means three reviews, one per bottle, because that is what a
  // shopper reading a product page needs. `comment` above is still used as the
  // fallback for a link whose products the server couldn't resolve.
  const [targetComments, setTargetComments] = useState<Record<string, string>>({});
  // A star rating per product, keyed the same way as the comments. A pack and
  // each product inside it are rated independently — the set can be excellent
  // while one bottle in it disappoints.
  const [targetRatings, setTargetRatings] = useState<Record<string, number>>({});
  const [hoveredTargetRating, setHoveredTargetRating] = useState<Record<string, number>>({});
  const [reviewTargets, setReviewTargets] = useState<ReviewTarget[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isValidating, setIsValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [isAlreadySubmitted, setIsAlreadySubmitted] = useState(false);
  const [tokenProducts, setTokenProducts] = useState<string[]>([]);

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false);
        return;
      }
      try {
        const response = await fetch(`/api/reviews/check-token/${token}`);

        // This endpoint is rate limited (30 requests / 15 min per IP) because
        // the token is a guessable-ish path param.
        if (response.status === 429) {
          setTokenValid(false);
          setStatus('error');
          setErrorMessage(
            tr(
              'محاولات كثيرة من اتصالك. انتظر بضع دقائق ثم أعد تحميل الصفحة — رابط التقييم الخاص بك لا يزال صالحاً.',
              "Trop de tentatives depuis votre connexion. Patientez quelques minutes puis rechargez la page — votre lien d'avis est toujours valide.",
              'Too many attempts from your connection. Please wait a few minutes and reload this page — your review link is still valid.',
            ),
          );
          return;
        }

        const data = await response.json();
        if (data.isValid) {
          setTokenValid(true);
          if (data.isSubmitted && !data.canEdit) {
            setIsAlreadySubmitted(true);
          }
          if (data.products) setTokenProducts(data.products);
          if (Array.isArray(data.reviewTargets)) {
            setReviewTargets(
              data.reviewTargets.map((target: any) => ({
                key: String(target.key),
                id: String(target.id ?? ''),
                name: String(target.name ?? ''),
                isPack: target.isPack === true,
              })),
            );
            // Pre-fill anything already written for a product
            const prefilled: Record<string, string> = {};
            const prefilledRatings: Record<string, number> = {};
            for (const target of data.reviewTargets) {
              if (target?.comment) prefilled[String(target.key)] = String(target.comment);
              const saved = Number(target?.rating) || 0;
              if (saved > 0) prefilledRatings[String(target.key)] = saved;
            }
            if (Object.keys(prefilled).length > 0) setTargetComments(prefilled);
            if (Object.keys(prefilledRatings).length > 0) setTargetRatings(prefilledRatings);
          }
          if (data.clientName) setName(data.clientName);
          if (data.existingReview) {
            setComment(data.existingReview.comment || "");
            setRating(data.existingReview.rating || 5);
            if (data.existingReview.image) {
              try {
                const parsed = JSON.parse(data.existingReview.image);
                if (Array.isArray(parsed)) setImages(parsed);
                else setImages([data.existingReview.image]);
              } catch (e) {
                setImages([data.existingReview.image]);
              }
            }
          }
        } else {
          setTokenValid(false);
          setStatus('error');
          setErrorMessage(
            tr(
              'رابط التقييم غير صالح أو تم استخدامه بالفعل.',
              "Ce lien d'avis est invalide ou a déjà été utilisé.",
              'This review link is invalid or has already been used.',
            ),
          );
        }
      } catch (err) {
        setStatus('error');
        setErrorMessage(
          tr(
            'تعذر التحقق من رابط التقييم. حاول مرة أخرى.',
            "Échec de la validation du lien d'avis. Veuillez réessayer.",
            'Failed to validate the review link. Please try again.',
          ),
        );
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const isRtl = language === 'ar';

  /**
   * Every visible string on this page goes through here.
   *
   * The page was written entirely in English, so a customer browsing in Arabic
   * filled in an Arabic form and was thanked in English. The rest of the site
   * (including the general review page) picks language per string with inline
   * ternaries; this is the same thing with the branching in one place, because
   * there are ~25 strings here.
   */
  const tr = (ar: string, fr: string, en: string) =>
    language === 'ar' ? ar : language === 'fr' ? fr : en;

  // Per-product boxes whenever the server resolved what was bought. It falls
  // back to the original single box when it couldn't — an old token holding
  // only a free-text product name, for instance — so no link becomes unusable.
  const usePerProductBoxes = reviewTargets.length > 0;
  // Either half counts: text, stars, or both.
  const hasAnyProductComment = reviewTargets.some(
    (target: ReviewTarget) =>
      (targetComments[target.key] || '').trim().length > 0 ||
      (targetRatings[target.key] || 0) > 0,
  );

  const handleImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      if (images.length + files.length > 5) {
        toast.error(
          tr(
            'يمكنك تحميل 5 صور كحد أقصى',
            'Vous pouvez téléverser 5 images au maximum',
            'You can upload a maximum of 5 images',
          ),
        );
        return;
      }
      
      const newImages: string[] = [];
      for (const file of Array.from(files as Iterable<File>)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(
            tr(
              'يجب أن يكون حجم كل صورة أقل من 10 ميغابايت',
              'Chaque image doit peser moins de 10 Mo',
              'Each image must be smaller than 10MB',
            ),
          );
          continue;
        }
        try {
          // Compress to 800x800 and 0.6 quality for fast page loading
          const compressed = await compressImage(file, 800, 800, 0.6);
          newImages.push(compressed);
        } catch (err) {
          console.warn("Failed to compress image, using fallback", err);
          const raw = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          newImages.push(raw);
        }
      }
      setImages(prev => [...prev, ...newImages]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setStatus('error');
      setErrorMessage(
        tr(
          'لا يوجد رمز تقييم. يرجى استخدام الرابط الذي أُرسل إليك.',
          "Aucun jeton d'avis fourni. Veuillez utiliser le lien qui vous a été envoyé.",
          'No review token provided. Please use the link that was sent to you.',
        ),
      );
      return;
    }

    // With per-product boxes, "at least one filled in" is the rule. Requiring
    // every box would stop a customer reviewing the one product they have an
    // opinion about; requiring none would file an empty review.
    if (usePerProductBoxes && !hasAnyProductComment) {
      setStatus('error');
      setErrorMessage(
        tr(
          'يرجى تقييم منتج واحد على الأقل أو كتابة رأيك عنه.',
          "Veuillez noter au moins un produit ou rédiger un avis.",
          'Please rate at least one of the products below, or write a review for it.',
        ),
      );
      return;
    }

    setIsSubmitting(true);
    setStatus('idle');
    setErrorMessage('');

    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          name: name.trim() || 'Anonymous',
          rating,
          // Sent for older server builds and for the fallback case; the server
          // ignores it when productReviews is present.
          comment: comment.trim(),
          ...(usePerProductBoxes
            ? {
                productReviews: reviewTargets
                  .map((target: ReviewTarget) => ({
                    productId: target.id,
                    productName: target.name,
                    comment: (targetComments[target.key] || '').trim(),
                    // 0 means "not rated". The stars start empty, so an
                    // untouched product sends nothing rather than a 5 nobody
                    // chose — otherwise every product in an order would collect
                    // a five-star review whether or not the customer looked at
                    // it, and the averages would be meaningless.
                    rating: targetRatings[target.key] || 0,
                  }))
                  // Stars alone are a review. A customer who rates a product
                  // without writing anything has still told you something, and
                  // dropping it (as this did) silently threw the rating away.
                  .filter(
                    (entry: { comment: string; rating: number }) =>
                      entry.comment.length > 0 || entry.rating > 0,
                  ),
              }
            : {}),
          images,
        }),
      });

      const data = await response.json();

      if (data.success) {
        window.scrollTo(0, 0);
        setStatus('success');
      } else {
        setStatus('error');
        // Deliberately not `data.message`: the API answers in English only, and
        // relaying it is how an Arabic customer ended up with an English error.
        //
        // 429 is separated out for the same reason the token check does it: this
        // endpoint is rate limited, and telling someone their link is used up
        // when they have simply retried too often is both wrong and the one
        // message that makes them retry harder.
        setErrorMessage(
          response.status === 429
            ? tr(
                'محاولات كثيرة من اتصالك. انتظر بضع دقائق ثم حاول مرة أخرى — رابط التقييم لا يزال صالحاً.',
                "Trop de tentatives depuis votre connexion. Patientez quelques minutes puis réessayez — votre lien reste valide.",
                'Too many attempts from your connection. Please wait a few minutes and try again — your review link is still valid.',
              )
            : tr(
                'تعذر إرسال التقييم. قد يكون الرابط غير صالح أو تم استخدامه بالفعل.',
                "Échec de l'envoi de l'avis. Le lien est peut-être invalide ou déjà utilisé.",
                'Failed to submit review. The link may be invalid or already used.',
              ),
        );
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        tr(
          'حدث خطأ في الشبكة. حاول مرة أخرى.',
          'Une erreur réseau est survenue. Veuillez réessayer.',
          'Network error occurred. Please try again.',
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-background-soft flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
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
            {tr('شكراً لك', 'Merci', 'Thank You')}
          </h1>
          <p className="text-primary-earth/70 mb-8 leading-relaxed">
            {tr(
              'تم نشر تقييمك الموثّق. نقدّر رأيك ودعمك لنا.',
              'Votre avis vérifié a été publié. Merci sincèrement pour votre retour et votre soutien.',
              'Your verified review has been published. We truly appreciate your feedback and support.',
            )}
          </p>
          <button 
            onClick={() => navigate('/')}
            className="bg-primary-earth text-white px-8 py-4 text-sm font-bold uppercase tracking-widest hover:bg-accent-gold transition-colors duration-300"
          >
            {tr('العودة للمتجر', 'Retour à la boutique', 'Return to Store')}
          </button>
        </motion.div>
      </div>
    );
  }

  if (isAlreadySubmitted) {
    return (
      <div className="min-h-screen bg-background-soft pt-32 pb-24 flex items-center justify-center px-4" dir={isRtl ? 'rtl' : 'ltr'}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 md:p-12 max-w-xl w-full text-center shadow-2xl relative border border-primary-earth/10"
        >
          <div className="flex justify-center mb-5">
            <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center border border-green-200">
              <CheckCircle className="w-8 h-8 text-green-700" />
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-light text-primary-earth mb-2">
            {tr('تم استلام هذا التقييم مسبقاً', 'Avis déjà reçu', 'Review Already Submitted')}
          </h1>
          <p className="text-xs sm:text-sm text-primary-earth/60 mb-6 leading-relaxed">
            {tr(
              'تم تسجيل هذا التقييم الموثّق مسبقاً بنجاح في سجلات المتجر.',
              'Cet avis vérifié a déjà été enregistré et validé avec succès.',
              'This verified review has already been recorded and validated in our store.',
            )}
          </p>

          <div className="bg-background-soft p-5 border border-primary-earth/10 rounded-sm mb-6 text-start">
            {name && (
              <p className="text-xs font-bold text-primary-earth mb-2">
                {name}
              </p>
            )}
            <div className="flex items-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={`w-4 h-4 ${i < rating ? 'fill-accent-gold text-accent-gold' : 'fill-transparent text-primary-earth/20'}`}
                />
              ))}
            </div>
            {comment && (
              <p className="text-xs italic text-primary-earth/80 whitespace-pre-wrap leading-relaxed">
                "{comment}"
              </p>
            )}
            {reviewTargets.length > 0 && (
              <div className="mt-3 pt-3 border-t border-primary-earth/10 space-y-2">
                {reviewTargets.map((t) => (
                  <div key={t.key} className="text-xs">
                    <span className="font-bold text-primary-earth">{t.name}: </span>
                    <span className="text-primary-earth/70 italic">{targetComments[t.key] || comment}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button 
              type="button"
              onClick={() => navigate('/reviews')}
              className="w-full sm:w-auto bg-[#2c5836] text-white px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-[#1a3a22] transition-colors"
            >
              {tr('عرض كل التقييمات', 'Voir tous les avis', 'View All Reviews')}
            </button>
            <button 
              type="button"
              onClick={() => navigate('/')}
              className="w-full sm:w-auto bg-primary-earth text-white px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-accent-gold transition-colors"
            >
              {tr('العودة للمتجر', 'Retour à la boutique', 'Return to Store')}
            </button>
          </div>
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
          {/* Badge */}
          <div className="absolute top-0 right-0 bg-accent-gold text-primary-earth text-[10px] uppercase font-bold tracking-[0.2em] px-4 py-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            {tr('شراء موثّق', 'Achat vérifié', 'Verified Purchase')}
          </div>

          <div className="text-center mb-10 mt-4">
            <h1 className="text-3xl md:text-4xl font-light text-primary-earth mb-4">
              {tr('قيّم تجربتك', 'Évaluez votre expérience', 'Rate Your Experience')}
            </h1>
            <p className="text-primary-earth/60 font-light">
              {tr(
                'رأيك يهمنا كثيراً. شاركنا انطباعك عن المنتجات التي استلمتها.',
                'Votre retour nous est précieux. Partagez votre avis sur les produits reçus.',
                'Your feedback is invaluable to us. Please share your thoughts on the products you received.',
              )}
            </p>
          </div>

          {!token && (
            <div className="bg-red-50 text-red-800 p-4 mb-8 text-sm text-center border border-red-200">
              {tr(
                'لا يوجد رمز تقييم في الرابط. تحتاج إلى الرابط الخاص المرفق بتأكيد طلبك لترك تقييم موثّق.',
                "Aucun jeton d'avis dans l'URL. Vous avez besoin du lien unique de votre confirmation de commande.",
                'No review token found in the URL. You need the unique link from your order confirmation to leave a verified review.',
              )}
            </div>
          )}

          {status === 'error' && errorMessage ? (
            <div className="bg-red-50 text-red-800 p-4 mb-8 text-sm text-center border border-red-200">
              {errorMessage}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Only shown in the fallback case. When there is a box per
                  product below, each box is already labelled with its product
                  name and a separate chip list would just repeat it. */}
              {!usePerProductBoxes && tokenProducts.length > 0 && (
                <div className="text-center mb-6 text-sm text-primary-earth/80">
                  <p className="font-bold uppercase tracking-widest text-[10px] mb-2">
                    {tr('تقييم', 'Vous évaluez', 'Reviewing')}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {tokenProducts.map(p => (
                      <span key={p} className="bg-primary-earth/5 px-3 py-1 border border-primary-earth/10 text-xs">{p}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* The single shared rating, for the fallback single-box mode only.
                  When there is a box per product each one carries its own stars,
                  and a second overall rating on top of them would be ambiguous:
                  the customer would not know which one counts. */}
              {!usePerProductBoxes && (
              <div className="flex flex-col items-center space-y-4">
                <label className="text-sm font-bold uppercase tracking-widest text-primary-earth/80">
                  {tr('تقييمك', 'Votre note', 'Your Rating')}
                </label>
                <div className="flex items-center gap-2" dir="ltr">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoveredRating(star)}
                      onMouseLeave={() => setHoveredRating(0)}
                      className="focus:outline-none transition-transform hover:scale-110"
                    >
                      <Star 
                        className={`w-10 h-10 ${
                          star <= (hoveredRating || rating) 
                            ? 'fill-accent-gold text-accent-gold' 
                            : 'fill-transparent text-primary-earth/20'
                        } transition-colors duration-200`} 
                      />
                    </button>
                  ))}
                </div>
              </div>
              )}

              <div className="space-y-6 pt-6 border-t border-primary-earth/10">
                <div>
                  <label htmlFor="name" className="block text-xs font-bold uppercase tracking-widest text-primary-earth/80 mb-2">
                    {tr('الاسم المعروض (اختياري)', "Nom d'affichage (facultatif)", 'Display Name (Optional)')}
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={tr('كيف تريد أن يظهر اسمك', 'Comment souhaitez-vous apparaître', "How you'd like to appear")}
                    className="w-full border-b border-primary-earth/30 py-3 bg-transparent focus:border-accent-gold focus:outline-none transition-colors duration-300 font-light placeholder:text-primary-earth/30"
                  />
                </div>

                {usePerProductBoxes ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-primary-earth/80">
                        {tr('رأيك', 'Votre avis', 'Your Review')}
                      </p>
                      <p className="text-xs text-primary-earth/50 mt-1 font-light">
                        {reviewTargets.length > 1
                          ? tr(
                              'خانة لكل عنصر استلمته. للباك خانة خاصة به ككل، وخانة لكل منتج داخله. اكتب عن ما تريد واترك الباقي فارغاً.',
                              "Une case par article reçu. Un pack a sa propre case pour l'ensemble, plus une case par produit qu'il contient. Remplissez celles que vous voulez.",
                              'One box per item you received. A pack has its own box for the set as a whole, plus a box for each product inside it. Fill in the ones you want to review; you can leave the rest empty.',
                            )
                          : tr('أخبرنا بتجربتك معه.', 'Dites-nous comment cela s\'est passé.', 'Tell us how you got on with it.')}
                      </p>
                    </div>
                    {reviewTargets.map((target: ReviewTarget) => (
                      // The pack's own box is visually separated from the
                      // per-product ones: it asks a different question (how the
                      // set worked as a whole) and it is the review that will
                      // appear on the pack's page.
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
                                {tr('تقييم الباك', 'Avis sur le pack', 'Pack review')}
                              </span>
                            )}
                          </label>
                          {/* This product's own stars. dir=ltr so 1→5 reads the
                              same in Arabic; a rating scale is not a sentence. */}
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
                            {tr(
                              'كيف كان الباك ككل؟ المنتجات التي يحتويها لها خانات خاصة أدناه.',
                              "Comment avez-vous trouvé le pack dans son ensemble ? Les produits qu'il contient ont leurs propres cases ci-dessous.",
                              'How was the pack as a whole? The products inside it have their own boxes below.',
                            )}
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
                              ? tr(
                                  `ما رأيك في ${target.name} بشكل عام؟`,
                                  `Qu'avez-vous pensé de ${target.name} dans l'ensemble ?`,
                                  `What did you think of ${target.name} overall?`,
                                )
                              : tr(
                                  `ما رأيك في ${target.name}؟`,
                                  `Qu'avez-vous pensé de ${target.name} ?`,
                                  `What did you think of ${target.name}?`,
                                )
                          }
                          className="w-full border border-primary-earth/30 p-4 bg-transparent focus:border-accent-gold focus:outline-none transition-colors duration-300 resize-none font-light placeholder:text-primary-earth/30"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <label htmlFor="comment" className="block text-xs font-bold uppercase tracking-widest text-primary-earth/80 mb-2">
                      {tr('رأيك', 'Votre avis', 'Your Review')}
                    </label>
                    <textarea
                      id="comment"
                      required
                      rows={4}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={tr('أخبرنا بما أحببته...', 'Dites-nous ce que vous avez aimé...', 'Tell us what you loved...')}
                      className="w-full border border-primary-earth/30 p-4 bg-transparent focus:border-accent-gold focus:outline-none transition-colors duration-300 resize-none font-light placeholder:text-primary-earth/30"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-primary-earth/80 mb-2">
                    {tr('أضف صوراً (اختياري، 5 كحد أقصى)', 'Ajouter des photos (facultatif, 5 max)', 'Add Pictures (Optional, max 5)')}
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
                          <span className="text-xs text-center px-1">{tr('تحميل', 'Téléverser', 'Upload')}</span>
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
                disabled={isSubmitting || !token}
                className="w-full bg-primary-earth text-white py-5 text-sm font-bold uppercase tracking-widest hover:bg-accent-gold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed mt-8"
              >
                {isSubmitting
                  ? tr('جاري الإرسال...', 'Envoi en cours...', 'Submitting...')
                  : tr('نشر التقييم الموثّق', "Publier l'avis vérifié", 'Post Verified Review')}
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
