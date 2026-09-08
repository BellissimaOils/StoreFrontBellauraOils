import React from "react";
import StarRating from "./StarRating";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useCart } from "../context/CartContext";
import { useProducts } from "../context/ProductContext";
import { Product, getProductSlug, parseBenefitsList } from "../types";
import { getOptimizedImageUrl } from "../lib/imageUtils";
import {
  Sparkles,
  Droplets,
  Shield,
  Leaf,
  Heart,
  Zap,
  Sun,
  Eye,
  ShieldCheck,
  Activity,
  ShoppingBag,
  Crown,
  Layers,
  Columns,
} from "lucide-react";

interface PremiumData {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  glowColor: string;
  tag: {
    en: string;
    ar: string;
    fr: string;
  };
  benefits: {
    en: string[];
    ar: string[];
    fr: string[];
  };
  volume: string;
}

// One shared style for the product tag chip ("Cold Pressed" / "100% Pure" /
// custom tags). Previously each of the 7 layout variants declared its own
// slightly different washed-out gold outline, so the same chip looked
// inconsistent from section to section. This is a single solid lilac pill
// with dark plum text, which reads clearly against the dark card surfaces.
// text-[#1a0823] rather than a plum-* token: the plum scale was introduced by
// the colour commit that has since been reverted, so referencing it here would
// resolve to nothing and leave this chip with inherited (white) text on a light
// lilac pill — invisible. #1a0823 is the dark value this file already used for
// dark-on-light-accent text before that commit.
// Canonical product-card styles. Each of these used to be re-declared per
// layout variant with values that had drifted apart — the same "disabled"
// state used three different backgrounds (#14081b, black/50, #130919), the
// same gold CTA used three different dark text values and two different
// hovers (white vs gray-900), and the discount badge had three padding/
// rounding/border combinations. One definition each, so a variant cannot
// silently diverge again.
const DISCOUNT_BADGE_CLASS =
  "text-[11px] sm:text-[12px] font-black tracking-tight text-white bg-[#cc0000] border border-[#ff0000]/30 px-3 py-1 rounded-[10px] shadow-md";
const CTA_ENABLED_CLASS =
  "bg-accent-gold text-[#1a0823] hover:bg-white hover:text-black hover:shadow-xl cursor-pointer";
const CTA_DISABLED_CLASS =
  "bg-[#14081b] text-gray-500 border border-white/5 cursor-not-allowed shadow-none";

// Benefit list cap.
//
// This used to be two different limits — 3 on mobile, 10 on desktop, with the
// desktop overflow split into a second column — so a pack's benefits list
// visibly grew past 3 items the moment the screen got wider. The request was
// for one consistent cap everywhere, so this is now a single number and the
// second-column layout that used to split the desktop overflow into its own
// <ul> is gone, since 3 items never fill more than one column anyway.
const BENEFITS_MAX = 3;

const TAG_BADGE_CLASS =
  "inline-flex items-center gap-1.5 bg-accent-lilac text-[#1a0823] text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-1 rounded-full shadow-sm leading-none whitespace-nowrap";

