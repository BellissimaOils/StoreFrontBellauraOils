import { normalizeLinkUrl } from "./urlUtils";
import { normalizePathname } from "./canonicalRoutes";

/**
 * The single source of truth for page titles and meta descriptions.
 *
 * Why this module exists
 * ----------------------
 * The same page's title was computed in two places that disagreed. The Express
 * SPA fallback had a hardcoded per-route if/else chain, and each React page
 * built its own string with a different template. On /skin the server sent
 * "Skin Care Products | Bellaura Oils" while the browser hydrated to
 * "Skin | Bellaura Oils — Organic Natural Oils". Google's renderer indexes the
 * second one, so what the server carefully emitted was thrown away.
 *
 * Worse, the admin's own setting could lose to both. The hardcoded chain
 * assigned unconditionally, so for /, /skin, /hair-and-scalp, /packs and
 * /products it overwrote the seo_settings 'main' row that had been read a few
 * lines earlier. And the two layers matched section rows by different rules —
 * the server folded aliases through normalizeLinkUrl, the client compared raw
 * substrings — so they could pick different rows, or one could match while the
 * other fell back to a generated string.
 *
 * Everything now goes through resolvePageSeo() with one documented precedence:
 *
 *   1. Product SEO      (Admin > SEO > Products)      - product pages only
 *   2. Section SEO      (Admin > SEO > Sections)      - matched by canonical path
 *   3. Route default    (ROUTE_SEO below)             - localized ar/en/fr
 *   4. Site-wide default (storeSettings.seoTitle)
 *   5. The brand name
 *
 * Anything an admin typed therefore outranks anything generated, which is the
 * behaviour the old chain accidentally inverted.
 */

export const BRAND = "Bellaura Oils";
export const BRAND_AR = "Bellaura Oils";

/** Google truncates around here; keep descriptions inside it. */
export const DESCRIPTION_MAX = 160;

export interface LocalizedText {
  ar: string;
  en: string;
  fr: string;
}

export interface RouteSeoEntry {
  title: LocalizedText;
  description?: LocalizedText;
  /** Never index this page. */
  noindex?: boolean;
}

/**
 * Per-route defaults, used only when no admin value exists. These are the
 * strings that were previously hardcoded inside server.ts's else-if chain,
 * moved here verbatim so the browser can produce the identical text.
 */
