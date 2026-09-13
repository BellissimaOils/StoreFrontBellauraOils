import { useState, useEffect } from 'react';
import { ShoppingBag, Globe } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useProducts } from '../context/ProductContext';
import CartOverlay from './CartOverlay';
import { Link, useLocation } from 'react-router-dom';
import { normalizeLinkUrl } from '../lib/urlUtils';
import { Language } from '../translations';
import { fetchWithCache, getCachedSync } from '../lib/apiCache';

// Parse nav links from a sections API response for the current language.
function parseNavLinks(data: any, lang: string) {
  if (!data?.success || !data.sections) return null;
  return data.sections
    .filter((s: any) => Number(s.is_visible) === 1 && s.type === 'link')
    .sort((a: any, b: any) => a.order_index - b.order_index)
    .map((s: any) => ({
      to: normalizeLinkUrl(s.link_url),
      label: lang === 'ar' ? (s.title_ar || s.title_en) : lang === 'fr' ? (s.title_fr || s.title_en) : s.title_en || s.title_ar,
    }));
}

export default function Navbar() {
  const { totalItems, isCartOpen, setIsCartOpen } = useCart();
  const { language, setLanguage, t } = useLanguage();
  const { storeSettings, loading: storeLoading } = useProducts();
  const location = useLocation();
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);


  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const mobileSelector = document.getElementById('language-selector-mobile');
      const desktopSelector = document.getElementById('language-selector-desktop');
      
      const clickedMobile = mobileSelector && mobileSelector.contains(event.target as Node);
      const clickedDesktop = desktopSelector && desktopSelector.contains(event.target as Node);
      
      if (!clickedMobile && !clickedDesktop) {
        setIsLangOpen(false);
      }
    };

    if (isLangOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isLangOpen]);

  const isHome = location.pathname === '/';

  const handlePrefetchRoute = (path: string) => {
    if (path === '/skin' || path === '/hair-and-scalp' || path === '/products' || path.startsWith('/category')) {
      import('./CategoryPage');
    } else if (path === '/reviews') {
      import('./ReviewsPage');
    }
  };

  const allLanguages: { code: Language; label: string }[] = [
    { code: 'ar', label: 'العربية' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
  ];

  const languages = allLanguages.filter(lang => {
    // Wait until storeSettings is loaded before filtering
    // undefined means "not set" = use server defaults: AR=true, EN/FR=false
    if (lang.code === 'ar') return storeSettings?.enableAr !== false;
    if (lang.code === 'en') return storeSettings?.enableEn === true;
    if (lang.code === 'fr') return storeSettings?.enableFr === true;
    return false;
  });

  // Bootstrap from the shared in-memory cache synchronously — avoids the
  // blank nav flash on client-side navigation where the cache was already
  // warmed by prefetchAppInitialData() or a previous fetchWithCache call.
  const cachedSectionsSync = getCachedSync<any>('/api/sections');
  const initialNavLinks = cachedSectionsSync ? (parseNavLinks(cachedSectionsSync, language) ?? null) : null;

  const [dynamicNavLinks, setDynamicNavLinks] = useState<{ to: string, label: string }[] | null>(initialNavLinks);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    // Use fetchWithCache instead of raw fetch so the shared in-memory cache
    // is populated. When CategoryPage mounts after navigation, its
    // getCachedSync('/api/sections') call now finds valid data immediately,
    // making sectionsLoaded start true and rendering the page without waiting.
    fetchWithCache('/api/sections')
      .then(data => {
        const links = parseNavLinks(data, language);
        if (links !== null) {
          setDynamicNavLinks(links);
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      })
      .catch((err) => {
        console.error(err);
        setFetchFailed(true);
      });
  }, [language]);

  // Only show the links the admin configured — never show hardcoded fallback links.
  // While loading: show nothing (dynamicNavLinks is null). This matches the
  // original behavior exactly: the nav is empty until the API response arrives.
  const navLinksToUse = (!fetchFailed && dynamicNavLinks) ? dynamicNavLinks : [];
  const displayLinks = language === 'ar' ? [...navLinksToUse].reverse() : navLinksToUse;

  return (
    <>
      <nav 
        id="main-navigation" 
        className="fixed top-0 left-0 right-0 z-50 bg-background-soft/95 backdrop-blur-md border-b border-primary-earth/10 transition-all duration-300"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Mobile Header Layout (lg:hidden) */}
          <div className={`lg:hidden flex flex-col transition-all duration-300 [direction:ltr] ${isScrolled ? 'py-2.5 gap-0' : 'py-3.5 gap-2.5'}`} style={{ direction: 'ltr' }}>
            {/* Top Row: Centered Logo/Name - BRAND AT THE VERY TOP */}
            <div className="flex items-center justify-center">
              <Link to="/" id="logo-link-mobile" className="block text-center">
                <h1 className="text-lg sm:text-xl font-medium tracking-[0.15em] text-primary-earth uppercase whitespace-nowrap flex flex-row items-center justify-center gap-1" dir="ltr">
                  <span className="text-accent-lavender text-sm">🌸</span>
                  BELLAURA <span className="text-accent-lavender font-light">OILS</span>
                  <span className="text-accent-lavender text-sm">🌸</span>
                </h1>
              </Link>
            </div>

            {/* Bottom Row: Actions (Language, Auth on left, Cart on right) */}
            <div className={`justify-between items-center transition-all duration-300 ${isScrolled ? 'hidden' : 'flex'}`}>
              {/* Left side: Mobile Actions (Languages & Auth) */}
              <div className="flex items-center gap-2">
                {/* Language Switcher */}
                {!storeLoading && languages.length > 1 && (
                <div className="relative" id="language-selector-mobile">
                  <button 
                    onClick={() => setIsLangOpen(!isLangOpen)}
                    className="p-1 hover:text-accent-gold transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Globe className="w-5 h-5 text-primary-earth/80" />
                    <span className="text-xs font-bold uppercase tracking-wider text-primary-earth/80">{language}</span>
                  </button>
                  {isLangOpen && (
                    <div className="absolute top-full mt-2 left-0 bg-white shadow-xl border border-primary-earth/5 min-w-[120px] py-1.5 z-50">
                      {languages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setLanguage(lang.code);
                            setIsLangOpen(false);
                          }}
                          className={`w-full text-left rtl:text-right px-4 py-2.5 text-xs uppercase tracking-widest hover:bg-background-soft transition-colors ${language === lang.code ? 'text-accent-gold font-bold' : 'text-primary-earth/60'}`}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                )}

                {/* Auth / Admin lock icon */}
                {showAdminAccess && (
                  <div className="flex items-center gap-2 pl-1.5 border-l border-primary-earth/10">
                    <UserButton afterSignOutUrl="/" />
                    <Link 
                      to="/admin/reviews" 
                      className="p-1 hover:text-accent-gold transition-colors"
                      title="Admin Dashboard"
                    >
                      <Lock className="w-4.5 h-4.5 text-primary-earth/80" />
                    </Link>
                  </div>
                )}
              </div>

              {/* Right side: Shopping Cart */}
              <div className="flex items-center">
                <button 
                  id="cart-toggle-btn-mobile"
                  onClick={() => setIsCartOpen(true)}
                  className="p-1 relative hover:text-accent-gold transition-colors cursor-pointer"
                >
                  <ShoppingBag className="w-5.5 h-5.5 text-primary-earth/80" />
                  {totalItems > 0 && (
                    <span className="absolute -top-1 -right-1 bg-accent-gold text-white text-[9px] w-4.5 h-4.5 flex items-center justify-center rounded-full font-bold">
                      {totalItems}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Header Layout (lg:grid) */}
          <div className="hidden lg:grid grid-cols-[1fr_auto_1fr] items-center h-24 relative [direction:ltr]" style={{ direction: 'ltr' }}>
            {/* Left side Actions (Authenication, Language, Cart) */}
            <div className="flex items-center justify-start z-10 gap-3 xl:gap-5 pr-4">
              {/* Shopping Cart button */}
              <button 
                id="cart-toggle-btn"
                onClick={() => setIsCartOpen(true)}
                className="p-2 relative hover:text-accent-gold transition-colors mr-1"
              >
                <ShoppingBag className="w-6 h-6 text-primary-earth/80" />
                {totalItems > 0 && (
                  <span className="absolute top-0 right-0 bg-accent-gold text-white text-[10px] w-4.5 h-4.5 flex items-center justify-center rounded-full font-bold">
                    {totalItems}
                  </span>
                )}
              </button>

              {/* Language Switcher */}
              {!storeLoading && languages.length > 1 && (
              <div className="relative" id="language-selector-desktop">
                <button 
                  onClick={() => setIsLangOpen(!isLangOpen)}
                  className="p-1 hover:text-accent-gold transition-colors flex items-center gap-1"
                  id="language-toggle-btn"
                >
                  <Globe className="w-5.5 h-5.5 text-primary-earth/80" />
                  <span className="text-xs font-bold uppercase tracking-widest text-primary-earth/80">{language}</span>
                </button>
                {isLangOpen && (
                  <div className="absolute top-full mt-2 left-0 bg-white shadow-xl border border-primary-earth/5 min-w-[120px] py-2 z-50">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code);
                          setIsLangOpen(false);
                        }}
                        className={`w-full text-left rtl:text-right px-4 py-2 text-xs uppercase tracking-widest hover:bg-background-soft transition-colors ${language === lang.code ? 'text-accent-gold font-bold' : 'text-primary-earth/60'}`}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}

            </div>

            {/* Centered Logo/Name */}
            <div className="flex items-center justify-center z-20 px-4 xl:px-8">
              <Link to="/" id="logo-link" className="block text-center">
                <h1 className="text-2xl lg:text-[28px] xl:text-[34px] font-medium tracking-widest text-primary-earth uppercase whitespace-nowrap flex flex-row items-center justify-center gap-2" dir="ltr">
                  <span className="text-accent-lavender text-xl">🌸</span>
                  BELLAURA <span className="text-accent-lavender font-light">OILS</span>
                  <span className="text-accent-lavender text-xl">🌸</span>
                </h1>
              </Link>
            </div>

            {/* Right side / Desktop Navigation */}
            <div className="flex items-center justify-end z-10 pl-4">
              <div className="flex items-center gap-3 lg:gap-4 xl:gap-7 flex-wrap lg:flex-nowrap justify-end">
                {displayLinks.map((link) => (
                  <Link 
                    key={link.to}
                    to={link.to} 
                    onMouseEnter={() => handlePrefetchRoute(link.to)}
                    onTouchStart={() => handlePrefetchRoute(link.to)}
                    className={`relative text-[14px] xl:text-[15.5px] font-bold tracking-wider hover:text-accent-gold transition-colors duration-300 pb-2 text-primary-earth whitespace-nowrap ${location.pathname === link.to ? 'text-accent-gold' : 'text-primary-earth/70'}`}
                    id={`desktop-nav-${link.to.replace(/\//g, '') || 'home'}`}
                  >
                    <span>{link.label}</span>
                    {location.pathname === link.to && (
                      <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-accent-gold rounded-full" />
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
 
        {/* Persistent Mobile Bar - Horizontal scrolling links */}
        <div id="mobile-navigation-bar" className="lg:hidden border-t border-primary-earth/5 bg-background-soft/80 backdrop-blur-md overflow-x-auto no-scrollbar">
          <div className="flex items-center px-4 h-14 min-w-max gap-8 justify-center">
            {navLinksToUse.map((link) => (
              <Link 
                key={link.to}
                to={link.to} 
                onMouseEnter={() => handlePrefetchRoute(link.to)}
                onTouchStart={() => handlePrefetchRoute(link.to)}
                id={`mobile-nav-${link.to.replace(/\//g, '') || 'home'}`}
                className={`text-[15.5px] sm:text-[17px] font-bold tracking-wide hover:text-accent-gold transition-colors block py-3.5 ${location.pathname === link.to ? 'text-accent-gold border-b-2 border-accent-gold' : 'text-primary-earth'}`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      
      <CartOverlay isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
}
