/**
 * Shared hero configuration helpers for homepage sections.
 *
 * Why two JSON columns instead of ~25 flat columns:
 * `POST /api/admin/homepage-sections` writes with INSERT OR REPLACE and a
 * HARDCODED column list. Because INSERT OR REPLACE deletes the row before
 * re-inserting it, any column missing from that list is silently reset to
 * NULL on every save — including plain visibility toggles and drag-reorders,
 * which round-trip the whole object through the same endpoint. That footgun
 * already bit this table once (see the comment above
 * ensureSectionsSeoColumnsExist in sectionRoutes.ts).
 *
 * Keeping all hero styling inside two JSON blobs (`overlay_config`,
 * `image_config`) means the column list needs exactly two new entries, once,
 * and every future hero option is added here with no migration and no risk
 * of being nulled out by an unrelated save.
 *
 * Both columns are plain TEXT holding JSON. Parsing is always defensive:
 * unset / malformed / legacy rows fall back to defaults that reproduce the
 * previous hard-coded look, so existing homepages render unchanged until an
 * admin actually edits something.
 */

export type OverlayAlign = "left" | "center" | "right";
export type OverlayVAlign = "top" | "middle" | "bottom";
/** Direction the hero overlay text animates in from. */
export type AnimDirection = "up" | "down" | "left" | "right" | "none" | "zoom";

export const ANIM_DIRECTIONS: AnimDirection[] = [
  "up",
  "down",
  "left",
  "right",
  "none",
  "zoom",
];

/**
 * The motion "from" state for a given direction. Paired with ANIM_TARGET
 * below, which is a single shared "to" state — listing every animatable
 * property there (x/y/scale) is intentional so that switching direction
 * never leaves a stale transform behind from a previous render.
 */
export function animInitial(
  direction: AnimDirection,
  distance: number,
): { opacity: number; x?: number; y?: number; scale?: number } {
  switch (direction) {
    case "up":
      return { opacity: 0, y: distance };
    case "down":
      return { opacity: 0, y: -distance };
    case "left":
      return { opacity: 0, x: -distance };
    case "right":
      return { opacity: 0, x: distance };
    case "zoom":
      return { opacity: 0, scale: 0.9 };
    case "none":
    default:
      return { opacity: 0 };
  }
}

export const ANIM_TARGET = { opacity: 1, x: 0, y: 0, scale: 1 } as const;

export interface HeroOverlayConfig {
  /** Overlay is opt-in so existing heroes are visually untouched. */
  enabled: boolean;
  heading_en: string;
  heading_ar: string;
  heading_fr: string;
  sub_en: string;
  sub_ar: string;
  sub_fr: string;
  btn_label_en: string;
  btn_label_ar: string;
  btn_label_fr: string;
  /** Where the button goes. Empty string hides the button. */
  btn_link: string;
  /**
   * Optional second CTA, stacked under the first. Same behaviour in every
   * respect — an empty label or link hides it, so a hero with only one button
   * is just this one left blank.
   *
   * It gets its own colours rather than inheriting the first button's, so the
   * pair can be styled as primary + secondary. Corner rounding is deliberately
   * shared (btn_radius) because two stacked buttons with different radii read
   * as a mistake rather than a choice.
   */
  btn2_label_en: string;
  btn2_label_ar: string;
  btn2_label_fr: string;
  btn2_link: string;
  btn2_bg: string;
  btn2_text: string;
  align: OverlayAlign;
  valign: OverlayVAlign;
  text_color: string;
  /** Dark scrim behind the text, 0-100, for legibility over busy photos. */
  scrim: number;
  /** Heading size multiplier in percent (50-160). */
  heading_scale: number;
  btn_bg: string;
  btn_text: string;
  /**
   * Corner radius of the browse button, in px. 0 is the original sharp
   * rectangle, which stays the default so existing heroes are untouched.
   * The button is roughly 46px tall, so anything from ~23px up renders as a
   * full pill/capsule — the slider's 40px ceiling covers sharp through pill
   * without letting the value grow meaninglessly large.
   */
  btn_radius: number;
  /**
   * Milliseconds to wait, after the hero has mounted, before the overlay
   * text starts animating in. Heading, subtext and button are staggered
   * `anim_stagger` ms apart on top of this base delay so they don't all pop
   * in as one flat block.
   */
  text_delay: number;
  /**
   * Which side the text travels in from. "up" means it rises up into place
   * (i.e. starts below), "left" means it slides in from the left edge, and
   * so on. "none" is a pure fade with no movement; "zoom" scales up.
   *
   * Deliberately NOT mirrored for RTL/Arabic: these are literal visual
   * directions, so "left" always means the text enters from the viewer's
   * left regardless of text direction. Mirroring it would make the admin
   * control mean two different things depending on the active language.
   */
  anim_direction: AnimDirection;
  /** How far the text travels, in px. Ignored for "none" and "zoom". */
  anim_distance: number;
  /** Duration of each line's entrance, in ms. */
  anim_duration: number;
  /** Delay between heading -> subtext -> button, in ms. */
  anim_stagger: number;
}

