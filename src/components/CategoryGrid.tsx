import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { CATEGORIES } from './constants';
import { useLanguage } from '../context/LanguageContext';
import { getOptimizedImageUrl } from '../lib/imageUtils';

import { useState, useEffect } from 'react';
export default function CategoryGrid() {
  const { t, language } = useLanguage();
  const [dynamicCats, setDynamicCats] = useState(CATEGORIES);

  useEffect(() => {
    fetch('/api/sections')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.sections) {
          const fetchedCats = data.sections
            .filter((s: any) => Number(s.is_visible) === 1 && s.type === 'link' && s.link_url !== '/' && s.link_url !== '/products' && s.link_url !== '/reviews')
            .sort((a: any, b: any) => a.order_index - b.order_index)
            .map((s: any) => {
              const baseId = s.link_url.replace(/^\//, '');
              const existing = CATEGORIES.find(c => c.id === baseId);
              return {
                id: baseId,
                name: language === 'ar' ? (s.title_ar || s.title_en) : language === 'fr' ? (s.title_fr || s.title_en) : s.title_en || s.title_ar,
                image: existing ? existing.image : 'https://images.unsplash.com/photo-1615397323126-7243c39379cf?auto=format&fit=crop&q=80',
              };
            });
          if (fetchedCats.length > 0) {
            setDynamicCats(fetchedCats);
          }
        }
      })
      .catch(console.error);
  }, [language]);

  return (
    <section className="py-32 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col mb-24 max-w-3xl">
          <h2 className="text-5xl lg:text-7xl text-primary-earth mb-8 leading-[0.9] tracking-tighter decoration-accent-gold/20 decoration-8 underline-offset-8">
            {t('categories.title') || 'Our Collections'}
          </h2>
          <p className="text-primary-earth/50 text-xl font-light leading-relaxed font-serif italic">
            {t('home.artOfLiving.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 lg:gap-16">
          {dynamicCats.map((category, index) => {
            // Create asymmetrical layout classes
            const gridClasses = [
              "md:col-span-7", // First large
              "md:col-span-5 md:mt-24", // Second small & offset
              "md:col-span-4", // Third medium
              "md:col-span-8", // Fourth large
            ][index % 4];

            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.8 }}
                className={gridClasses}
              >
                <Link to={`/${category.id}`} className="group block relative overflow-hidden bg-background-soft">
                  <div className={`relative aspect-[4/5] overflow-hidden`}>
                    {category.image && (
                      <img
                        src={getOptimizedImageUrl(category.image, 'eco', 800) || undefined}
                        alt={category.name}
                        loading="lazy"
                        fetchPriority="low"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="absolute inset-0 bg-primary-earth/5 group-hover:bg-transparent transition-colors duration-700" />
                  </div>
                  
                  <div className="mt-6">
                    <h3 className="text-xl lg:text-2xl font-light tracking-tight text-primary-earth hover:text-accent-gold transition-colors duration-300">
                      {t(`categories.${category.id}`) || category.name}
                    </h3>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