export const ROUTE_SEO: Record<string, RouteSeoEntry> = {
  "/": {
    title: {
      ar: `${BRAND_AR} | زيوت طبيعية فاخرة للعناية بالبشرة والشعر`,
      fr: `${BRAND} | Huiles Naturelles de Luxe pour Peau et Cheveux`,
      en: `${BRAND} | Premium Pure Natural Oils for Skin & Hair`,
    },
    description: {
      ar: `متجر ${BRAND_AR} الرسمي للزيوت الطبيعية المعصورة على البارد 100% للنضارة والعناية بالبشرة والشعر. توصيل سريع لكافة مدن المغرب.`,
      fr: `Boutique officielle ${BRAND} : huiles 100% pure et naturelles pressées à froid pour la beauté de votre peau et de vos cheveux. Livraison partout au Maroc.`,
      en: `Official ${BRAND} store: 100% pure cold-pressed natural oils for radiant skin and hair care. Fast delivery across Morocco.`,
    },
  },
  "/skin": {
    title: {
      ar: `منتجات العناية بالبشرة | ${BRAND_AR}`,
      fr: `Soins de la Peau | ${BRAND}`,
      en: `Skin Care Products | ${BRAND}`,
    },
    description: {
      ar: `تصفح منتجات العناية بالبشرة والزيوت الطبيعية من ${BRAND_AR}.`,
      fr: `Découvrez notre collection d'huiles naturelles pour la peau chez ${BRAND}.`,
      en: `Explore our premium natural skin care oil collection at ${BRAND}.`,
    },
  },
  "/hair-and-scalp": {
    title: {
      ar: `منتجات العناية بالشعر وفروة الرأس | ${BRAND_AR}`,
      fr: `Soins des Cheveux & du Cuir Chevelu | ${BRAND}`,
      en: `Hair & Scalp Care Products | ${BRAND}`,
    },
    description: {
      ar: `تصفح منتجات العناية بالشعر وفروة الرأس من ${BRAND_AR}.`,
      fr: `Découvrez notre collection d'huiles naturelles pour cheveux et cuir chevelu chez ${BRAND}.`,
      en: `Explore our premium natural hair & scalp care oil collection at ${BRAND}.`,
    },
  },
  "/packs": {
    title: {
      ar: `المجموعات والباقات | ${BRAND_AR}`,
      fr: `Collections & Packs | ${BRAND}`,
      en: `Collection Packs | ${BRAND}`,
    },
    description: {
      ar: `اكتشف مجموعات وباقات الزيوت الطبيعية الفاخرة من ${BRAND_AR}، مصممة للعناية الكاملة بالبشرة والشعر.`,
      fr: `Découvrez nos collections et packs d'huiles naturelles ${BRAND}, conçus pour un soin complet de la peau et des cheveux.`,
      en: `Discover ${BRAND}' curated natural oil packs and collections, designed for complete skin and hair care.`,
    },
  },
  "/products": {
    title: {
      ar: `منتجاتنا | زيوت طبيعية فاخرة | ${BRAND_AR}`,
      fr: `Nos Produits | Huiles Naturelles de Luxe | ${BRAND}`,
      en: `Our Products | Premium Natural Oils | ${BRAND}`,
    },
    description: {
      ar: `تسوّق التشكيلة الكاملة لزيوت ${BRAND_AR} الطبيعية 100% المعصورة على البارد للعناية بالبشرة والشعر.`,
      fr: `Découvrez toute la gamme d'huiles 100% naturelles pressées à froid ${BRAND} pour la peau et les cheveux.`,
      en: `Shop the full range of ${BRAND}' 100% natural cold-pressed oils for skin and hair care.`,
    },
  },
  // /about and /faq previously had NO server entry at all, so the pre-rendered
  // HTML carried the site-wide default while the hydrated page showed the
  // component's own hardcoded string. Same text, one place, both layers.
  "/about": {
    title: {
      ar: `من نحن | ${BRAND} — زيوت طبيعية عضوية`,
      fr: `À Propos | ${BRAND} — Huiles Naturelles Biologiques`,
      en: `About Us | ${BRAND} — Premium Organic Natural Oils`,
    },
    description: {
      ar: `تعرف على قصة ${BRAND}: نستورد أجود الزيوت الطبيعية العضوية المعصورة على البارد مباشرة من إنجلترا للعناية بالبشرة والشعر.`,
      fr: `Découvrez l'histoire de ${BRAND} : des huiles biologiques pressées à froid, importées directement d'Angleterre, pour des soins naturels et efficaces.`,
      en: `Learn the story of ${BRAND}: we import the finest cold-pressed organic oils directly from England for pure, effective skin and hair care.`,
    },
  },
  "/faq": {
    title: {
      ar: `أسئلة شائعة | ${BRAND} — زيوت طبيعية عضوية`,
      fr: `FAQ | ${BRAND} — Huiles Naturelles Biologiques`,
      en: `FAQ | ${BRAND} — Natural Oils for Skin & Hair`,
    },
    description: {
      ar: `أجوبة عن الأسئلة الأكثر شيوعاً حول زيوت ${BRAND} الطبيعية، الاستعمال، التوصيل والدفع في المغرب.`,
      fr: `Réponses aux questions fréquentes sur les huiles naturelles ${BRAND}, leur utilisation, la livraison et le paiement au Maroc.`,
      en: `Answers to common questions about ${BRAND} natural oils, how to use them, delivery and payment across Morocco.`,
    },
  },
  "/reviews": {
    noindex: true,
    title: {
      ar: `آراء العملاء | ${BRAND_AR}`,
      fr: `Avis Clients | ${BRAND}`,
      en: `Customer Reviews | ${BRAND}`,
    },
  },
  "/checkout": {
    noindex: true,
    title: {
      ar: `إتمام الطلب | ${BRAND_AR}`,
      fr: `Finaliser la Commande | ${BRAND}`,
      en: `Checkout | ${BRAND}`,
    },
  },
  // The shareable general review link. noindex because it's handed out
  // privately to past customers, not something to rank — but it is a real 200
  // page, unlike before, when it wasn't listed in canonicalRoutes at all and
  // the server answered it with a 404 while React rendered the form anyway.
  "/leave-a-review": {
    noindex: true,
    title: {
      ar: `أضف تقييمك | ${BRAND_AR}`,
      fr: `Laisser un Avis | ${BRAND}`,
      en: `Leave a Review | ${BRAND}`,
    },
  },
};

