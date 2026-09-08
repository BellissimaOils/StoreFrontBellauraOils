import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { Language, translations } from '../translations';
import { fetchWithCache } from '../lib/apiCache';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('bellaura_lang');
    if (saved && (saved === 'ar' || saved === 'en' || saved === 'fr')) {
      return saved as Language;
    }
    return 'ar';
  });

  useEffect(() => {
    let isMounted = true;

    // Re-use the already-inflight /api/products request from ProductContext
    // (fetchWithCache deduplicates so this adds zero extra network requests)
    fetchWithCache('/api/products')
      .then(data => {
        if (!isMounted || !data?.storeSettings) return;
        const { storeSettings } = data;
        // Explicit boolean check: undefined means not configured, treat as disabled
        const arEnabled = storeSettings.enableAr !== false;
        const enEnabled = storeSettings.enableEn === true;
        const frEnabled = storeSettings.enableFr === true;

        const isCurrentLangEnabled =
          (language === 'ar' && arEnabled) ||
          (language === 'en' && enEnabled) ||
          (language === 'fr' && frEnabled);

        if (!isCurrentLangEnabled) {
          // Redirect to first available language
          if (arEnabled) setLanguage('ar');
          else if (enEnabled) setLanguage('en');
          else if (frEnabled) setLanguage('fr');
          else setLanguage('ar');
        }
      }).catch(() => {});

    return () => { isMounted = false; };
  }, [language]);

  useEffect(() => {
    const dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = language;
    localStorage.setItem('bellaura_lang', language);
  }, [language]);

  const t = useCallback((path: string): string => {
    const keys = path.split('.');
    let result: any = translations[language];

    for (const key of keys) {
      if (result && result[key]) {
        result = result[key];
      } else {
        // Fallback to Arabic if key missing (primary language)
        result = translations['ar'];
        for (const fallbackKey of keys) {
          result = (result && result[fallbackKey]) || path;
        }
        break;
      }
    }

    return typeof result === 'string' ? result : path;
  }, [language]);

  const value = useMemo(() => ({
    language, setLanguage, t
  }), [language, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
