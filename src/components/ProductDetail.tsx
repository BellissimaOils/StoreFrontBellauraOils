import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useProducts } from '../context/ProductContext';
import { getProductSlug } from '../types';
import { getOptimizedImageUrl } from '../lib/imageUtils';
import { usePaginatedReviews } from '../lib/usePaginatedReviews';
import { trackViewContent, trackAddToCart } from '../lib/pixel';
import { fetchWithCache, getCachedSync } from '../lib/apiCache';
import NotFoundPage from './NotFoundPage';

import { ChevronLeft, ShoppingBag, Leaf, ShieldCheck, Heart, CreditCard, ZoomIn, ZoomOut, X, Maximize2, Info, Droplets, Minus, Plus, ChevronDown, ChevronUp, Truck, ShieldAlert, Check, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Helmet } from 'react-helmet-async';
import DynamicSEO from "./DynamicSEO";
import StarRating from "./StarRating";
// A normal import, not a lazy one.
//
// This was the chunk behind the error customers were hitting on this page: when
// the request for it failed, React cached the rejection permanently and the
// error propagated past the Suspense boundary around it, replacing the entire
// product page — buy button included — with an error panel. Retrying the import
// made it rarer without making it impossible.
//
// Benefits, usage, ingredients and reviews are part of the page. They now ship
// with it and cannot fail to arrive separately.
import ProductAccordions from "./ProductAccordions";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { addToCart, cart } = useCart();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { products, storeSettings, loading } = useProducts();
  const isAr = language === 'ar';
  
  const [isHovered, setIsHovered] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isAdded, setIsAdded] = useState(false);
  const [openSection, setOpenSection] = useState<'desc' | 'usage' | 'ingredients' | 'reviews' | null>('desc');
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [extendedData, setExtendedData] = useState<{
    description?: string;
    benefits?: any;
    usage?: string;
    ingredients?: string;
    tag?: string;
    showDescription?: boolean;
    showBenefits?: boolean;
    showUsage?: boolean;
    showIngredients?: boolean;
    show_size?: boolean | number;
    showSize?: boolean;
  }>({});

  const buyButtonRef = useRef<HTMLDivElement>(null);

  const decodedId = id ? decodeURIComponent(id).trim().toLowerCase() : '';
  const initialProduct = typeof window !== 'undefined' ? (window as any).__INITIAL_PRODUCT__ : null;
  const isInitialNotFound = typeof window !== 'undefined' && !!(window as any).__INITIAL_NOT_FOUND__;
  const product =
    products.find((p) => {
      if (!p) return false;
      if (String(p.id) === id || String(p.id).toLowerCase() === decodedId) return true;
      if (p.slug && String(p.slug).toLowerCase() === decodedId) return true;
      const slug = getProductSlug(p.name);
      const slugEn = p.name_en ? getProductSlug(p.name_en) : '';
      const slugAr = (p as any).name_ar ? getProductSlug((p as any).name_ar) : '';
      return (
        slug.toLowerCase() === decodedId ||
        slug === id ||
        (slugEn && (slugEn.toLowerCase() === decodedId || slugEn === id)) ||
        (slugAr && (slugAr.toLowerCase() === decodedId || slugAr === id))
      );
    }) || initialProduct;

  useEffect(() => {
    if (isInitialNotFound) return;
    const targetId = product?.id || id;
    if (targetId) {
      const cacheKey = `/api/products/${targetId}/data`;
      const cached = getCachedSync<any>(cacheKey);
      if (cached?.success && cached.data) {
        setExtendedData(cached.data);
      }

      fetchWithCache(cacheKey)
        .then((d) => {
          if (d && d.success && d.data) {
            setExtendedData(d.data);
          }
        })
        .catch(console.error);
    }
  }, [id, product?.id]);

  // Pixel: fire ViewContent once per product visit.
  useEffect(() => {
    if (!product?.id) return;
    const price = parseFloat(String(product.price ?? "").replace(/[^\d.]/g, "")) || 0;
    trackViewContent({
      content_name: product.name_en || product.name || "",
      value: price,
      currency: "MAD",
    });
  }, [product?.id]);

  const displayProduct = useMemo(() => {
    if (!product) return undefined;

    const description = (extendedData.description && extendedData.description.trim()) || 
                        (product.description && product.description.trim()) || "";

    const rawBenefits = (extendedData.benefits && (Array.isArray(extendedData.benefits) ? extendedData.benefits.length > 0 : String(extendedData.benefits).trim()))
      ? extendedData.benefits
      : (product.benefits && (Array.isArray(product.benefits) ? product.benefits.length > 0 : String(product.benefits).trim()) ? product.benefits : undefined);

    const benefits = Array.isArray(rawBenefits)
      ? rawBenefits
      : (typeof rawBenefits === 'string' ? rawBenefits.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : []);

    const usage = (extendedData.usage && extendedData.usage.trim()) || 
                  (product.usage && product.usage.trim()) || "";

    const ingredients = (extendedData.ingredients && extendedData.ingredients.trim()) || 
                        (product.ingredients && product.ingredients.trim()) || "";

    return {
      ...product,
      description,
      benefits,
      usage,
      ingredients,
      tag: (extendedData.tag !== undefined && extendedData.tag !== '') ? extendedData.tag : (product.tag || ''),
      showDescription: extendedData.showDescription !== undefined ? extendedData.showDescription : (product.showDescription !== undefined ? product.showDescription : true),
      showBenefits: extendedData.showBenefits !== undefined ? extendedData.showBenefits : (product.showBenefits !== undefined ? product.showBenefits : true),
      showUsage: extendedData.showUsage !== undefined ? extendedData.showUsage : (product.showUsage !== undefined ? product.showUsage : true),
      showIngredients: extendedData.showIngredients !== undefined ? extendedData.showIngredients : (product.showIngredients !== undefined ? product.showIngredients : true),
      show_size: extendedData.show_size !== undefined ? (extendedData.show_size !== 0 && extendedData.show_size !== "0" && extendedData.show_size !== false && (extendedData as any).showSize !== false) : (product.show_size !== undefined ? (product.show_size !== 0 && product.show_size !== "0" && product.show_size !== false && (product as any).showSize !== false) : true),
      showSize: extendedData.showSize !== undefined ? extendedData.showSize : (product.showSize !== undefined ? product.showSize : true),
    };
  }, [product, extendedData]);

  let availabilityText = '';
  if (product?.isAvailable !== false) {
    availabilityText = language === 'ar' ? (storeSettings?.availabilityTextAr || t('products.availableInfo')) : (language === 'fr' ? (storeSettings?.availabilityTextFr || t('products.availableInfo')) : (storeSettings?.availabilityTextEn || t('products.availableInfo')));
  } else {
    availabilityText = language === 'ar' ? (storeSettings?.outOfStockTextAr || t('products.outOfStock')) : (language === 'fr' ? (storeSettings?.outOfStockTextFr || t('products.outOfStock')) : (storeSettings?.outOfStockTextEn || t('products.outOfStock')));
  }

  let deliveryTitleText = language === 'ar' ? (storeSettings?.deliveryTitleAr || '') : (language === 'fr' ? (storeSettings?.deliveryTitleFr || '') : (storeSettings?.deliveryTitleEn || ''));
  let deliveryDescText = language === 'ar' ? (storeSettings?.deliveryDescAr || '') : (language === 'fr' ? (storeSettings?.deliveryDescFr || '') : (storeSettings?.deliveryDescEn || ''));
  
  let guaranteeTitleText = language === 'ar' ? (storeSettings?.guaranteeTitleAr || '') : (language === 'fr' ? (storeSettings?.guaranteeTitleFr || '') : (storeSettings?.guaranteeTitleEn || ''));
  let guaranteeDescText = language === 'ar' ? (storeSettings?.guaranteeDescAr || '') : (language === 'fr' ? (storeSettings?.guaranteeDescFr || '') : (storeSettings?.guaranteeDescEn || ''));

  let organicTitleText = language === 'ar' ? (storeSettings?.organicTitleAr || '') : (language === 'fr' ? (storeSettings?.organicTitleFr || '') : (storeSettings?.organicTitleEn || ''));
  let organicDescText = language === 'ar' ? (storeSettings?.organicDescAr || '') : (language === 'fr' ? (storeSettings?.organicDescFr || '') : (storeSettings?.organicDescEn || ''));

  let healthTitleText = language === 'ar' ? (storeSettings?.healthTitleAr || '') : (language === 'fr' ? (storeSettings?.healthTitleFr || '') : (storeSettings?.healthTitleEn || ''));
  let healthDescText = language === 'ar' ? (storeSettings?.healthDescAr || '') : (language === 'fr' ? (storeSettings?.healthDescFr || '') : (storeSettings?.healthDescEn || ''));

  useEffect(() => {
    const handleScroll = () => {
      if (buyButtonRef.current) {
        const rect = buyButtonRef.current.getBoundingClientRect();
        // If the bottom of the button is scrolled above the viewport
        setShowStickyBar(rect.bottom < 0);
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // This product's English name, used as one of the references a review can
  // name a product by. Mirrors the `englishName` derivation further down, but is
  // needed up here because hooks can't be called after the early returns below.
  const productNameEn = useMemo(() => {
    if (!product) return '';
    if (product.name_en) return product.name_en;
    return String(product.name || '').split(' (')[0] || '';
  }, [product]);

  // Reviews for THIS product, 20 at a time.
  //
  // This used to fetch /api/reviews in full — every review in the shop — and
  // then keep only the ones whose `products` array named this product. On a
  // catalogue with any review history that is a large download to display a
  // handful of cards. The server now does both the product match and the rating
  // filter, so only this product's reviews cross the wire.
  //
  // The rating filter lives here rather than inside ProductAccordions because it
  // has to reach the server: filtering only the rows already loaded would hide
  // matching reviews sitting on a later page.
  const [reviewRatingFilter, setReviewRatingFilter] = useState<number | null>(null);
  const {
    reviews: productReviews,
    total: productReviewsTotal,
    hasMore: hasMoreReviews,
    isLoading: loadingReviews,
    isLoadingMore: loadingMoreReviews,
    loadMore: loadMoreReviews,
  } = usePaginatedReviews({
    productId: product?.id ? String(product.id) : undefined,
    productName: product?.name || undefined,
    productNameEn: productNameEn || undefined,
    rating: reviewRatingFilter,
    enabled: Boolean(product),
    // Product page reviews start smaller than the standalone reviews page
    // (5 vs. 20): a single product usually has far fewer reviews than the
    // whole shop, and the accordion sits inside an already-long page, so a
    // shorter first batch keeps it from dominating the scroll before anyone
    // has opened the section on purpose.
    pageSize: 5,
  });

  // Amazon-style zoom state
  const [lensPos, setLensPos] = useState({ x: 0, y: 0, show: false });
  const [bgPos, setBgPos] = useState({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState(2.5); // Initial zoom scale for the side panel

  const [qty, setQty] = useState(1);

  // ─────────────────────────────────────────────────────────────────────────
  // THIS IS THE LAST HOOK. Nothing below the early returns may call one.
  //
  // Escape closes the image popup. Only bound while it's actually open so we
  // aren't holding a document-level listener for the whole page lifetime.
  //
  // It used to sit ~150 lines further down, AFTER the `if (loading)` and
  // `if (!product)` returns below, and that was the bug behind the "this page
  // could not load" error customers hit on this page:
  //
  //   render 1 — products still loading  → returns early → N hooks run
  //   render 2 — products arrived        → runs past the returns → N+1 hooks
  //   React    — "Rendered more hooks than during the previous render." (throws)
  //
  // A hook count that changes between renders is a hard React error, thrown
  // during render, so it took out the whole page rather than degrading. It only
  // fired when the first render happened to catch `loading === true` — a race
  // between prefetchAppInitialData() warming /api/products and this component
  // mounting — which is exactly why it came and went on refresh, and why it was
  // this page alone: it is the only one with a hook after an early return.
  // Moving it above the returns makes the hook count identical on every render.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLightboxOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
        setLightboxZoom(1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen]);

  // A slug with leading/trailing dashes or consecutive dashes is structurally
  // invalid — getProductSlug() strips these, so no real product can ever have
  // one. Return 404 immediately on frame 1, before any product lookup or API
  // fetch. This handles stale browser-cached HTML for previously-broken URLs
  // (e.g. /-golden-jojoba-oil that was cached before the slug bug was fixed).
  if (decodedId.startsWith('-') || decodedId.endsWith('-') || decodedId.includes('--')) {
    return <NotFoundPage variant="product" />;
  }

  if (isInitialNotFound) {
    return <NotFoundPage variant="product" />;
  }

  // Show spinner only while the catalog hasn't arrived yet.
  // If the catalog IS loaded (products.length > 0) but the product isn't in it,
  // skip the spinner and fall through to the 404 below immediately.
  if (loading && !product && products.length === 0) {
    return (
      <div className="pt-40 lg:pt-48 pb-24 bg-[#FAF9F6] min-h-screen flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
          <p className="text-accent-gold font-medium animate-pulse">
            {language === "ar"
              ? "جاري تحميل المنتج..."
              : language === "fr"
                ? "Chargement du produit..."
                : "Loading product..."}
          </p>
        </div>
      </div>
    );
  }

  // A product slug that matches nothing is a 404, not a trip to the homepage.
  // The previous fallback here rendered t('products.relatedProducts') as its
  // heading (a copy-paste slip - it literally said "Related Products" as the
  // error message) and was visible for a single frame before an effect
  // navigate('/', {replace:true})'d away.
  if (!product) {
    return <NotFoundPage variant="product" />;
  }

  let englishName = '';
  let arabicName = '';
  
  if (displayProduct.name_en) {
    englishName = displayProduct.name_en;
    arabicName = displayProduct.name;
  } else {
    const nameStr = displayProduct.name || '';
    const parts = nameStr.split(' (');
    englishName = parts[0];
    arabicName = parts[1] ? parts[1].replace(')', '') : '';
  }

  // (A local getBenefitsList used to sit here but was never called — the
  // benefits shown on this page are resolved above and rendered by
  // ProductAccordions. Removed; the shared parseBenefitsList in ../types is
  // the single implementation now.)

  // categoryKey / catTranslation / displayCategory were removed along with the
  // "BELLAURA OILS • category • tag" meta line above the product name — they
  // existed solely to feed that line's category chip and became dead code.

  const handleCheckoutNow = () => {
    navigate('/checkout');
  };

  // Helper to parse review images array
  const parseReviewImages = (imgVal: any): string[] => {
    if (!imgVal) return [];
    if (Array.isArray(imgVal)) return imgVal;
    if (typeof imgVal === 'string') {
      const trimmed = imgVal.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          return JSON.parse(trimmed);
        } catch (e) {
          return [imgVal];
        }
      }
      return [imgVal];
    }
    return [];
  };

  // (The client-side review filter that used to sit here is gone — the server
  // now returns only this product's reviews. See usePaginatedReviews above.)

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

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only apply hover zoom on desktop
    if (window.innerWidth < 768) {
      return;
    }
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;

    const lensW = width / zoomLevel;
    const lensH = height / zoomLevel;
    
    let lx = x - lensW / 2;
    let ly = y - lensH / 2;

    if (lx < 0) lx = 0;
    if (lx > width - lensW) lx = width - lensW;
    if (ly < 0) ly = 0;
    if (ly > height - lensH) ly = height - lensH;

    setLensPos({ x: lx, y: ly, show: true });

    // Background position for the side panel
    const bgX = (lx / (width - lensW)) * 100;
    const bgY = (ly / (height - lensH)) * 100;
    
    setBgPos({ x: bgX, y: bgY });
  };

  const handleMouseEnter = () => {
    if (window.innerWidth >= 768) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setLensPos(prev => ({ ...prev, show: false }));
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isHovered) return;
    e.preventDefault();
    setZoomLevel(prev => {
      const newZoom = prev - e.deltaY * 0.01;
      return Math.min(Math.max(1.5, newZoom), 5); // constrain between 1.5x and 5x
    });
  };

  const closeLightbox = () => {
    setIsLightboxOpen(false);
    setLightboxZoom(1);
  };

  const handleImageClick = () => {
    setLightboxImage(product.image);
    setIsLightboxOpen(true);
    setLightboxZoom(1);
  };

  const handleReviewImageClick = (imgUrl: string) => {
    setLightboxImage(imgUrl);
    setIsLightboxOpen(true);
    setLightboxZoom(1);
  };

  const toggleSection = (section: 'desc' | 'usage' | 'ingredients' | 'reviews') => {
    setOpenSection(prev => prev === section ? null : section);
  };

  // Safe price calculations
  const getCleanPrice = (priceStr: string) => {
    if (!priceStr) return 0;
    const clean = priceStr.replace(/[^\d.]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : Math.round(num);
  };

  return (
    <>
      <DynamicSEO product={displayProduct || product} language={language} />
      <div className="pt-40 lg:pt-36 pb-24 bg-[#FAF9F6] min-h-screen text-gray-900 leading-normal" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Minimalist Return Bar */}
        <div className="mb-10">
          <button 
            onClick={() => navigate(-1)} 
            className="inline-flex items-center text-xs font-black tracking-[0.2em] uppercase text-accent-gold hover:text-accent-lilac transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-1 ml-1 rtl:rotate-180" />
            <span>{t('checkout.returnedToShop')}</span>
          </button>
        </div>

        {/* Dynamic Dual-Column Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 sm:gap-16 items-start relative">
          
          {/* LEFT PANEL: High-end Studio Shot Showcase */}
          <div className="lg:col-span-6 flex flex-col gap-6">
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              onClick={handleImageClick}
              className={`w-full aspect-square bg-[#0a0a0a] rounded-[24px] border border-gray-100/10 overflow-hidden flex items-center justify-center shadow-2xl relative group cursor-pointer`}
            >
              {/* Skeleton placeholder while loading image. Was bg-[#121212]
                  (near-black), which flashed dark over the product image;
                  now uses the shared light-lilac loading token. */}
              <div className="absolute inset-0 bg-background-lilac animate-pulse pointer-events-none" />

              {/* Click instruction hint overlay */}
              <div className="absolute top-4 right-4 rtl:left-4 rtl:right-auto bg-white/10 text-white/90 text-[10px] uppercase font-bold tracking-[0.15em] px-3.5 py-2 z-20 shadow-none backdrop-blur-md rounded-full flex items-center gap-1.5 border border-white/10 hover:bg-white/20 transition-all duration-300">
                <ZoomIn className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? 'اضغط للتكبير' : 'Click to enlarge'}</span>
              </div>

              {product.isSale && (
                <div className="absolute top-4 left-4 rtl:right-4 rtl:left-auto bg-red-600 text-white text-[11px] uppercase font-black tracking-widest px-4 py-2 z-20 shadow-md rounded-[8px]">
                  {product.originalPrice ? (() => {
                    const p = getCleanPrice(product.price);
                    const op = getCleanPrice(product.originalPrice);
                    if (p > 0 && op > 0) {
                      return `-${Math.round(((op - p) / op) * 100)}%`;
                    }
                    return t('products.sale') || 'DISCOUNT';
                  })() : t('products.sale') || 'DISCOUNT'}
                </div>
              )}
              
              {product.image && (
                <img 
                  src={getOptimizedImageUrl(product.image, 'eco', 800) || undefined} 
                  alt={product.name} 
                  loading="eager"
                  fetchPriority="high"
                  decoding="sync"
                  className="relative z-10 w-full h-full object-contain pointer-events-none transition-opacity duration-300"
                  referrerPolicy="no-referrer"
                  onLoad={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    el.style.opacity = '1';
                  }}
                  style={{ opacity: 0 }}
                />
              )}

              {/* Click-to-Zoom Indicator Icon */}
              <div className="absolute bottom-4 right-4 rtl:left-4 rtl:right-auto bg-white/80 text-gray-900 rounded-full p-2.5 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-sm flex items-center justify-center z-20">
                <Maximize2 className="w-4 h-4 text-gray-700" />
              </div>
            </motion.div>

            {/* Quick specifications values ribbon under image */}
            <div className="grid grid-cols-2 gap-4">
              {organicTitleText && organicDescText && (
                <div className="bg-white/80 border border-black/[0.03] rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent-gold/10 flex items-center justify-center text-accent-gold">
                    <Leaf className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">{organicTitleText}</span>
                    <span className="block text-xs font-semibold text-gray-800 mt-1">
                      {(() => {
                        const customTag = product?.tag !== undefined && product?.tag !== null && String(product.tag).trim() !== "" && String(product.tag).trim() !== "none" ? String(product.tag).trim() : null;
                        if (customTag) return customTag;
                        // Same fix as ProductCard: this used to substitute
                        // "100% Pure" for non-oil categories, overriding the
                        // Cold Pressed default the admin actually selected.
                        return organicDescText;
                      })()}
                    </span>
                  </div>
                </div>
              )}

              {healthTitleText && healthDescText && (
                <div className="bg-white/80 border border-black/[0.03] rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent-gold/10 flex items-center justify-center text-accent-gold">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">{healthTitleText}</span>
                    <span className="block text-xs font-semibold text-gray-800 mt-1">{healthDescText}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Availability Detail Box & Express Delivery Terms */}
            {availabilityText && (
              <div className="bg-[#f4f7f5]/50 border border-[#2c5836]/10 rounded-[16px] p-5 space-y-4 text-xs text-gray-700 font-sans shadow-inner">
                <div className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full ${product.isAvailable !== false ? 'bg-green-600 animate-pulse' : 'bg-red-500'}`} />
                  <span className={`font-extrabold uppercase tracking-wider ${product.isAvailable !== false ? 'text-green-950' : 'text-red-900'}`}>
                    {availabilityText}
                  </span>
                </div>
                
                {deliveryTitleText && deliveryDescText && (
                  <div className="flex items-start gap-3 border-t border-[#2c5836]/5 pt-3.5">
                    <Truck className="w-4.5 h-4.5 text-[#2c5836] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-gray-900 uppercase tracking-widest text-[10.5px]">{deliveryTitleText}</p>
                      <p className="text-gray-500 text-[11px] mt-1 pr-1 pl-1 leading-relaxed">
                        {deliveryDescText}
                      </p>
                    </div>
                  </div>
                )}

                {guaranteeTitleText && guaranteeDescText && (
                  <div className="flex items-start gap-3 border-t border-[#2c5836]/5 pt-3.5">
                    <ShieldAlert className="w-4.5 h-4.5 text-[#2c5836] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-gray-900 uppercase tracking-widest text-[10.5px]">{guaranteeTitleText}</p>
                      <p className="text-gray-500 text-[11px] mt-1 pr-1 pl-1 leading-relaxed">
                        {guaranteeDescText}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT PANEL: Pure Typography, Details, Pricing, & Horizontal Purchases */}
          <div className="lg:col-span-6 flex flex-col relative w-full">
            

            {/* Luxurious Large Title Structure */}
            <h1 className="text-3xl sm:text-4xl lg:text-4xl font-medium tracking-tight text-[#112031] leading-[1.25] mb-2 font-sans break-words max-w-full">
              {isAr ? (arabicName || englishName) : englishName}
            </h1>
            
            {/* Elegant Sub-title */}
            {/* The score, under the title. The product page showed no rating at
                all: the only stars on it were inside the reviews accordion,
                which is collapsed by default, so a well-reviewed product looked
                unreviewed. Clicking scrolls to the reviews rather than being a
                dead decoration. */}
            <button
              type="button"
              onClick={() => {
                document
                  .getElementById('product-reviews-anchor')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="flex items-center gap-2 mb-2 group cursor-pointer"
            >
              <StarRating
                value={displayProduct?.rating ?? product.rating}
                count={displayProduct?.reviews ?? (product as any).reviews}
                size="md"
                showValue
                className="text-accent-gold"
              />
              <span className="text-xs text-[#112031]/50 group-hover:text-accent-gold transition-colors">
                {Number((displayProduct as any)?.reviews ?? (product as any).reviews) > 0
                  ? isAr
                    ? `${Number((displayProduct as any)?.reviews ?? (product as any).reviews)} تقييم`
                    : language === 'fr'
                      ? `${Number((displayProduct as any)?.reviews ?? (product as any).reviews)} avis`
                      : `${Number((displayProduct as any)?.reviews ?? (product as any).reviews)} reviews`
                  : isAr
                    ? 'لا تقييمات بعد'
                    : language === 'fr'
                      ? "Pas encore d'avis"
                      : 'No reviews yet'}
              </span>
            </button>

            {(isAr ? englishName : arabicName) && (
              <h2 className="text-xl sm:text-2xl font-medium text-[#112031]/80 tracking-wide font-sans mb-3">
                {isAr ? englishName : arabicName}
              </h2>
            )}

            {/* Minimal Pricing Board */}
            <div className="mb-6 flex flex-col gap-1 mt-3">
              <div className={`flex items-baseline gap-4 text-[17px] ${isAr ? 'justify-end' : 'justify-start'}`} dir="ltr">
                <span className="tracking-wide text-[24px] font-black text-accent-gold drop-shadow-sm">
                  {Math.round(getCleanPrice(product.price))} <span className="text-[16px] font-medium tracking-normal text-accent-gold/80">DH</span>
                </span>
                {product.isSale && product.originalPrice && (
                  <span className="text-[15px] font-medium text-gray-400 line-through decoration-red-500/50">
                    {Math.round(getCleanPrice(product.originalPrice))} DH
                  </span>
                )}
              </div>
            </div>

            {/* Subtle premium store code and guarantee labels - removed based on user request */}

            {/* Substantive Description Introductory block */}
            {displayProduct?.showDescription !== false && (displayProduct?.description || product.description) && (
              <p className="text-gray-600 text-[14.5px] leading-relaxed mb-6 font-light">
                {displayProduct?.description || product.description}
              </p>
            )}

            {/* SIDE-BY-SIDE BUY DOCK (Quantity selector + CTA Button) */}
            <div ref={buyButtonRef} className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 mb-4 items-center">
              
              {/* Premium Quantity Bracket */}
              <div className="sm:col-span-4 flex items-center justify-between border border-gray-200 bg-white rounded-xl h-14 px-3 flex-shrink-0 shadow-sm">
                <button 
                  type="button"
                  onClick={() => setQty(prev => Math.max(1, prev - 1))}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer"
                  title="Decrease volume quantity"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-mono font-black text-[15px] text-gray-800 w-10 text-center select-none">
                  {qty}
                </span>
                <button 
                  type="button"
                  onClick={() => setQty(prev => prev + 1)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-800 transition-colors cursor-pointer"
                  title="Increase volume quantity"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Master Add to Basket Button */}
              <div className="sm:col-span-8 w-full">
                <button 
                  onClick={() => {
                    if (product.isAvailable !== false) {
                      addToCart(product, qty);
                      trackAddToCart({
                        content_name: product.name_en || product.name || "",
                        value: (parseFloat(String(product.price ?? "").replace(/[^\d.]/g, "")) || 0) * qty,
                        currency: "MAD",
                      });
                      setIsAdded(true);
                      setTimeout(() => setIsAdded(false), 2000);
                    }
                  }}
                  disabled={product.isAvailable === false}
                  className={`w-full h-14 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2.5 px-6 shadow-md hover:shadow-lg active:scale-95 ${
                    product.isAvailable === false
                      ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed shadow-none'
                      : isAdded
                      ? 'bg-green-700 text-white shadow-green-700/15'
                      : 'bg-accent-gold hover:bg-gray-900 hover:shadow-gray-900/25 text-gray-900 hover:text-white cursor-pointer'
                  }`}
                >
                  {isAdded ? (
                    <div className="flex items-center gap-2 justify-center">
                      <Check className="w-4 h-4 text-white stroke-[3.5]" />
                      <span>{isAr ? 'تمت الإضافة بنجاح!' : language === 'fr' ? 'AJOUTÉ AU PANIER !' : 'ADDED TO BASKET!'}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 justify-center">
                      <ShoppingBag className="w-4.5 h-4.5 text-current" />
                      <span>
                        {product.isAvailable === false 
                          ? availabilityText.toUpperCase()
                          : (isAr ? 'أضف إلى السلة' : language === 'fr' ? 'AGOUTER AU PANIER' : 'ADD TO BASKET')
                        }
                      </span>
                    </div>
                  )}
                </button>
              </div>

            </div>

            {/* Direct Express Checkout Panel Trigger */}
            <div className="mb-8">
              <button 
                onClick={() => {
                  if (product.isAvailable !== false && cart.length > 0) {
                    handleCheckoutNow();
                  }
                }}
                disabled={product.isAvailable === false || cart.length === 0}
                className={`w-full py-4 rounded-xl text-xs font-black uppercase tracking-[0.15em] transition-all duration-300 flex items-center justify-center gap-2.5 border shadow-sm ${
                  (product.isAvailable === false || cart.length === 0)
                    ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed shadow-none'
                    : 'border-gray-900 bg-transparent text-gray-900 hover:bg-gray-900 hover:text-white cursor-pointer active:scale-95'
                }`}
              >
                <CreditCard className="w-4.5 h-4.5" />
                <span>{isAr ? "إنشاء طلب" : language === "fr" ? "CRÉER UNE COMMANDE" : "CREATE ORDER"}</span>
              </button>
            </div>

            {/* REDESIGNED ACCORDION DOCK (Inspired by upscale detail accordions) */}
            <div id="product-reviews-anchor" />
            <ProductAccordions 
                displayProduct={displayProduct}
                product={product}
                productReviews={productReviews}
                loadingReviews={loadingReviews}
                handleReviewImageClick={handleReviewImageClick}
                totalReviews={productReviewsTotal}
                hasMoreReviews={hasMoreReviews}
                loadingMoreReviews={loadingMoreReviews}
                onLoadMoreReviews={loadMoreReviews}
                ratingFilter={reviewRatingFilter}
                onRatingFilterChange={setReviewRatingFilter}
              />

          </div>
        </div>
      </div>

      {/* STICKY BOTTOM BAR */}
      <AnimatePresence>
        {showStickyBar && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 bg-[#3b3b3b] z-40 px-4 py-3 sm:px-8 hidden md:flex items-center justify-between"
          >
            <div className="flex items-center gap-4 max-w-7xl mx-auto w-full">
              <div className="hidden sm:block w-12 h-12 bg-transparent overflow-hidden flex-shrink-0 flex items-center justify-center rounded-sm">
                 {product.image && (
                   <img src={product.image || undefined} alt={product.name} decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                 )}
              </div>
              <div className="flex-1 truncate">
                  <h3 className="text-white font-medium text-[15px] tracking-wide truncate">
                    {product.name} {displayProduct?.show_size !== false && (displayProduct as any)?.show_size !== 0 && (displayProduct as any)?.show_size !== "0" && (displayProduct as any)?.showSize !== false && product.volume && <span dir="ltr">- {product.volume}</span>}
                  </h3>
              </div>
              <div className="flex items-center gap-6 flex-shrink-0">
                 <button 
                    onClick={() => {
                      if (product.isAvailable !== false) {
                        addToCart(product, qty);
                        trackAddToCart({
                          content_name: product.name_en || product.name || "",
                          value: (parseFloat(String(product.price ?? "").replace(/[^\d.]/g, "")) || 0) * qty,
                          currency: "MAD",
                        });
                        setIsAdded(true);
                        setTimeout(() => setIsAdded(false), 2000);
                      }
                    }}
                    disabled={product.isAvailable === false}
                    className="bg-[#4d4d4d] hover:bg-[#5a5a5a] text-white px-6 py-2.5 rounded text-sm transition-colors font-medium cursor-pointer flex items-center gap-2"
                 >
                   <span>{isAdded ? (isAr ? 'تمت الإضافة' : 'AJOUTÉ') : (isAr ? `أضف إلى السلة` : `Ajouter au panier`)}</span>
                   <span className="text-white/60">•</span>
                   <span>{getCleanPrice(product.price) * qty} DH</span>
                 </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Image popup.

        This used to be a full-page takeover: `fixed inset-0` with an opaque
        bg-black/95 backdrop, a full-width header, the image at up to
        90vw x 70vh, and a separate controls panel — so opening an image
        swallowed the whole screen. It's now a normal, compact centred modal
        (a card of at most 30rem) over a translucent backdrop, so the page
        stays visible behind it and it reads as a window you dismiss rather
        than a mode you're trapped in.

        Dismissable three ways, which a full-screen takeover didn't offer:
        the X button, clicking the backdrop, or pressing Escape.
      */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
          aria-label={product.name}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            // Stop clicks inside the card from reaching the backdrop handler,
            // otherwise interacting with the image would close the popup.
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[30rem] max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-primary-earth/10 shrink-0">
              <h3 className="text-xs sm:text-sm font-medium text-primary-earth truncate">
                {product.name}
              </h3>
              <button
                onClick={closeLightbox}
                className="p-1.5 -me-1.5 rounded-full text-primary-earth/60 hover:text-primary-earth hover:bg-primary-earth/5 transition-colors cursor-pointer shrink-0"
                aria-label={language === 'ar' ? 'إغلاق' : language === 'fr' ? 'Fermer' : 'Close'}
                title={language === 'ar' ? 'إغلاق' : language === 'fr' ? 'Fermer' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Image */}
            <div className="flex-1 min-h-0 overflow-auto bg-background-soft flex items-center justify-center p-3">
              <img
                src={getOptimizedImageUrl(lightboxImage || product.image, 'full') || undefined}
                alt={product.name}
                style={{ transform: `scale(${lightboxZoom})` }}
                className="max-w-full max-h-[55vh] object-contain transition-transform duration-200 origin-center"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Compact zoom controls */}
            <div className="flex items-center justify-center gap-5 px-4 py-2.5 border-t border-primary-earth/10 shrink-0">
              <button
                onClick={() => setLightboxZoom(prev => Math.max(1, prev - 0.5))}
                disabled={lightboxZoom <= 1}
                className="text-primary-earth/70 hover:text-accent-gold disabled:opacity-30 disabled:hover:text-primary-earth/70 transition-colors cursor-pointer"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut className="w-4.5 h-4.5" />
              </button>

              <span className="text-primary-earth/70 font-mono text-[11px] min-w-[3rem] text-center" dir="ltr">
                {Math.round(lightboxZoom * 100)}%
              </span>

              <button
                onClick={() => setLightboxZoom(prev => Math.min(4, prev + 0.5))}
                disabled={lightboxZoom >= 4}
                className="text-primary-earth/70 hover:text-accent-gold disabled:opacity-30 disabled:hover:text-primary-earth/70 transition-colors cursor-pointer"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn className="w-4.5 h-4.5" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
    </>
  );
}