const PREMIUM_OILS_DATA: Record<string, PremiumData> = {
  "sweet-almond-oil": {
    icon: Sparkles,
    iconColor: "text-[#ffd54f]",
    glowColor: "shadow-[#ffd54f]/10 border-[#ffd54f]/20",
    tag: { en: "Cold Pressed", ar: "معصور على البارد", fr: "Pressée à Froid" },
    benefits: {
      en: [
        "Naturally and gently brightens skin tone",
        "Soothes and hydrates dry, sensitive areas",
        "Rich in nourishing vitamins and minerals",
      ],
      ar: [
        "موازن طبيعي للبشرة وسريع الامتصاص",
        "يهدئ ويرطب المناطق الجافة والحساسة",
        "غني بالفيتامينات والمعادن المغذية",
      ],
      fr: [
        "Éclaircit naturellement et en douceur le teint",
        "Apaise et hydrate les zones sèches et sensibles",
        "Riche en vitamines et minéraux nourrissants",
      ],
    },
    volume: "50ml",
  },
  "avocado-oil": {
    icon: Droplets,
    iconColor: "text-[#64b5f6]",
    glowColor: "shadow-[#64b5f6]/10 border-[#64b5f6]/20",
    tag: { en: "Cold Pressed", ar: "معصور على البارد", fr: "Pressée à Froid" },
    benefits: {
      en: [
        "Deep hydration for inner skin layers",
        "Rich in nourishing Vitamins A, D, and E",
        "Treats extreme dryness and nourishes hair fibers",
      ],
      ar: [
        "ترطيب عميق لطبقات البشرة الداخلية",
        "غني بفيتامينات (أ، د، هـ) المغذية",
        "يعالج الجفاف الشديد ويغذي ألياف الشعر",
      ],
      fr: [
        "Hydratation profonde des couches de la peau",
        "Riche en vitamines nourrissantes A, D et E",
        "Traite la sécheresse extrême et nourrit le cheveu",
      ],
    },
    volume: "50ml",
  },
  "castor-oil": {
    icon: ShieldCheck,
    iconColor: "text-[#4db6ac]",
    glowColor: "shadow-[#4db6ac]/10 border-[#4db6ac]/20",
    tag: { en: "100% Pure", ar: "نقي 100%", fr: "100% Pure" },
    benefits: {
      en: [
        "Superb moisturizing and moisture lock-in",
        "Forms a strong protective layer against elements",
        "Stimulates hair growth, thickness, and strength",
      ],
      ar: [
        "ترطيب فائق وحبس الرطوبة داخل الخلايا",
        "يشكل طبقة حماية قوية ضد العوامل الخارجية",
        "يحفز نمو الشعر ويزيد كثافته وقوته",
      ],
      fr: [
        "Hydratation supérieure et scelle l'humidité",
        "Forme une barrière protectrice contre les éléments",
        "Stimule la pousse, la densité et la force du cheveu",
      ],
    },
    volume: "100ml",
  },
  "neem-oil": {
    icon: Leaf,
    iconColor: "text-[#81c784]",
    glowColor: "shadow-[#81c784]/15 border-[#81c784]/20",
    tag: { en: "Organic", ar: "عضوي", fr: "Biologique" },
    benefits: {
      en: [
        "Anti-bacterial and skin anti-inflammatory",
        "Treats scalp dandruff and purifies the scalp",
        "Best blended with a strong carrier or base oil",
      ],
      ar: [
        "مضاد للبكتيريا والالتهابات الجلد",
        "يعالج قشرة الرأس ويُطهر فروة الرأس",
        "يُفضل مزجه مع ناقل زيت قوي",
      ],
      fr: [
        "Antibactérien et anti-inflammatoire cutané",
        "Traite les pellicules et purifie le cuir chevelu",
        "Idéal à mélanger avec une huile végétale de base",
      ],
    },
    volume: "50ml",
  },
  "rosehip-oil": {
    icon: Heart,
    iconColor: "text-[#f06292]",
    glowColor: "shadow-[#f06292]/10 border-[#f06292]/20",
    tag: { en: "Cold Pressed", ar: "معصور على البارد", fr: "Pressée à Froid" },
    benefits: {
      en: [
        "Renews skin cells and evens skin tone",
        "Resists wrinkles and stretch marks",
        "Grants the skin instant radiance and freshness",
      ],
      ar: [
        "يجدد خلايا البشرة ويوحد لونها",
        "مقاوم للتجاعيد وعلامات التمدد",
        "يمنح البشرة إشراقة ونضارة فورية",
      ],
      fr: [
        "Renouvelle les cellules et unifie le teint",
        "Lutte contre les rides et les vergetures",
        "Procure au visage éclat et fraîcheur instantanés",
      ],
    },
    volume: "50ml",
  },
  "apricot-oil": {
    icon: Zap,
    iconColor: "text-[#ffb74d]",
    glowColor: "shadow-[#ffb74d]/10 border-[#ffb74d]/20",
    tag: { en: "Cold Pressed", ar: "معصور على البارد", fr: "Pressée à Froid" },
    benefits: {
      en: [
        "Extremely gentle and suitable for sensitive skin",
        "Softens skin texture and improves elasticity",
        "Nourishes hair without leaving a heavy greasy feel",
      ],
      ar: [
        "لطيف جداً ومناسب للبشرة الحساسة",
        "ينعم ملمس الجلد ويحسن مرونته",
        "يغذي الشعر دون تركه ملمساً دهنياً ثقيلاً",
      ],
      fr: [
        "Très doux et idéal pour peaux sensibles",
        "Adoucit le grain de peau et améliore l'élasticité",
        "Nourrit les cheveux sans laisser de fini gras et lourd",
      ],
    },
    volume: "50ml",
  },
  "sesame-oil": {
    icon: Activity,
    iconColor: "text-[#ba68c8]",
    glowColor: "shadow-[#ba68c8]/10 border-[#ba68c8]/20",
    tag: {
      en: "Antioxidant Rich",
      ar: "غني بمضادات الأكسدة",
      fr: "Riche en Antioxydants",
    },
    benefits: {
      en: [
        "Deep nutrition with rapid penetration into pores",
        "Promotes health and vitality of skin and hair",
        "Protects against dryness and harmful heat effects",
      ],
      ar: [
        "تغذية عميقة وتغلغل سريع في المسام",
        "يعزز صحة وحيوية الجلد والشعر",
        "يحمي من الجفاف والحرارة الضارة",
      ],
      fr: [
        "Nutrition intense et pénétration rapide",
        "Favorise la santé et la vitalité cutanée et capillaire",
        "Protège contre le dessèchement et la chaleur",
      ],
    },
    volume: "50ml",
  },
  "macadamia-oil": {
    icon: Sun,
    iconColor: "text-[#ffd54f]",
    glowColor: "shadow-[#ffd54f]/10 border-[#ffd54f]/20",
    tag: {
      en: "Ultra Nourishing",
      ar: "مغذي بعمق",
      fr: "Ultra Nourrissant",
    },
    benefits: {
      en: [
        "Nourishes dry skin and restores vitality",
        "Deep restoration and repair for damaged hair",
        "Absorbs swiftly without leaving any greasy residue",
      ],
      ar: [
        "يغذي البشرة الجافة ويعيد لها الحيوية",
        "ترميم وإصلاح عميق للشعر التالف والجاف",
        "يمتص سريعاً ولا يترك أي أثر دهني مزعج",
      ],
      fr: [
        "Nourrit la peau sèche et restaure sa vitalité",
        "Restauration profonde pour cheveux abîmés",
        "S'absorbe rapidement sans aucun film gras",
      ],
    },
    volume: "50ml",
  },
  "hemp-seed-oil": {
    icon: Eye,
    iconColor: "text-[#80deea]",
    glowColor: "shadow-[#80deea]/10 border-[#80deea]/20",
    tag: {
      en: "Skin Balancer",
      ar: "موازن للبشرة",
      fr: "Équilibreur de Peau",
    },
    benefits: {
      en: [
        "Strengthens and protects irritated skin barrier",
        "Regulates sebum without clogging facial pores",
        "Significantly calms inflammation and redness",
      ],
      ar: [
        "يقوي حاجز البشرة المتهيج ويحميها",
        "ينظم الدهون دون سد مسام الوجه",
        "يهدئ الالتهابات والاحمرار بشكل ملحوظ",
      ],
      fr: [
        "Renforce et protège la barrière cutanée",
        "Régule le sébum sans boucher les pores",
        "Calme visiblement les inflammations et rougeurs",
      ],
    },
    volume: "50ml",
  },
  "grapeseed-oil": {
    icon: Shield,
    iconColor: "text-[#b39ddb]",
    glowColor: "shadow-[#b39ddb]/10 border-[#b39ddb]/20",
    tag: {
      en: "Cold Pressed",
      ar: "معصور على البارد",
      fr: "Pressée à Froid",
    },
    benefits: {
      en: [
        "Natural skin balancing and fast absorption",
        "Nourishes the skin without clogging pores",
        "Grants hair and skin smoothness and protection",
      ],
      ar: [
        "موازن طبيعي للبشرة وسريع الامتصاص",
        "يغذي البشرة دون سد المسام",
        "يمنح الشعر والبشرة نعومة وحماية",
      ],
      fr: [
        "Équilibreur naturel de la peau à absorption rapide",
        "Nourrit la peau sans obstruer les pores",
        "Apporte douceur et protection aux cheveux et à la peau",
      ],
    },
    volume: "50ml",
  },
};

const DEFAULT_PACK_PREMIUM_DATA = (product: Product): PremiumData => {
  const isSkin = String(product.id).includes("skin");
  return {
    icon: Sparkles,
    iconColor: "text-accent-gold",
    glowColor: "shadow-accent-gold/10 border-accent-gold/20",
    tag: { en: "Complete Care", ar: "باقة عناية متكاملة", fr: "Soin Complet" },
    benefits: {
      en: product.benefits || [
        "Balances and coordinates",
        "Deep hydration and wellness",
        "Revitalizes naturally",
      ],
      ar: isSkin
        ? [
            "يوازن إفراز دهون البشرة",
            "يرطب بشكل ملائم ولطيف",
            "ينقي ويصغر مسام الوجه",
          ]
        : [
            "يرمم ويصلح ألياف الشعر التالف",
            "تغذية فائقة من الجذور للأطراف",
            "يعيد اللمعان والصحة لشعرك",
          ],
      fr: isSkin
        ? [
            "Équilibre l'excès de sébum",
            "Hydrate correctement et en douceur",
            "Resserre et purifie les pores",
          ]
        : [
            "Répare et reconstruit la fibre",
            "Nutrition des racines aux pointes",
            "Restaure une brillance éclatante",
          ],
    },
    volume: "Combo Pack",
  };
};

interface ProductCardProps {
  product: Product;
  layoutMode?: "compact" | "grid" | "vertical" | "minimal" | "circular" | "luxury" | "split" | "floating" | "featured" | "banner";
  key?: React.Key | null | undefined;
}

