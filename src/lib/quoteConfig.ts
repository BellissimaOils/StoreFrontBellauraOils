/**
 * Admin-configurable typography/spacing for "quote" homepage sections.
 *
 * Root cause of the original "big empty space" complaint: the quote section
 * stacked TWO separate vertical spacing rules on top of each other —
 * section padding (`py-14 lg:py-24`) AND an outer margin (`my-6 lg:my-12`) —
 * adding up to 80px on mobile and 144px on desktop of empty space
 * above/below the text, with zero admin control over either value. This
 * module replaced both with one clear, per-device `padding_y` the admin can
 * see and adjust, plus per-device control over quote/author font size, the
 * gap between the quote and the divider, and the max text width.
 *
 * Follow-up #1: even after that fix landed, the DEFAULT `padding_y` values
 * still reproduced the old 80px/144px (so nothing visually changed for
 * sections nobody had edited yet) — and the purple box was still reported
 * as too tall. DEFAULT_QUOTE_CONFIG.padding_y_* below has since been
 * lowered to a genuinely more compact spacing (not just "editable"), while
 * staying within the same admin-adjustable range in case a taller look is
 * wanted for a specific section.
 *
 * Follow-up #2: on desktop the colored band looked like it had too much
 * empty lateral space, because the band is full-bleed (100% of the
 * viewport) while the text column inside it was capped at only 896px — so
 * on a wide screen a narrow column of text floated in a very wide block of
 * color. Mobile already looked right, since phones are usually narrower
 * than 896px anyway. The correct fix is to WIDEN THE TEXT, not to shrink
 * the colored band: the background must stay full-bleed edge to edge.
 * `max_width_desktop` was therefore raised (see below) so the text spans
 * most of the band with just a small lateral margin, and the section CSS in
 * HomePage.tsx deliberately sets no max-width on the <section> itself.
 *
 * Same JSON-TEXT-column storage pattern as src/lib/heroConfig.ts, for the
 * same reason: the write path is an INSERT OR REPLACE with a hardcoded
 * column list, so every flat column has to be repeated there or it gets
 * nulled on every save/toggle/reorder. One JSON column keeps that list
 * short and lets future quote options ship without another migration.
 *
 * Parsing is always defensive (unset / malformed / legacy rows fall back to
 * the current defaults below), so a quote section with corrupt or missing
 * config never breaks the homepage.
 */

export interface QuoteConfig {
  /** Font size of the quote text, in px. */
  quote_size_mobile: number;
  quote_size_desktop: number;
  /** Font size of the author/subtitle line, in px. */
  sub_size_mobile: number;
  sub_size_desktop: number;
  /** Line height of the quote text (unitless multiplier), shared across devices. */
  line_height: number;
  /**
   * CSS font-weight for the quote text and the author line (100-900).
   * Shared across devices rather than split per-device — same rationale as
   * line_height above: weight is a typographic identity choice that
   * essentially never needs to differ between phone and desktop, and
   * splitting it would double the slider count for no real benefit.
   */
  quote_weight: number;
  sub_weight: number;
  /**
   * Vertical padding above and below the whole section, in px. Replaces the
   * old stacked "py" (padding) plus "my" (margin) combo with a single value
   * per device.
   */
  padding_y_mobile: number;
  padding_y_desktop: number;
  /** Space between the quote text and the divider/author block below it, in px. */
  gap_mobile: number;
  gap_desktop: number;
  /**
   * Max width of the centered text column, in px. This is the ONLY width
   * control — the colored section itself always stays full-bleed. Raising
   * this makes the text span wider (leaving just a small lateral margin);
   * lowering it pulls the text into a narrower column.
   */
  max_width_mobile: number;
  max_width_desktop: number;
}

// Font sizes/line-height/gap/width still match the previous hard-coded
// Tailwind classes (text-xl->lg:text-3xl, text-xs->lg:text-sm,
// leading-[1.6], mb-6->lg:mb-8, max-w-4xl) so the TEXT itself looks the
// same as before. padding_y_* is the one exception: it no longer
// reproduces the old 80px/144px combined padding+margin figure — that was
// the actual size of the reported empty purple space, so keeping it as the
// "default" would have kept the problem. It's now a noticeably smaller,
// still-comfortable value, and remains fully adjustable per device via
// AdminQuoteStudio.tsx's "Section vertical spacing" slider.
export const DEFAULT_QUOTE_CONFIG: QuoteConfig = {
  quote_size_mobile: 20,
  quote_size_desktop: 30,
  sub_size_mobile: 12,
  sub_size_desktop: 14,
  line_height: 1.6,
  // 400 = the browser default the quote text already rendered at; 600
  // matches the author line's existing `font-semibold`. So an unedited
  // section keeps its current weight until an admin changes it.
  quote_weight: 400,
  sub_weight: 600,
  padding_y_mobile: 40,
  padding_y_desktop: 64,
  gap_mobile: 24,
  gap_desktop: 32,
  max_width_mobile: 896,
  // Widened from the original 896px so the text expands across more of the
  // full-bleed colored band, leaving only a small lateral margin (on a
  // 1440px screen this is ~80px per side, plus the inner px-6 padding)
  // instead of a narrow column floating in a wide block of color.
  max_width_desktop: 1280,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export function parseQuoteConfig(raw: unknown): QuoteConfig {
  const source = toRecord(raw);
  const d = DEFAULT_QUOTE_CONFIG;
  return {
    quote_size_mobile: clamp(toNumber(source.quote_size_mobile, d.quote_size_mobile), 12, 56),
    quote_size_desktop: clamp(toNumber(source.quote_size_desktop, d.quote_size_desktop), 14, 72),
    sub_size_mobile: clamp(toNumber(source.sub_size_mobile, d.sub_size_mobile), 8, 28),
    sub_size_desktop: clamp(toNumber(source.sub_size_desktop, d.sub_size_desktop), 8, 32),
    line_height: clamp(toNumber(source.line_height, d.line_height), 1, 2.4),
    quote_weight: clamp(toNumber(source.quote_weight, d.quote_weight), 100, 900),
    sub_weight: clamp(toNumber(source.sub_weight, d.sub_weight), 100, 900),
    padding_y_mobile: clamp(toNumber(source.padding_y_mobile, d.padding_y_mobile), 0, 260),
    padding_y_desktop: clamp(toNumber(source.padding_y_desktop, d.padding_y_desktop), 0, 360),
    gap_mobile: clamp(toNumber(source.gap_mobile, d.gap_mobile), 0, 100),
    gap_desktop: clamp(toNumber(source.gap_desktop, d.gap_desktop), 0, 140),
    max_width_mobile: clamp(toNumber(source.max_width_mobile, d.max_width_mobile), 240, 1400),
    max_width_desktop: clamp(toNumber(source.max_width_desktop, d.max_width_desktop), 240, 2000),
  };
}

/** Serialize for the D1 TEXT column / for posting back to the save endpoint. */
export function serializeQuoteConfig(config: unknown): string {
  if (typeof config === "string") return config;
  try {
    return JSON.stringify(config ?? {});
  } catch {
    return "{}";
  }
}
