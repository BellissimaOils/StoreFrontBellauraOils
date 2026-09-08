import { useState, useEffect } from 'react';
import React from 'react';
import { useCart } from './context/CartContext';
import { useLanguage } from './context/LanguageContext';
import { useProducts } from './context/ProductContext';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ShoppingBag, CheckCircle2, MessageCircle, Loader2, Printer, Clock, BadgeCheck, ChevronDown, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {  useUser  } from './lib/clerk';
import { SITE_HOST } from './lib/siteUrl';
import { trackPurchase } from './lib/pixel';
import { Helmet } from 'react-helmet-async';
import { BRAND } from './lib/seoContent';

function normalizeString(str: string): string {
  if (!str) return "";
  let s = str.trim().toLowerCase();
  
  // Replace common synonyms/short forms of Casablanca
  s = s.replace(/\bcasa\b/g, "casablanca");
  s = s.replace(/\bكازا\b/g, "دار بيضاء");
  s = s.replace(/\bكازابلانكا\b/g, "الدار البيضاء");
  
  // Normalize Arabic characters
  s = s.replace(/[أإآ]/g, "ا");
  s = s.replace(/ى/g, "ي");
  s = s.replace(/ة/g, "ه");
  
  // Remove common prefixes/al-
  s = s.replace(/\bal\b/g, ""); // english al
  s = s.replace(/\bel\b/g, ""); // english el
  s = s.replace(/^(ال)/g, ""); // arabic definite article at start
  s = s.replace(/[\s\-_](ال)/g, " ");
  
  // Remove hyphens, slashes, punctuation, accents (e.g. â -> a)
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove diacritics
  s = s.replace(/œ/g, "oe").replace(/æ/g, "ae");
  s = s.replace(/[\-\_\/\,\.\(\)\"\']/g, " "); // replace symbols/punctuation with space
  
  // Replace multiple spaces with single space
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function findBestCityMatch(extractedCity: string, citiesList: Array<{ name: string; translation: string; price_mad?: number | null }>): any {
  if (!extractedCity || !citiesList || citiesList.length === 0) return null;

  const normInput = normalizeString(extractedCity);
  if (!normInput) return null;

  // 1. Try exact match on name or translation.
  let exactMatch = citiesList.find(c => {
    return normalizeString(c.name) === normInput || normalizeString(c.translation) === normInput;
  });
  if (exactMatch) return exactMatch;

  // 2. Word-based overlap matching.
  let matches: { city: any; score: number; specificity: number }[] = [];
  const inputWords = normInput.split(" ");

  citiesList.forEach(city => {
    const normName = normalizeString(city.name);
    const normTrans = normalizeString(city.translation);

    const nameWords = normName.split(" ");
    const transWords = normTrans.split(" ");

    // Count how many input words are present in the city's name or translation words
    const nameScore = nameWords.filter(w => inputWords.includes(w)).length;
    const transScore = transWords.filter(w => inputWords.includes(w)).length;

    const score = Math.max(nameScore, transScore);
    if (score > 0) {
      const specificity = Math.max(city.name.length, city.translation.length);
      matches.push({ city, score, specificity });
    }
  });

  if (matches.length > 0) {
    // Sort primarily by matching score descending, and secondarily by specificity descending
    matches.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.specificity - a.specificity;
    });

    const best = matches[0];
    if (best.score >= 1) {
      return best.city;
    }
  }

  // 3. Substring match fallback (e.g. if the input is a single word sub-part like "maârouf" or "maarouf")
  let substringMatch = citiesList.find(c => {
    const normName = normalizeString(c.name);
    const normTrans = normalizeString(c.translation);
    return normName.includes(normInput) || normTrans.includes(normInput);
  });

  if (substringMatch) return substringMatch;

  return null;
}

function CheckoutCouponCountdown({ expiresAt, language }: { expiresAt: string, language: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const calculateTime = () => {
      const difference = +new Date(expiresAt) - +new Date();
      if (difference <= 0) {
        setTimeLeft(language === 'ar' ? "منتهي التفعيل" : "Expired");
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((difference / 1000 / 60) % 60);
      const seconds = Math.floor((difference / 1000) % 60);

      const parts = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0 || days > 0) parts.push(`${hours}h`);
      parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);

      setTimeLeft(parts.join(" "));
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, language]);

  return (
    <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-amber-700 font-mono font-bold bg-amber-50 px-2 py-1 rounded border border-amber-200/30">
      <Clock className="w-3 h-3 animate-pulse text-amber-600" />
      <span>
        {language === 'ar' ? 'ينتهي العرض الخاص في: ' : 'Expiring in: '}
        {timeLeft}
      </span>
    </div>
  );
}

