/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Helmet } from "react-helmet-async";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { getOptimizedImageUrl } from "../lib/imageUtils";
import { fetchWithCache, getCachedSync } from "../lib/apiCache";
import { resolvePageSeo } from "../lib/seoContent";
import { serverRenderedSeo } from "../lib/ssrSeo";
import {
  ANIM_TARGET,
  animInitial,
  overlayFlexStyle,
  parseOverlayConfig,
  pickOverlayText,
  resolveCtaHref,
  resolveHeroLayout,
} from "../lib/heroConfig";
import { parseQuoteConfig } from "../lib/quoteConfig";
import { parseParagraphConfig } from "../lib/paragraphConfig";
import { SITE_ORIGIN, absoluteUrl } from "../lib/siteUrl";

import CollectionSwiper from "./CollectionSwiper";

const DEFAULT_HOME_HERO_IMAGE = "https://pub-584126fe09324e178d68a3f2461340ea.r2.dev/Images/HomeImages/home.jpg";

const DEFAULT_HERO = {
  id: "home_hero_fallback",
  type: "hero",
  image_url: DEFAULT_HOME_HERO_IMAGE,
  image_fit: "contain",
  image_align: "bottom",
  is_visible: 1,
  order_index: 0,
};

const ProgressiveImage = ({ src, alt, className, loading, fetchPriority, decoding }: any) => {
  const isEager = loading === "eager" || fetchPriority === "high";
  const [isLoaded, setIsLoaded] = React.useState(isEager);
  // A failed image must be removed, not revealed. onError used to call
  // setIsLoaded(true), which made the broken <img> fully opaque — so the
  // browser painted its broken-image state, including the alt text, straight
  // over the layout. That is what put a stray sentence above the hero.
  const [hasError, setHasError] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    setHasError(false);
    if (imgRef.current?.complete) {
      setIsLoaded(true);
    }
  }, [src]);

  return (
    <div className="relative w-full h-full bg-background-soft overflow-hidden">
      {!isLoaded && !isEager && (
        <div className="absolute inset-0 bg-background-soft z-0" />
      )}
      {/* No src, or a src that 404s, leaves just the soft background. */}
      {src && !hasError && (
        <img
          ref={imgRef}
          src={src}
          // Empty alt is deliberate when the caller passes none: these are
          // decorative background images sitting behind real text.
          alt={alt || ""}
          className={`${className} relative z-10 transition-opacity duration-300 ${
            isLoaded || isEager ? "opacity-100" : "opacity-0"
          }`}
          referrerPolicy="no-referrer"
          loading={loading}
          fetchPriority={fetchPriority}
          decoding={decoding}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
};

function HomePage() {
  const { t, language } = useLanguage();
  const isAr = language === "ar";
  const isFr = language === "fr";
  const isEn = language === "en";

  const cachedData = getCachedSync<any>("/api/homepage-sections");
  const initialSections = (cachedData?.success && cachedData.sections)
    ? cachedData.sections
        .filter((s: any) => Number(s.is_visible) === 1)
        .sort((a: any, b: any) => a.order_index - b.order_index)
    : []; // Start empty if no cache, don't use DEFAULT_HERO which causes flashes

  const [sections, setSections] = React.useState<any[]>(initialSections);
  const [hasFetched, setHasFetched] = React.useState(Boolean(cachedData));

  // Separate from the homepage content-block sections above - this is the
  // nav/SEO sections list (AdminSEO.tsx -> Section SEO tab), used to
  // pick up a custom Home title/description if the admin has set one.
  const cachedNavSections = getCachedSync<any>("/api/sections");
  const [navSections, setNavSections] = React.useState<any[]>(
    cachedNavSections?.success ? cachedNavSections.sections : [],
  );

  React.useEffect(() => {
    fetchWithCache("/api/sections")
      .then((data) => {
        if (data && data.success && data.sections) {
          setNavSections(data.sections);
        }
      })
      .catch(() => {});
  }, []);


  React.useEffect(() => {
    fetchWithCache("/api/homepage-sections")
      .then((data) => {
        if (data && data.success && data.sections) {
          const visible = data.sections
              .filter((s: any) => Number(s.is_visible) === 1)
              .sort((a: any, b: any) => a.order_index - b.order_index);
          setSections(visible.length > 0 ? visible : [DEFAULT_HERO]);
        } else if (sections.length === 0) {
          setSections([DEFAULT_HERO]);
        }
        setHasFetched(true);
      })
      .catch((err) => {
        console.error(err);
        if (sections.length === 0) setSections([DEFAULT_HERO]);
        setHasFetched(true);
      });
  }, []);

  const renderSection = (s: any, idx: number) => {
    const isEn = language === "en";
    const isFr = language === "fr";
    const isAr = language === "ar";
    const title = isAr
      ? s.title_ar || s.title_en
      : isFr
        ? s.title_fr || s.title_en
        : s.title_en || s.title_ar;
    const subtitle = isAr
      ? s.subtitle_ar || s.subtitle_en
      : isFr
        ? s.subtitle_fr || s.subtitle_en
        : s.subtitle_en || s.subtitle_ar;
    const content = isAr
      ? s.content_ar || s.content_en
      : isFr
        ? s.content_fr || s.content_en
        : s.content_en || s.content_ar;

    const objectFitClass =
      s.image_fit === "contain"
        ? "object-contain"
        : s.image_fit === "fill"
          ? "object-fill"
          : "object-cover";
    let objectAlignClass = "object-center";
    switch (s.image_align) {
      case "top":
        objectAlignClass = "object-top";
        break;
      case "bottom":
        objectAlignClass = "object-bottom";
        break;
      case "left":
        objectAlignClass = "object-left";
        break;
      case "right":
        objectAlignClass = "object-right";
        break;
      default:
        objectAlignClass = "object-center";
        break;
    }
    const imgClasses = `w-full h-full ${objectFitClass} ${objectAlignClass}`;

    const firstImageSectionIndex = sections.findIndex(
      (s: any) => s.type === "hero" || Boolean(s.image_url),
    );
    const isFirstImage = idx === (firstImageSectionIndex !== -1 ? firstImageSectionIndex : 0);

    if (s.type === "hero") {
      const optimizedHeroUrl = getOptimizedImageUrl(s.image_url, "eco");

      // Height, fit, focal point and zoom are all resolved per device. When a
      // hero has never been edited these fall back to the exact values that
      // used to be hard-coded, so existing homepages look unchanged.
      const layout = resolveHeroLayout(s.image_fit, s.image_align, s.image_config);
      const overlay = parseOverlayConfig(s.overlay_config);

      // Scoped class so each hero gets its own responsive rules. Media queries
      // can't live in a style attribute, and a real breakpoint (rather than
      // JS viewport detection) means no flash and no resize listener.
      const scope = `bo-hero-${String(s.id || idx).replace(/[^a-zA-Z0-9_-]/g, "")}`;
      const deviceCss = (sel: string, l: typeof layout.mobile) =>
        // min-height, not height. With a fixed height the overlay — which is a
        // flow child below — had nowhere to go once heading + subtext + two
        // buttons exceeded it, and `overflow-hidden` silently cut the bottom
        // off. Since the block is vertically centred, the button furthest down
        // is the first thing to disappear. Measured at 1152x640 the content came
        // to exactly the section height, so anything shorter clipped. The
        // configured value is now a floor: the hero is at least that tall and
        // grows if the text needs more.
        `${sel}{min-height:${l.height}vh;}` +
        `${sel} .${scope}-img{object-fit:${l.fit};object-position:${l.x}% ${l.y}%;` +
        `transform:scale(${l.zoom / 100});transform-origin:${l.x}% ${l.y}%;}`;
      const heroCss =
        deviceCss(`.${scope}`, layout.mobile) +
        `@media (min-width:1024px){${deviceCss(`.${scope}`, layout.desktop)}}`;

      const heading = pickOverlayText(overlay, "heading", language);
      const overlaySub = pickOverlayText(overlay, "sub", language);
      const btnLabel = pickOverlayText(overlay, "btn_label", language);
      const cta = resolveCtaHref(overlay.btn_link);
      const btn2Label = pickOverlayText(overlay, "btn2_label", language);
      const cta2 = resolveCtaHref(overlay.btn2_link);
      const flex = overlayFlexStyle(overlay);
      // btn2Label counts too, otherwise a hero configured with only the second
      // button would render no overlay at all.
      const hasOverlay =
        overlay.enabled && Boolean(heading || overlaySub || btnLabel || btn2Label);

      const btnClasses =
        "inline-block px-8 py-3.5 text-[11px] sm:text-xs font-bold uppercase tracking-[0.2em] " +
        "transition-transform duration-300 hover:scale-[1.04] shadow-lg cursor-pointer";
      const btnStyle = {
        backgroundColor: overlay.btn_bg,
        color: overlay.btn_text,
        borderRadius: `${overlay.btn_radius}px`,
      };
      // Shares btn_radius with the first button on purpose: two stacked CTAs
      // with different corner rounding look like a bug, not a decision.
      const btn2Style = {
        backgroundColor: overlay.btn2_bg,
        color: overlay.btn2_text,
        borderRadius: `${overlay.btn_radius}px`,
      };

      // Entrance animation is fully admin-driven: which side the text comes
      // from, how far it travels, how long it takes, and the gap between
      // heading -> subtext -> button. Framer wants seconds, the config
      // stores ms.
      const animFrom = animInitial(overlay.anim_direction, overlay.anim_distance);
      const animDelay = overlay.text_delay / 1000;
      const animDuration = overlay.anim_duration / 1000;
      const animStagger = overlay.anim_stagger / 1000;

      return (
        <section
          key={s.id || idx}
          className={`${scope} relative flex overflow-hidden bg-background-soft`}
          // items-center was hardcoded here; the overlay's configured vertical
          // placement (top/middle/bottom) now drives it, because the overlay is
          // a flow child rather than an absolutely-positioned layer.
          style={{ alignItems: hasOverlay ? flex.alignItems : "center" }}
        >
          <style dangerouslySetInnerHTML={{ __html: heroCss }} />
          <div className="absolute inset-0 z-0">
            <ProgressiveImage
              src={optimizedHeroUrl || undefined}
              // Empty when the overlay is on: the heading and subtext are real
              // text in the DOM a few lines below, so repeating them here made
              // screen readers announce everything twice and — because a
              // broken image renders its alt — printed the whole marketing
              // sentence on screen whenever the photo failed to load.
              alt={hasOverlay ? "" : title || ""}
              className={`w-full h-full ${scope}-img`}
              loading={isFirstImage ? "eager" : "lazy"}
              fetchPriority={isFirstImage ? "high" : "low"}
              decoding={isFirstImage ? "sync" : "async"}
            />
          </div>

          {hasOverlay && overlay.scrim > 0 && (
            <div
              className="absolute inset-0 z-10 pointer-events-none"
              style={{ backgroundColor: `rgba(0,0,0,${overlay.scrim / 100})` }}
            />
          )}

          {hasOverlay && (
            // In normal flow (relative), not absolute. Absolute positioning took
            // the overlay out of the layout, so the section could never know how
            // tall its own content was and couldn't grow to fit it. As a flow
            // child it participates in the section's height, so min-height above
            // actually does something. Vertical placement moves to the section's
            // own align-items (set below) to keep the 9-position control working.
            <div
              className="relative z-20 w-full flex px-6 sm:px-10 lg:px-16 py-10"
              style={{ justifyContent: flex.justifyContent }}
            >
              <div
                className="max-w-3xl"
                style={{ textAlign: flex.textAlign, color: overlay.text_color }}
                dir={isAr ? "rtl" : "ltr"}
              >
                {/*
                  Each line animates in on its own motion.div rather than one
                  wrapper around the whole block, so heading/subtext/button
                  can be staggered ~150ms apart instead of popping in as one
                  flat unit. All three still start counting from the same
                  admin-configured base delay (overlay.text_delay, default
                  1s), which is what actually "moves after 1s" — the stagger
                  on top of that is a small polish, not the requested delay
                  itself.
                */}
                {heading && (
                  <motion.h1
                    initial={animFrom}
                    animate={ANIM_TARGET}
                    transition={{ duration: animDuration, ease: "easeOut", delay: animDelay }}
                    className="font-light leading-[1.1] tracking-tight mb-4 break-words drop-shadow-sm"
                    style={{
                      // min(5vw, 8vh) rather than 5vw alone. Sizing the heading
                      // off viewport WIDTH only meant a short-but-wide window
                      // got a 64px heading with no room for it, which is why the
                      // hero looked cramped at 100% zoom and fine at 90% —
                      // zooming out buys viewport height, and the old formula
                      // ignored height entirely. Tall windows are unaffected
                      // (both terms exceed the 4rem cap there).
                      fontSize: `calc(clamp(1.75rem, min(5vw, 8vh), 4rem) * ${overlay.heading_scale / 100})`,
                    }}
                  >
                    {heading}
                  </motion.h1>
                )}
                {overlaySub && (
                  <motion.p
                    initial={animFrom}
                    animate={ANIM_TARGET}
                    transition={{ duration: animDuration, ease: "easeOut", delay: animDelay + animStagger }}
                    className="text-sm sm:text-base lg:text-xl font-light leading-relaxed mb-7 opacity-90 break-words"
                  >
                    {overlaySub}
                  </motion.p>
                )}
                {btnLabel && cta.href && (
                  <motion.div
                    initial={animFrom}
                    animate={ANIM_TARGET}
                    transition={{ duration: animDuration, ease: "easeOut", delay: animDelay + animStagger * 2 }}
                  >
                    {cta.external ? (
                      <a
                        href={cta.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={btnClasses}
                        style={btnStyle}
                      >
                        {btnLabel}
                      </a>
                    ) : (
                      <Link to={cta.href} className={btnClasses} style={btnStyle}>
                        {btnLabel}
                      </Link>
                    )}
                  </motion.div>
                )}
                {/* Second CTA, stacked under the first. Continues the same
                    stagger sequence so it arrives one step after button one
                    instead of appearing with it. */}
                {btn2Label && cta2.href && (
                  <motion.div
                    initial={animFrom}
                    animate={ANIM_TARGET}
                    transition={{ duration: animDuration, ease: "easeOut", delay: animDelay + animStagger * 3 }}
                    className="mt-3"
                  >
                    {cta2.external ? (
                      <a
                        href={cta2.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={btnClasses}
                        style={btn2Style}
                      >
                        {btn2Label}
                      </a>
                    ) : (
                      <Link to={cta2.href} className={btnClasses} style={btn2Style}>
                        {btn2Label}
                      </Link>
                    )}
                  </motion.div>
                )}
              </div>
            </div>
          )}

          <div className="absolute right-12 bottom-0 top-0 w-px bg-primary-earth/10 hidden lg:block z-10" />
          <div className="absolute right-0 bottom-12 w-24 h-px bg-primary-earth/10 hidden lg:block z-10" />
        </section>
      );
    }

    if (s.type === "collection") {
      return (
        <div key={s.id || idx}>
          <CollectionSwiper
            title={title}
            subtitle={subtitle}
            content={content}
          />
        </div>
      );
    }

    if (s.type === "paragraph") {
      const isRight = s.image_position === "right";
      const isContain = s.image_fit === "contain";
      const optimizedParagraphUrl = getOptimizedImageUrl(
        s.image_url,
        "eco",
        800,
      );

      const pc = parseParagraphConfig(s.paragraph_config);
      const scope = `bo-para-${String(s.id || idx).replace(/[^a-zA-Z0-9_-]/g, "")}`;
      // Same scoped-CSS + real media query approach as the hero/quote
      // sections: independent mobile and desktop values with no JS viewport
      // detection, so there's no flash and no resize listener. `contain`
      // deliberately skips aspect-ratio/object-fit so the image keeps its
      // natural height, preserving the previous behaviour for that mode.
      const paraCss =
        `.${scope}{padding-top:${pc.padding_y_mobile}px;padding-bottom:${pc.padding_y_mobile}px;}` +
        `.${scope} .${scope}-grid{gap:${pc.gap_mobile}px;}` +
        `.${scope} .${scope}-imgwrap{max-width:${pc.img_max_w_mobile}px;border-radius:${pc.img_radius}px;}` +
        (isContain ? "" : `.${scope} .${scope}-imgwrap{aspect-ratio:${pc.img_ratio_mobile};}`) +
        `.${scope} .${scope}-img{${isContain ? "" : `object-fit:${s.image_fit === "fill" ? "fill" : "cover"};`}` +
        `object-position:${pc.focal_x_mobile}% ${pc.focal_y_mobile}%;` +
        `transform:scale(${pc.img_zoom_mobile / 100});transform-origin:${pc.focal_x_mobile}% ${pc.focal_y_mobile}%;}` +
        // Alignment is set explicitly on the text column. It used to be
        // inherited, which left a long body paragraph centred — every line
        // ragged on both sides and no straight edge to return to. `start`
        // resolves to right in Arabic and left in English/French, so it
        // follows the page direction rather than being pinned to a side.
        `.${scope} .${scope}-text{text-align:${pc.text_align};}` +
        `.${scope} .${scope}-title{font-size:${pc.title_size_mobile}px;font-weight:${pc.title_weight};color:${pc.title_color};}` +
        `.${scope} .${scope}-sub{font-size:${pc.sub_size_mobile}px;font-weight:${pc.sub_weight};color:${pc.sub_color};}` +
        `.${scope} .${scope}-body{font-size:${pc.content_size_mobile}px;font-weight:${pc.content_weight};line-height:${pc.line_height_mobile};color:${pc.body_color};}` +
        // Block spacing is per-device too. It was `mb-2 lg:mb-8` / `mb-2
        // lg:mb-10`, i.e. 8px on mobile whatever the font size, so a 24px title
        // sat 8px above its subtitle and the three blocks ran together.
        `.${scope} .${scope}-title{margin-bottom:${pc.title_gap_mobile}px;}` +
        `.${scope} .${scope}-sub{margin-bottom:${pc.sub_gap_mobile}px;}` +
        // Justified Arabic needs hyphenation off and word spacing left alone,
        // otherwise short lines stretch into visible rivers of whitespace.
        (pc.text_align === "justify"
          ? `.${scope} .${scope}-body{text-justify:inter-word;hyphens:none;}`
          : "") +
        `@media (min-width:1024px){` +
        `.${scope}{padding-top:${pc.padding_y_desktop}px;padding-bottom:${pc.padding_y_desktop}px;}` +
        `.${scope} .${scope}-grid{gap:${pc.gap_desktop}px;}` +
        `.${scope} .${scope}-imgwrap{max-width:${pc.img_max_w_desktop}px;}` +
        (isContain ? "" : `.${scope} .${scope}-imgwrap{aspect-ratio:${pc.img_ratio_desktop};}`) +
        `.${scope} .${scope}-img{object-position:${pc.focal_x_desktop}% ${pc.focal_y_desktop}%;` +
        `transform:scale(${pc.img_zoom_desktop / 100});transform-origin:${pc.focal_x_desktop}% ${pc.focal_y_desktop}%;}` +
        `.${scope} .${scope}-title{font-size:${pc.title_size_desktop}px;}` +
        `.${scope} .${scope}-sub{font-size:${pc.sub_size_desktop}px;margin-bottom:${pc.sub_gap_desktop}px;}` +
        `.${scope} .${scope}-body{font-size:${pc.content_size_desktop}px;line-height:${pc.line_height_desktop};}` +
        `.${scope} .${scope}-title{margin-bottom:${pc.title_gap_desktop}px;}` +
        `}`;

      const showImage = pc.show_image && Boolean(s.image_url);

      return (
        <section
          key={s.id || idx}
          className={`${scope} bg-white overflow-hidden`}
        >
          <style dangerouslySetInnerHTML={{ __html: paraCss }} />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div
              className={`${scope}-grid grid grid-cols-1 ${showImage ? "lg:grid-cols-2" : "lg:grid-cols-1"} items-center`}
            >
              {showImage && (
                <motion.div
                  initial={{ opacity: 0, x: isRight ? 50 : -50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className={`${scope}-imgwrap relative ${isContain ? "flex items-center justify-center" : "overflow-hidden"} group w-full lg:w-full shrink-0 mx-auto ${isRight ? "order-1 lg:order-2" : "order-1 lg:order-1"}`}
                >
                  <ProgressiveImage
                    src={optimizedParagraphUrl || undefined}
                    className={`${scope}-img ${isContain ? "w-full h-auto block" : "w-full h-full"} transition-transform duration-1000`}
                    alt={title}
                    loading={isFirstImage ? "eager" : "lazy"}
                    fetchPriority={isFirstImage ? "high" : "low"}
                    decoding={isFirstImage ? "sync" : "async"}
                  />
                  <div className="absolute inset-0 bg-primary-earth/10 group-hover:bg-transparent transition-colors duration-700 pointer-events-none" />
                  <div className="hidden lg:block absolute -top-3 -left-3 w-12 h-12 border-t border-l border-accent-gold/40 pointer-events-none" />
                  <div className="hidden lg:block absolute -bottom-3 -right-3 w-12 h-12 border-b border-r border-accent-gold/40 pointer-events-none" />
                </motion.div>
              )}
              <motion.div
                initial={{ opacity: 0, x: isRight ? -50 : 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className={`${scope}-text flex-1 min-w-0 w-full ${!showImage ? "" : isRight ? "order-2 lg:order-1 lg:pr-12" : "order-2 lg:order-2 lg:pl-12"}`}
              >
                {title && (
                  <h2
                    className={`${scope}-title leading-[1.1] tracking-tight break-words ${
                      pc.title_underline
                        ? "inline-block border-b border-accent-gold pb-2 lg:pb-4"
                        : "block"
                    }`}
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  // font-light removed: the weight is admin-controlled now, and
                  // a hardcoded 300 here meant the subtitle could never be made
                  // bolder than the body text below it.
                  <p className={`${scope}-sub leading-relaxed break-words max-w-prose text-pretty`}>
                    {subtitle}
                  </p>
                )}
                {content && (
                  <p className={`${scope}-body whitespace-pre-wrap break-words max-w-prose text-pretty`}>
                    {content}
                  </p>
                )}
              </motion.div>
            </div>
          </div>
        </section>
      );
    }

    if (s.type === "quote") {
      const bgColor = s.bg_color || "#f3e8ff";
      const textColor = s.text_color || undefined;

      // Previously this section stacked TWO vertical spacing rules on top of
      // each other — section padding (py-14 lg:py-24) AND an outer margin
      // (my-6 lg:my-12) — adding up to 80px on mobile / 144px on desktop of
      // empty space, with no admin control over either. qc.padding_y_* now
      // replaces both with one clear, editable value per device.
      const qc = parseQuoteConfig(s.quote_config);
      const scope = `bo-quote-${String(s.id || idx).replace(/[^a-zA-Z0-9_-]/g, "")}`;
      // The colored <section> is intentionally full-bleed (edge to edge) —
      // the background must always span the full viewport width. The lateral
      // breathing room comes from the inner text column being capped at
      // max_width_* (plus its own px-6), NOT from shrinking the colored box.
      const quoteCss =
        `.${scope}{padding-top:${qc.padding_y_mobile}px;padding-bottom:${qc.padding_y_mobile}px;}` +
        `.${scope} .${scope}-inner{max-width:${qc.max_width_mobile}px;}` +
        `.${scope} .${scope}-text{font-size:${qc.quote_size_mobile}px;line-height:${qc.line_height};margin-bottom:${qc.gap_mobile}px;font-weight:${qc.quote_weight};}` +
        `.${scope} .${scope}-sub{font-size:${qc.sub_size_mobile}px;font-weight:${qc.sub_weight};}` +
        `@media (min-width:1024px){` +
        `.${scope}{padding-top:${qc.padding_y_desktop}px;padding-bottom:${qc.padding_y_desktop}px;}` +
        `.${scope} .${scope}-inner{max-width:${qc.max_width_desktop}px;}` +
        `.${scope} .${scope}-text{font-size:${qc.quote_size_desktop}px;margin-bottom:${qc.gap_desktop}px;}` +
        `.${scope} .${scope}-sub{font-size:${qc.sub_size_desktop}px;}` +
        `}`;

      return (
        <section
          key={s.id || idx}
          className={`${scope} overflow-hidden transition-colors duration-300`}
          style={{ backgroundColor: bgColor, color: textColor }}
        >
          <style dangerouslySetInnerHTML={{ __html: quoteCss }} />
          <div className={`${scope}-inner mx-auto px-6 text-center relative z-10`}>
            {content && (
              <p
                className={`${scope}-text font-serif italic break-words`}
                style={{ color: textColor || "rgba(44,37,32,0.85)" }}
              >
                "{content}"
              </p>
            )}
            <div className="flex flex-col items-center">
              <div
                className="w-12 lg:w-16 h-px mb-3 lg:mb-4"
                style={{ backgroundColor: textColor || "#c5a059" }}
              />
              {subtitle && (
                <p
                  className={`${scope}-sub font-semibold uppercase tracking-[0.25em] break-words`}
                  style={{ color: textColor || "#2c2520" }}
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>
        </section>
      );
    }

    return null;
  };

  // Resolved by the same module the server uses, so the title in the HTML and
  // the title after hydration are the same string by construction. The ar/fr/en
  // defaults that used to be duplicated here now live in src/lib/seoContent.ts.
  // No storeSettings needed: "/" always has a route default, so the site-wide
  // fallback below it is unreachable here.
  const homeSeo = resolvePageSeo({
    pathname: "/",
    language,
    sections: navSections,
    // Falls back to whatever the server already put in the tab, so the title
    // can't visibly change after load.
    ...serverRenderedSeo("/"),
  });
  const homeTitle = homeSeo.title;
  const homeDescription = homeSeo.description;

  // Absolute URL of the hero image, for og:image and twitter:image.
  const ogImageUrl = (() => {
    const hero = sections.find((s: any) => s?.type === "hero" && s?.image_url);
    const raw = String(hero?.image_url || DEFAULT_HOME_HERO_IMAGE).trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    return absoluteUrl(raw);
  })();

  return (
    <div className="pt-[140px] lg:pt-24 bg-background-soft">
      {/* Tags that never depend on loaded data can be asserted immediately. */}
      <Helmet>
        <link rel="canonical" href={`${SITE_ORIGIN}/`} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:secure_url" content={ogImageUrl} />
        <meta property="og:image:type" content="image/jpeg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={ogImageUrl} />
      </Helmet>
      <Helmet>
        <title>{homeTitle}</title>
        <meta name="description" content={homeDescription} />
        <meta property="og:title" content={homeTitle} />
        <meta property="og:description" content={homeDescription} />
      </Helmet>
      {!hasFetched && sections.length === 0 ? (
        <div className="w-full flex flex-col space-y-0 -mt-[140px] lg:-mt-24">
          <div className="relative w-full h-[65vh] sm:h-[65vh] md:h-[70vh] lg:h-[85vh] bg-background-lilac overflow-hidden">
            {/* The blurred <img> that used to sit here pointed at
                DEFAULT_HERO.image_url, a file that isn't in the build, so it
                only ever rendered a broken image with the alt text "Loading"
                written across the placeholder. The lilac wash below is the
                placeholder. */}
            {/* Was bg-black/10, which darkened the whole hero area while
                loading. A light lilac wash keeps the pulse visible without
                the dark flash. */}
            <div className="absolute inset-0 bg-accent-lilac/25 animate-pulse" />
          </div>
          <div className="w-full max-w-7xl mx-auto py-24 px-4 flex flex-col lg:flex-row gap-16 items-center">
            <div className="w-full max-w-md aspect-[4/5] bg-background-lilac animate-pulse shrink-0 mx-auto" />
            <div className="flex-1 w-full space-y-4">
              <div className="h-12 bg-background-lilac rounded w-1/2 animate-pulse mb-8" />
              <div className="h-4 bg-background-lilac rounded w-full animate-pulse" />
              <div className="h-4 bg-background-lilac rounded w-5/6 animate-pulse" />
              <div className="h-4 bg-background-lilac rounded w-3/4 animate-pulse" />
            </div>
          </div>
        </div>
      ) : sections.length > 0 ? (
        <div className="space-y-0">
          {sections.map((s, idx) => renderSection(s, idx))}
        </div>
      ) : hasFetched ? (
        <div className="py-24 text-center text-primary-earth/50">
          No content found
        </div>
      ) : null}
    </div>
  );
}

export default HomePage;