export interface HeroDeviceLayout {
  /** Section height in vh. */
  height: number;
  /** object-fit value. */
  fit: string;
  /** object-position X in percent. */
  x: number;
  /** object-position Y in percent. */
  y: number;
  /** Extra zoom in percent; 100 = no zoom. */
  zoom: number;
}

export interface HeroImageConfig {
  /** null = inherit the historical default for the current image_fit. */
  h_desktop: number | null;
  h_mobile: number | null;
  /** null = inherit from the legacy image_align field. */
  focal_x_desktop: number | null;
  focal_y_desktop: number | null;
  focal_x_mobile: number | null;
  focal_y_mobile: number | null;
  zoom_desktop: number;
  zoom_mobile: number;
  /** "" = inherit the desktop image_fit value. */
  fit_mobile: string;
}

export const DEFAULT_OVERLAY_CONFIG: HeroOverlayConfig = {
  enabled: false,
  heading_en: "",
  heading_ar: "",
  heading_fr: "",
  sub_en: "",
  sub_ar: "",
  sub_fr: "",
  btn_label_en: "",
  btn_label_ar: "",
  btn_label_fr: "",
  btn_link: "/products",
  // Pre-filled so the second button appears as soon as the overlay is on,
  // rather than requiring the label to be typed in three languages first.
  btn2_label_en: "Who We Are",
  btn2_label_ar: "من نحن",
  btn2_label_fr: "Qui sommes-nous",
  btn2_link: "/about",
  btn2_bg: "#2c2520",
  btn2_text: "#ffffff",
  align: "center",
  valign: "middle",
  text_color: "#ffffff",
  scrim: 25,
  heading_scale: 100,
  btn_bg: "#2c2520",
  btn_text: "#ffffff",
  btn_radius: 0,
  text_delay: 1000,
  // "up" + 24px + 700ms + 150ms stagger reproduces exactly what the hero
  // overlay animation was hard-coded to before these became configurable.
  anim_direction: "up",
  anim_distance: 24,
  anim_duration: 700,
  anim_stagger: 150,
};

export const DEFAULT_IMAGE_CONFIG: HeroImageConfig = {
  h_desktop: null,
  h_mobile: null,
  focal_x_desktop: null,
  focal_y_desktop: null,
  focal_x_mobile: null,
  focal_y_mobile: null,
  zoom_desktop: 100,
  zoom_mobile: 100,
  fit_mobile: "",
};

/**
 * Historical hard-coded heights, preserved so an untouched hero keeps its
 * exact current size. The `contain` branch used to be shorter than `cover`.
 */
export const LEGACY_HERO_HEIGHTS = {
  cover: { mobile: 55, desktop: 85 },
  contain: { mobile: 65, desktop: 50 },
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Accepts either a JSON string (what D1 returns) or an already-parsed object
 * (what the admin form holds in local state before saving).
 */
function toRecord(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Malformed JSON must never break the homepage — fall back to defaults.
      return {};
    }
  }
  return {};
}

