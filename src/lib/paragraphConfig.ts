/**
 * Admin-configurable image + typography + spacing for "paragraph" homepage
 * sections (the image-beside-text blocks).
 *
 * Before this, every one of these was hard-coded in HomePage.tsx: the image
 * was locked to a 4:5 crop at a fixed max width, cropping was limited to the
 * legacy 5-way `image_align` keyword, and all three text sizes (title,
 * subtitle, body) plus the section padding and the image/text gap had no
 * admin control at all. This module makes all of it editable, independently
 * for mobile and desktop, and adds a proper focal point + zoom for choosing
 * which part of the photo survives the crop — the same approach already used
 * for the hero image (see src/lib/heroConfig.ts).
 *
 * Same JSON-TEXT-column storage pattern as heroConfig/quoteConfig, for the
 * same reason: the write path is an INSERT OR REPLACE with a hardcoded
 * column list, so every flat column would have to be repeated there or it
 * gets nulled on every save/toggle/reorder. One JSON column keeps that list
 * short and lets future paragraph options ship without another migration.
 *
 * Parsing is always defensive (unset / malformed / legacy rows fall back to
 * defaults that reproduce the previous hard-coded look), so existing
 * paragraph sections render unchanged until an admin edits something.
 */

export interface ParagraphConfig {
  /** Hide the photo entirely and let the text use the full width. */
  show_image: boolean;
  /** Max width of the image column, in px. */
  img_max_w_mobile: number;
  img_max_w_desktop: number;
  /**
   * Image aspect ratio as width/height (0.8 = the old 4:5 portrait crop).
   * Only applies when image_fit is cover/fill — with `contain` the image
   * keeps its natural height, matching the previous behaviour.
   */
  img_ratio_mobile: number;
  img_ratio_desktop: number;
  /** Focal point in percent — which part of the photo stays visible. */
  focal_x_mobile: number;
  focal_y_mobile: number;
  focal_x_desktop: number;
  focal_y_desktop: number;
  /** Extra zoom in percent; 100 = no zoom. */
  img_zoom_mobile: number;
  img_zoom_desktop: number;
  /** Image corner rounding, in px. */
  img_radius: number;
  /** Font sizes in px. */
  title_size_mobile: number;
  title_size_desktop: number;
  sub_size_mobile: number;
  sub_size_desktop: number;
  content_size_mobile: number;
  content_size_desktop: number;
  /** CSS font-weight (100-900), shared across devices like line_height. */
  title_weight: number;
  /**
   * Subtitle weight. There was no control for this and the markup hardcoded
   * font-light, so the subtitle could not be emphasised at all — it rendered
   * lighter than the body copy underneath it, which inverts the hierarchy.
   */
  sub_weight: number;
  content_weight: number;
  /**
   * Gold rule under the title. Off by default: the reference layout this
   * section is modelled on separates the title from the text with space
   * rather than a line, and an underline plus a colour change plus a size
   * change is three signals doing one job.
   */
  title_underline: boolean;
  /**
   * Line height of the body text (unitless multiplier), per device.
   *
   * This was a single shared value, which is the main reason the block read
   * badly on a phone: the same multiplier that looks right on a 14px desktop
   * paragraph leaves visible gaps between lines at the smaller mobile size,
   * because the glyphs fill less of each line box. Mobile needs its own.
   */
  line_height_mobile: number;
  line_height_desktop: number;
  /**
   * Space below the title and below the subtitle, in px, per device.
   *
   * Previously hardcoded as Tailwind `mb-2 lg:mb-8` and `mb-2 lg:mb-10` — 8px
   * on mobile for both, regardless of font size. A 24px title followed by an
   * 8px gap reads as one crowded lump, which is the other half of the mobile
   * problem and was not adjustable at all.
   */
  title_gap_mobile: number;
  title_gap_desktop: number;
  sub_gap_mobile: number;
  sub_gap_desktop: number;
  /**
   * Horizontal alignment of the text column.
   *
   * "start" means the reading start edge — right in Arabic, left in
   * English/French — so it follows the page direction instead of being pinned
   * to one side. This was previously not set at all, so the alignment came
   * from whatever the surrounding markup happened to inherit, which is how a
   * long body paragraph ended up centred: readable for a one-line heading,
   * but a wall of centred Arabic body copy has a ragged edge on BOTH sides
   * and no straight edge for the eye to return to.
   */
  text_align: "start" | "center" | "justify";
  /**
   * Text colours. Previously the title was a hardcoded #8854c0 (a bright
   * purple that appears nowhere in the theme) and the body and subtitle were
   * Tailwind opacity classes at 60% and 70% of primary-earth — light enough
   * on white to read as grey rather than as text.
   */
  title_color: string;
  sub_color: string;
  body_color: string;
  /** Vertical padding above/below the section, in px. */
  padding_y_mobile: number;
  padding_y_desktop: number;
  /** Gap between the image column and the text column, in px. */
  gap_mobile: number;
  gap_desktop: number;
}