/** Prefix rules for paths that carry a variable segment. */
const PREFIX_SEO: Array<{ prefix: string; entry: RouteSeoEntry }> = [
  {
    prefix: "/review/",
    entry: {
      noindex: true,
      title: {
        ar: `أضف تقييمك | ${BRAND_AR}`,
        fr: `Laisser un Avis | ${BRAND}`,
        en: `Leave a Review | ${BRAND}`,
      },
    },
  },
  {
    prefix: "/admin",
    entry: {
      noindex: true,
      title: {
        ar: `لوحة التحكم | ${BRAND}`,
        fr: `Tableau de Bord | ${BRAND}`,
        en: `Admin Dashboard | ${BRAND}`,
      },
    },
  },
  {
    prefix: "/onlyme",
    entry: {
      noindex: true,
      title: {
        ar: `لوحة التحكم | ${BRAND}`,
        fr: `Tableau de Bord | ${BRAND}`,
        en: `Admin Dashboard | ${BRAND}`,
      },
    },
  },
];

export function pickLocalized(text: LocalizedText | undefined, language: string): string {
  if (!text) return "";
  if (language === "ar") return text.ar || text.en || text.fr || "";
  if (language === "fr") return text.fr || text.en || text.ar || "";
  return text.en || text.ar || text.fr || "";
}