export function parseOverlayConfig(raw: unknown): HeroOverlayConfig {
  const source = toRecord(raw);
  const align = toStringValue(source.align, "center");
  const valign = toStringValue(source.valign, "middle");
  return {
    enabled: source.enabled === true || source.enabled === 1 || source.enabled === "1",
    heading_en: toStringValue(source.heading_en),
    heading_ar: toStringValue(source.heading_ar),
    heading_fr: toStringValue(source.heading_fr),
    sub_en: toStringValue(source.sub_en),
    sub_ar: toStringValue(source.sub_ar),
    sub_fr: toStringValue(source.sub_fr),
    btn_label_en: toStringValue(source.btn_label_en),
    btn_label_ar: toStringValue(source.btn_label_ar),
    btn_label_fr: toStringValue(source.btn_label_fr),
    btn_link: toStringValue(source.btn_link, DEFAULT_OVERLAY_CONFIG.btn_link),
    // Fall back to the defaults only when the key is absent entirely. Once a
    // row has been saved from the studio the stored value wins, including a
    // deliberately blank label used to hide this button.
    btn2_label_en: toStringValue(
      source.btn2_label_en,
      source.btn2_label_en === undefined ? DEFAULT_OVERLAY_CONFIG.btn2_label_en : "",
    ),
    btn2_label_ar: toStringValue(
      source.btn2_label_ar,
      source.btn2_label_ar === undefined ? DEFAULT_OVERLAY_CONFIG.btn2_label_ar : "",
    ),
    btn2_label_fr: toStringValue(
      source.btn2_label_fr,
      source.btn2_label_fr === undefined ? DEFAULT_OVERLAY_CONFIG.btn2_label_fr : "",
    ),
    btn2_link: toStringValue(source.btn2_link, DEFAULT_OVERLAY_CONFIG.btn2_link),
    btn2_bg: toStringValue(source.btn2_bg, DEFAULT_OVERLAY_CONFIG.btn2_bg),
    btn2_text: toStringValue(source.btn2_text, DEFAULT_OVERLAY_CONFIG.btn2_text),
    align: (["left", "center", "right"].includes(align) ? align : "center") as OverlayAlign,
    valign: (["top", "middle", "bottom"].includes(valign) ? valign : "middle") as OverlayVAlign,
    text_color: toStringValue(source.text_color, DEFAULT_OVERLAY_CONFIG.text_color),
    scrim: clamp(toNumber(source.scrim, DEFAULT_OVERLAY_CONFIG.scrim), 0, 100),
    heading_scale: clamp(toNumber(source.heading_scale, 100), 50, 160),
    btn_bg: toStringValue(source.btn_bg, DEFAULT_OVERLAY_CONFIG.btn_bg),
    btn_text: toStringValue(source.btn_text, DEFAULT_OVERLAY_CONFIG.btn_text),
    btn_radius: clamp(
      toNumber(source.btn_radius, DEFAULT_OVERLAY_CONFIG.btn_radius),
      0,
      40,
    ),
    text_delay: clamp(toNumber(source.text_delay, DEFAULT_OVERLAY_CONFIG.text_delay), 0, 5000),
    anim_direction: (ANIM_DIRECTIONS.includes(
      toStringValue(source.anim_direction) as AnimDirection,
    )
      ? (source.anim_direction as AnimDirection)
      : DEFAULT_OVERLAY_CONFIG.anim_direction),
    anim_distance: clamp(
      toNumber(source.anim_distance, DEFAULT_OVERLAY_CONFIG.anim_distance),
      0,
      300,
    ),
    anim_duration: clamp(
      toNumber(source.anim_duration, DEFAULT_OVERLAY_CONFIG.anim_duration),
      100,
      3000,
    ),
    anim_stagger: clamp(
      toNumber(source.anim_stagger, DEFAULT_OVERLAY_CONFIG.anim_stagger),
      0,
      1000,
    ),
  };
}

const ALLOWED_OBJECT_FITS = ["cover", "contain", "fill"] as const;
export type AllowedObjectFit = (typeof ALLOWED_OBJECT_FITS)[number];

function toObjectFit(value: unknown, fallback: AllowedObjectFit = "cover"): AllowedObjectFit {
  const str = toStringValue(value, "").trim().toLowerCase();
  return (ALLOWED_OBJECT_FITS as readonly string[]).includes(str) ? (str as AllowedObjectFit) : fallback;
}

export function parseImageConfig(raw: unknown): HeroImageConfig {
  const source = toRecord(raw);
  return {
    h_desktop: toNumberOrNull(source.h_desktop),
    h_mobile: toNumberOrNull(source.h_mobile),
    focal_x_desktop: toNumberOrNull(source.focal_x_desktop),
    focal_y_desktop: toNumberOrNull(source.focal_y_desktop),
    focal_x_mobile: toNumberOrNull(source.focal_x_mobile),
    focal_y_mobile: toNumberOrNull(source.focal_y_mobile),
    zoom_desktop: clamp(toNumber(source.zoom_desktop, 100), 100, 250),
    zoom_mobile: clamp(toNumber(source.zoom_mobile, 100), 100, 250),
    fit_mobile: source.fit_mobile ? toObjectFit(source.fit_mobile, "cover") : "",
  };
}

