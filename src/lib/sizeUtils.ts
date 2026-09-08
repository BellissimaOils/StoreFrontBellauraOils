/**
 * Product size / volume helpers.
 *
 * The catalogue has two size fields and they answer different questions:
 *
 *   size_label (TEXT)  — what the shop shows the customer. Free text, because
 *                        a pack's size genuinely is not one number: "3 x 50 ml",
 *                        "100 ml + 30 ml", "طقم 4 زيوت". This is the field the
 *                        admin types into.
 *   size_ml (INTEGER)  — a single millilitre figure for the rows where one
 *                        makes sense, kept for the D1 manager, sorting and any
 *                        future per-ml maths. Derived from the label when the
 *                        label is unambiguous, otherwise left null.
 *
 * Before this existed the admin field was an <input type="number"> writing to
 * size_ml, so typing "50 ml" or "2 x 50 ml" produced an empty value that
 * collapsed to 0 — the "it doesn't accept the size" report.
 */

/** Trim and collapse internal whitespace; anything empty becomes "". */
export function normalizeSizeLabel(value: any): string {
  if (value === undefined || value === null) return "";
  const str = String(value).trim().replace(/\s+/g, " ");
  if (!str) return "";
  // Guard against the string forms of "no value" that can reach us from a
  // JSON round-trip or a D1 NULL that was stringified along the way.
  if (str === "null" || str === "undefined" || str === "NaN") return "";
  return str;
}

/**
 * Best-effort millilitre figure for a free-text size label.
 *
 * Handles exactly three shapes and returns null for everything else — a null
 * size_ml is honest, whereas a guess would show up as a wrong "(N ml)" in the
 * database manager:
 *
 *   "100", "100ml", "100 ML", "١٠٠ ml"  -> 100
 *   "1 l", "1.5 litre", "2L"            -> 1000 / 1500 / 2000
 *   "3 x 50 ml", "3×50ml", "3 * 50"     -> 150   (pack: count x unit size)
 */
export function parseSizeMlFromLabel(label: any): number | null {
  const str = normalizeSizeLabel(label).toLowerCase();
  if (!str) return null;

  // Arabic-Indic digits, so a size typed on an Arabic keyboard parses too.
  const ascii = str.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660),
  );

  const isLitres = (unit: string | undefined) =>
    !!unit && /^(l|lt|ltr|litre|liter|لتر)$/.test(unit.trim());

  const toMl = (n: number, unit?: string) =>
    isLitres(unit) ? n * 1000 : n;

  // "3 x 50 ml" — count times unit size.
  const packMatch = ascii.match(
    /^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(ml|مل|l|lt|ltr|litre|liter|لتر)?$/,
  );
  if (packMatch) {
    const count = parseFloat(packMatch[1].replace(",", "."));
    const unitSize = parseFloat(packMatch[2].replace(",", "."));
    if (Number.isFinite(count) && Number.isFinite(unitSize)) {
      const ml = toMl(count * unitSize, packMatch[3]);
      return Number.isFinite(ml) && ml > 0 ? Math.round(ml) : null;
    }
  }

  // "100 ml" / "100" / "1.5 l"
  const singleMatch = ascii.match(
    /^(\d+(?:[.,]\d+)?)\s*(ml|مل|l|lt|ltr|litre|liter|لتر)?$/,
  );
  if (singleMatch) {
    const n = parseFloat(singleMatch[1].replace(",", "."));
    if (Number.isFinite(n)) {
      const ml = toMl(n, singleMatch[2]);
      return Number.isFinite(ml) && ml > 0 ? Math.round(ml) : null;
    }
  }

  return null;
}

/**
 * Resolves the {size_label, size_ml} pair to persist from whatever a client
 * sent. Either field may be absent.
 *
 * Returns `undefined` for a field when the caller supplied nothing for it, so
 * an update can tell "leave this column alone" apart from "clear this column"
 * (null).
 */
export function resolveProductSize(input: {
  size_label?: any;
  size_ml?: any;
}): { size_label: string | null | undefined; size_ml: number | null | undefined } {
  const hasLabel = input.size_label !== undefined;
  const hasMl = input.size_ml !== undefined;

  if (!hasLabel && !hasMl) {
    return { size_label: undefined, size_ml: undefined };
  }

  if (hasLabel) {
    const label = normalizeSizeLabel(input.size_label);
    if (!label) {
      // Explicitly cleared.
      return { size_label: null, size_ml: hasMl ? coerceMl(input.size_ml) : null };
    }
    // A numeric size_ml sent alongside the label wins only if the label itself
    // isn't parseable — the label is what the admin actually typed.
    const fromLabel = parseSizeMlFromLabel(label);
    return {
      size_label: label,
      size_ml: fromLabel !== null ? fromLabel : hasMl ? coerceMl(input.size_ml) : null,
    };
  }

  // size_ml only (an older client, or the bulk paths): keep the number and
  // leave the label alone rather than inventing text for it.
  return { size_label: undefined, size_ml: coerceMl(input.size_ml) };
}

function coerceMl(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    // Fall back to reading it as a label, so a client that still posts
    // "50 ml" into size_ml gets 50 rather than null.
    return parseSizeMlFromLabel(value);
  }
  return Math.round(n);
}