export default function CheckoutPage() {
  const { storeSettings } = useProducts();
  const navigate = useNavigate();
  const { 
    cart, 
    totalPrice, 
    finalPrice, 
    discountAmount, 
    appliedCoupon, 
    applyCoupon, 
    removeCoupon, 
    clearCart 
  } = useCart();
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const isFr = language === 'fr';
  const pageTitle = isAr
    ? `إتمام الطلب | ${BRAND}`
    : isFr
      ? `Finaliser la Commande | ${BRAND}`
      : `Checkout | ${BRAND}`;

  const getItemDisplayName = (item: any) => {
    if (isAr) return item.name || item.name_en || '';
    return item.name_en || item.name || '';
  };
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<{
    items: any[],
    customer: any,
    total: string,
    orderNbr?: string,
    appliedCoupon?: { id: string; code: string; discountType: "percentage" | "fixed"; discountValue: number; expiresAt?: string | null } | null,
    discountAmount?: number,
    subtotalPrice?: string,
    shippingFee?: number,
    isFreeShipping?: boolean,
    isEurope?: boolean,
    reviewLink?: string,
  } | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');
  const [couponSuccess, setCouponSuccess] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [cities, setCities] = useState<{name: string, translation: string, price_mad?: number}[]>([]);
  const [countries, setCountries] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/countries')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCountries(data);
          const morocco = data.find(c => c.name_en === 'Morocco' || c.name_en === 'المغرب');
          if (morocco) {
             setFormData(f => ({ ...f, countryId: String(morocco.id), shippingMethod: 'standard' }));
          }
        }
      })
      .catch(err => console.error("Failed to load countries", err));
  }, []);

  useEffect(() => {
    fetch('/api/cities')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCities(data);
        } else {
          setCities([]); // fallback
        }
      })
      .catch(err => {
        console.error("Failed to load cities", err);
        setCities([]);
      });
  }, []);

  const handleApplyCoupon = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!couponInput.trim()) return;
    setCouponError('');
    setCouponSuccess('');
    setIsApplying(true);
    const result = await applyCoupon(couponInput.trim().toUpperCase());
    setIsApplying(false);
    if (result.success) {
      setCouponSuccess(result.message);
      setCouponInput('');
    } else {
      setCouponError(result.message);
    }
  };

  const handleRemoveCoupon = () => {
    removeCoupon();
    setCouponError('');
    setCouponSuccess('');
  };

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    address: '',
    city: '',
    zip: '',
    countryId: '',
    shippingMethod: 'standard'
  });
  const [addressError, setAddressError] = useState<string | null>(null);

  const { isSignedIn: isClerkSignedIn, user: clerkUser } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);
  const [aiText, setAiText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    if (isClerkSignedIn && (localStorage.getItem("adminToken") || localStorage.getItem("admin_token") || localStorage.getItem("sendit_token"))) {
      setIsAdmin(true);
    } else {
      setIsAdmin(false);
    }
  }, [isClerkSignedIn]);

  const handleExtractAddress = async () => {
    if (!aiText.trim()) return;
    setIsExtracting(true);
    try {
      const token = localStorage.getItem("adminToken") || localStorage.getItem("admin_token") || localStorage.getItem("sendit_token");
      const response = await fetch("/api/admin/extract-customer-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ text: aiText })
      });
      const res = await response.json();
      if (res.success && res.data) {
        let splitFirstName = res.data.name || "";
        let splitLastName = "";
        if (splitFirstName.includes(" ")) {
          const parts = splitFirstName.split(" ");
          splitFirstName = parts[0];
          splitLastName = parts.slice(1).join(" ");
        }

        let extractedCity = res.data.city || "";
        let requiresSuggestion = false;
        let finalMatchedCityName = "";

        if (extractedCity && cities.length > 0) {
            const matchedCity = findBestCityMatch(extractedCity, cities);
            if (matchedCity) {
                finalMatchedCityName = `${matchedCity.translation} - ${matchedCity.name}`;
            } else {
                requiresSuggestion = true;
            }
        }

        setFormData(prev => {
            return {
              ...prev,
              firstName: splitFirstName || prev.firstName,
              lastName: splitLastName || prev.lastName,
              phone: res.data.phone || prev.phone,
              city: finalMatchedCityName || prev.city,
              address: res.data.address || prev.address
            };
        });

        if (extractedCity && requiresSuggestion) {
            setCitySearch(extractedCity);
            setShowCityDropdown(true);
        }
      }
    } catch (e) {
      console.error("Extraction error", e);
    } finally {
      setIsExtracting(false);
    }
  };

  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [citySearch, setCitySearch] = useState("");

  const filteredCities = (citySearch.trim() === "") ? cities : (() => {
    const normSearch = normalizeString(citySearch);
    const scored = cities.map(c => {
      const normName = normalizeString(c.name || "");
      const normTrans = normalizeString(c.translation || "");
      
      let score = 0;
      if (normName === normSearch || normTrans === normSearch) {
        score = 100;
      } else if (normName.includes(normSearch) || normTrans.includes(normSearch)) {
        score = 80;
      } else if (normSearch.includes(normName) || normSearch.includes(normTrans)) {
        score = 50;
      } else {
        const searchWords = normSearch.split(" ");
        const nameWords = normName.split(" ");
        const transWords = normTrans.split(" ");
        
        const nameOverlap = nameWords.filter(w => searchWords.includes(w)).length;
        const transOverlap = transWords.filter(w => searchWords.includes(w)).length;
        score = Math.max(nameOverlap, transOverlap) * 10;
      }
      return { city: c, score };
    });
    
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.city);
  })();

  // Derive shipping cost from selected city
  const selectedCityData = cities.find(c => 
    formData.city && (formData.city.includes(c.translation) || formData.city.includes(c.name))
  );

  const selectedCountryData = countries.find(c => String(c.id) === formData.countryId);
  const isEurope = selectedCountryData?.is_europe;
  const isMorocco = selectedCountryData?.name_en?.toLowerCase() === 'morocco' || selectedCountryData?.name_ar === 'المغرب';
  const isFreeShipping = finalPrice >= (storeSettings?.freeShippingThreshold || 500);
  const shippingCost = (selectedCityData && selectedCityData.price_mad) ? selectedCityData.price_mad : 0;
  const effectiveShippingCost = isEurope ? 0 : (isFreeShipping ? 0 : shippingCost);
  const checkoutTotalNumeric = finalPrice + effectiveShippingCost;

  // Ensure we start at the top when submitting or showing errors
  useEffect(() => {
    if (isSubmitted || error) {
      window.scrollTo(0, 0);
    }
  }, [isSubmitted, error]);

  const getWhatsAppSummary = (
    items: any[],
    customer: any,
    total: string,
    orderNbr?: string,
    subtotalPriceVal?: string,
    discountAmount?: number,
    orderShippingFee?: number,
    orderIsFreeShipping?: boolean,
    orderIsEurope?: boolean
  ) => {
    const itemList = items.map((i, index) => `${index + 1}- ${i.name} (x${i.quantity}): ${i.price}`).join('\n');
    const orderHeader = orderNbr ? `*Order ID / N° de commande : ${orderNbr}*\n` : '';
    const originalSubtotal = subtotalPriceVal ? Math.round(parseFloat(subtotalPriceVal.replace(' DH', ''))) : parseFloat(total.replace(' DH', ''));
    const discount = discountAmount || 0;
    const isFree = orderIsFreeShipping !== undefined ? orderIsFreeShipping : (originalSubtotal - discount) >= (storeSettings?.freeShippingThreshold || 500);
    const isEur = orderIsEurope !== undefined ? orderIsEurope : isEurope;
    const totalNum = Math.round(parseFloat(total.replace(' DH', '')));
    const fee = orderShippingFee !== undefined ? orderShippingFee : Math.max(0, totalNum - (originalSubtotal - discount));
    
    // We already include the shipping price in "total" from checkout, so reflect that gracefully.
    const shippingLabel = isEur 
      ? `(${language === 'ar' ? 'سيتم تحديد تكلفة الشحن ومشاركتها لاحقًا' : 'Shipping price will be shared later'})`
      : isFree 
      ? `(${language === 'ar' ? 'توصيل مجاني 🎉' : language === 'fr' ? 'LIVRAISON GRATUITE 🎉' : 'FREE SHIPPING 🎉'})`
      : fee > 0
        ? `(${language === 'ar' ? `شامل مصاريف التوصيل: ${fee} DH` : `Shipping fee included: ${fee} DH`})`
        : `(${language === 'ar' ? 'سعر الشحن يحدد من قبل شركة الشحن' : 'Shipping price decided by shipping company'})`;
    
    return `
*${t('checkout.whatsappHeader')}*
${orderHeader}
${t('checkout.firstName')} ${t('checkout.lastName')} : ${customer.firstName} ${customer.lastName}
${t('checkout.address')} : ${customer.address}, ${customer.city}
${t('checkout.phone')} : ${customer.phone}

${t('checkout.itemSummary')} :
${itemList}

${t('cart.total')}: ${total} ${shippingLabel}
    `.trim();
  };

  const handleWhatsAppShare = () => {
    if (!lastOrder) return;
    const summary = getWhatsAppSummary(
      lastOrder.items,
      lastOrder.customer,
      lastOrder.total,
      lastOrder.orderNbr,
      lastOrder.subtotalPrice,
      lastOrder.discountAmount,
      lastOrder.shippingFee,
      lastOrder.isFreeShipping,
      lastOrder.isEurope
    );
    window.open(`https://wa.me/212677343386?text=${encodeURIComponent(summary)}`, '_blank');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (e.target.name === 'address' && e.target.value.trim().length >= 20) {
      setAddressError(null);
    }
  };

  const attemptKeyRef = React.useRef<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    if (cart.length === 0) return;

    const trimmedAddress = (formData.address || '').trim();
    if (trimmedAddress.length < 20) {
      setAddressError(
        language === 'ar'
          ? 'يرجى كتابة عنوان مفصل لا يقل عن 20 حرفاً لضمان وصول الشحنة بدقة.'
          : language === 'fr'
            ? "L'adresse doit comporter au moins 20 caractères pour assurer la livraison."
            : 'Address must be at least 20 characters to ensure accurate delivery.'
      );
      const el = document.querySelector('textarea[name="address"]') as HTMLTextAreaElement;
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    setAddressError(null);

    setIsLoading(true);
    setError(null);

    // Create a stable idempotency key for this checkout submission attempt
    if (!attemptKeyRef.current) {
      attemptKeyRef.current = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    try {
      const checkoutTotalStr = `${checkoutTotalNumeric} DH`;
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idempotencyKey: attemptKeyRef.current,
          customer: {
            ...formData,
            address: trimmedAddress,
          },
          items: cart,
          total: checkoutTotalStr,
          appliedCoupon: appliedCoupon ? { ...appliedCoupon } : null,
          discountAmount: discountAmount,
          subtotalPrice: totalPrice,
        }),
      });

      if (response.ok) {
        attemptKeyRef.current = null;
        const resData = await response.json();
        const orderNbr = resData.orderNbr;
        // Enforce a 2-second delay for a smoother processing experience
        setTimeout(() => {
          const orderData = { 
            items: [...cart], 
            customer: { ...formData, address: trimmedAddress }, 
            total: checkoutTotalStr,
            orderNbr: orderNbr,
            appliedCoupon: appliedCoupon ? { ...appliedCoupon } : null,
            discountAmount: discountAmount,
            subtotalPrice: totalPrice,
            shippingFee: effectiveShippingCost,
            isFreeShipping: isFreeShipping,
            isEurope: !!isEurope,
            reviewLink: resData.reviewLink,
          };
          setLastOrder(orderData);
          setIsSubmitted(true);
          // Pixel: fire Purchase with server-confirmed total, before
          // clearing the cart so the event captures the real order.
          trackPurchase({
            value: checkoutTotalNumeric,
            currency: "MAD",
            content_name: orderNbr || "",
          });
          clearCart();
          setIsLoading(false);
          // Force scroll to top
          window.scrollTo(0, 0);
        }, 2000);
      } else {
        // Surface the server's specific reason when it sends one. The backend
        // rejects a checkout with a clear, actionable message in cases the
        // customer can fix themselves — e.g. an item that no longer exists in
        // the catalog because it was deleted while it sat in their saved cart
        // ("Some items in your cart are no longer available: X. Please refresh
        // the page and try again."). Collapsing that into a generic
        // "an error occurred" left them stuck with no idea what to do.
        let serverMessage = '';
        try {
          const errData = await response.json();
          if (errData && typeof errData.message === 'string') {
            serverMessage = errData.message;
          }
        } catch {
          // Non-JSON error body — fall back to the generic message below.
        }
        setError(serverMessage || t('checkout.errorOccurred'));
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      setError(t('checkout.errorOccurred'));
      setIsLoading(false);
    }
  };

  if (isSubmitted && lastOrder) {
    const timePlaced = new Date().toLocaleString(
      isAr ? 'ar-MA-u-nu-latn' : isFr ? 'fr-FR' : 'en-GB',
      { dateStyle: 'medium', timeStyle: 'short' }
    );
    const formattedTotal = lastOrder.total.includes('DH') ? lastOrder.total : `${lastOrder.total} DH`;
    
    // Compute pricing details for coupon breakdown
    const hasCouponApplied = lastOrder.appliedCoupon != null;
    const subtotalPriceVal = lastOrder.subtotalPrice || lastOrder.total;
    const originalSubtotal = Math.round(parseFloat(subtotalPriceVal.replace(' DH', '')));
    const discountTotalAmount = lastOrder.discountAmount || 0;
    const itemsNetTotal = originalSubtotal - discountTotalAmount;
    const totalNumeric = Math.round(parseFloat(lastOrder.total.replace(' DH', '')));

    const isLastOrderFreeShipping = lastOrder.isFreeShipping !== undefined
      ? lastOrder.isFreeShipping
      : itemsNetTotal >= (storeSettings?.freeShippingThreshold || 500);

    const isLastOrderEurope = lastOrder.isEurope !== undefined ? lastOrder.isEurope : false;

    // Determine exact shipping fee (explicit or calculated difference)
    const lastOrderShippingFee = lastOrder.shippingFee !== undefined
      ? lastOrder.shippingFee
      : (isLastOrderEurope || isLastOrderFreeShipping ? 0 : Math.max(0, totalNumeric - itemsNetTotal));

    const handlePrintReceipt = () => {
      try {
        const prevTitle = document.title;
        document.title = "";
        window.print();
        setTimeout(() => {
          document.title = prevTitle;
        }, 1000);
      } catch (e) {
        console.error("Print error:", e);
      }
    };

    return (
      <div className="min-h-screen pt-40 lg:pt-32 pb-24 bg-background-soft px-4">
        <Helmet>
          <title>{pageTitle}</title>
          <meta name="robots" content="noindex, follow" />
        </Helmet>
        {/* Style block dedicated to printing page layout configuration */}
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page {
              size: A4 portrait;
              margin: 0 !important;
            }
            
            /* Force collapse height and hide screen elements entirely to avoid empty print pages */
            .no-print,
            .print\\:hidden,
            header,
            footer,
            nav,
            button {
              display: none !important;
              height: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }

            /* Hide other components visually without impacting their layout structures */
            body * {
              visibility: hidden !important;
            }

            /* Restore visual formatting for print container and its direct visual content */
            .print-invoice-max,
            .print-invoice-max * {
              visibility: visible !important;
            }

            /* Original and exact luxury design styling for print-invoice-max */
            .print-invoice-max {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              padding: 1.2cm !important;
              box-sizing: border-box !important;
              display: block !important;
              background: #ffffff !important;
              color: #000000 !important;
              font-family: system-ui, -apple-system, sans-serif !important;
            }

            /* Ensure body and html clear any height and default colors cleanly */
            html, body, #root, .min-h-screen, [class*="min-h-screen"], [class*="bg-background-soft"] {
              background: #ffffff !important;
              color: #000000 !important;
              font-family: system-ui, -apple-system, sans-serif !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              min-height: 0 !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
            }
          }
        `}} />

        {/* SCREEN PREVIEW LAYOUT (Only visible on browser screen, 100% hidden on paper/PDF print) */}
        <div className="max-w-2xl mx-auto print:hidden no-print screen-only">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-8 md:p-12 shadow-xl border border-primary-earth/5"
          >
            <div className="text-center mb-10">
              {/* Refined creative luxury success checkout logo lock-up */}
              <div className="relative w-24 h-24 mx-auto mb-6 flex items-center justify-center">
                {/* Concentric rings with micro-animations matching luxury aesthetics */}
                <div className="absolute inset-0 bg-green-100 rounded-full animate-[ping_2s_infinite] opacity-30"></div>
                <div className="absolute inset-2 bg-gradient-to-tr from-green-50 to-green-100/40 rounded-full border border-green-200/60 shadow-inner flex items-center justify-center">
                  <BadgeCheck className="w-12 h-12 text-green-600 drop-shadow-sm animate-[pulse_2s_infinite]" />
                </div>
              </div>
              
              <h2 className="text-2xl md:text-3xl font-light mb-2 leading-tight">{t('checkout.thankYou')}</h2>
              {lastOrder.orderNbr && (
                <div className="flex flex-col items-center gap-1.5 mb-4">
                  <p className="inline-block bg-accent-gold/20 text-primary-earth text-xs font-mono font-bold px-3 py-1 rounded-full">
                    {isAr ? 'رقم الطلب' : isFr ? 'N° de commande' : 'Order ID'}: {lastOrder.orderNbr}
                  </p>
                  <p className="text-xs text-primary-earth/60 font-mono">
                    {isAr ? 'تاريخ ووقت الطلب' : isFr ? 'Date de la commande' : 'Placed on'}: {timePlaced}
                  </p>
                </div>
              )}
              
              {/* WhatsApp Action Box right above the Order Summary */}
              <div className="bg-green-50 p-6 md:p-8 border border-green-600/15 rounded-none max-w-lg mx-auto shadow-sm mt-6">
                <p className="text-sm text-green-900 font-medium mb-5 leading-relaxed">
                  {lastOrder.customer.firstName}, {t('checkout.whatsappRedirect')}
                </p>
                <button 
                  onClick={handleWhatsAppShare}
                  className="inline-flex items-center justify-center space-x-3 bg-green-600 hover:bg-green-700 text-white px-10 py-5 text-sm font-bold uppercase tracking-[0.2em] transition-all duration-300 w-full cursor-pointer shadow-md active:scale-95 rounded-none"
                >
                  <MessageCircle className="w-5 h-5" />
                  <span>{t('checkout.sendWhatsApp')}</span>
                </button>
              </div>

              {/* Printable Receipt Action */}
              <div className="mt-5 max-w-lg mx-auto">
                <button 
                  onClick={handlePrintReceipt}
                  className="inline-flex items-center justify-center space-x-3 border-2 border-primary-earth hover:bg-primary-earth hover:text-white text-primary-earth px-10 py-4 text-xs font-bold uppercase tracking-[0.2em] transition-all duration-300 w-full cursor-pointer active:scale-95 rounded-none"
                >
                  <Printer className="w-4 h-4" />
                  <span>{isAr ? 'طباعة ملخص الطلب' : isFr ? 'Imprimer la Facture' : 'Print Order Summary'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 border-t border-b border-primary-earth/10 py-12 mb-12 text-sm">
              <div className="space-y-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{t('checkout.shippingInfo')}</h3>
                <div className="space-y-1 text-primary-earth">
                  <p className="font-medium">{lastOrder.customer.firstName} {lastOrder.customer.lastName}</p>
                  <p>{lastOrder.customer.address}</p>
                  <p>{lastOrder.customer.city}{lastOrder.customer.zip ? `, ${lastOrder.customer.zip}` : ''}</p>
                  <p className="pt-2"><span dir="ltr">{lastOrder.customer.phone}</span></p>
                </div>
                <div className="pt-4 border-t border-primary-earth/10 mt-4">
                  <h4 className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40 mb-1">
                    {isAr ? 'طريقة الدفع' : isFr ? 'Mode de Paiement' : 'Payment Method'}
                  </h4>
                  <p className="font-semibold text-green-700">
                    {isAr 
                      ? 'داخل المغرب الدفع عند الاستلام' 
                      : isFr 
                        ? 'Paiement à la livraison au Maroc' 
                        : 'Cash on Delivery (Inside Morocco)'}
                  </p>
                </div>
              </div>
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b border-primary-earth/10 pb-2">
                  <h3 className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{t('checkout.itemSummary')}</h3>
                  <button
                    onClick={handlePrintReceipt}
                    className="inline-flex items-center gap-1 text-[11px] text-accent-gold hover:text-primary-earth transition-colors duration-200"
                    title={isAr ? 'تحميل الفاتورة كـ PDF' : isFr ? 'Télécharger la Facture en PDF' : 'Download Invoice as PDF'}
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span className="underline decoration-dotted underline-offset-2">
                      {isAr ? 'تحميل كـ PDF' : isFr ? 'Imprimer / Enregistrer PDF' : 'Print / Save PDF'}
                    </span>
                  </button>
                </div>

                <div className="space-y-4 max-h-[200px] overflow-y-auto pr-2">
                  {lastOrder.items.map(item => (
                    <div key={item.id} className="flex justify-between items-start rtl:space-x-reverse">
                      <div className="flex space-x-3 rtl:space-x-reverse">
                        <div className="w-10 h-10 bg-background-soft p-1 flex-shrink-0">
                          {item.image && <img referrerPolicy="no-referrer" src={item.image || undefined} alt={getItemDisplayName(item)} loading="lazy" decoding="async" className="w-full h-full object-contain mix-blend-multiply" />}
                        </div>
                        <div>
                          <p className="font-medium text-xs">{getItemDisplayName(item)}</p>
                          <p className="text-primary-earth/40 text-[10px]">{t('cart.qty')}: {item.quantity}</p>
                        </div>
                      </div>
                      <div className="font-sans text-xs text-right text-primary-earth whitespace-nowrap" dir="ltr">
                        {item.quantity > 1 ? (
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] font-normal text-primary-earth/40 block mb-0.5">{Math.round(parseFloat(item.price.replace(' DH', '')))} DH × {item.quantity}</span>
                            <span className="text-accent-gold font-black">{Math.round(parseFloat(item.price.replace(' DH', '')) * item.quantity)} DH</span>
                          </div>
                        ) : (
                          <span className="text-accent-gold font-black">{Math.round(parseFloat(item.price.replace(' DH', '')))} DH</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-primary-earth/10 space-y-2.5">
                  <div className="flex justify-between text-xs text-primary-earth/60 font-mono">
                    <span>{isAr ? 'المجموع الفرعي:' : isFr ? 'Sous-total :' : 'Subtotal:'}</span>
                    <span dir="ltr">{originalSubtotal} DH</span>
                  </div>

                  {hasCouponApplied && lastOrder.appliedCoupon && (
                    <div className="flex justify-between text-xs text-green-700 font-mono">
                      <span className="flex items-center gap-1.5">
                        <span className="bg-green-100 text-green-800 text-[9px] font-bold px-1.5 py-0.5 rounded font-sans uppercase">
                          {lastOrder.appliedCoupon.code}
                        </span>
                        {isAr ? 'خصم الكوبون:' : isFr ? 'Remise Promo :' : 'Promo Discount:'}
                      </span>
                      <span dir="ltr">-{discountTotalAmount} DH</span>
                    </div>
                  )}

                  <div className="flex justify-between text-xs text-primary-earth/70 font-mono">
                    <span>{isAr ? 'مصاريف التوصيل والشحن:' : isFr ? 'Frais de Livraison :' : 'Shipping & Delivery:'}</span>
                    <span dir="ltr" className={isLastOrderFreeShipping ? "text-green-700 font-bold" : "font-semibold"}>
                      {isLastOrderEurope ? (
                        isAr ? 'سيتحدد لاحقاً' : isFr ? 'À déterminer ultérieurement' : 'To be determined'
                      ) : isLastOrderFreeShipping ? (
                        isAr ? 'مجاني (0 DH) 🎉' : isFr ? 'Gratuit (0 DH) 🎉' : 'Free (0 DH) 🎉'
                      ) : (
                        `${lastOrderShippingFee} DH`
                      )}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-dashed border-primary-earth/10 flex justify-between items-center">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{t('cart.total')}</span>
                    <div className="text-right">
                      <span className="text-xl font-semibold text-primary-earth block" dir="ltr">{formattedTotal}</span>
                      {isLastOrderFreeShipping ? (
                        <span className="text-xs font-bold text-green-600 uppercase tracking-widest block mt-0.5 animate-pulse">
                          {isAr ? 'توصيل مجاني 🎉' : isFr ? 'LIVRAISON GRATUITE 🎉' : 'FREE SHIPPING 🎉'}
                        </span>
                      ) : isLastOrderEurope ? (
                        <span className="text-[10px] text-accent-gold font-bold block mt-0.5">
                          {isAr ? 'سيتم احتساب سعر الشحن لاحقاً' : isFr ? 'Frais de port calculés plus tard' : 'Shipping calculated later'}
                        </span>
                      ) : (
                        <span className="text-[10px] text-primary-earth/50 font-medium block mt-0.5">
                          {isAr ? 'شامل مصاريف التوصيل' : isFr ? 'Frais de livraison inclus' : 'Shipping fee included'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center space-y-6">
              <div className="pt-4">
                <Link to="/" className="inline-block text-primary-earth/40 text-[10px] font-bold uppercase tracking-widest hover:text-accent-gold transition-colors">
                  {t('checkout.returnedToShop')}
                </Link>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ELEGANT PRINT RE-DESIGNED BRANDED INVOICE (Only visible during print, optimized to occupy exactly 1 premium A4 page without overflows) */}
        <div className="hidden print:block w-full max-w-4xl mx-auto p-2 font-sans text-black select-text print-invoice-max" dir={isAr ? 'rtl' : 'ltr'}>
          {/* Branded Luxury Header */}
          <div className="text-center pb-3.5 border-b-2 border-black/80">
            <h1 className="text-2xl font-serif font-bold tracking-[0.25em] text-black">BELLAURA OILS</h1>
            <p className="text-[8px] uppercase tracking-[0.4em] text-black/60 mt-0.5">
              {isAr 
                ? 'زيوت نباتية طبيعية نقية ومستحضرات تجميل فاخرة'
                : isFr 
                  ? 'Huiles Végétales Pures & Essences Cosmétiques de Luxe'
                  : 'Pure Botanical Oils & High-End Cosmetic Essences'}
            </p>
            <p className="text-[9px] text-black/45 mt-0.5 font-mono">{SITE_HOST}</p>
          </div>

          {/* Invoice Meta-Details Block with reduced compact layout */}
          <div className="flex justify-between items-start py-4 text-[11px] font-mono border-b border-black/10">
            <div>
              <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-black mb-1">
                {isAr 
                  ? 'فاتورة تأكيد الطلب' 
                  : isFr 
                    ? 'Facture & Confirmation de Commande' 
                    : 'Invoice & Order Confirmation'}
              </h2>
              <p className="space-x-1 rtl:space-x-reverse">
                <span className="font-extrabold text-black/60">
                  {isAr ? 'رقم الطلب:' : isFr ? 'N° de Commande :' : 'Order ID:'}
                </span>
                <span className="font-bold underline text-black"> #{lastOrder.orderNbr}</span>
              </p>
              <p className="mt-0.5">
                <span className="font-extrabold text-black/60">
                  {isAr ? 'تاريخ الطلب:' : isFr ? 'Date d\'Émission :' : 'Date Issued:'}
                </span>
                <span className="text-black"> {timePlaced}</span>
              </p>
            </div>
            <div className="text-right rtl:text-left">
              <span className="inline-block bg-black text-white px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-none">
                {isAr 
                  ? 'الدفع عند الاستلام (COD)' 
                  : isFr 
                    ? 'PAIEMENT À LA LIVRAISON (COD)' 
                    : 'CASH ON DELIVERY (COD)'}
              </span>
              <p className="mt-1 text-[9px] text-black/60">
                {isAr 
                  ? 'الحالة: قيد التجهيز والشحن' 
                  : isFr 
                    ? 'Statut : En cours de préparation pour expédition' 
                    : 'Status: Processing for dispatch'}
              </p>
            </div>
          </div>

          {/* Grid of addresses (Tightened padding to guarantee single page print height limits) */}
          <div className="grid grid-cols-2 gap-4 py-4 text-xs border-b border-black/10">
            <div>
              <h3 className="text-[8px] uppercase font-bold tracking-widest text-black/50 mb-1 font-mono">
                {isAr ? 'العميل المستلم:' : isFr ? 'Destinataire :' : 'Deliver To:'}
              </h3>
              <p className="font-bold text-xs text-black">{lastOrder.customer.firstName} {lastOrder.customer.lastName}</p>
              <p className="mt-0.5 text-black/70 font-mono text-[11px]"><span dir="ltr">{lastOrder.customer.phone}</span></p>
            </div>
            <div>
              <h3 className="text-[8px] uppercase font-bold tracking-widest text-black/50 mb-1 font-mono">
                {isAr ? 'عنوان الشحن والتسليم:' : isFr ? 'Adresse de Livraison :' : 'Shipping Destination:'}
              </h3>
              <p className="text-black/80 leading-relaxed font-normal text-[11px]">{lastOrder.customer.address}</p>
              <p className="text-black font-semibold text-[11px]">
                {lastOrder.customer.city} {lastOrder.customer.zip ? `(${lastOrder.customer.zip})` : ''}
              </p>
              <p className="text-[9px] text-black/50 font-mono mt-0.5 italic">
                {isAr 
                  ? 'المملكة المغربية (Morocco)' 
                  : isFr 
                    ? 'Royaume du Maroc (Maroc)' 
                    : 'Kingdom of Morocco'}
              </p>
            </div>
          </div>

          {/* Clean printed tabular area with tighter paddings */}
          <div className="py-4">
            <h3 className="text-[8px] uppercase font-bold tracking-widest text-black/50 mb-2 font-mono">
              {isAr 
                ? 'تفاصيل المنتجات والأسعار' 
                : isFr 
                  ? 'Détails des Produits & Tarifs' 
                  : 'Purchased Items List & Breakdown'}
            </h3>
            <table className="w-full text-[11px] text-left rtl:text-right border-collapse">
              <thead>
                <tr className="border-b border-black bg-gray-50 uppercase tracking-wider text-[8px] font-bold font-mono">
                  <th className="py-1.5 px-2 text-black">{isAr ? 'المنتوج' : isFr ? 'Produit / Article' : 'Botanical Item / Product'}</th>
                  <th className="py-1.5 px-2 text-center text-black">{isAr ? 'الكمية' : isFr ? 'Qté' : 'Qty'}</th>
                  <th className="py-1.5 px-2 text-right rtl:text-left text-black">{isAr ? 'سعر الوحدة' : isFr ? 'Prix Unitaire' : 'Unit Price'}</th>
                  <th className="py-1.5 px-2 text-right rtl:text-left text-black">{isAr ? 'المجموع فرعي' : isFr ? 'Sous-total' : 'Subtotal'}</th>
                </tr>
              </thead>
              <tbody>
                {lastOrder.items.map((item, index) => {
                  const rawPrice = Math.round(parseFloat(item.price.replace(' DH', '')));
                  const rowSubtotal = rawPrice * item.quantity;
                  return (
                    <tr key={index} className="border-b border-black/10 font-mono">
                      <td className="py-2 px-2 font-sans font-semibold text-black">
                        <div>
                          <span>{getItemDisplayName(item)}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center font-bold text-black font-mono">{item.quantity}</td>
                      <td className="py-2 px-2 text-right rtl:text-left text-black/80" dir="ltr">{rawPrice} DH</td>
                      <td className="py-2 px-2 text-right rtl:text-left font-bold text-black" dir="ltr">{rowSubtotal} DH</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Price Calculation details summary - highly compact */}
          <div className="flex justify-end py-2">
            <div className="w-full max-w-xs space-y-1 text-[11px] font-mono border-t border-black/35 pt-1.5">
              <div className="flex justify-between text-black/70">
                <span>{isAr ? 'المجموع الفرعي:' : isFr ? 'Sous-total :' : 'Subtotal:'}</span>
                <span dir="ltr">{originalSubtotal} DH</span>
              </div>

              {hasCouponApplied && lastOrder.appliedCoupon && (
                <div className="flex justify-between text-green-800 font-semibold text-[10px]">
                  <span>
                    {isAr ? 'خصم الكوبون:' : isFr ? 'Remise Code Promo :' : 'Coupon Discount:'} <span className="underline font-mono">{lastOrder.appliedCoupon.code}</span>
                  </span>
                  <span dir="ltr">-{discountTotalAmount} DH</span>
                </div>
              )}

              <div className="flex justify-between text-black/70">
                <span>{isAr ? 'مصاريف التوصيل والشحن:' : isFr ? 'Frais de Livraison :' : 'Shipping & Delivery:'}</span>
                <span dir="ltr" className={isLastOrderFreeShipping ? "text-green-800 font-bold" : "font-bold text-black"}>
                  {isLastOrderEurope ? (
                    isAr ? 'سيتحدد لاحقاً' : isFr ? 'À déterminer ultérieurement' : 'To be determined'
                  ) : isLastOrderFreeShipping ? (
                    isAr ? 'مجاني (0 DH) 🎉' : isFr ? 'Gratuit (0 DH) 🎉' : 'Free (0 DH) 🎉'
                  ) : (
                    `${lastOrderShippingFee} DH`
                  )}
                </span>
              </div>

              <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-black/25">
                <span className="font-bold text-black/80">{isAr ? 'المبلغ المستحق:' : isFr ? 'Total à Payer :' : 'Total To Pay:'}</span>
                <span className="text-base font-black text-black underline underline-offset-4" dir="ltr">
                  {formattedTotal}
                </span>
              </div>

              <p className="text-[8px] text-right rtl:text-left font-medium italic leading-tight pt-1">
                {isLastOrderEurope ? (
                  <span className="text-black/60">
                    {isAr
                      ? '* تكلفة الشحن الدولي ستُحدد وتُشارك معكم عبر واتساب.'
                      : isFr
                        ? '* Les frais de livraison internationale seront confirmés et partagés avec vous sur WhatsApp.'
                        : '* International shipping price will be confirmed and shared via WhatsApp.'}
                  </span>
                ) : isLastOrderFreeShipping ? (
                  <span className="text-green-700 font-bold">
                    {isAr
                      ? '✓ مبروك! لقد حصلت على توصيل مجاني لطلبك! 🎉'
                      : isFr
                        ? '✓ Félicitations ! Vous bénéficiez de la livraison gratuite sur votre commande ! 🎉'
                        : '✓ Congratulations! You have unlocked FREE SHIPPING on this order! 🎉'}
                  </span>
                ) : (
                  <span className="text-black/60">
                    {isAr
                      ? '* السعر الإجمالي شامل مصاريف التوصيل والدفع عند الاستلام.'
                      : isFr
                        ? '* Le montant total inclut les frais de livraison et le paiement à la livraison.'
                        : '* Total price includes delivery fee and cash on delivery.'}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Tagline footer - placed gracefully with less margin to comfortably stay on Page 1 */}
          <div className="text-center pt-5 mt-5 border-t border-black/10">
            <p className="text-xs font-serif italic text-black/80">
              {isAr 
                ? 'نشكركم على ثقتكم الغالية بمنتجات Bellaura Oils! نسعد بخدمتكم دائماً.' 
                : isFr 
                  ? 'Merci pour votre précieuse confiance en Bellaura Oils ! Nous sommes ravis de vous servir.' 
                  : 'Thank you for your trust in Bellaura Oils! We wish you a pure, beautiful botanical journey.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-20 px-4">
        <Helmet>
          <title>{pageTitle}</title>
          <meta name="robots" content="noindex, follow" />
        </Helmet>
        <ShoppingBag className="w-16 h-16 text-primary-earth/10 mb-6" />
        <h2 className="text-2xl font-light mb-4">{t('cart.empty')}</h2>
        <button onClick={() => navigate(-1)} className="text-accent-gold font-bold uppercase tracking-widest text-sm border-b-2 border-accent-gold pb-1">
          {t('cart.continue')}
        </button>
      </div>
    );
  }

  return (
    <div className="pt-40 lg:pt-32 pb-24 bg-background-soft min-h-screen relative">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center"
          >
            <Loader2 className="w-12 h-12 text-accent-gold animate-spin mb-4" />
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-primary-earth animate-pulse mb-2">
              {t('checkout.processing')}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-primary-earth/60">
              {t('checkout.itemSummary')}
            </p>
          </motion.div>
        )}

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[200] bg-white/90 flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="max-w-md w-full">
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShoppingBag className="w-10 h-10 text-red-600" />
              </div>
              <h2 className="text-3xl font-light mb-4">{error}</h2>
              <button 
                onClick={() => handleSubmit(undefined as any)}
                className="w-full bg-primary-earth text-white py-5 text-sm font-bold uppercase tracking-widest hover:bg-accent-gold transition-all duration-300 mb-4"
              >
                {t('checkout.resendOrder')}
              </button>
              <button 
                onClick={() => setError(null)}
                className="text-primary-earth/40 text-[10px] uppercase font-bold tracking-widest hover:text-primary-earth"
              >
                {t('checkout.returnedToShop')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          
          {/* Form */}
          <motion.div 
            initial={{ opacity: 1, x: 0 }}
            animate={{ opacity: 1, x: 0 }}
            className="order-2 lg:order-1"
          >
            <h1 className="text-4xl font-light mb-12">{t('checkout.title')}</h1>
            
            {isAdmin && (
              <div className="mb-8 p-4 bg-primary-earth/5 border border-primary-earth/10">
                <h3 className="text-sm font-bold text-primary-earth mb-2 uppercase tracking-widest flex items-center">
                  <span className="w-2 h-2 bg-accent-gold rounded-full flex-shrink-0 mr-2 animate-pulse"></span>
                  Admin Assistant: Auto-Fill
                </h3>
                <textarea
                  className="w-full bg-white border border-primary-earth/10 p-3 mb-3 text-sm focus:outline-none focus:border-accent-gold resize-none"
                  rows={3}
                  placeholder="Paste customer message containing address and details here..."
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                />
                <button
                  type="button"
                  disabled={isExtracting || !aiText.trim()}
                  onClick={handleExtractAddress}
                  className="w-full bg-[#2c5836] text-white py-3 text-xs font-bold uppercase tracking-widest hover:bg-[#2c5836]/90 transition-colors disabled:opacity-50"
                >
                  {isExtracting ? "Extracting Data..." : "Extract Customer Data"}
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{language === 'ar' ? 'الاسم الكامل' : 'Full Name'}</label>
                <input 
                  required
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  className="w-full bg-white border border-primary-earth/10 px-4 py-3 focus:outline-none focus:border-accent-gold bg-transparent transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{t('checkout.phone')}</label>
                <input 
                  type="tel"
                  dir="ltr"
                  required
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full bg-white border border-primary-earth/10 px-4 py-3 focus:outline-none focus:border-accent-gold bg-transparent transition-colors text-left rtl:text-right"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{language === 'ar' ? 'الدولة' : 'Country'}</label>
                <div className="relative">
                  <select
                    value={formData.countryId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      const country = countries.find(c => String(c.id) === cid);
                      setFormData(f => ({
                        ...f,
                        countryId: cid,
                        shippingMethod: country?.is_europe ? 'colis_postal' : 'standard',
                        city: country?.is_europe ? '' : f.city
                      }));
                    }}
                    className="w-full bg-white border border-primary-earth/10 px-4 py-3 focus:outline-none focus:border-accent-gold transition-colors appearance-none"
                  >
                    <option value="" disabled>{language === 'ar' ? 'اختر الدولة...' : 'Select Country...'}</option>
                    {countries.map(c => (
                      <option key={c.id} value={c.id}>
                        {language === 'ar' ? c.name_ar : c.name_en}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-primary-earth/40 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2 relative">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">{t('checkout.city')}</label>
                  {isMorocco ? (
                    <div className="relative">
                      <div 
                        className="w-full bg-white border border-primary-earth/10 px-4 py-3 flex items-center justify-between cursor-pointer transition-colors hover:border-primary-earth/30"
                        onClick={() => setShowCityDropdown(!showCityDropdown)}
                      >
                        <span className={formData.city ? "text-primary-earth" : "text-primary-earth/40"}>
                          {formData.city || t('checkout.city')}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-primary-earth/40 transition-transform ${showCityDropdown ? 'rotate-180' : ''}`} />
                      </div>
                      {showCityDropdown && (
                        <>
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => { setShowCityDropdown(false); setCitySearch(''); }}
                          />
                          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-primary-earth/10 shadow-xl max-h-60 overflow-y-auto">
                            <div className="sticky top-0 bg-white p-2 border-b border-primary-earth/10 z-10">
                              <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-primary-earth/40" />
                                <input
                                  type="text"
                                  autoFocus
                                  placeholder={language === 'ar' ? 'بحث عن مدينة...' : 'Search city...'}
                                  value={citySearch}
                                  onChange={(e) => setCitySearch(e.target.value)}
                                  className="w-full bg-primary-earth/5 border-none px-9 py-2 text-xs focus:outline-none"
                                />
                              </div>
                            </div>
                            {filteredCities.slice(0, 30).map((city) => (
                              <div 
                                key={city.name}
                                className="px-4 py-2 cursor-pointer hover:bg-primary-earth/5 text-sm transition-colors text-primary-earth"
                                onClick={() => {
                                  setFormData({ ...formData, city: `${city.translation} - ${city.name}` });
                                  setShowCityDropdown(false);
                                  setCitySearch('');
                                }}
                              >
                                {city.translation} - {city.name}
                              </div>
                            ))}
                            {citySearch.trim() !== '' && (
                              <div 
                                className="px-4 py-3 cursor-pointer hover:bg-primary-earth/5 text-sm transition-colors text-primary-earth border-t border-primary-earth/10 flex items-center gap-2"
                                onClick={() => {
                                  setFormData({ ...formData, city: citySearch.trim() });
                                  setShowCityDropdown(false);
                                  setCitySearch('');
                                }}
                              >
                                <span className="font-medium">{language === 'ar' ? 'استخدام' : 'Use'} "{citySearch.trim()}"</span>
                              </div>
                            )}
                            {filteredCities.length === 0 && (
                              <div className="px-4 py-3 text-xs text-center text-primary-earth/40 italic">
                                {language === 'ar' ? 'لم يتم العثور على مدينة' : 'No city found'}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <input 
                      required
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      placeholder={language === 'ar' ? 'أدخل مدينتك' : 'Enter your city'}
                      className="w-full bg-white border border-primary-earth/10 px-4 py-3 focus:outline-none focus:border-accent-gold bg-transparent transition-colors"
                    />
                  )}
                </div>
                {!isMorocco && (
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">
                      {t('checkout.zip')} <span className="text-[9px] lowercase opacity-60">({t('checkout.optional') || (language === 'ar' ? 'اختياري' : 'optional')})</span>
                    </label>
                    <input 
                      name="zip"
                      value={formData.zip}
                      onChange={handleChange}
                      className="w-full bg-white border border-primary-earth/10 px-4 py-3 focus:outline-none focus:border-accent-gold bg-transparent transition-colors"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-primary-earth/40">
                    {t('checkout.address')}
                  </label>
                  <span className={`text-[10px] font-medium transition-colors ${
                    formData.address.trim().length >= 20 ? 'text-emerald-600 font-bold' : 'text-primary-earth/50'
                  }`}>
                    {formData.address.trim().length} / 20 {language === 'ar' ? 'حرف كحد أدنى' : language === 'fr' ? 'caractères min' : 'chars min'}
                  </span>
                </div>
                <textarea 
                  required
                  name="address"
                  rows={3}
                  value={formData.address}
                  onChange={handleChange}
                  placeholder={
                    language === 'ar'
                      ? 'يرجى كتابة العنوان بالتفصيل (اسم الشارع، رقم العمارة أو المنزل، الحي، علامة مميزة... 20 حرفاً على الأقل)'
                      : language === 'fr'
                        ? "Adresse complète (rue, n° d'immeuble/maison, quartier... au moins 20 caractères)"
                        : "Detailed street address, building/house number, neighborhood... (at least 20 characters)"
                  }
                  className={`w-full bg-white border px-4 py-3 focus:outline-none transition-colors resize-none ${
                    addressError
                      ? 'border-red-500 focus:border-red-600'
                      : formData.address.trim().length > 0 && formData.address.trim().length < 20
                        ? 'border-amber-400 focus:border-amber-500'
                        : 'border-primary-earth/10 focus:border-accent-gold'
                  }`}
                />
                {addressError && (
                  <p className="text-[11px] text-red-600 font-medium mt-1">
                    {addressError}
                  </p>
                )}
                {!addressError && formData.address.trim().length > 0 && formData.address.trim().length < 20 && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    {language === 'ar'
                      ? `بقي ${20 - formData.address.trim().length} حرفًا للوصول للحد الأدنى المطلوب.`
                      : language === 'fr'
                        ? `Encore ${20 - formData.address.trim().length} caractères requis.`
                        : `${20 - formData.address.trim().length} more characters required.`}
                  </p>
                )}
              </div>

              {/* Shipping Method Selection removed as requested */}

              {/* Cash on Delivery Policy Notice */}
              <div className="bg-[#f4f7f5] border border-[#2c5836]/10 p-4 rounded-none flex items-start gap-3.5" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                <div className="w-8 h-8 rounded-full bg-[#2c5836]/10 flex items-center justify-center text-[#2c5836] shrink-0 font-black text-[10px] tracking-tight">
                  COD
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-bold text-primary-earth uppercase tracking-wider">
                    {language === 'ar' ? 'الدفع عند الاستلام' : language === 'fr' ? 'Paiement à la Livraison' : 'Cash on Delivery'}
                  </p>
                  <p className="text-[11px] text-primary-earth/70 mt-1 leading-relaxed">
                    {language === 'ar' 
                      ? 'داخل المغرب الدفع عند الاستلام.' 
                      : language === 'fr' 
                        ? 'Au Maroc, le paiement se fait à la livraison.' 
                        : 'Inside Morocco, payment is on delivery.'}
                  </p>
                </div>
              </div>

              <button 
                type="submit"
                disabled={isLoading || cart.length === 0}
                className={`w-full py-5 mt-8 text-xs font-bold uppercase tracking-widest transition-all duration-300 ${
                  (isLoading || cart.length === 0)
                    ? 'bg-gray-150 text-gray-400 border border-gray-200 cursor-not-allowed'
                    : 'bg-primary-earth text-white hover:bg-accent-gold cursor-pointer'
                }`}
              >
                {isLoading ? t('checkout.processing') : t('checkout.placeOrder')}
              </button>
            </form>
          </motion.div>

          {/* Order Summary */}
          <motion.div 
            initial={{ opacity: 1, x: 0 }}
            animate={{ opacity: 1, x: 0 }}
            className="order-1 lg:order-2 bg-white p-8 lg:p-12 h-fit border border-primary-earth/5"
          >
            <h2 className="text-2xl font-light mb-8">{t('checkout.summary')}</h2>
            <div className="space-y-6 mb-8 max-h-[400px] overflow-y-auto pr-2">
              {cart.map(item => (
                <div key={item.id} className="flex justify-between items-center text-sm">
                  <div className="flex items-center space-x-4 rtl:space-x-reverse">
                    <div className="w-12 h-12 bg-background-soft p-1 flex-shrink-0">
                      {item.image && <img referrerPolicy="no-referrer" src={item.image || undefined} alt={item.name} loading="lazy" decoding="async" className="w-full h-full object-contain mix-blend-multiply" />}
                    </div>
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-primary-earth/40 text-xs">{t('cart.qty')}: {item.quantity}</p>
                    </div>
                  </div>
                  <div className="font-sans text-right text-xs sm:text-sm text-primary-earth whitespace-nowrap" dir="ltr">
                    {item.quantity > 1 ? (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-normal text-primary-earth/40 block mb-0.5">{Math.round(parseFloat(item.price.replace(' DH', '')))} DH × {item.quantity}</span>
                        <span className="text-accent-gold font-black tracking-wide">{Math.round(parseFloat(item.price.replace(' DH', '')) * item.quantity)} DH</span>
                      </div>
                    ) : (
                      <span className="text-accent-gold font-black tracking-wide">{Math.round(parseFloat(item.price.replace(' DH', '')))} DH</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="border-t border-primary-earth/10 pt-6 space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-primary-earth/60">{t('checkout.shipping')}</span>
                {isEurope ? (
                  <span className="text-right text-xs sm:text-sm font-bold text-accent-gold max-w-[200px] leading-snug animate-pulse">
                    {language === 'ar' ? 'سيتحدد لاحقاً' : 'To be determined'}
                  </span>
                ) : isFreeShipping ? (
                  <span className="text-right text-xs sm:text-sm text-green-600 font-bold max-w-[200px] leading-snug animate-pulse">
                    {language === 'ar' ? 'توصيل مجاني 🎉' : language === 'fr' ? 'Livraison gratuite ! 🎉' : 'Free Shipping! 🎉'}
                  </span>
                ) : formData.city ? (
                  <span className="text-right text-xs sm:text-sm font-bold text-accent-gold max-w-[200px] leading-snug">
                    {shippingCost > 0 ? `${shippingCost} DH` : (language === 'ar' ? 'سعر الشحن يحدد من قبل شركة الشحن' : 'Price decided by the shipping company')}
                  </span>
                ) : (
                  <span className="text-right text-xs sm:text-sm text-accent-gold font-medium max-w-[200px] leading-snug">{t('checkout.shippingInfoNotice')}</span>
                )}
              </div>

              {/* Promo Code section inside Checkout Summary */}
              <div className="border-t border-primary-earth/5 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary-earth/60 mb-2">
                  {language === 'ar' ? 'هل لديك رمز تخفيض؟' : 'Have a Promo Code?'}
                </h3>
                {!appliedCoupon ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={language === 'ar' ? 'أدخل الرمز هنا...' : 'Enter coupon here...'}
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      className="flex-grow bg-background-soft border border-primary-earth/10 px-3 py-2 text-xs focus:outline-none focus:border-accent-gold uppercase font-semibold font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleApplyCoupon()}
                      disabled={isApplying}
                      className="bg-primary-earth hover:bg-accent-gold text-white text-[10px] font-bold uppercase tracking-[0.1em] px-4 py-2 cursor-pointer transition-all duration-300"
                    >
                      {isApplying ? '...' : (language === 'ar' ? 'تطبيق' : 'Apply')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col bg-green-50/50 border border-green-600/10 p-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-green-800 font-mono font-medium">
                        {appliedCoupon.code} ({appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.discountValue}%` : `${appliedCoupon.discountValue} DH`})
                      </span>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="text-red-500 hover:text-red-700 font-bold font-mono text-[10px] hover:underline"
                      >
                        {language === 'ar' ? 'إزالة' : 'Remove'}
                      </button>
                    </div>
                    {appliedCoupon.expiresAt && (
                      <CheckoutCouponCountdown expiresAt={appliedCoupon.expiresAt} language={language} />
                    )}
                  </div>
                )}

                {couponError && <p className="text-[10px] text-red-600 font-medium mt-1.5">{couponError}</p>}
                {couponSuccess && <p className="text-[10px] text-green-600 font-medium mt-1.5">{couponSuccess}</p>}
              </div>

                <div className="flex justify-between items-center pb-2 mb-2 border-b border-primary-earth/10">
                  <span className="text-[12px] font-bold text-primary-earth uppercase tracking-widest">{t('checkout.total')}</span>
                  <div className="text-right">
                    <span className="text-xl font-bold text-accent-gold flex items-center justify-end gap-1">
                      {checkoutTotalNumeric.toFixed(2)} DH
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-primary-earth/60 uppercase tracking-widest">{t('checkout.shipping')}</span>
                  <div className="text-right">
                  {isEurope ? (
                    <span className="text-[10px] text-accent-gold font-bold block mt-1">
                      {language === 'ar' ? 'سيتم احتساب سعر الشحن في الواتساب مباشرة' : 'Shipping price will be calculated in WhatsApp directly'}
                    </span>
                  ) : isFreeShipping ? (
                    <span className="text-[10px] text-green-600 font-bold uppercase tracking-wider block mt-1">
                      {language === 'ar' ? 'توصيل مجاني 🎉' : 'Free Shipping 🎉'}
                    </span>
                  ) : formData.city && shippingCost > 0 ? (
                    <span className="text-[10px] text-primary-earth/60 font-medium block mt-1">
                      {language === 'ar' ? `يشمل توصيل (${shippingCost} DH)` : `Includes Shipping (${shippingCost} DH)`}
                    </span>
                  ) : formData.city ? (
                    <span className="text-[10px] text-primary-earth/60 font-medium block mt-1">
                      {language === 'ar' ? 'سعر الشحن يحدد من قبل شركة الشحن' : 'Price decided by the shipping company'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-primary-earth/40 font-medium block mt-1 italic">
                      {language === 'ar' ? 'أدخل المدينة لرؤية تكلفة الشحن' : 'Enter city for shipping cost'}
                    </span>
                  )}
                </div>
              </div>

              {/* Secure checkout info & COD notice */}
              <div className="border-t border-primary-earth/10 pt-5 mt-5 flex flex-col gap-3 text-xs text-primary-earth/60">
                <div className="flex items-center gap-2 text-green-700 bg-green-50/50 p-2.5 border border-green-600/10 font-bold" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                  <span className="text-lg">📦</span>
                  <span>{language === 'ar' ? 'داخل المغرب الدفع عند الاستلام' : 'Cash on Delivery Inside Morocco'}</span>
                </div>
                <div className="flex items-center gap-2" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                  <span className="text-base text-accent-gold">🛡️</span>
                  <span>{language === 'ar' ? 'عملية شراء آمنة ومضمونة 100٪' : '100% Safe & Secure Checkout'}</span>
                </div>
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