/** Serialize for the D1 TEXT column. */
export function serializeConfig(config: unknown): string {
  if (typeof config === "string") return config;
  try {
    return JSON.stringify(config ?? {});
  } catch {
    return "{}";
  }
}

/**
 * Translates the legacy `image_align` keyword into focal-point percentages so
 * heroes saved before this feature existed keep their original framing.
 */
export function alignToFocal(align: unknown): { x: number; y: number } {
  switch (toStringValue(align, "center")) {
    case "top":
      return { x: 50, y: 0 };
    case "bottom":
      return { x: 50, y: 100 };
    case "left":
      return { x: 0, y: 50 };
    case "right":
      return { x: 100, y: 50 };
    default:
      return { x: 50, y: 50 };
  }
}

/**
 * Resolves the effective per-device layout for a hero section, merging the
 * saved config over the legacy `image_fit` / `image_align` fallbacks.
 */
export function resolveHeroLayout(
  imageFit: unknown,
  imageAlign: unknown,
  rawImageConfig: unknown,
): { mobile: HeroDeviceLayout; desktop: HeroDeviceLayout } {
  const config = parseImageConfig(rawImageConfig);
  const desktopFit = toObjectFit(imageFit, "cover");
  const mobileFit = config.fit_mobile ? toObjectFit(config.fit_mobile, desktopFit) : desktopFit;
  const legacyFocal = alignToFocal(imageAlign);

  const desktopDefaults =
    desktopFit === "contain" ? LEGACY_HERO_HEIGHTS.contain : LEGACY_HERO_HEIGHTS.cover;
  const mobileDefaults =
    mobileFit === "contain" ? LEGACY_HERO_HEIGHTS.contain : LEGACY_HERO_HEIGHTS.cover;

  return {
    desktop: {
      height: clamp(config.h_desktop ?? desktopDefaults.desktop, 20, 100),
      fit: desktopFit,
      x: clamp(config.focal_x_desktop ?? legacyFocal.x, 0, 100),
      y: clamp(config.focal_y_desktop ?? legacyFocal.y, 0, 100),
      zoom: config.zoom_desktop,
    },
    mobile: {
      height: clamp(config.h_mobile ?? mobileDefaults.mobile, 20, 100),
      fit: mobileFit,
      x: clamp(config.focal_x_mobile ?? legacyFocal.x, 0, 100),
      y: clamp(config.focal_y_mobile ?? legacyFocal.y, 0, 100),
      zoom: config.zoom_mobile,
    },
  };
}

/** Picks the right language variant, falling back to EN then AR then FR. */
export function pickOverlayText(
  config: HeroOverlayConfig,
  field: "heading" | "sub" | "btn_label" | "btn2_label",
  language: string,
): string {
  const en = config[`${field}_en` as keyof HeroOverlayConfig] as string;
  const ar = config[`${field}_ar` as keyof HeroOverlayConfig] as string;
  const fr = config[`${field}_fr` as keyof HeroOverlayConfig] as string;
  if (language === "ar") return ar || en || fr || "";
  if (language === "fr") return fr || en || ar || "";
  return en || ar || fr || "";
}

/**
 * Resolves a CTA target. Deliberately does NOT use normalizeLinkUrl, which
 * rewrites `/oils` to `/` — a browse button must land exactly where the admin
 * pointed it.
 */
export function resolveCtaHref(link: string): { href: string; external: boolean } {
  const trimmed = (link || "").trim();
  if (!trimmed) return { href: "", external: false };
  if (/^https?:\/\//i.test(trimmed)) return { href: trimmed, external: true };
  if (trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return { href: trimmed, external: true };
  }
  return { href: trimmed.startsWith("/") ? trimmed : `/${trimmed}`, external: false };
}

/** CSS flex mapping for overlay placement. */
export function overlayFlexStyle(config: HeroOverlayConfig): {
  justifyContent: string;
  alignItems: string;
  textAlign: "left" | "center" | "right";
} {
  return {
    justifyContent:
      config.align === "left" ? "flex-start" : config.align === "right" ? "flex-end" : "center",
    alignItems:
      config.valign === "top" ? "flex-start" : config.valign === "bottom" ? "flex-end" : "center",
    textAlign: config.align,
  };
}
