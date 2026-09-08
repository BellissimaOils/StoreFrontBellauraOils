import { X, Plus, Minus, ShoppingBag, Clock, Truck, Sparkles } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useProducts } from '../context/ProductContext';
import { getOptimizedImageUrl } from '../lib/imageUtils';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';

function CartCouponCountdown({ expiresAt, language, isOpen }: { expiresAt: string, language: string, isOpen: boolean }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    const calculateTime = () => {
      const difference = +new Date(expiresAt) - +new Date();
      if (difference <= 0) {
        setTimeLeft(language === 'ar' ? "منتهي" : "Expired");
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
  }, [expiresAt, language, isOpen]);

  return (
    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-700 font-mono font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200/30">
      <Clock className="w-3 h-3 animate-pulse text-amber-600" />
      <span>
        {language === 'ar' ? 'ينتهي في: ' : 'Expiring in: '}
        {timeLeft}
      </span>
    </div>
  );
}

interface CartOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartOverlay({ isOpen, onClose }: CartOverlayProps) {
  const { 
    cart, 
    removeFromCart, 
    updateQuantity, 
    totalPrice, 
    totalItems,
    appliedCoupon,
    applyCoupon,
    removeCoupon,
    discountAmount,
    finalPrice,
    addToCart
  } = useCart();
  const { products, storeSettings } = useProducts();
  const { language, t } = useLanguage();
  const navigate = useNavigate();

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');
  const [couponSuccess, setCouponSuccess] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const handleCheckout = () => {
    onClose();
    navigate('/checkout');
  };

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const isRtl = language === 'ar';

  const FREE_SHIPPING_THRESHOLD = storeSettings?.freeShippingThreshold || 500;
  const isFreeShipping = finalPrice >= FREE_SHIPPING_THRESHOLD;
  const amountNeeded = FREE_SHIPPING_THRESHOLD - finalPrice;
  const progressPercent = Math.min(100, (finalPrice / FREE_SHIPPING_THRESHOLD) * 100);

  const suggestedProducts = products
    .filter(p => p.isAvailable !== false && !cart.some(item => item.id === p.id))
    .slice(0, 3);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-primary-earth/40 backdrop-blur-sm z-[100]"
          />
          
