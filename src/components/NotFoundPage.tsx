import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Home, Droplets, Sparkles, ShoppingBag } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useProducts } from "../context/ProductContext";

/**
 * Real 404 page.
 *
 * Before this existed, every broken URL was silently `navigate('/', {replace:true})`d
 * to the homepage — the visitor never learned the link was wrong, and Google saw
 * a "soft 404" (thin/duplicate content served with a 200, or a 404 status whose
 * body was just the homepage). Both are explicitly discouraged by Google.
 *
 * `variant` only changes the wording, so a missing product can say "this product"
 * instead of "this page" while sharing one design and one noindex rule.
 */
export default function NotFoundPage({
  variant = "page",
}: {
  variant?: "page" | "product" | "category";
}) {
  const { language } = useLanguage();
  const { storeSettings } = useProducts();
  const isAr = language === "ar";
  const isFr = language === "fr";
  const storeName = storeSettings?.storeName || "Bellaura Oils";

  const heading = isAr
    ? "الصفحة غير موجودة"
    : isFr
      ? "Page introuvable"
      : "Page not found";

  const body =
    variant === "product"
      ? isAr
        ? "هذا المنتج غير متوفر أو تم تغيير رابطه. يمكنك تصفح باقي منتجاتنا من الأسفل."
        : isFr
          ? "Ce produit n'existe plus ou son lien a changé. Découvrez le reste de nos produits ci-dessous."
          : "This product no longer exists or its link has changed. Browse the rest of our products below."
      : variant === "category"
        ? isAr
          ? "هذا القسم غير موجود أو تم تغيير رابطه. يمكنك تصفح أقسامنا من الأسفل."
          : isFr
            ? "Cette catégorie n'existe pas ou son lien a changé. Parcourez nos catégories ci-dessous."
            : "This category does not exist or its link has changed. Browse our categories below."
        : isAr
          ? "الرابط الذي فتحته غير صحيح أو لم يعد موجوداً. يمكنك الرجوع إلى الصفحة الرئيسية أو تصفح أقسامنا."
          : isFr
            ? "Le lien que vous avez ouvert est incorrect ou n'existe plus. Retournez à l'accueil ou parcourez nos catégories."
            : "The link you opened is incorrect or no longer exists. Head back home or browse our categories.";

  const eyebrow = isAr ? "خطأ ٤٠٤" : "Error 404";
  const homeLabel = isAr
    ? "العودة إلى الصفحة الرئيسية"
    : isFr
      ? "Retour à l'accueil"
      : "Back to homepage";
  const orBrowse = isAr
    ? "أو تصفح أقسامنا"
    : isFr
      ? "Ou parcourez nos catégories"
      : "Or browse our categories";

  const quickLinks = [
    {
      to: "/products",
      icon: ShoppingBag,
      label: isAr ? "جميع المنتجات" : isFr ? "Tous les produits" : "All products",
    },
    {
      to: "/skin",
      icon: Sparkles,
      label: isAr ? "العناية بالبشرة" : isFr ? "Soins de la peau" : "Skin care",
    },
    {
      to: "/hair-and-scalp",
      icon: Droplets,
      label: isAr ? "الشعر وفروة الرأس" : isFr ? "Cheveux et cuir chevelu" : "Hair & scalp",
    },
  ];

  return (
    <>
      <Helmet>
        <title>
          {heading} | {storeName}
        </title>
        {/* A 404 must never be indexed. `follow` is deliberate: crawlers should
            still walk the recovery links below instead of treating this as a
            dead end. The server sends the matching 404 status for unknown
            paths; for slugs only the client can resolve (custom sections,
            deleted products) this tag is the signal that keeps the URL out
            of the index. */}
        <meta name="robots" content="noindex, follow" />
      </Helmet>

      <div
        className="pt-40 lg:pt-36 pb-24 bg-white min-h-screen"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-accent-gold font-medium mb-6">
            {eyebrow}
          </p>

          {/* Oversized numeral as the visual anchor, kept very light so it
              reads as decoration rather than shouting at the visitor. */}
          <div
            className="text-[6rem] sm:text-[8rem] leading-none font-light text-primary-earth/15 select-none mb-2"
            aria-hidden="true"
            dir="ltr"
          >
            404
          </div>

          <h1 className="text-3xl sm:text-4xl font-light text-primary-earth mb-5 leading-tight">
            {heading}
          </h1>

          <p className="text-primary-earth/60 leading-relaxed mb-10">{body}</p>

          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-full bg-primary-earth text-white text-sm font-medium tracking-wide transition-colors hover:bg-accent-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2"
          >
            <Home className="w-4 h-4 shrink-0" aria-hidden="true" />
            {homeLabel}
          </Link>

          <div className="mt-14 pt-10 border-t border-primary-earth/10">
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary-earth/40 mb-6">
              {orBrowse}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {quickLinks.map(({ to, icon: Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-primary-earth/15 text-sm text-primary-earth/80 transition-colors hover:border-accent-gold hover:text-accent-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