// Numerically equal to the previous hard-coded Tailwind classes at a 16px
// root font size, so an unedited paragraph section looks identical:
//   section padding: py-8 (32px)   -> lg:py-24 (96px)
//   image/text gap:  gap-4 (16px)  -> lg:gap-16 (64px)
//   image max width: the old responsive ladder was
//                    max-w-[280px] xs:[320px] sm:[360px] -> lg:max-w-md (448px);
//                    the mobile ladder is consolidated into one 320px value
//                    (its middle step) now that it's a single editable field
//   image ratio:     aspect-[4/5] = 0.8
//   title:           text-2xl (24px) -> lg:text-5xl (48px), font-light (300)
//   subtitle:        text-sm (14px)  -> lg:text-xl (20px)
//   body:            text-xs (12px)  -> lg:text-sm (14px), font-light (300)
/**
 * The recommended baseline for this section.
 *
 * These are no longer "whatever the old hardcoded Tailwind classes happened to
 * produce" — they are chosen values, with the reasoning next to each group. The
 * "Reset to default" button in the studio applies exactly this.
 *
 * Three principles drive the numbers:
 *
 * 1. **16px body, both breakpoints.** 14px is small for desktop body copy and
 *    Arabic needs more room than Latin at the same nominal size, because the
 *    diacritics sit above and below the baseline and get lost when the type is
 *    small.
 * 2. **Leading follows line length, not taste.** A wide desktop measure needs
 *    more space between lines so the eye can find the start of the next one
 *    (1.75); a narrow phone column needs less because the return journey is
 *    short (1.6). One shared value cannot serve both, which is why it is split.
 * 3. **Space groups, it doesn't just separate.** The gap under the title is
 *    smaller than the gap under the subtitle, so title+subtitle read as one
 *    heading block and the body reads as a separate unit. Equal gaps make all
 *    three float as unrelated fragments.
 */