          {/* Floating Cart Panel */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: -15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -15 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={`fixed ${isRtl ? 'left-4 lg:left-8' : 'right-4 lg:right-8'} top-[168px] lg:top-28 bottom-4 lg:bottom-8 w-[calc(100vw-32px)] sm:w-[500px] bg-white z-[101] shadow-2xl rounded-2xl border border-primary-earth/15 flex flex-col overflow-hidden`}
          >
            <div className="p-4 border-b border-primary-earth/10 flex justify-between items-center bg-white">
              <h2 className="text-lg font-bold text-primary-earth uppercase tracking-wider">{t('cart.title')} ({totalItems})</h2>
              <button 
                onClick={onClose}
                className="p-1 px-1.5 hover:bg-background-soft rounded-full transition-colors text-primary-earth/60 hover:text-primary-earth"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dynamic Free Shipping Threshold Bar */}
            {cart.length > 0 && (
              <div className="px-5 py-3.5 bg-accent-gold/5 border-b border-accent-gold/15 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-primary-earth">
                  {isFreeShipping ? (
                    <span className="text-green-700 flex items-center gap-1.5 font-sans">
                      <Truck className="w-4 h-4 text-green-600 animate-bounce" />
                      {isRtl ? 'مبروك! لقد حصلت على توصيل مجاني لطلبك! 🎉' : language === 'fr' ? 'Livraison gratuite activée ! 🎉' : 'You have unlocked FREE SHIPPING! 🎉'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-primary-earth/80 font-sans">
                      <Truck className="w-4 h-4 text-accent-gold animate-pulse" />
                      <span>
                        {isRtl ? (
                          <>أضف بقيمة <span className="text-accent-gold font-black">{Math.round(amountNeeded)} DH</span> إضافية للحصول على شحن مجاني!</>
                        ) : language === 'fr' ? (
                          <>Ajoutez <span className="text-accent-gold font-black">{Math.round(amountNeeded)} DH</span> de plus pour la livraison gratuite !</>
                        ) : (
                          <>Add <span className="text-accent-gold font-black">{Math.round(amountNeeded)} DH</span> more for FREE SHIPPING!</>
                        )}
                      </span>
                    </span>
                  )}
                  <span className="text-[10px] font-mono font-black text-primary-earth/50">{Math.round(finalPrice)} / {FREE_SHIPPING_THRESHOLD} DH</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden shadow-inner border border-black/[0.03]">
                  <motion.div 
                    className={`h-full ${isFreeShipping ? 'bg-green-600 animate-pulse' : 'bg-accent-gold'}`}
                    initial={{ width: "0%" }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>
            )}

            <div className="flex-grow overflow-y-auto p-4 space-y-4 [scrollbar-width:thin] [scrollbar-color:rgba(180,140,80,0.3)_transparent]">
              {cart.length === 0 ? (
                <div className="flex flex-col py-2 space-y-5">
                  {/* Glowing, floating icon and descriptive message */}
                  <div className="flex flex-col items-center justify-center text-center px-4 py-6">
                    <motion.div 
                      animate={{ y: [0, -6, 0] }}
                      transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                      className="w-16 h-16 rounded-full bg-accent-gold/5 border border-accent-gold/10 flex items-center justify-center shadow-inner mb-4 relative"
                    >
                      <ShoppingBag className="w-8 h-8 text-accent-gold/70" />
                      <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                      </span>
                    </motion.div>
                    
                    <h3 className="text-base font-black text-primary-earth/90 tracking-wide font-sans mb-1">
                      {t('cart.empty')}
                    </h3>
                    
                    <p className="text-xs text-primary-earth/60 leading-relaxed max-w-[280px]">
                      {isRtl 
                        ? 'سلتك فارغة ولكن يمكنك ملؤها بالنقاء! اختر من تشكيلتنا الحصرية من الزيوت الطبيعية والمستدامة.' 
                        : language === 'fr' 
                        ? 'Votre panier est vide, mais vous pouvez le remplir de pureté ! Découvrez nos huiles naturelles précieuses.' 
                        : 'Your basket is empty, but you can fill it with botanical pureness! Explore our select premium oils.'}
                    </p>
                  </div>

                  {/* Best Sellers / Recommendations when empty */}
                  {suggestedProducts.length > 0 && (
                    <div className="bg-accent-gold/5 rounded-2xl p-4 border border-accent-gold/15 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-accent-gold flex items-center gap-1.5 font-mono">
                          <Sparkles className="w-3.5 h-3.5 text-accent-gold animate-pulse" />
                          {isRtl ? 'منتجات نقترحها لك:' : language === 'fr' ? 'SÉLECTION POUR VOUS :' : 'RECOMMENDED FOR YOU :'}
                        </span>
                        <span className="text-[9px] bg-accent-gold/10 text-accent-gold font-bold px-2 py-0.5 rounded-full">
                          {isRtl ? 'الأعلى مبيعاً' : language === 'fr' ? 'Bestsellers' : 'Best Sellers'}
                        </span>
                      </div>

                      <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin">
                        {suggestedProducts.map((p) => (
                          <motion.div 
                            key={p.id} 
                            whileHover={{ scale: 1.01 }}
                            className="flex gap-3 items-center bg-white p-2 border border-primary-earth/10 rounded-lg shadow-sm relative overflow-hidden group"
                          >
                            <div className="w-10 h-10 bg-[#0a0a0a] rounded flex-shrink-0 flex items-center justify-center overflow-hidden border border-primary-earth/5">
                              {p.image && (
                                <img 
                                  src={getOptimizedImageUrl(p.image, 'eco', 200) || undefined} 
                                  alt={p.name} 
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                            </div>
                            <div className="flex-grow min-w-0">
                              <h4 className="text-xs font-bold text-primary-earth truncate">{p.name}</h4>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] font-black text-accent-gold font-mono">{p.price}</span>
                                {p.isSale && p.originalPrice && (
                                  <span className="text-[9px] text-primary-earth/40 line-through font-mono">{p.originalPrice}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => addToCart(p, 1)}
                              className="bg-accent-gold hover:bg-primary-earth text-white rounded-lg text-[10px] px-2.5 py-1.5 font-bold uppercase transition-all duration-300 hover:shadow active:scale-95 cursor-pointer whitespace-nowrap flex items-center justify-center"
                            >
                              {isRtl ? '+ أضف' : language === 'fr' ? '+ Ajouter' : '+ Add'}
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Continue Shopping Button */}
                  <button 
                    onClick={onClose}
                    className="w-full bg-[#3b3b3b] text-white py-3.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-neutral-800 transition-colors duration-300 shadow-md hover:shadow-lg cursor-pointer mt-2"
                  >
                    {t('cart.continue')}
                  </button>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="flex gap-4 items-center py-3 border-b border-primary-earth/5 last:border-b-0 pb-4">
                    <div className="w-[72px] h-[72px] bg-[#0a0a0a] rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden border border-primary-earth/5">
                      {item.image && (
                        <img 
                          src={getOptimizedImageUrl(item.image, 'eco', 200) || undefined} 
                          alt={item.name} 
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </div>
                    <div className="flex-grow flex flex-col justify-between h-full min-h-[72px]">
                      <div>
                        <h3 className="text-base font-semibold text-primary-earth leading-snug line-clamp-2">{item.name}</h3>
                        <p className="text-xs text-primary-earth/50 uppercase tracking-widest mt-1">{item.category}</p>
                      </div>
                      <div className="flex justify-between items-center mt-2 gap-2">
                        <div className="flex items-center gap-3 border border-primary-earth/10 px-2 py-1 rounded bg-white flex-shrink-0">
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="p-0.5 hover:text-accent-gold transition-colors text-primary-earth/60"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-sm w-4 text-center font-semibold text-primary-earth">{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="p-0.5 hover:text-accent-gold transition-colors text-primary-earth/60"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-right rtl:text-left flex-shrink-0 ml-auto rtl:mr-auto rtl:ml-0 flex flex-col items-end" dir="ltr">
                          {item.isSale && item.originalPrice && (
                            <p className="text-xs text-primary-earth/40 line-through mb-0.5 flex items-baseline gap-1 justify-end">
                              <span>{Math.round(parseFloat(item.originalPrice.replace(' DH', '')))}</span>
                              <span className="text-[9px]">DH</span>
                            </p>
                          )}
                          <div className="font-bold text-base whitespace-nowrap">
                            {item.quantity > 1 ? (
                              <div className="flex flex-col items-end">
                                <span className="text-[11px] font-normal text-primary-earth/50 block mb-0.5 flex items-baseline gap-1 justify-end">
                                  <span>{Math.round(parseFloat(item.price.replace(' DH', '')))}</span>
                                  <span className="text-[9px]">DH</span> × {item.quantity}
                                </span>
                                <span className="text-accent-gold font-black">{Math.round(parseFloat(item.price.replace(' DH', '')) * item.quantity)} DH</span>
                              </div>
                            ) : (
                              <span className="flex items-baseline justify-end gap-1 text-accent-gold font-black">
                                <span>{Math.round(parseFloat(item.price.replace(' DH', '')))}</span>
                                <span className="text-xs text-accent-gold/80">DH</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-5 bg-background-soft border-t border-primary-earth/10 space-y-3">
                {/* Coupon Code Panel */}
                <div className="border-b border-primary-earth/10 pb-3 mb-1">
                  {!appliedCoupon ? (
                    <form onSubmit={handleApplyCoupon} className="flex gap-2">
                      <input
                        type="text"
                        placeholder={language === 'ar' ? 'رمز الكوبون...' : 'Coupon code...'}
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        className="flex-grow bg-white border border-primary-earth/15 px-3 py-1.5 text-xs rounded-lg focus:outline-none focus:border-accent-gold uppercase font-semibold font-mono"
                      />
                      <button
                        type="submit"
                        disabled={isApplying}
                        className="bg-primary-earth hover:bg-accent-gold text-white text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-lg cursor-pointer transition-colors active:scale-95 text-center whitespace-nowrap"
                      >
                        {isApplying ? '...' : (language === 'ar' ? 'تطبيق' : 'Apply')}
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-col bg-green-50/50 border border-green-600/10 p-2.5 rounded-lg text-xs w-full">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-green-800 font-mono">
                          {appliedCoupon.code} ({appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.discountValue}%` : `${appliedCoupon.discountValue} DH`})
                        </span>
                        <button
                          onClick={handleRemoveCoupon}
                          className="text-red-500 hover:text-red-700 text-[10px] font-mono font-bold hover:underline"
                        >
                          {language === 'ar' ? 'إزالة' : 'Remove'}
                        </button>
                      </div>
                      {appliedCoupon.expiresAt && (
                        <CartCouponCountdown expiresAt={appliedCoupon.expiresAt} language={language} isOpen={isOpen} />
                      )}
                    </div>
                  )}

                  {couponError && <p className="text-[10px] text-red-600 font-medium mt-1.5">{couponError}</p>}
                  {couponSuccess && <p className="text-[10px] text-green-600 font-medium mt-1.5">{couponSuccess}</p>}
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold uppercase tracking-[0.15em] text-primary-earth/60">{t('cart.total')}</span>
                  {appliedCoupon ? (
                    <div className="text-right flex flex-col items-end">
                      <span className="text-xs text-primary-earth/40 line-through font-medium" dir="ltr">
                        {totalPrice} DH
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] bg-red-50 text-red-700 font-bold px-1.5 py-0.5 rounded uppercase font-mono tracking-widest">
                          -{discountAmount} DH
                        </span>
                        <span className="text-2xl font-bold text-accent-gold flex items-baseline gap-1" dir="ltr">
                          <span>{finalPrice}</span>
                          <span className="text-sm">DH</span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-2xl font-bold text-primary-earth flex items-baseline gap-1" dir="ltr">
                      <span>{totalPrice}</span>
                      <span className="text-sm">DH</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2.5">
                  <button 
                    onClick={handleCheckout}
                    className="w-full bg-primary-earth text-white py-3.5 rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-accent-gold transition-colors duration-300 shadow-md hover:shadow-lg cursor-pointer"
                  >
                    {t('cart.checkout')}
                  </button>
                  <button 
                    onClick={onClose}
                    className="w-full border border-primary-earth/25 text-primary-earth py-3 rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-primary-earth/5 hover:border-primary-earth transition-colors duration-300 flex items-center justify-center gap-2 cursor-pointer bg-white"
                  >
                    {t('cart.continue')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
