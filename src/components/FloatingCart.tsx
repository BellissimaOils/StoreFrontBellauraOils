import { useState, useEffect } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation } from 'react-router-dom';

export default function FloatingCart() {
  const { totalItems, setIsCartOpen, isCartOpen } = useCart();
  const { language } = useLanguage();
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show floating cart if we have scrolled down, or if we are not on the homepage
      const isNotHome = location.pathname !== '/';
      const scrolledDown = window.scrollY > 120;
      setIsVisible(isNotHome || scrolledDown);
    };

    // Initial check
    handleScroll();

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]);

  // Adjust positioning for RTL (Arabic) vs LTR (English/French)
  const isAr = language === 'ar';

  return (
    <AnimatePresence>
      {isVisible && !isCartOpen && (
        <motion.button
          id="floating-cart-btn"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsCartOpen(true)}
          className={`fixed bottom-6 md:bottom-24 ${
            isAr ? 'left-6 sm:left-8' : 'right-6 sm:right-8'
          } z-50 bg-white border border-primary-earth/10 text-primary-earth shadow-lg hover:border-accent-gold/40 flex items-center justify-center w-14 h-14 rounded-full cursor-pointer transition-all duration-300`}
          title={isAr ? 'حقيبة التسوق' : 'Shopping Basket'}
        >
          <div className="relative p-3.5">
            <ShoppingBag className="w-6.5 h-6.5 text-primary-earth stroke-[1.75]" />
            <AnimatePresence mode="popLayout">
              <motion.span
                key={totalItems}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="absolute -top-1 -right-1 bg-accent-gold text-white text-[11px] font-sans font-extrabold w-5 h-5 flex items-center justify-center rounded-full border border-white shadow-sm"
              >
                {totalItems}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
