import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { CATEGORIES } from "./constants";
import { useLanguage } from "../context/LanguageContext";
import { useProducts } from "../context/ProductContext";
import { getProductSlug } from "../types";
import ProductCard from "./ProductCard";
import NotFoundPage from "./NotFoundPage";
import LoadMoreButton from "./LoadMoreButton";
import { PRODUCTS_PAGE_SIZE } from "../lib/useIncrementalList";
import { Helmet } from "react-helmet-async";
import {
  LayoutGrid,
  Grid2X2,
  Sparkles,
  Grid3X3,
  StretchHorizontal,
  RectangleVertical,
  Square,
  CircleDot,
  Crown,
  Columns,
  Layers,
} from "lucide-react";
import { fetchWithCache, getCachedSync } from "../lib/apiCache";
import { normalizeLinkUrl } from "../lib/urlUtils";
import {
  resolvePath,
  collectSectionPaths,
  collectProductSlugs,
} from "../lib/canonicalRoutes";
import { resolvePageSeo, findSectionForPath } from "../lib/seoContent";
import { serverRenderedSeo } from "../lib/ssrSeo";
import { SITE_ORIGIN } from "../lib/siteUrl";

// The CATEGORY_SLUGS list that used to live here is gone. It enumerated every
// alias ("peau", "cheveux", "oils", "pack", "our-products"...) and any slug in
// it was accepted as a real category page, which is one of the reasons a single
// category answered on so many URLs. Whether a path exists is now decided by
// src/lib/canonicalRoutes.ts, shared with the server.
//
// hasCategoryMatch below is unchanged and still does the actual work of
// deciding which products belong on a category page. Matching products is a
// legitimate job; what it must no longer do is decide whether a URL is real.
// It used to double as that test, so any slug that happened to fuzzy-match a
// product's text conjured up a category page - /body, /face, /general and
// /oil all rendered invented pages that nobody had created.
function hasCategoryMatch(p: any, targetCats: string[]) {
  if (!p) return false;
  const catStr = String(p.category || "").toLowerCase();
  const nameStr = String(p.name || "").toLowerCase();
  const nameEnStr = String(p.name_en || "").toLowerCase();
  const displaySec = String(p.displaySection || p.display_section || "").toLowerCase();
  const pIdStr = String(p.id || "").toLowerCase();

  // If display_section is 'home', hide from all catalog pages (only shows on homepage swiper)
  if (displaySec === "home") return false;

  return targetCats.some((tc) => {
    const target = tc.toLowerCase().trim();
    if (!target) return false;
    if (target === "all") return true;
    
    if (target === "products" || target === "ourproducts" || target === "our-products") {
      if (displaySec === "packs") return false;
      // Exclude packs even if they accidentally categorize them as Oils
      if (catStr.includes("pack") || catStr.includes("bundle") || pIdStr.startsWith("pack-") || nameEnStr.includes("pack")) return false;
      return catStr.includes("oil") || catStr === "oils" || catStr === "";
    }
    if (target === "skin")
      return (
        catStr.includes("skin") ||
        catStr.includes("peau") ||
        catStr.includes("بشرة") ||
        catStr.includes("face") ||
        catStr.includes("body") ||
        catStr.includes("general") ||
        nameStr.includes("بشرة") ||
        nameEnStr.includes("skin") ||
        nameEnStr.includes("face")
      );
    if (target === "hair" || target === "scalp")
      return (
        catStr.includes("hair") ||
        catStr.includes("scalp") ||
        catStr.includes("cheveux") ||
        catStr.includes("شعر") ||
        catStr.includes("فروة") ||
        nameStr.includes("شعر") ||
        nameEnStr.includes("hair") ||
        nameEnStr.includes("scalp")
      );
    if (target === "oil" || target === "oils")
      return catStr.includes("oil") || catStr.includes("زيوت") || catStr.includes("أويلز") || nameEnStr.includes("oil");
    if (
      target === "pack" ||
      target === "packs" ||
      target === "bundle" ||
      target === "collection"
    )
      return (
        catStr.includes("pack") ||
        catStr.includes("bundle") ||
        catStr.includes("باقة") ||
        catStr.includes("مجموعة") ||
        catStr.includes("مجموعات") ||
        catStr.includes("collection") ||
        displaySec === "packs" ||
        pIdStr.startsWith("pack-") ||
        nameEnStr.includes("pack") ||
        nameStr.includes("باقة") ||
        nameStr.includes("مجموعة") ||
        nameStr.includes("مجموعات") ||
        nameStr.includes("طقم")
      );
    return catStr === target || catStr.includes(target) || catStr.split(/[\s,-]+/).includes(target);
  });
}

