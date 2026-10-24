import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Product } from '../types';
import { SITE_ORIGIN, canonicalUrlFor } from '../lib/siteUrl';
import { isGenericCatalogDescription, productMetaFallback } from '../lib/seoContent';

interface DynamicSEOProps {
  product: Product;
  language: string;
}

export default function DynamicSEO({ product, language }: DynamicSEOProps) {
  // Extract appropriate title and description based on language
  const anyProd = product as any;
  const productName = anyProd[`titre_${language}`] 
    || anyProd.titre_en 
    || product.name.split(' (')[0] 
    || "Product";

  // The admin's per-product SEO description (Admin > SEO > Products tab)
  // takes priority over sousTitre_{lang}/description. This was previously
  // never read here at all, so a custom seo_description set in the admin
  // panel had no effect on the rendered page — every product fell back to
  // the same generic sousTitre/description text once the SPA hydrated,
  // which is what Google's JS-rendering crawler ultimately indexes.
  const rawDescription = [
    anyProd.seo_description,
    anyProd[`sousTitre_${language}`],
    product.description,
  ].map((value) => typeof value === 'string' ? value.trim() : '')
   .find((value) => value && !isGenericCatalogDescription(value))
    || productMetaFallback(anyProd, language);

  // 1 & 2. Title and Description (Max 160 characters)
  const seoTitle = anyProd.seo_title || `${productName} | Bellaura Oils`;
  const seoDescription = rawDescription.length > 160 
    ? `${rawDescription.substring(0, 157)}...` 
    : rawDescription;

  // Ensure absolute URL for image — falls back to the site's hero image
  // when a product has no image set, instead of producing a broken URL
  // like "https://bellauraoils.com/undefined" in OG/Twitter/JSON-LD tags.
  // The canonical origin, NOT window.location.origin.
  //
  // Reading the live host meant a product page told search engines its
  // canonical URL was whatever host the visitor arrived on: the server had
  // already injected `https://bellauraoils.com/product/x` into the HTML, and
  // hydration then rewrote it to `https://www.bellauraoils.com/product/x` for
  // anyone who came in on www. One page, two contradictory canonical URLs,
  // decided by the visitor's link — which is exactly the kind of conflicting
  // signal that leaves pages sitting in "Discovered – currently not indexed".
  const origin = SITE_ORIGIN;
  // No fixed fallback image. This used to fall back to
  // /BackgroundPictures/hero_naissance_banner_v2_...png, which isn't in the
  // repo and 404s — so a product with no image advertised a broken preview
  // instead of no preview, which is worse: the crawler fetches it and fails.
  const imageUrl = product.image
    ? (product.image.startsWith('http') ? product.image : `${origin}${product.image}`)
    : '';

  // Base URL for canonical and hreflang.
  //
  // Built from the path only, through the same normaliser the server uses, so
  // the canonical this component renders is character-for-character the one the
  // server already injected. Previously this was `window.location.href` with
  // the query string trimmed, which also let a trailing slash or an arriving
  // `#hash` change the canonical.
  const canonicalUrl = canonicalUrlFor(
    typeof window !== 'undefined' ? window.location.pathname : `/product/${product.id}`,
  );

  // hreflang must reflect the language actually being rendered — it was
  // previously hardcoded to "ar-ma" for every visitor, which told search
  // engines every product page was Arabic even when displaying French or
  // English content.
  const hrefLangMap: Record<string, string> = { ar: 'ar-MA', fr: 'fr-MA', en: 'en' };
  const hrefLangCode = hrefLangMap[language] || 'en';

  // Clean price
  const getCleanPrice = (priceStr: string | number) => {
    if (!priceStr) return 0;
    if (typeof priceStr === 'number') return priceStr;
    const clean = priceStr.replace(/[^\d.]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : Math.round(num);
  };
  const price = getCleanPrice(product.price);

  // 6. JSON-LD Product Schema
  const hasRating = product.rating && Number(product.rating) > 0 && product.reviews && Number(product.reviews) > 0;
  const jsonLdSchema: any = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": productName,
    // Omit the key entirely when there's no image rather than sending
    // "image": "" — an empty string is a validation error in Product schema
    // and can invalidate the whole rich-result entry.
    ...(imageUrl ? { image: imageUrl } : {}),
    "description": seoDescription,
    "sku": product.id,
    "brand": {
      "@type": "Brand",
      "name": "Bellaura Oils"
    },
    ...(hasRating ? {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": Number(product.rating),
        "reviewCount": Number(product.reviews),
        "bestRating": "5",
        "worstRating": "1"
      }
    } : {}),
    "offers": {
      "@type": "Offer",
      "url": canonicalUrl,
      "priceCurrency": "MAD",
      "price": price,
      "itemCondition": "https://schema.org/NewCondition",
      "availability": product.isAvailable !== false ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "eligibleRegion": {
        "@type": "Country",
        "name": "MA"
      }
    }
  };

  return (
    <>
      <Helmet>
      {/* 1. Title Tag */}
      <title>{seoTitle}</title>

      {/* 2. Meta Description */}
      <meta name="description" content={seoDescription} />

      {/* 3. Hreflang (Geographic Targeting) */}
      <link rel="alternate" hrefLang={hrefLangCode} href={canonicalUrl} />
      <link rel="alternate" hrefLang="x-default" href={canonicalUrl} />
      
      {/* 4. Canonical URL */}
      <link rel="canonical" href={canonicalUrl} />

      {/* 5. Open Graph / Facebook */}
      <meta property="og:type" content="product" />
      <meta property="og:title" content={seoTitle} />
      <meta property="og:description" content={seoDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content="Bellaura Oils" />

      {/* 5. Twitter Cards */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seoTitle} />
      <meta name="twitter:description" content={seoDescription} />
      <meta name="twitter:image" content="https://pub-584126fe09324e178d68a3f2461340ea.r2.dev/Images/HomeImages/Home_BellauraOils_Meta.jpg" />

      {/* Open Graph Meta Image */}
      <meta property="og:image" content="https://pub-584126fe09324e178d68a3f2461340ea.r2.dev/Images/HomeImages/Home_BellauraOils_Meta.jpg" />
      <meta property="og:image:secure_url" content="https://pub-584126fe09324e178d68a3f2461340ea.r2.dev/Images/HomeImages/Home_BellauraOils_Meta.jpg" />
      <meta property="og:image:type" content="image/jpeg" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      {/* 6. JSON-LD Schema */}
      <script type="application/ld+json">
        {JSON.stringify(jsonLdSchema)}
      </script>
      </Helmet>
    </>
  );
}
