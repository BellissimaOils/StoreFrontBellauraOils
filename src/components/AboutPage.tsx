import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useProducts } from "../context/ProductContext";
import { useNavSections } from "../lib/useNavSections";
import { resolvePageSeo } from "../lib/seoContent";
import { serverRenderedSeo } from "../lib/ssrSeo";

export default function AboutPage() {
  const { language } = useLanguage();
  const { storeSettings } = useProducts();
  const { sections } = useNavSections();
  const isAr = language === "ar";

  const aboutSeo = resolvePageSeo({
    pathname: "/about",
    language,
    sections,
    storeSettings,
    ...serverRenderedSeo("/about"),
  });

  const storeName = storeSettings?.storeName || "Bellaura Oils";

  // Read from storeSettings (saved via AdminSettings) with fallback to defaults
  const title = isAr
    ? storeSettings?.aboutTitleAr || "من نحن"
    : storeSettings?.aboutTitleEn || "About Us";

  const intro = isAr
    ? "بدأت رحلتنا من معاناة شخصية حقيقية مع مشاكل البشرة والشعر؛ ومن هنا انطلق شغفنا لاستكشاف قوة الزيوت الناقلة المعصورة على البارد ومستخلصاتها النقية. وبعد أن اختبرنا النتائج بأنفسنا وتيقنا من فعاليتها المذهلة التي كنا واثقين أنها ستبهر زبنائنا الكرام، تأسست (Bellaura Oils) لنكون البديل الواعي والموثوق في وجه \"الخلطات العشوائية\" التي أساسها فقط تسويقي وتضر بصحة البشرة والشعر. نحرص اليوم على استيراد أجود الزيوت الطبيعية العضوية مباشرة من إنجلترا لنضعها بين أيديكم بكل أمانة وجودة."
    : storeSettings?.aboutIntroEn ||
      `${storeName} is a Moroccan brand specializing in premium natural oils, believing in the power of nature for skin and hair care.`;

  const mission = isAr
    ? "نؤمن بأن الجودة الحقيقية تبدأ من المصدر، لذلك نسعى لتقديم أصفى الزيوت والمستخلصات النباتية الموثوقة القادمة من إنجلترا. مهمتنا هي أن نمنحكم حلولاً نقية ومدروسة بعيداً عن مخاطر الوصفات العشوائية والترويج الفارغ لها، لتقديم تجربة عناية استثنائية تجمع بين النقاء والفعالية والثقة، لترافقكم في كل خطوة نحو شعر وبشرة أكثر صحة وجمالاً."
    : storeSettings?.aboutMissionEn ||
      "We strive to deliver the finest authentic natural oils, carefully extracted from Morocco's best ingredients, offering you an exceptional care experience that blends tradition with effectiveness.";

  return (
    <>
      <Helmet>
        {/* Resolved centrally so Admin > SEO > Sections can govern this page.
            The title was hardcoded here, which meant it overrode any section
            row an admin created for /about after hydration. */}
        <title>{aboutSeo.title}</title>
        <meta
          name="description"
          content={
            isAr
              ? `تعرف على قصة ${storeName}: بدأنا من معاناة شخصية مع مشاكل البشرة والشعر، وتأسسنا لنكون البديل الواعي عن الخلطات العشوائية. نستورد أجود الزيوت الطبيعية العضوية المعصورة على البارد مباشرة من إنجلترا.`
              : language === 'fr'
                ? `Découvrez l'histoire de ${storeName} : née d'une expérience personnelle, notre marque propose des huiles biologiques pressées à froid, importées directement d'Angleterre, pour des soins capillaires et cutanés naturels et efficaces.`
                : `Learn the story of ${storeName}: born from a personal journey, we import the finest cold-pressed organic oils directly from England for pure, effective skin and hair care.`
          }
        />
        <meta
          name="keywords"
          content={
            isAr
              ? `من نحن، Bellaura Oils، بيلاورا أويلز، زيوت طبيعية، زيوت عضوية، زيوت معصورة على البارد، عناية بالبشرة، عناية بالشعر، مستوردة من إنجلترا`
              : language === 'fr'
                ? `à propos, Bellaura Oils, huiles naturelles biologiques, pressées à froid, soins peau cheveux, importées d'Angleterre`
                : `about us, Bellaura Oils, organic natural oils, cold pressed, skin hair care, imported from England`
          }
        />
      </Helmet>

      <div
        className="pt-40 lg:pt-36 pb-24 bg-white min-h-screen"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Hero */}
          <div className="text-center mb-16">
            <p className="text-xs uppercase tracking-[0.3em] text-accent-gold font-medium mb-4">
              {isAr ? "قصتنا" : "Our Story"}
            </p>
            <h1 className="text-4xl sm:text-5xl font-light text-primary-earth mb-6 leading-tight">
              {title}
            </h1>
            <div className="w-12 h-px bg-accent-gold mx-auto mb-8" />
            <p className="text-primary-earth/70 text-lg leading-relaxed">
              {intro}
            </p>
          </div>

          {/* Mission */}
          <div className="bg-[#faf7f2] rounded-3xl p-8 sm:p-12 mb-10 border border-primary-earth/10">
            <h2 className="text-2xl font-medium text-primary-earth mb-4">
              {isAr ? "رسالتنا" : "Our Mission"}
            </h2>
            <p className="text-primary-earth/70 leading-relaxed">
              {mission}
            </p>
          </div>

          {/* Values */}
          <div className="grid sm:grid-cols-3 gap-6 mb-10">
            {[
              {
                emoji: "🌿",
                title: isAr ? "طبيعي 100%" : "100% Natural",
                desc: isAr
                  ? "منتجاتنا مستخرجة من مكونات طبيعية خالصة بدون إضافات كيميائية."
                  : "Our products are extracted from pure natural ingredients without chemical additives.",
              },
              {
                emoji: "✨",
                title: isAr ? "جودة فاخرة" : "Premium Quality",
                desc: isAr
                  ? "نختار بعناية كل منتج لضمان أعلى معايير الجودة لعملائنا."
                  : "We carefully select every product to ensure the highest quality standards for our customers.",
              },
              {
                emoji: "🤝",
                title: isAr ? "ثقة وشفافية" : "Trust & Transparency",
                desc: isAr
                  ? "نؤمن بالصدق مع عملائنا ونوفر معلومات كاملة عن كل منتج."
                  : "We believe in honesty with our customers and provide complete information about every product.",
              },
            ].map((v) => (
              <div
                key={v.title}
                className="bg-white rounded-2xl p-6 border border-primary-earth/10 text-center shadow-sm"
              >
                <div className="text-3xl mb-3">{v.emoji}</div>
                <h3 className="font-semibold text-primary-earth mb-2">{v.title}</h3>
                <p className="text-sm text-primary-earth/60 leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>

          {/* Contact CTA */}
          <div className="text-center mt-12">
            <p className="text-primary-earth/60 text-sm mb-4">
              {isAr ? "هل لديك سؤال؟ تواصل معنا" : "Have a question? Get in touch"}
            </p>
            <button
              onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })}
              // border-transparent is load-bearing, not decoration: the button
              // below it is outlined, and a 1px border adds 2px of height.
              // Without a matching (invisible) border here the two stacked
              // pills are 43px and 45px tall, which reads as sloppy alignment.
              className="inline-flex items-center gap-2 px-6 py-3 border border-transparent bg-primary-earth text-white rounded-full text-sm font-medium hover:bg-primary-earth/90 transition-colors"
            >
              {isAr ? "راسلنا" : "Contact Us"}
            </button>

            {/* Back to the homepage, below the contact button. Same pill
                geometry, padding and type as the button above so the pair reads
                as one set; outlined rather than filled because two identical
                solid pills stacked compete for the same attention, and
                "contact us" is the primary action on this page. A Link, not a
                button with navigate(), so it is a real anchor: middle-click,
                open-in-new-tab and crawlers all work. */}
            <div className="mt-3">
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-primary-earth/25 text-primary-earth/85 text-sm font-medium transition-colors hover:border-accent-gold hover:text-accent-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2"
              >
                <Home className="w-4 h-4 shrink-0" aria-hidden="true" />
                {isAr
                  ? "العودة إلى الصفحة الرئيسية"
                  : language === "fr"
                    ? "Retour à l'accueil"
                    : "Back to homepage"}
              </Link>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