export function truncateDescription(text: string, max = DESCRIPTION_MAX): string {
  const clean = String(text || "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trim()}...`;
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Finds the ROUTE_SEO / PREFIX_SEO entry for a path, if any. */
export function routeSeoFor(pathname: string): RouteSeoEntry | null {
  const path = normalizePathname(pathname);
  if (ROUTE_SEO[path]) return ROUTE_SEO[path];
  for (const { prefix, entry } of PREFIX_SEO) {
    if (path === prefix || path.startsWith(prefix)) return entry;
  }
  return null;
}

/** Whether a path must never be indexed, per the route table. */
export function isNoindexPath(pathname: string): boolean {
  return routeSeoFor(pathname)?.noindex === true;
}

/**
 * Picks the section row that owns a path.
 *
 * Both layers call this, which is the point: the server used to fold aliases
 * through normalizeLinkUrl while HomePage compared `link_url` to "/" literally
 * and CategoryPage compared only the last URL segment. A row saved as "/oils"
 * or "/hair" therefore governed the title on the server and was invisible to
 * the browser, so the tab changed on hydration.
 */
export function findSectionForPath(
  sections: any[] | null | undefined,
  pathname: string,
): any | null {
  return findSectionsForPath(sections, pathname)[0] || null;
}

/**
 * Every section row that owns a path, in order.
 *
 * More than one row can legitimately match: server.ts appends the seo_settings
 * 'main' row as a fallback "/" section, and a database can hold duplicates.
 * Taking only the first match meant a row with a BLANK seo_title shadowed a
 * later row that actually had one — so the server fell back to the generated
 * route default while the browser, whose copy of the row had the seo_settings
 * overlay applied, showed the admin's real title. That mismatch was the
 * browser-tab flicker on the homepage.
 */
export function findSectionsForPath(
  sections: any[] | null | undefined,
  pathname: string,
): any[] {
  if (!Array.isArray(sections)) return [];
  const target = normalizePathname(pathname).toLowerCase();
  const matches: any[] = [];
  for (const section of sections) {
    if (!section) continue;
    const raw = typeof section.link_url === "string" ? section.link_url : "";
    if (!raw) continue;
    const lower = raw.trim().toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) continue;
    if (normalizePathname(normalizeLinkUrl(raw)).toLowerCase() === target) {
      matches.push(section);
    }
  }
  return matches;
}

/** Language-aware display name for a product, used in generated titles. */
export function productDisplayName(product: any, language: string): string {
  const p = product || {};
  const localized = nonEmpty(p[`titre_${language}`]) || nonEmpty(p.titre_en);
  if (localized) return localized;
  const base =
    language === "ar"
      ? nonEmpty(p.name) || nonEmpty(p.name_en)
      : nonEmpty(p.name_en) || nonEmpty(p.name);
  // Product names are often stored as "Argan Oil (زيت الأركان)"; the
  // parenthetical is the other language, not part of the title.
  return base.split(" (")[0].trim() || "Product";
}

export interface ResolveSeoInput {
  pathname: string;
  language: string;
  /** Rows from /api/sections (they already carry the seo_settings overlay). */
  sections?: any[] | null;
  /** Set for /product/<slug> pages. */
  product?: any | null;
  /** storeSettings, for the site-wide fallback. */
  storeSettings?: any | null;
  /**
   * Display name for a custom section page that has no ROUTE_SEO entry — e.g.
   * an admin-created /gifts. Only used to build a generated fallback.
   */
  fallbackName?: string;
  /**
   * The title/description the server already put in the HTML for this page.
   * Supply these from serverRenderedSeo() so the browser adopts what is
   * already on screen rather than recomputing a competing default. Ignored
   * when an admin value exists.
   */
  ssrTitle?: string;
  ssrDescription?: string;
}

export interface ResolvedSeo {
  title: string;
  description: string;
  noindex: boolean;
  /** Which layer supplied the title. Exposed for tests and debugging. */
  titleSource: "product" | "section" | "ssr" | "route" | "store" | "brand";
  descriptionSource: "product" | "section" | "ssr" | "route" | "store" | "none";
}

/**
 * Resolves the final title and description for a page. Title and description
 * are resolved independently: a section may override only one of them, and the
 * other must still fall through rather than being blanked.
 */
export function resolvePageSeo(input: ResolveSeoInput): ResolvedSeo {
  const { pathname, language, sections, product, storeSettings, fallbackName } = input;
  const path = normalizePathname(pathname);
  const routeEntry = routeSeoFor(path);
  const noindex = routeEntry?.noindex === true;

  let title = "";
  let description = "";
  let titleSource: ResolvedSeo["titleSource"] = "brand";
  let descriptionSource: ResolvedSeo["descriptionSource"] = "none";

  const isProductPage = path.startsWith("/product/");

  // 1. Product SEO. Product pages never consult section rows.
  if (isProductPage && product) {
    const adminTitle = nonEmpty(product.seo_title);
    if (adminTitle) {
      title = adminTitle;
      titleSource = "product";
    } else {
      title = `${productDisplayName(product, language)} | ${BRAND}`;
      titleSource = "route";
    }
    const adminDesc =
      nonEmpty(product.seo_description) ||
      nonEmpty(product[`sousTitre_${language}`]) ||
      nonEmpty(product.description);
    if (adminDesc) {
      description = adminDesc;
      descriptionSource = "product";
    }
  } else {
    // 2. Section SEO, keyed on the canonical path. Scans every matching row for
    // a value rather than trusting the first row to have one, so a blank row
    // can't shadow a populated one.
    for (const section of findSectionsForPath(sections, path)) {
      if (!title) {
        const sectionTitle = nonEmpty(section.seo_title);
        if (sectionTitle) {
          title = sectionTitle;
          titleSource = "section";
        }
      }
      if (!description) {
        const sectionDesc = nonEmpty(section.seo_description);
        if (sectionDesc) {
          description = sectionDesc;
          descriptionSource = "section";
        }
      }
      if (title && description) break;
    }
  }

  // 2b. Whatever the server already rendered into the HTML for THIS page.
  //
  // This is what stops the browser tab changing after load. If no admin value
  // was found above, the browser reuses the exact string the server sent
  // instead of recomputing a default — so even when the two sides hold
  // different data, the visible title never changes. Sits below admin values
  // so a real setting still wins, and above the generated defaults.
  if (!title && nonEmpty(input.ssrTitle)) {
    title = nonEmpty(input.ssrTitle);
    titleSource = "ssr";
  }
  if (!description && nonEmpty(input.ssrDescription)) {
    description = nonEmpty(input.ssrDescription);
    descriptionSource = "ssr";
  }

  // 3. Route default.
  if (!title && routeEntry) {
    title = pickLocalized(routeEntry.title, language);
    if (title) titleSource = "route";
  }
  if (!description && routeEntry?.description) {
    description = pickLocalized(routeEntry.description, language);
    if (description) descriptionSource = "route";
  }

  // 3b. A page with no route entry - an admin-created section. Build something
  // specific from its own name rather than reusing the site-wide default for
  // every custom page, which would make them all duplicates of each other.
  if (!title && fallbackName) {
    title = `${fallbackName} | ${BRAND}`;
    titleSource = "route";
  }

  // 4. Site-wide default.
  if (!title) {
    const storeTitle = nonEmpty(storeSettings?.seoTitle);
    if (storeTitle) {
      title = storeTitle;
      titleSource = "store";
    }
  }
  if (!description) {
    const storeDesc = nonEmpty(storeSettings?.seoDescription);
    if (storeDesc) {
      description = storeDesc;
      descriptionSource = "store";
    }
  }

  // 5. Last resort.
  if (!title) {
    title = BRAND;
    titleSource = "brand";
  }

  return {
    title,
    description: truncateDescription(description),
    noindex,
    titleSource,
    descriptionSource,
  };
}
