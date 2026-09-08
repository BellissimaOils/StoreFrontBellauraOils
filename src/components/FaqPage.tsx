import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useProducts } from "../context/ProductContext";
import { useNavSections } from "../lib/useNavSections";
import { resolvePageSeo } from "../lib/seoContent";
import { serverRenderedSeo } from "../lib/ssrSeo";
import { fetchWithCache, getCachedSync } from "../lib/apiCache";

/** One row of the `faq` table. */
interface FaqItem {
  id?: number;
  question_ar: string;
  answer_ar: string;
  question_en: string;
  answer_en: string;
  question_fr: string;
  answer_fr: string;
}

export default function FaqPage() {
  const { language } = useLanguage();
  const { storeSettings } = useProducts();
  const { sections } = useNavSections();
  const isAr = language === "ar";
  const storeName = storeSettings?.storeName || "Bellaura Oils";

  const faqSeo = resolvePageSeo({
    pathname: "/faq",
    language,
    sections,
    storeSettings,
    ...serverRenderedSeo("/faq"),
  });

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Straight from the `faq` table. The database is the only source: there is no
  // built-in list to fall back on, because a hardcoded default meant the page
  // could show questions that were not in Admin > Settings > FAQ and could not
  // be edited or removed from there.
  //
  // Hydrated synchronously from apiCache when possible, the same pattern
  // ProductContext and useNavSections already use. This used to be a plain,
  // uncached `fetch()` fired from useEffect on every mount, so the page always
  // rendered its empty accordion area first and only filled in a request
  // later — visible as a one-second "no questions" flash even on a page the
  // visitor had already loaded once this session. prefetchAppInitialData()
  // (src/lib/apiCache.ts) now warms "/api/faq" alongside the other app-wide
  // data, so this usually finds it already cached.
  const cachedFaq = getCachedSync<any>("/api/faq");
  const [items, setItems] = useState<FaqItem[]>(
    Array.isArray(cachedFaq?.items) ? cachedFaq.items : [],
  );
  const [loaded, setLoaded] = useState(Boolean(cachedFaq?.success));

  useEffect(() => {
    let cancelled = false;
    fetchWithCache("/api/faq")
      .then((data) => {
        if (!cancelled && Array.isArray(data?.items)) setItems(data.items);
      })
      .catch((err) => {
        console.error("Failed to load the FAQ", err);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick the current language, falling back to English and then Arabic rather
  // than rendering a blank row: a question that has only been written in one
  // language is still better than nothing.
  const pick = (fr: string, en: string, ar: string) => {
    if (isAr) return ar || en || fr;
    if (language === "fr") return fr || en || ar;
    return en || ar || fr;
  };

  const displayFaqs = items
    .map((item) => ({
      q: pick(item.question_fr, item.question_en, item.question_ar),
      a: pick(item.answer_fr, item.answer_en, item.answer_ar),
    }))
    .filter((item) => item.q?.trim());

  return (
    <>
      <Helmet>
        {/* Resolved centrally so Admin > SEO > Sections can govern this page. */}
        <title>{faqSeo.title}</title>
        <meta
          name="description"
          content={
            isAr
              ? `إجابات على الأسئلة الأكثر شيوعاً حول منتجات ${storeName}: الجودة، طريقة الاستخدام، مدة التوصيل، الإرجاع، والتوافق مع أنواع البشرة والشعر المختلفة.`
              : language === 'fr'
                ? `Retrouvez les réponses aux questions fréquentes sur ${storeName} : qualité des huiles, délais de livraison, retours, et conseils d'utilisation.`
                : `Find answers to the most common questions about ${storeName}: oil quality, delivery times, returns, and usage tips for skin and hair.`
          }
        />
        <meta
          name="keywords"
          content={
            isAr
              ? `أسئلة شائعة، Bellaura Oils، زيوت طبيعية، توصيل المغرب، كيفية استخدام الزيوت، جودة المنتجات، أنواع البشرة، العناية بالشعر`
              : language === 'fr'
                ? `FAQ, Bellaura Oils, huiles naturelles, livraison Maroc, soins peau cheveux, utilisation huiles`
                : `FAQ, Bellaura Oils, natural oils, Morocco delivery, skin hair care, oil usage tips`
          }
        />
      </Helmet>

      <div
        className="pt-40 lg:pt-36 pb-24 bg-white min-h-screen"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-[0.3em] text-accent-gold font-medium mb-4">
              {isAr ? "لديك سؤال؟" : "Have a question?"}
            </p>
            <h1 className="text-4xl sm:text-5xl font-light text-primary-earth mb-6">
              {isAr ? "أسئلة شائعة" : "FAQ"}
            </h1>
            <div className="w-12 h-px bg-accent-gold mx-auto" />
          </div>

          {/* Accordion */}
          <div className="space-y-3">
            {displayFaqs.map((faq, i) => (
              <div
                key={i}
                className="border border-primary-earth/10 rounded-2xl overflow-hidden bg-white shadow-sm"
              >
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-[#faf7f2] transition-colors"
                >
                  <span className="font-medium text-primary-earth text-sm sm:text-base">
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-accent-gold shrink-0 transition-transform duration-300 ${openIndex === i ? "rotate-180" : ""}`}
                  />
                </button>
                {openIndex === i && (
                  <div className="px-6 pb-6 text-primary-earth/70 text-sm leading-relaxed border-t border-primary-earth/5 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}

            {/* While the request is in flight, placeholder rows the same shape
                and size as the real questions.
                
                `loaded` already stopped the "no questions added yet" message
                from flashing, but it left the area completely blank instead, so
                the page still looked like an FAQ with no FAQ in it and then
                visibly jumped when the answers arrived. Showing the shape of
                the content reserves the height, so nothing moves when it
                lands. */}
            {!loaded && displayFaqs.length === 0 && (
              <div className="space-y-4" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="bg-white border border-primary-earth/10 rounded-2xl px-6 py-5 flex items-center justify-between gap-4 animate-pulse"
                  >
                    <div
                      className="h-3.5 rounded-full bg-primary-earth/10"
                      style={{ width: `${68 - i * 6}%` }}
                    />
                    <div className="w-4 h-4 rounded-full bg-primary-earth/10 shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Gated on `loaded` so the first paint doesn't flash "no questions"
                before the request comes back. */}
            {loaded && displayFaqs.length === 0 && (
              <p className="text-center text-primary-earth/40 py-12 text-sm">
                {isAr
                  ? "لا توجد أسئلة بعد."
                  : language === "fr"
                    ? "Aucune question pour le moment."
                    : "No questions added yet."}
              </p>
            )}
          </div>

          {/* CTA */}
          <div className="text-center mt-14 p-8 bg-[#faf7f2] rounded-3xl border border-primary-earth/10">
            <p className="text-primary-earth font-medium mb-2">
              {isAr ? "لم تجد إجابتك؟" : "Didn't find your answer?"}
            </p>
            <p className="text-sm text-primary-earth/60 mb-5">
              {isAr
                ? "فريق خدمة العملاء لدينا جاهز لمساعدتك."
                : "Our customer support team is ready to help you."}
            </p>
            <button
              onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-earth text-white rounded-full text-sm font-medium hover:bg-primary-earth/90 transition-colors"
            >
              {isAr ? "تواصل معنا" : "Contact Us"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