export const DEFAULT_PARAGRAPH_CONFIG: ParagraphConfig = {
  show_image: true,
  img_max_w_mobile: 320,
  // Slightly wider than the old 448 so the photo holds its own against a 16px
  // text column instead of looking like a thumbnail beside it.
  img_max_w_desktop: 480,
  img_ratio_mobile: 0.8,
  img_ratio_desktop: 0.8,
  focal_x_mobile: 50,
  focal_y_mobile: 50,
  focal_x_desktop: 50,
  focal_y_desktop: 50,
  img_zoom_mobile: 100,
  img_zoom_desktop: 100,
  // Softly rounded rather than a hard rectangle, matching the rest of the
  // site's cards and the modal.
  img_radius: 12,
  title_size_mobile: 26,
  // 40px against a 16px body is a 2.5x step: unmistakably the heading without
  // the title dominating the block. The old 48px was a 3.4x step against a
  // 14px body, which is where "shouty" comes from, and it wrapped badly in
  // Arabic.
  title_size_desktop: 40,
  sub_size_mobile: 16,
  sub_size_desktop: 20,
  // 16px on both. 12px was far too small for Arabic body text; raising the
  // size is also most of what fixes the perceived line spacing, because at
  // small sizes the gaps between lines dominate the glyphs.
  content_size_mobile: 16,
  content_size_desktop: 16,
  title_weight: 300,
  sub_weight: 700,
  content_weight: 400,
  title_underline: false,
  // Narrow phone column: shorter return journey, so less leading. Wide desktop
  // measure: more, or the eye loses the next line.
  line_height_mobile: 1.6,
  line_height_desktop: 1.75,
  // Title sits close to its subtitle; the subtitle sits further from the body.
  title_gap_mobile: 12,
  title_gap_desktop: 18,
  sub_gap_mobile: 20,
  sub_gap_desktop: 30,
  // Reading-edge aligned: right in Arabic, left in English/French.
  text_align: "start",
  // Purple title, black subtitle, black body.
  //
  // The hierarchy is carried by colour and weight rather than by fading the
  // text out: the title is the brand purple, and the subtitle is separated
  // from the body by being bold at a larger size rather than by being a
  // lighter grey. #111 rather than #000 — it reads as black while avoiding the
  // harsh edge pure black gives on a white background at small sizes. Both are
  // editable per section, so #000000 is one click away in the picker.
  title_color: "#8854c0",
  sub_color: "#111111",
  body_color: "#111111",
  padding_y_mobile: 40,
  padding_y_desktop: 96,
  // On mobile the photo stacks above the text, so this gap is what stops them
  // touching; 16px was too tight for a stacked layout.
  gap_mobile: 24,
  gap_desktop: 64,
};

/**
 * Fields that describe how the TEXT looks, as opposed to how the photo is
 * framed. Used by the studio's "reset text styling" action so the recommended
 * typography can be applied without discarding a focal point and zoom that
 * were chosen for one specific photo.
 */
export const PARAGRAPH_TEXT_STYLE_KEYS = [
  "title_size_mobile",
  "title_size_desktop",
  "sub_size_mobile",
  "sub_size_desktop",
  "content_size_mobile",
  "content_size_desktop",
  "title_weight",
  "sub_weight",
  "content_weight",
  "title_underline",
  "line_height_mobile",
  "line_height_desktop",
  "title_gap_mobile",
  "title_gap_desktop",
  "sub_gap_mobile",
  "sub_gap_desktop",
  "padding_y_mobile",
  "padding_y_desktop",
  "gap_mobile",
  "gap_desktop",
  "text_align",
  "title_color",
  "sub_color",
  "body_color",
] as const satisfies readonly (keyof ParagraphConfig)[];

/** Applies the recommended text styling, preserving all image settings. */
export function resetParagraphTextStyling(current: ParagraphConfig): ParagraphConfig {
  const next: ParagraphConfig = { ...current };
  for (const key of PARAGRAPH_TEXT_STYLE_KEYS) {
    // Assigning through a union of keys needs the cast; each key is checked
    // against keyof ParagraphConfig by the `satisfies` above.
    (next as any)[key] = DEFAULT_PARAGRAPH_CONFIG[key];
  }
  return next;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Colours are interpolated straight into a <style> block, so anything that
 * isn't a plain hex colour is rejected rather than injected.
 */
function toColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
}

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