function ProductCardInner({ product, layoutMode = "grid" }: ProductCardProps) {
  const { language, t } = useLanguage();
  const { addToCart } = useCart();

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const target = e.currentTarget;
    if (!target.dataset.failed) {
      target.dataset.failed = "true";
      if (product.image && target.src !== product.image) {
        target.src = product.image;
      }
    }
  };
  const { storeSettings } = useProducts();
  const isAr = language === "ar";
  const isFr = language === "fr";
  const [isAdded, setIsAdded] = React.useState(false);

  if (!product) return null;

  const displayPriceNum = Math.round(parseFloat(String(product.price || "0").replace(/[^\d.]/g, "")) || 0);

  // Retrieve premium metadata matching the product ID
  const prodName = String(product.name || "");
  // The real `isPack` flag (set explicitly in the admin) wins when present;
  // the id/name string-matching below is the original heuristic, kept as a
  // fallback for any product saved before this flag existed.
  const isPack = product.isPack === true || String(product.id || "").startsWith("pack-") || prodName.toLowerCase().includes("pack");
  
  let mappedKey = String(product.id || "");
  if (!isPack && !PREMIUM_OILS_DATA[mappedKey]) {
      const searchStr = `${prodName} ${product.image || ''}`.toLowerCase();
      if (searchStr.includes("almond") || searchStr.includes("لوز")) mappedKey = "sweet-almond-oil";
      else if (searchStr.includes("avocado") || searchStr.includes("افوكادو") || searchStr.includes("أفوكادو")) mappedKey = "avocado-oil";
      else if (searchStr.includes("castor") || searchStr.includes("خروع")) mappedKey = "castor-oil";
      else if (searchStr.includes("neem") || searchStr.includes("نيم")) mappedKey = "neem-oil";
      else if (searchStr.includes("rosehip") || searchStr.includes("ثمر الورد")) mappedKey = "rosehip-oil";
      else if (searchStr.includes("apricot") || searchStr.includes("مشمش")) mappedKey = "apricot-oil";
      else if (searchStr.includes("sesame") || searchStr.includes("سمسم")) mappedKey = "sesame-oil";
      else if (searchStr.includes("macadamia") || searchStr.includes("مكاديميا")) mappedKey = "macadamia-oil";
      else if (searchStr.includes("hemp") || searchStr.includes("قنب")) mappedKey = "hemp-seed-oil";
      else if (searchStr.includes("grape") || searchStr.includes("عنب")) mappedKey = "grapeseed-oil";
  }

  const premium = isPack
    ? DEFAULT_PACK_PREMIUM_DATA(product)
    : PREMIUM_OILS_DATA[mappedKey] || PREMIUM_OILS_DATA["grapeseed-oil"];
  const IconComponent = premium.icon;

  // The size the admin stored takes precedence over PREMIUM_OILS_DATA's
  // hardcoded volume and over the pack override below. Until now the card
  // could only ever print the hardcoded value — a pack was force-labelled
  // "Full Kit" and an oil got whatever the name-keyword match guessed — so
  // setting a size in the admin had no visible effect even once it saved.
  // Empty means nothing was entered, and the old fallbacks stand unchanged.
  const storedSize = String(product.size_label || product.volume || "").trim();
  const packSizeLabel = isAr ? "طقم كامل" : "Full Kit";
  const sizeBadge = storedSize || premium.volume;
  const sizeCapsule = storedSize || (isPack ? packSizeLabel : premium.volume);
  const showSize = product.show_size !== false && (product as any).show_size !== 0 && (product as any).show_size !== "0" && (product as any).showSize !== false;

  // Size text ("4 x 50 ml", "100ml") is always written in Latin digits/letters,
  // even on an Arabic page. The whole document flips to dir="rtl" for Arabic
  // (LanguageContext sets document.documentElement.dir), and a mixed run of
  // digits and Latin letters with no explicit direction gets reordered by the
  // browser's bidi algorithm inside an RTL container — "4 x 50 ml" could come
  // out reading "50 ml x 4". Wrapping it in dir="ltr" pins the token order to
  // however it was typed, regardless of page direction. This used to be applied
  // at only one of the five spots that render a size string; the other four
  // were still exposed to the same reordering.
  const renderSizeText = (value: string) => (isAr ? <span dir="ltr">{value}</span> : value);

  const outOfStockText = language === 'ar' ? (storeSettings?.outOfStockTextAr || "نفذت الكمية") : (language === 'fr' ? (storeSettings?.outOfStockTextFr || "Rupture") : (storeSettings?.outOfStockTextEn || "Out of Stock"));

  const rawTag = product.tag !== undefined && product.tag !== null ? String(product.tag).trim() : "";
  const isNoTag = rawTag === "none";
  const hasCustomTag = rawTag !== "" && !isNoTag;

  // An empty tag means "use the default", and AdminProductModal's default radio
  // is explicitly labelled Cold Pressed — picking it saves tag: "". So empty
  // must render as Cold Pressed, full stop.
  //
  // This previously branched on the category and substituted "100% Pure" for
  // anything that wasn't an oil, which meant selecting Cold Pressed in the
  // admin displayed a completely different label the admin never chose on
  // packs and other non-oil categories. Removed the branch (and the now-unused
  // catLower / isOilCategory it existed for). An admin who wants "100% Pure"
  // selects the custom option, which stores it as a real tag value.
  const currentTag = isNoTag
    ? null
    : (hasCustomTag
        ? rawTag
        : (language === "ar" ? "معصور على البارد" : language === "fr" ? "Pressée à Froid" : "Cold Pressed")
      );

  // Parse Arabic and English names
  let englishName = product.name_en || "";
  let arabicName = prodName;

  if (prodName.includes(" (")) {
    const parts = prodName.split(" (");
    if (!englishName) englishName = parts[0];
    arabicName = parts[1].replace(")", "");
  } else if (!englishName) {
    englishName = prodName;
  }

  // Determine localized display strings
  const titleDisplay = isAr && arabicName ? arabicName : englishName;
  const subtitleDisplay = isAr ? englishName : arabicName || product.category || "";

  // Calculate discount string for top-left label
  let discountStr = "";
  if (product.isSale && product.originalPrice) {
    const p = displayPriceNum;
    const op = parseFloat(String(product.originalPrice).replace(/[^\d.]/g, ""));
    if (!isNaN(p) && !isNaN(op) && op > 0) {
      const pct = Math.round(((op - p) / op) * 100);
      if (language === "ar") {
        discountStr = `تخفيض -${pct}%`;
      } else if (language === "fr") {
        discountStr = `REDUC -${pct}%`;
      } else {
        discountStr = `-${pct}%`;
      }
    }
  }
  if (!discountStr && product.isSale) {
    discountStr = isAr ? "تخفيض" : language === "fr" ? "SOLDE" : "SALE";
  }

  const topTagStr = discountStr || currentTag;
  const isDiscount = !!discountStr;
  // `product.rating` is only meaningful when there are reviews behind it. The
  // old `product.rating || 5.0` fallback invented a five-star score for
  // unreviewed products, which is why it was only ever rendered behind
  // `hasReviews` — StarRating applies the same rule itself, so the five empty
  // stars an unrated product now shows are honest rather than hidden.
  const hasReviews = product.reviews !== undefined && Number(product.reviews) > 0;
  const ratingValue = product.rating;
  const reviewsCount = Number(product.reviews) || 0;

  const productSlug = product.name_en ? getProductSlug(product.name_en) : getProductSlug(product.name);

  // Benefits come from the product itself (products_Data.benefits, entered in
  // the admin) — this previously read ONLY the hardcoded PREMIUM_OILS_DATA
  // table, so whatever an admin typed for a product never appeared on its
  // card, and packs/products with no premium entry fell back to an unrelated
  // oil's benefits. The curated premium copy is now just the fallback for
  // products that genuinely have no benefits saved, and the admin's
  // showBenefits toggle is respected (ProductAccordions already honoured it).
  const ownBenefits = parseBenefitsList(product.benefits);
  const premiumBenefits: string[] =
    (premium.benefits && (premium.benefits as any)[language]) || premium.benefits.en || [];
  const currentBenefits =
    product.showBenefits === false
      ? []
      : ownBenefits.length > 0
        ? ownBenefits
        : premiumBenefits;

  // Capped to the same BENEFITS_MAX on every breakpoint now, so there is
  // nothing left to overflow into a second column — see the banner-layout
  // render below, which used to split anything past the mobile cap into a
  // second <ul> that only appeared at `lg`.
  const cappedBenefits = currentBenefits.slice(0, BENEFITS_MAX);

  if (layoutMode === "vertical") {
    const primaryTitle = isAr ? (arabicName || englishName) : englishName;
    const secondaryTitle = isAr ? englishName : arabicName;

    return (
      <div
        className="group flex flex-col w-full h-full text-start"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="relative w-full h-full flex flex-col justify-between overflow-hidden rounded-2xl border border-accent-gold/35 bg-gradient-to-b from-[#231232] via-[#14091d] to-[#09030d] p-3.5 sm:p-4 shadow-xl transition-all duration-300 hover:border-accent-gold/60 hover:shadow-[0_8px_30px_rgba(214,179,252,0.18)]">
          <div className="relative w-full flex-1 flex flex-col">
            {/* Top Badges */}
            <div className="flex items-center justify-between gap-2 mb-2.5">
              {currentTag && (
                <span className={TAG_BADGE_CLASS}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
              )}

              {isDiscount && (
                <span className="text-[10px] font-extrabold text-accent-gold bg-amber-950/80 border border-amber-500/40 px-2 py-0.5 rounded shadow-sm">
                  {discountStr}
                </span>
              )}
            </div>

            {/* Tall Vertical Portrait Image Container */}
            <Link
              to={`/product/${productSlug}`}
              className="block w-full text-center rounded-xl relative overflow-hidden group/img aspect-[3/4] bg-[#0d0514] border border-white/10 p-3 transition-all duration-300 hover:border-accent-gold/40"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(214,179,252,0.12)_0%,transparent_70%)] pointer-events-none" />
              {product.image && (
                <img
                  src={getOptimizedImageUrl(product.image, 'eco', 500) || undefined}
                  alt={product.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-contain transition-transform duration-500 ease-out group-hover/img:scale-105 relative z-10 drop-shadow-lg"
                  referrerPolicy="no-referrer"
                  
                  
                />
              )}
            </Link>

            {/* Product Details Stack */}
            <div className="mt-3 flex-1 flex flex-col justify-between text-start">
              <div>
                <h3 className="text-sm font-bold text-white line-clamp-2 leading-snug break-words min-w-0">
                  {primaryTitle}
                </h3>
                {secondaryTitle && (
                  <p className="text-[11px] text-accent-gold/85 font-medium line-clamp-1 mt-0.5 break-words min-w-0">
                    {secondaryTitle}
                  </p>
                )}

                {/* Rating & Volume */}
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
                  <StarRating
                    value={ratingValue}
                    count={reviewsCount}
                    size="xs"
                    showValue
                    showCount={hasReviews}
                    className="text-amber-400"
                  />
                  {showSize && sizeBadge && (
                    <span className="text-[10px] text-white/80 bg-white/10 px-2 py-0.5 rounded border border-white/10">
                      {renderSizeText(sizeBadge)}
                    </span>
                  )}
                </div>
              </div>

              {/* Price Row */}
              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-baseline justify-between">
                <div className="flex items-baseline gap-1" dir="ltr">
                  <span className="text-accent-gold font-extrabold text-lg">
                    {displayPriceNum}
                  </span>
                  <span className="text-accent-gold/80 font-bold text-xs uppercase">
                    DH
                  </span>
                  {product.originalPrice && (
                    <span className="text-white/40 line-through text-xs ml-1">
                      {product.originalPrice}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Add to Cart Button */}
          <button
            onClick={() => {
              if (product.isAvailable !== false) {
                addToCart(product);
                setIsAdded(true);
                setTimeout(() => setIsAdded(false), 1200);
              }
            }}
            disabled={product.isAvailable === false}
            className={`mt-3 w-full py-2.5 px-3 rounded-xl text-xs font-bold uppercase transition-all duration-200 flex items-center justify-center gap-1.5 active:scale-95 ${
              product.isAvailable === false
                ? CTA_DISABLED_CLASS
                : isAdded
                  ? "bg-green-600 text-white"
                  : "bg-accent-gold text-[#14061f] hover:bg-white hover:text-black cursor-pointer shadow-md"
            }`}
          >
            {isAdded ? (
              <span>{isAr ? "تم الإضافة!" : "Added!"}</span>
            ) : product.isAvailable === false ? (
              <span>{outOfStockText}</span>
            ) : (
              <div className="flex items-center gap-1.5 justify-center">
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>{isAr ? "أضف إلى السلة" : "Add to Cart"}</span>
              </div>
            )}
          </button>
        </div>
      </div>
    );
  }
  /* Look: Circular Botanical Pill Card Layout (الشكل الدائري) */
  if (layoutMode === "circular") {
    const primaryTitle = isAr ? (arabicName || englishName) : englishName;

    return (
      <div
        className="group flex flex-col w-full h-full text-center items-center"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="relative w-full h-full flex flex-col items-center justify-between overflow-hidden rounded-3xl border border-accent-gold/30 bg-gradient-to-b from-[#251338] via-[#170a24] to-[#0c0314] p-4 shadow-xl transition-all duration-300 hover:border-accent-gold/70 hover:shadow-accent-gold/10">
          <div className="relative w-full flex flex-col items-center">
            {/* Top Pill Tag */}
            {currentTag && (
              <span className={`mb-3 ${TAG_BADGE_CLASS}`}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
            )}

            {/* Circular Frame for Product Image */}
            <Link
              to={`/product/${productSlug}`}
              className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full border-2 border-accent-gold/40 p-2 bg-gradient-to-tr from-[#2f1746] to-[#12051e] shadow-inner overflow-hidden flex items-center justify-center group/circle transition-transform duration-500 hover:scale-105 hover:border-accent-gold"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(214,179,252,0.2)_0%,transparent_75%)] pointer-events-none" />
              {product.image && (
                <img
                  src={getOptimizedImageUrl(product.image, 'eco', 400) || undefined}
                  alt={product.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-contain relative z-10 drop-shadow-md transition-transform duration-500 group-hover/circle:scale-110"
                  referrerPolicy="no-referrer"
                  
                  
                />
              )}
            </Link>

            <div className="mt-3 text-center w-full">
              <h3 className="text-sm sm:text-base font-bold text-white line-clamp-2 break-words min-w-0">
                {primaryTitle}
              </h3>
              
              <div className="mt-2 inline-flex items-center gap-1 bg-white/5 border border-white/10 px-3 py-1 rounded-full text-accent-gold font-extrabold text-sm" dir="ltr">
                <span>{displayPriceNum}</span>
                <span className="text-xs">DH</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              if (product.isAvailable !== false) {
                addToCart(product);
                setIsAdded(true);
                setTimeout(() => setIsAdded(false), 1200);
              }
            }}
            disabled={product.isAvailable === false}
            className={`mt-4 w-full py-2.5 px-4 rounded-full text-xs font-bold uppercase transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 ${
              product.isAvailable === false
                ? CTA_DISABLED_CLASS
                : isAdded
                  ? "bg-green-600 text-white"
                  : CTA_ENABLED_CLASS
            }`}
          >
            {isAdded ? (
              <span>{isAr ? "تم الإضافة!" : "Added!"}</span>
            ) : product.isAvailable === false ? (
              <span>{outOfStockText}</span>
            ) : (
              <div className="flex items-center gap-1.5 justify-center">
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>{isAr ? "أضف للسلة" : "Add to Cart"}</span>
              </div>
            )}
          </button>
        </div>
      </div>
    );
  }

  /* Look: Modern Dual-Pane Split Layout (الشكل العصري المزدوج) */
  if (layoutMode === "split") {
    const primaryTitle = isAr ? (arabicName || englishName) : englishName;
    const secondaryTitle = isAr ? englishName : arabicName;

    return (
      <div
        className="group w-full h-full"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="relative w-full h-full flex flex-col sm:flex-row rounded-2xl border border-accent-gold/30 bg-gradient-to-b from-[#231232] via-[#14091d] to-[#09030d] overflow-hidden shadow-xl transition-all duration-300 hover:border-accent-gold/60">
          {/* Left/Right Media Box */}
          <Link
            to={`/product/${productSlug}`}
            className="w-full sm:w-5/12 aspect-square sm:aspect-auto bg-[#0d0416] p-4 flex items-center justify-center relative overflow-hidden group/img border-b sm:border-b-0 sm:border-e border-white/10 shrink-0"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(214,179,252,0.15)_0%,transparent_70%)] pointer-events-none" />
            {isDiscount && (
              <span className="absolute top-2 start-2 z-20 text-[9px] font-bold text-accent-gold bg-amber-950/80 border border-amber-500/40 px-2 py-0.5 rounded-md shadow-sm">
                {discountStr}
              </span>
            )}
            {product.image && (
              <img
                src={getOptimizedImageUrl(product.image, 'eco', 450) || undefined}
                alt={product.name}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-contain transition-transform duration-500 group-hover/img:scale-105 relative z-10"
                referrerPolicy="no-referrer"
                
                
              />
            )}
          </Link>

          {/* Details Content Box */}
          <div className="w-full sm:w-7/12 p-4 flex flex-col justify-between text-start bg-gradient-to-b from-[#1a0c2b] to-[#12071f]">
            <div>
              <div className="flex items-center justify-between gap-1 mb-1.5">
                {currentTag && (
                  <span className={TAG_BADGE_CLASS}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
                )}
                {showSize && sizeBadge && (
                  <span className="text-[10px] text-white/60 bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                    {renderSizeText(sizeBadge)}
                  </span>
                )}
              </div>

              <h3 className="text-sm font-bold text-white line-clamp-2 leading-tight break-words min-w-0">
                {primaryTitle}
              </h3>
              {secondaryTitle && (
                <p className="text-[11px] text-accent-gold/80 line-clamp-1 mt-0.5 break-words min-w-0">
                  {secondaryTitle}
                </p>
              )}

              <div className="mt-2">
                <StarRating
                  value={ratingValue}
                  count={reviewsCount}
                  size="xs"
                  showValue
                  showCount={hasReviews}
                  className="text-amber-400"
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-baseline gap-1 mb-2.5" dir="ltr">
                <span className="text-accent-gold font-extrabold text-lg">
                  {displayPriceNum}
                </span>
                <span className="text-accent-gold/80 font-bold text-xs uppercase">DH</span>
              </div>

              <button
                onClick={() => {
                  if (product.isAvailable !== false) {
                    addToCart(product);
                    setIsAdded(true);
                    setTimeout(() => setIsAdded(false), 1200);
                  }
                }}
                disabled={product.isAvailable === false}
                className={`w-full py-2 px-3 rounded-xl text-xs font-bold uppercase transition-all duration-200 flex items-center justify-center gap-1.5 active:scale-95 ${
                  product.isAvailable === false
                    ? CTA_DISABLED_CLASS
                    : isAdded
                      ? "bg-green-600 text-white"
                      : CTA_ENABLED_CLASS
                }`}
              >
                {isAdded ? (
                  <span>{isAr ? "تم الإضافة!" : "Added!"}</span>
                ) : product.isAvailable === false ? (
                  <span>{outOfStockText}</span>
                ) : (
                  <div className="flex items-center gap-1.5 justify-center">
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>{isAr ? "إضافة سريعة" : "Quick Add"}</span>
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* Look: 3D Floating Glass Halo Layout (الشكل الزجاجي العائم) */
  if (layoutMode === "floating") {
    const primaryTitle = isAr ? (arabicName || englishName) : englishName;
    const secondaryTitle = isAr ? englishName : arabicName;

    return (
      <div
        className="group flex flex-col w-full h-full text-start transform-gpu transition-all duration-300 hover:-translate-y-2"
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="relative w-full h-full flex flex-col justify-between overflow-hidden rounded-3xl border border-accent-gold/30 bg-gradient-to-b from-[#231232] via-[#14091d] to-[#09030d] p-4 shadow-xl transition-all duration-300 hover:border-accent-gold/70 hover:shadow-[0_15px_35px_rgba(214,179,252,0.18)]">
          {/* Luminous Background Glow Aura */}
          <div className="absolute -top-12 -left-12 w-32 h-32 bg-accent-gold/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-accent-gold/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative w-full flex-1 flex flex-col z-10">
            <div className="flex items-center justify-between gap-1 mb-2">
              {currentTag && (
                <span className={TAG_BADGE_CLASS}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
              )}

              {isDiscount && (
                <span className="text-[10px] font-extrabold text-accent-gold bg-amber-950/80 border border-amber-500/40 px-2 py-0.5 rounded-full shadow">
                  {discountStr}
                </span>
              )}
            </div>

            {/* Elevated Glass Image Stage */}
            <Link
              to={`/product/${productSlug}`}
              className="block w-full text-center rounded-2xl relative overflow-hidden group/img aspect-[4/3] bg-black/40 border border-white/10 p-3 shadow-inner transition-transform duration-500 group-hover/img:scale-105"
            >
              {product.image && (
                <img
                  src={getOptimizedImageUrl(product.image, 'eco', 450) || undefined}
                  alt={product.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-contain relative z-10 drop-shadow-[0_10px_20px_rgba(0,0,0,0.7)]"
                  referrerPolicy="no-referrer"
                  
                  
                />
              )}
            </Link>

            <div className="mt-3.5 text-start flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-base font-extrabold text-white line-clamp-2 drop-shadow-sm break-words min-w-0">
                  {primaryTitle}
                </h3>
                {secondaryTitle && (
                  <p className="text-xs text-accent-gold/80 font-medium line-clamp-1 mt-0.5 break-words min-w-0">
                    {secondaryTitle}
                  </p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between pt-2 border-t border-white/10">
                <div className="flex items-baseline gap-1" dir="ltr">
                  <span className="text-accent-gold font-black text-lg">
                    {displayPriceNum}
                  </span>
                  <span className="text-accent-gold/80 font-bold text-xs uppercase">DH</span>
                </div>
                <StarRating
                  value={ratingValue}
                  count={reviewsCount}
                  size="xs"
                  showValue
                  className="text-amber-400"
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              if (product.isAvailable !== false) {
                addToCart(product);
                setIsAdded(true);
                setTimeout(() => setIsAdded(false), 1200);
              }
            }}
            disabled={product.isAvailable === false}
            className={`mt-3.5 w-full py-2.5 px-4 rounded-2xl text-xs font-bold uppercase transition-all duration-300 flex items-center justify-center gap-2 z-10 active:scale-95 ${
              product.isAvailable === false
                ? CTA_DISABLED_CLASS
                : isAdded
                  ? "bg-emerald-600 text-white"
                  : CTA_ENABLED_CLASS
            }`}
          >
            {isAdded ? (
              <span>{isAr ? "تم الإضافة!" : "Added!"}</span>
            ) : product.isAvailable === false ? (
              <span>{outOfStockText}</span>
            ) : (
              <div className="flex items-center gap-1.5 justify-center">
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>{isAr ? "تسوق الآن" : "Shop Floating"}</span>
              </div>
            )}
          </button>
        </div>
      </div>
    );
  }

  /* Look #4: Wide Horizontal Landscape Banner Layout */
  if (layoutMode === "banner") {
    return (
      <div
        className="group w-full text-start"
      >
        <div className="relative w-full overflow-hidden rounded-[28px] sm:rounded-[32px] border border-accent-gold/40 bg-gradient-to-r from-[#2a1637] via-[#170c1f] to-[#0a040d] p-5 sm:p-8 shadow-2xl transition-all duration-500 hover:border-accent-gold/70 hover:shadow-[0_12px_45px_rgba(214,179,252,0.22)]">
          <div className="flex flex-col lg:flex-row items-stretch gap-6 lg:gap-8">
            {/* Left Side: Wide Landscape Image Container */}
            <Link
              to={`/product/${productSlug}`}
              className="block w-full lg:w-5/12 xl:w-1/2 focus:outline-none rounded-[22px] relative overflow-hidden group/img aspect-[16/10] sm:aspect-[16/9] lg:aspect-[4/3] bg-gradient-to-b from-[#130b18] via-[#0a050d] to-[#040206] border border-white/10 transition-all duration-500 hover:border-accent-gold/50 shadow-2xl flex items-center justify-center p-6 sm:p-8 shrink-0"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(214,179,252,0.15)_0%,transparent_70%)] pointer-events-none" />
              {product.image && (
                <img
                  src={getOptimizedImageUrl(product.image, 'eco', 800) || undefined}
                  alt={product.name}
                  loading="lazy"
                  fetchPriority="low"
                  decoding="async"
                  className="w-full h-full object-contain transition-all duration-700 ease-out group-hover/img:scale-[1.08] relative z-10 drop-shadow-2xl"
                  referrerPolicy="no-referrer"
                  
                  
                />
              )}
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
                {currentTag && (
                  <span className={TAG_BADGE_CLASS}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
                )}
                {isDiscount && (
                  <span className={DISCOUNT_BADGE_CLASS}>
                    {discountStr}
                  </span>
                )}
              </div>
              <div className="absolute top-4 right-4 z-20 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-accent-gold shadow-xl">
                <IconComponent className="w-4 h-4 stroke-[1.5]" />
              </div>
            </Link>

            {/* Right Side: Product Details & Story */}
            <div className="flex-1 flex flex-col justify-between py-1">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
                  <div>
                    <h3 className="text-lg sm:text-xl font-serif tracking-[0.15em] text-accent-gold uppercase font-bold leading-tight">
                      {englishName}
                    </h3>
                    {arabicName && (
                      <p className="text-sm sm:text-base font-serif text-white/90 font-medium mt-1" dir="rtl">
                        {arabicName}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl backdrop-blur-md">
                    <StarRating
                      value={ratingValue}
                      count={reviewsCount}
                      size="sm"
                      showValue
                      className="text-amber-400"
                    />
                    <span className="text-[11px] text-white/50 font-sans">
                      {hasReviews
                        ? `(${reviewsCount} ${isAr ? "تقييم" : isFr ? "avis" : "reviews"})`
                        : isAr
                          ? "لا تقييمات بعد"
                          : isFr
                            ? "Pas encore d'avis"
                            : "No reviews yet"}
                    </span>
                  </div>
                </div>

                {currentBenefits.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-[11px] uppercase tracking-widest text-accent-gold/80 font-bold mb-2">
                      {isAr ? "أبرز الفوائد والاستعمالات:" : "Key Benefits & Uses:"}
                    </h4>
                    {/*
                      A single column: BENEFITS_MAX is 3 on every breakpoint
                      now, so there's never a second column's worth of items
                      to split off. This used to render up to BENEFITS_PER_COLUMN
                      chunks with a second <ul> revealed only at `lg`, which is
                      exactly the "10 on desktop, 3 on mobile" behaviour that was
                      reported as inconsistent.
                    */}
                    <ul className="flex flex-col gap-2 text-xs font-sans">
                      {cappedBenefits.map((text: string, index: number) => (
                        <li
                          key={index}
                          className="flex items-start gap-2 bg-white/[0.03] p-2 rounded-xl border border-white/5"
                        >
                          <span className="text-accent-gold font-bold text-sm leading-none">•</span>
                          <span className="text-white/90 text-[11.5px] leading-relaxed">{text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {showSize && sizeCapsule && (
                    <div className="bg-[#21112d] border border-white/15 rounded-full py-2 px-4 text-xs font-semibold text-white/90">
                      {renderSizeText(sizeCapsule)}
                    </div>
                  )}
                  <div className="flex items-baseline gap-1.5" dir="ltr">
                    <span className="text-accent-gold font-black text-2xl sm:text-3xl">
                      {displayPriceNum}
                    </span>
                    <span className="text-accent-gold/80 font-bold text-sm uppercase">
                      DH
                    </span>
                    {product.originalPrice && (
                      <span className="text-white/40 line-through text-sm ml-2">
                        {product.originalPrice}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      if (product.isAvailable !== false) {
                        addToCart(product);
                        setIsAdded(true);
                        setTimeout(() => setIsAdded(false), 1200);
                      }
                    }}
                    disabled={product.isAvailable === false}
                    className={`flex-1 sm:flex-initial py-3.5 px-6 rounded-[16px] text-xs font-black uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2 shadow-lg active:scale-95 ${
                      product.isAvailable === false
                        ? CTA_DISABLED_CLASS
                        : isAdded
                          ? "bg-green-700 text-white shadow-xl"
                          : CTA_ENABLED_CLASS
                    }`}
                  >
                    {isAdded ? (
                      <span>{isAr ? "تمت الإضافة للسلة!" : "Added to Basket!"}</span>
                    ) : product.isAvailable === false ? (
                      <span>{outOfStockText}</span>
                    ) : (
                      <div className="flex items-center gap-2 justify-center">
                        <ShoppingBag className="w-4 h-4" />
                        <span>{isAr ? "أضف إلى السلة" : "Add to Basket"}</span>
                      </div>
                    )}
                  </button>

                  <Link
                    to={`/product/${productSlug}`}
                    className="py-3.5 px-5 rounded-[16px] border border-white/15 bg-white/5 hover:bg-white/10 text-white/90 hover:text-white text-xs font-semibold text-center transition-all duration-200 whitespace-nowrap"
                  >
                    {isAr ? "كل التفاصيل ←" : "Full Details →"}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (layoutMode === "featured") {
    return (
      <div
        className="group flex flex-col w-full h-full text-start"
      >
        {/* Look #2: Spacious Featured Showcase Card */}
        <div className="relative w-full h-full flex flex-col justify-between overflow-hidden rounded-[28px] sm:rounded-[32px] border border-accent-gold/40 bg-gradient-to-b from-[#2d183b] via-[#170c1f] to-[#0a040d] p-5 sm:p-7 shadow-2xl transition-all duration-500 hover:border-accent-gold/70 hover:shadow-[0_12px_40px_rgba(214,179,252,0.2)]">
          
          {/* Top Header Badge Row */}
          <div className="flex items-center justify-between gap-2 mb-4">
            {currentTag && (
              <span className={TAG_BADGE_CLASS}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
            )}

            {isDiscount && (
              <span className={DISCOUNT_BADGE_CLASS}>
                {discountStr}
              </span>
            )}
          </div>

          {/* Large Vertical Image Spotlight Showcase */}
          <Link
            to={`/product/${productSlug}`}
            className="block w-full text-center focus:outline-none rounded-[20px] relative overflow-hidden group/img aspect-[4/5] bg-gradient-to-b from-[#130b18] via-[#0a050d] to-[#040206] border border-white/10 transition-all duration-500 hover:border-accent-gold/50 shadow-2xl"
          >
            {/* Soft Ambient Gold Radial Glow */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(214,179,252,0.12)_0%,transparent_70%)] pointer-events-none" />

            {/* Product Image - Expanded Scale */}
            {product.image && (
              <img
                src={getOptimizedImageUrl(product.image, 'eco', 800) || undefined}
                alt={product.name}
                loading="lazy"
                fetchPriority="low"
                decoding="async"
                className="w-full h-full object-contain p-6 sm:p-8 transition-all duration-700 ease-out group-hover/img:scale-[1.06] relative z-10"
                referrerPolicy="no-referrer"
                
                
              />
            )}

            {/* Icon Overlay Top Right */}
            <div className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-black/50 backdrop-blur-md border border-white/15 flex items-center justify-center text-accent-gold shadow-lg">
              <IconComponent className="w-4 h-4 stroke-[1.5]" />
            </div>
          </Link>

          {/* Detailed Content Section */}
          <div className="mt-5 flex flex-col w-full text-start">
            {/* Title & Localized Subtitle */}
            <div className="flex flex-col gap-1">
              <h3 className="text-sm sm:text-base font-sans tracking-[0.2em] text-accent-gold uppercase font-bold leading-tight">
                {englishName}
              </h3>
              {arabicName && (
                <p className="text-xs sm:text-sm font-serif text-white/80 font-medium leading-relaxed" dir="rtl">
                  {arabicName}
                </p>
              )}
            </div>

            {/* Key Benefits List (Look #2 Exclusive) */}
            {currentBenefits.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs text-gray-300 font-sans">
                {currentBenefits.slice(0, BENEFITS_MAX).map((benefit: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-accent-gold font-bold text-sm mt-0.5">•</span>
                    <span className="text-white/90 text-[11.5px] sm:text-xs">{benefit}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Volume & Pricing Bar */}
            <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between gap-3">
              {showSize && sizeCapsule ? (
                <div className="bg-[#21112d] border border-white/10 rounded-full py-2 px-3 text-[11px] font-medium text-white/90">
                  {renderSizeText(sizeCapsule)}
                </div>
              ) : (
                <div />
              )}

              <div className="flex items-baseline gap-1" dir="ltr">
                <span className="text-accent-gold font-black text-lg sm:text-xl">
                  {displayPriceNum}
                </span>
                <span className="text-accent-gold/80 font-semibold text-xs uppercase">
                  DH
                </span>
                {product.originalPrice && (
                  <span className="text-white/40 line-through text-xs ml-1.5">
                    {product.originalPrice}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Dual Interactive Action Buttons */}
          <div className="mt-5 grid grid-cols-1 gap-2.5 w-full">
            <button
              onClick={() => {
                if (product.isAvailable !== false) {
                  addToCart(product);
                  setIsAdded(true);
                  setTimeout(() => setIsAdded(false), 1200);
                }
              }}
              disabled={product.isAvailable === false}
              className={`w-full py-3.5 px-5 rounded-[16px] text-xs font-black uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2 shadow-lg active:scale-95 ${
                product.isAvailable === false
                  ? CTA_DISABLED_CLASS
                  : isAdded
                    ? "bg-green-700 text-white shadow-xl scale-[0.98]"
                    : CTA_ENABLED_CLASS
              }`}
            >
              {isAdded ? (
                <span>{isAr ? "تمت الإضافة للسلة!" : "Added to Basket!"}</span>
              ) : product.isAvailable === false ? (
                <span>{outOfStockText}</span>
              ) : (
                <div className="flex items-center gap-2 justify-center">
                  <ShoppingBag className="w-4 h-4" />
                  <span>{isAr ? "أضف إلى السلة" : "Add to Basket"}</span>
                </div>
              )}
            </button>

            <Link
              to={`/product/${productSlug}`}
              className="w-full py-2.5 px-4 rounded-[14px] border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-[11px] font-semibold text-center transition-all duration-200"
            >
              {isAr ? "عرض كل التفاصيل والفوائد ←" : "View Full Details & Benefits →"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex flex-col items-stretch w-full h-full text-start"
      dir={isAr ? "rtl" : "ltr"}
    >
      {/* Premium Dark Purple Brand Card */}
      <div className="relative w-full h-full flex flex-col justify-between overflow-hidden rounded-[24px] border border-accent-gold/30 bg-gradient-to-b from-[#24142f] via-[#140b1b] to-[#09040c] p-4 sm:p-5 shadow-2xl transition-all duration-300 hover:border-accent-gold/60 hover:shadow-[0_8px_32px_rgba(214,179,252,0.15)]">
        <div className="relative w-full flex flex-col">
          {/* Image Container with Studio Blackout back glow */}
          <Link
            to={`/product/${product.name_en ? getProductSlug(product.name_en) : getProductSlug(product.name)}`}
            className="block w-full text-center focus:outline-none rounded-[16px] relative overflow-hidden group/img aspect-square bg-gradient-to-b from-[#120a17] via-[#09050c] to-[#040206] border border-white/5 transition-all duration-300 hover:border-accent-gold/40 shadow-inner"
          >
            {/* Soft Ambient Gold Spotlight inside Image */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(190,156,212,0.08)_0%,transparent_60%)] pointer-events-none" />

            {/* Centered Product Image */}
            {product.image && (
              <img
                src={getOptimizedImageUrl(product.image, 'eco', 600) || undefined}
                alt={product.name}
                loading="lazy"
                fetchPriority="low"
                decoding="async"
                className="w-full h-full object-contain p-6 transition-all duration-700 ease-out group-hover/img:scale-[1.04] relative z-10"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.failed) {
                    target.dataset.failed = "true";
                    if (product.image && target.src !== product.image) {
                      target.src = product.image;
                    }
                  }
                }}
              />
            )}

            {/* Styled Discount Tag Overlay (High-Contrast Premium Rounded Badge) */}
            {isDiscount && (
              <div className="absolute top-3 left-3 z-20 animate-fade-in shadow-xl">
                <span className={DISCOUNT_BADGE_CLASS}>
                  {discountStr}
                </span>
              </div>
            )}

            {/* Category Icon Badge Top-Right */}
            <div className="absolute top-3.5 right-3.5 z-20 w-7 h-7 rounded-full bg-black/40 backdrop-blur-[4px] border border-white/10 flex items-center justify-center text-accent-gold">
              <IconComponent className="w-3.5 h-3.5 stroke-[1.5]" />
            </div>
          </Link>

          {/* Details & Content Block */}
          <div className="mt-4 flex flex-col w-full text-center">
            {/* Product Title — shows Arabic name in Arabic mode, English otherwise */}
            <h3
              className={`text-xs font-sans text-accent-gold font-semibold leading-snug line-clamp-2 break-words min-w-0 ${
                isAr
                  ? "tracking-normal not-italic"  // Arabic: no wide tracking, no uppercase
                  : "tracking-[0.18em] uppercase"  // LTR: keep spaced-caps look
              }`}
              dir={isAr ? "rtl" : "ltr"}
            >
              {isAr ? (arabicName || englishName) : englishName}
            </h3>

            {/* Process badge centered */}
            {currentTag && (
              <div className="mt-3 flex justify-center">
                <span className={TAG_BADGE_CLASS}>
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {currentTag}
                </span>
              </div>
            )}

            {/* Divider check-capsule */}
            <div className="w-full border-t border-white/5 my-4.5" />

            {/* Triple or Dual Metadata Pill Capsules (100% Organic, Size (if shown), High-contrast Price) */}
            <div className={`grid ${showSize && sizeCapsule ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 sm:gap-2 w-full`}>
              {/* Organic Capsule */}
              <div className="bg-[#1f112a] border border-white/[0.06] rounded-full py-2.5 px-2 flex items-center justify-center text-[10px] sm:text-[11px] font-sans text-[#f4f7f5] tracking-tight leading-tight text-center">
                {isAr ? "عضوي 100%" : language === 'fr' ? "100% Bio" : "100% Organic"}
              </div>

              {/* Volume/Size Capsule */}
              {showSize && sizeCapsule && (
                <div className="bg-[#1f112a] border border-white/[0.06] rounded-full py-2.5 px-2 flex items-center justify-center text-[10px] sm:text-[11px] font-sans text-[#f4f7f5] tracking-tight leading-tight text-center">
                  {/* A stored size is printed verbatim — the admin already typed
                      the spacing they wanted. The "ml" -> " ml" fixup only applies
                      to the hardcoded fallbacks, which are written as "50ml". */}
                  {storedSize
                    ? renderSizeText(storedSize)
                    : isPack
                      ? isAr
                        ? "طقم كامل"
                        : "Full Kit"
                      : renderSizeText(premium.volume.replace("ml", " ml"))}
                </div>
              )}

              {/* Price Capsule */}
              <div
                className="bg-[#1f112a] border border-white/[0.06] rounded-full py-2.5 px-2 flex items-center justify-center text-[11.5px] sm:text-[12px] font-sans text-accent-gold font-extrabold tracking-tight leading-tight gap-0.5 text-center"
                dir="ltr"
              >
                <span className="text-accent-gold font-black">
                  {displayPriceNum}
                </span>
                <span className="text-accent-gold/90 font-medium text-[9px] tracking-wide uppercase">
                  DH
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom solid gold button (CTA) with shopping bag */}
        <div className="mt-4 w-full">
          <button
            onClick={() => {
              if (product.isAvailable !== false) {
                addToCart(product);
                setIsAdded(true);
                setTimeout(() => setIsAdded(false), 1200);
              }
            }}
            disabled={product.isAvailable === false}
            className={`w-full py-3.5 px-4 rounded-[16px] text-[12px] sm:text-[12.5px] font-black uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2 shadow-lg active:scale-95 ${
              product.isAvailable === false
                ? CTA_DISABLED_CLASS
                : isAdded
                  ? "bg-green-700 hover:bg-green-800 text-white shadow-xl scale-[0.98]"
                  : CTA_ENABLED_CLASS
            }`}
          >
            {isAdded ? (
              <div className="flex items-center gap-1.5 justify-center">
                <span className="text-xs font-bold font-sans">✓</span>
                <span>
                  {isAr
                    ? "تمت الإضافة!"
                    : language === "fr"
                      ? "Ajouté !"
                      : "Added !"}
                </span>
              </div>
            ) : product.isAvailable === false ? (
              <span>
                {outOfStockText}
              </span>
            ) : isAr ? (
              <div className="flex items-center gap-2 justify-center">
                <span>أضف إلى السلة</span>
                <ShoppingBag className="w-4 h-4 text-current" />
              </div>
            ) : (
              <div className="flex items-center gap-2 justify-center">
                <ShoppingBag className="w-4 h-4 text-current" />
                <span>Add to Basket</span>
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const ProductCard = React.memo(ProductCardInner);
export default ProductCard;
