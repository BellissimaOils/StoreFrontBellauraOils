import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';

/**
 * Floating "back to top" button. Appears once the visitor has scrolled down
 * and always sits on the RIGHT edge of the viewport.
 *
 * Not to be confused with src/components/ScrollToTop.tsx, which renders
 * nothing — that one just resets scroll position on route changes.
 *
 * Collision handling with FloatingCart is the fiddly part: that button is
 * RTL-aware and swaps sides (left-6 in Arabic, right-6 otherwise) at
 * bottom-6 / md:bottom-24, w-14 h-14, z-50. Since this button is pinned
 * right in every language, in Arabic the right edge is free and both can
 * share the same baseline, but in English/French the cart is also on the
 * right — so there this one stacks above it with a small gap instead of
 * landing on top of it. The offsets below are derived from the cart's real
 * geometry (24px inset + 56px tall = 80px, so 88px clears it; 96px + 56px =
 * 152px on md, so 160px clears it).
 */
export default function BackToTopButton() {
  const { isCartOpen } = useCart();
  const { language } = useLanguage();
  const [isVisible, setIsVisible] = useState(false);
  const isAr = language === 'ar';

  useEffect(() => {
    const handleScroll = () => setIsVisible(window.scrollY > 300);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    // Honour the OS "reduce motion" setting rather than forcing a long
    // smooth scroll on people who've asked for less animation.
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, left: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
  };

  // Cart on the opposite side -> share the baseline. Cart on this side ->
  // sit above it.
  const verticalOffset = isAr ? 'bottom-6 md:bottom-24' : 'bottom-[5.5rem] md:bottom-40';

  return (
    <AnimatePresence>
      {isVisible && !isCartOpen && (
        <motion.button
          id="back-to-top-btn"
          type="button"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          onClick={scrollToTop}
          className={`fixed ${verticalOffset} right-6 sm:right-8 z-50 bg-white border border-primary-earth/10 text-primary-earth shadow-lg hover:border-accent-gold/40 hover:text-accent-gold flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full cursor-pointer transition-colors duration-300 print:hidden`}
          aria-label={isAr ? 'العودة إلى الأعلى' : language === 'fr' ? 'Retour en haut' : 'Back to top'}
          title={isAr ? 'العودة إلى الأعلى' : language === 'fr' ? 'Retour en haut' : 'Back to top'}
        >
          <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6 stroke-[1.75]" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