export default function CategoryPage() {
  const location = useLocation();
  const params = useParams<{ id?: string; "*"?: string }>();

  // Extract path segments to dynamically derive category slug even without route params
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const lastSegment =
    pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : "";

  const rawId = params.id || params["*"] || lastSegment || "";
  const cleanId = rawId.toLowerCase().trim().replace(/\/+$/, "");

  const { t, language } = useLanguage();
  const { products: allProducts, loading, storeSettings } = useProducts();
  const cachedSections = getCachedSync<any>("/api/sections");
  const [sections, setSections] = useState<any[]>(
    cachedSections?.success ? cachedSections.sections : [],
  );
  // Must start false when there's no cached /api/sections payload, otherwise
  // the "is this slug a custom section?" check below runs against an empty
  // array on a cold load and a legitimate admin-created section URL gets
  // treated as not-found before its data ever arrives.
  const [sectionsLoaded, setSectionsLoaded] = useState(
    !!cachedSections?.success,
  );
  // defaultMode moved below

  
  // Which section row owns this page. Uses the shared canonical-path matcher
  // so the row driving the layout is the same row driving the SEO text, and
  // the same row the server picks. This previously compared only the last URL
  // segment with its own special case for "products", which is how the client
  // and server ended up selecting different rows for the same URL.
  const currentSection = findSectionForPath(sections, location.pathname);

  let layoutsConfig = storeSettings?.categoryLayouts;
  if (currentSection && currentSection.available_layouts) {
    try {
      const parsed = typeof currentSection.available_layouts === "string" ? JSON.parse(currentSection.available_layouts) : currentSection.available_layouts;
      if (parsed && typeof parsed === "object") {
        layoutsConfig = parsed;
      }
    } catch(e) {}
  }
  
  const isVerticalAllowed = layoutsConfig ? layoutsConfig["vertical"] !== false : true;
  const isBannerAllowed = layoutsConfig ? layoutsConfig["banner"] !== false : true;

  const hasMultipleLayouts = layoutsConfig?.showSwitcher !== false && isVerticalAllowed && isBannerAllowed;

  const defaultLayout = (layoutsConfig?.defaultLayout && (layoutsConfig.defaultLayout === "vertical" || layoutsConfig.defaultLayout === "banner") && layoutsConfig[layoutsConfig.defaultLayout] !== false)
    ? layoutsConfig.defaultLayout
    : (isVerticalAllowed ? "vertical" : (isBannerAllowed ? "banner" : "vertical"));

  const vmStorageKey = `preferredViewMode_${cleanId || "all"}`;
  const [viewModeState, setViewModeState] = useState<any>(() => {
    const saved = localStorage.getItem(vmStorageKey);
    if (saved === "vertical" && isVerticalAllowed) return "vertical";
    if (saved === "banner" && isBannerAllowed) return "banner";
    return defaultLayout;
  });

  const setViewMode = (mode: any) => {
    localStorage.setItem(vmStorageKey, mode);
    setViewModeState(mode);
  };

  // Once /api/sections has finished loading the real layout config is known.
  // If the user hasn't saved a preference for this specific page, snap the
  // viewMode to the section's actual defaultLayout. Without this, the layout
  // that was guessed before sections arrived (always "vertical") stays in
  // place even when the section defines a different default — causing the
  // visible flash where the grid briefly shows the wrong layout then jumps.
  useEffect(() => {
    if (!sectionsLoaded) return;
    const saved = localStorage.getItem(vmStorageKey);
    // Honour an explicit user preference; only override a missing / invalid one.
    if (saved === "vertical" && isVerticalAllowed) return;
    if (saved === "banner" && isBannerAllowed) return;
    setViewModeState(defaultLayout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsLoaded, vmStorageKey]);

  const viewMode = (viewModeState === "banner" && isBannerAllowed)
    ? "banner"
    : (viewModeState === "vertical" && isVerticalAllowed)
      ? "vertical"
      : defaultLayout;

  // How many cards of this category are revealed; grows by PRODUCTS_PAGE_SIZE
  // per "Load more" click. Declared up here, above the loading / not-found
  // early returns below, because the filtered `products` array this applies to
  // is only built after them — and a hook called after an early return would
  // change the hook order between renders. Collapses back to the first page
  // when the visitor moves to a different category.
  const [visibleCount, setVisibleCount] = useState(PRODUCTS_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PRODUCTS_PAGE_SIZE);
  }, [cleanId]);



  useEffect(() => {
    fetchWithCache("/api/sections")
      .then((data) => {
        if (data && data.success && data.sections) {
          setSections(data.sections);
        }
        setSectionsLoaded(true);
      })
      .catch(() => {
        setSectionsLoaded(true);
      });
  }, []);

  // Does this URL exist? Answered by the module the Express SPA fallback also
  // uses, so the status code the server sent and what the browser renders can
  // never disagree.
  //
  // Two behaviours were deliberately dropped here. A slug matching a product
  // name used to redirect to that product, so /argan-oil was a second working
  // URL for /product/argan-oil; and an unknown slug used to
  // navigate('/', {replace:true}), dumping the visitor on the homepage with no
  // explanation and no way back. Both are now simply 404s.
  const sectionPaths = useMemo(
    () => collectSectionPaths(sections, normalizeLinkUrl),
    [sections],
  );
  const productSlugs = useMemo(
    () => collectProductSlugs(allProducts, getProductSlug),
    [allProducts],
  );
  const pathKind = resolvePath(location.pathname, {
    sectionPaths,
    productSlugs,
    dataReady: !loading && sectionsLoaded,
  });

  // Only block render on products loading (they're the page content).
  // Sections data (layout config / SEO) loads in the background — once it
  // arrives the component re-renders with the correct layout, but the product
  // grid is already visible. This prevents the "Hair/Products click feels slow"
  // experience that was caused by waiting for /api/sections before painting anything.
  if (loading && allProducts.length === 0) {
    return (
      <div className="pt-40 lg:pt-48 pb-24 bg-white min-h-screen flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
          <p className="text-accent-gold font-medium animate-pulse">
            {language === "ar"
              ? "جاري تحميل المنتجات..."
              : language === "fr"
                ? "Chargement des produits..."
                : "Loading products..."}
          </p>
        </div>
      </div>
    );
  }

  // Wait for sections before painting the grid on desktop.
  //
  // `currentSection` (and therefore layoutsConfig / defaultLayout) is derived
  // from `sections`, which starts as an empty array and is populated by
  // /api/sections. If we paint the grid immediately, the layout snaps from the
  // guessed default ("vertical") to the section's actual defaultLayout once
  // sections arrive — the visible flash the user reported.
  //
  // When sections were already in the cache (sectionsLoaded === true from the
  // very first render) this guard never fires, so cached visits are instant.
  // On a fresh navigation the wait is at most the round-trip for /api/sections,
  // which is ~100–200 ms and indistinguishable from the normal page transition.
  if (!sectionsLoaded) {
    return (
      <div className="pt-40 lg:pt-48 pb-24 bg-white min-h-screen flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-accent-gold border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // If sections haven't loaded yet we still don't know whether this path is
  // a real section or 404 — defer the not-found check until they arrive.
  // Products are available, so fall through and render what we have.

  if (pathKind === "not-found") {
    return <NotFoundPage variant="category" />;
  }

  let categoryName = "";
  let products: any[] = [];

  if (
    !cleanId ||
    cleanId === "all" ||
    cleanId === "products" ||
    cleanId === "ourproducts" ||
    cleanId === "our-products" ||
    cleanId === "category"
  ) {
    categoryName =
      t("nav.products") || (language === "ar" ? "منتجاتنا" : "Our Products");
    products = allProducts.filter((p) => hasCategoryMatch(p, [cleanId || "products"]));
  } else if (cleanId === "oils" || cleanId === "oil") {
    categoryName = language === "ar" ? "الزيوت الطبيعية" : language === "fr" ? "Huiles Naturelles" : "Natural Oils";
    products = allProducts.filter((p) => hasCategoryMatch(p, ["oil", "oils"]));
  } else if (cleanId === "skin" || cleanId === "peau" || cleanId === "peaux") {
    const catTrans = t("categories.skin");
    categoryName =
      catTrans !== "categories.skin"
        ? catTrans
        : language === "ar"
          ? "البشرة"
          : "Skin";
    products = allProducts.filter((p) => hasCategoryMatch(p, ["skin"]));
  } else if (
    cleanId === "hair" ||
    cleanId === "hair-and-scalp" ||
    cleanId === "hair_and_scalp" ||
    cleanId === "scalp" ||
    cleanId === "cheveux"
  ) {
    const catTrans = t("categories.hair");
    categoryName =
      catTrans !== "categories.hair"
        ? catTrans
        : (language === "ar" ? "الشعر" : "Hair");
    products = allProducts.filter((p) =>
      hasCategoryMatch(p, ["hair", "scalp"]),
    );
  } else if (
    cleanId === "packs" ||
    cleanId === "pack" ||
    cleanId === "collections" ||
    cleanId === "bundles"
  ) {
    const catTrans = t("categories.packs");
    categoryName =
      catTrans !== "categories.packs"
        ? catTrans
        : language === "ar"
          ? "المجموعات والباقات"
          : "Collection Packs";
    products = allProducts.filter((p) =>
      hasCategoryMatch(p, ["pack", "packs", "bundle", "collection"]),
    );
  } else {
    const category = CATEGORIES.find((c) => c.id.toLowerCase() === cleanId);
    if (category) {
      categoryName = t(`categories.${category.id}`);
      products = allProducts.filter((p) =>
        hasCategoryMatch(p, [category.name, category.id]),
      );
    } else {
      const matched = allProducts.filter((p) => hasCategoryMatch(p, [cleanId]));
      if (cleanId && cleanId !== "products") {
        categoryName = cleanId
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      } else {
        categoryName =
          t("nav.products") ||
          (language === "ar" ? "منتجاتنا" : "Our Products");
      }
      products = matched;
    }
  }

  // Generated fallback title/description — used only when the admin hasn't
  // set a custom SEO title/description for this section in Admin > SEO.
  // Resolved by the same module the server uses. Previously this file built
  // its own title from a different template than the server's, so every
  // category page was served with one title and hydrated to another - and
  // Google's renderer indexes the second one.
  const resolvedSeo = resolvePageSeo({
    pathname: location.pathname,
    language,
    sections,
    storeSettings,
    // Only used for an admin-created page that has no route default of its own.
    fallbackName: categoryName,
    ...serverRenderedSeo(location.pathname),
  });
  // Admin > SEO > Sections wins over any generated default; resolvePageSeo
  // owns that precedence now. It also matches the section row by canonical
  // path, where this file used to compare only the last URL segment — so a
  // section saved as "/hair" governed the server's title but was invisible
  // here, and the two layers disagreed.
  const pageTitle = resolvedSeo.title;
  const pageDescription = resolvedSeo.description;
  // Run the raw pathname through the app's own URL normaliser rather than
  // self-canonicalising. This used to emit the pathname verbatim, so an alias
  // like /products/skin told Google "index me" while the server-rendered tag
  // for the same request said /products — two layers contradicting each other
  // on the same page. Now both resolve to the one canonical slug.
  const canonicalUrl = `${SITE_ORIGIN}${normalizeLinkUrl(location.pathname)}`;

  const visibleProducts = products.slice(0, visibleCount);
  const hasMoreProducts = products.length > visibleCount;
  const showMoreProducts = () => setVisibleCount((current) => current + PRODUCTS_PAGE_SIZE);

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta
          name="keywords"
          content={
            language === 'ar'
              ? `${categoryName || "زيوت طبيعية"}، Bellaura Oils، زيوت عضوية، معصورة على البارد، عناية بالبشرة، عناية بالشعر، مستخلصات نباتية، المغرب`
              : language === 'fr'
                ? `${categoryName || "huiles naturelles"}, Bellaura Oils, huiles biologiques, pressées à froid, soins peau, soins cheveux, Maroc`
                : `${categoryName || "natural oils"}, Bellaura Oils, organic oils, cold pressed, skin care, hair care, Morocco`
          }
        />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Bellaura Oils" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
      </Helmet>
      <div className="pt-40 lg:pt-36 pb-24 bg-white min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header & Layout Look Switcher Controls */}
          {hasMultipleLayouts && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4 pb-8 mb-8 border-b border-primary-earth/10">
              {/* Layout Toggle Buttons (Vertical & Horizontal only) */}
              <div className="flex items-center gap-1 bg-[#1f112a] p-1.5 rounded-2xl border border-accent-gold/30 shadow-md self-start sm:self-auto">
                {isVerticalAllowed && (
                  <button
                    onClick={() => setViewMode("vertical")}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-300 cursor-pointer ${
                      viewMode === "vertical"
                        ? "bg-accent-gold text-[#1f112a] font-bold shadow-md"
                        : "text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                    title="Vertical"
                  >
                    <RectangleVertical className="w-3.5 h-3.5" />
                    <span>
                      {language === "ar"
                        ? "عمودي"
                        : language === "fr"
                          ? "Vertical"
                          : "Vertical"}
                    </span>
                  </button>
                )}

                {isBannerAllowed && (
                  <button
                    onClick={() => setViewMode("banner")}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-300 cursor-pointer ${
                      viewMode === "banner"
                        ? "bg-accent-gold text-[#1f112a] font-bold shadow-md"
                        : "text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                    title="Horizontal Banner"
                  >
                    <StretchHorizontal className="w-3.5 h-3.5" />
                    <span>
                      {language === "ar"
                        ? "أفقي"
                        : language === "fr"
                          ? "Horizontal"
                          : "Horizontal"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Dynamic Product Grid based on selected Look */}
          <div
            className={
              viewMode === "banner"
                ? "grid grid-cols-1 gap-8 sm:gap-10" // Wide Banner (Horizontal)
                : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6" // Vertical (Default)
            }
          >
            {products.length > 0 ? (
              visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  layoutMode={viewMode}
                />
              ))
            ) : (
              <div className="col-span-full py-20 text-center">
                <p className="text-primary-earth/40">
                  {language === "ar"
                    ? "لم يتم العثور على منتجات"
                    : language === "fr"
                      ? "Aucun produit trouvé"
                      : "No products found"}
                </p>
              </div>
            )}
          </div>

          <LoadMoreButton
            onClick={showMoreProducts}
            hasMore={hasMoreProducts}
            loaded={visibleProducts.length}
            total={products.length}
            className="mt-14"
          />
        </div>
      </div>
    </>
  );
}