export function parseParagraphConfig(raw: unknown): ParagraphConfig {
  const source = toRecord(raw);
  const d = DEFAULT_PARAGRAPH_CONFIG;
  return {
    // Only an explicit false/0/"0"/"false" hides the image, so a legacy row
    // with no value at all keeps showing it.
    show_image: !(
      source.show_image === false ||
      source.show_image === 0 ||
      source.show_image === "0" ||
      source.show_image === "false"
    ),
    img_max_w_mobile: clamp(toNumber(source.img_max_w_mobile, d.img_max_w_mobile), 120, 1200),
    img_max_w_desktop: clamp(toNumber(source.img_max_w_desktop, d.img_max_w_desktop), 120, 1400),
    img_ratio_mobile: clamp(toNumber(source.img_ratio_mobile, d.img_ratio_mobile), 0.4, 2.5),
    img_ratio_desktop: clamp(toNumber(source.img_ratio_desktop, d.img_ratio_desktop), 0.4, 2.5),
    focal_x_mobile: clamp(toNumber(source.focal_x_mobile, d.focal_x_mobile), 0, 100),
    focal_y_mobile: clamp(toNumber(source.focal_y_mobile, d.focal_y_mobile), 0, 100),
    focal_x_desktop: clamp(toNumber(source.focal_x_desktop, d.focal_x_desktop), 0, 100),
    focal_y_desktop: clamp(toNumber(source.focal_y_desktop, d.focal_y_desktop), 0, 100),
    img_zoom_mobile: clamp(toNumber(source.img_zoom_mobile, d.img_zoom_mobile), 100, 250),
    img_zoom_desktop: clamp(toNumber(source.img_zoom_desktop, d.img_zoom_desktop), 100, 250),
    img_radius: clamp(toNumber(source.img_radius, d.img_radius), 0, 80),
    title_size_mobile: clamp(toNumber(source.title_size_mobile, d.title_size_mobile), 12, 64),
    title_size_desktop: clamp(toNumber(source.title_size_desktop, d.title_size_desktop), 14, 96),
    sub_size_mobile: clamp(toNumber(source.sub_size_mobile, d.sub_size_mobile), 8, 40),
    sub_size_desktop: clamp(toNumber(source.sub_size_desktop, d.sub_size_desktop), 8, 48),
    content_size_mobile: clamp(toNumber(source.content_size_mobile, d.content_size_mobile), 8, 32),
    content_size_desktop: clamp(toNumber(source.content_size_desktop, d.content_size_desktop), 8, 40),
    title_weight: clamp(toNumber(source.title_weight, d.title_weight), 100, 900),
    sub_weight: clamp(toNumber(source.sub_weight, d.sub_weight), 100, 900),
    content_weight: clamp(toNumber(source.content_weight, d.content_weight), 100, 900),
    // Only an explicit true turns the rule on, so existing rows (which have no
    // value) get the cleaner underline-free look.
    title_underline:
      source.title_underline === true ||
      source.title_underline === 1 ||
      source.title_underline === "1" ||
      source.title_underline === "true",
    // Rows saved before line height was split per device carry a single
    // `line_height`. Honour it for both so an existing section keeps the
    // spacing an admin deliberately chose.
    line_height_mobile: clamp(
      toNumber(
        source.line_height_mobile ?? source.line_height,
        d.line_height_mobile,
      ),
      1,
      2.4,
    ),
    line_height_desktop: clamp(
      toNumber(
        source.line_height_desktop ?? source.line_height,
        d.line_height_desktop,
      ),
      1,
      2.4,
    ),
    title_gap_mobile: clamp(toNumber(source.title_gap_mobile, d.title_gap_mobile), 0, 120),
    title_gap_desktop: clamp(toNumber(source.title_gap_desktop, d.title_gap_desktop), 0, 160),
    sub_gap_mobile: clamp(toNumber(source.sub_gap_mobile, d.sub_gap_mobile), 0, 120),
    sub_gap_desktop: clamp(toNumber(source.sub_gap_desktop, d.sub_gap_desktop), 0, 160),
    text_align: (["start", "center", "justify"] as const).includes(
      source.text_align as any,
    )
      ? (source.text_align as ParagraphConfig["text_align"])
      : d.text_align,
    title_color: toColor(source.title_color, d.title_color),
    sub_color: toColor(source.sub_color, d.sub_color),
    body_color: toColor(source.body_color, d.body_color),
    padding_y_mobile: clamp(toNumber(source.padding_y_mobile, d.padding_y_mobile), 0, 260),
    padding_y_desktop: clamp(toNumber(source.padding_y_desktop, d.padding_y_desktop), 0, 360),
    gap_mobile: clamp(toNumber(source.gap_mobile, d.gap_mobile), 0, 140),
    gap_desktop: clamp(toNumber(source.gap_desktop, d.gap_desktop), 0, 200),
  };
}

/** Serialize for the D1 TEXT column / for posting back to the save endpoint. */
export function serializeParagraphConfig(config: unknown): string {
  if (typeof config === "string") return config;
  try {
    return JSON.stringify(config ?? {});
  } catch {
    return "{}";
  }
}
