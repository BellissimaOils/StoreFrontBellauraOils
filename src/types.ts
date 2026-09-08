export interface Product {
  id: string;
  name: string;
  name_en?: string;
  category: string;
  price: string;
  image: string;
  description: string;
  benefits?: string[];
  usage?: string;
  ingredients?: string;
  rating?: number;
  reviews?: number;
  isSale?: boolean;
  originalPrice?: string;
  isAvailable?: boolean;
  showInSwiper?: boolean;
  /**
   * Numeric millilitre figure, when the size is a single unambiguous volume.
   * Null for packs and for products whose size was never set — the storefront
   * shows `size_label`, not this.
   */
  size_ml?: number | null;
  /**
   * The size exactly as the admin typed it: "100 ml", "3 x 50 ml", "طقم 4 زيوت".
   * Free text on purpose, because a pack's size is not one number.
   */
  size_label?: string;
  /** Alias of `size_label`, kept because existing views already read `volume`. */
  volume?: string;
  /**
   * Whether to display the size (ml / volume) on the storefront (product card, details, etc.).
   * Defaults to true (1) if undefined/null.
   */
  show_size?: boolean | number;
  showSize?: boolean;
  orderIndex?: number;
  tag?: string;
  showDescription?: boolean;
  showBenefits?: boolean;
  showUsage?: boolean;
  showIngredients?: boolean;
  exclude_from_sitemap?: number;
  displaySection?: "both" | "products" | "packs";
  /**
   * True when this product is a bundle of other products rather than a
   * single item. Drives the reviews expansion on this product's page (see
   * `packProductIds`) and is meant to eventually replace the id/name string
   * guessing ProductCard.tsx currently does to detect a pack.
   */
  isPack?: boolean;
  /** The ids of the individual products bundled inside this pack, chosen in the admin. Empty/absent when `isPack` is false. */
  packProductIds?: string[];
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Category {
  id: string;
  name: string;
  name_en?: string;
  image: string;
  count: number;
}

/**
 * Normalises a product's `benefits` field into a string array.
 *
 * The value can arrive in three shapes depending on the path it took:
 *   - a real string[] (already mapped by d1Client)
 *   - a JSON-encoded array string (some stored/imported rows)
 *   - a newline-separated string (what the admin textarea saves)
 *
 * This lives here because three components each had their own copy of this
 * parsing — ProductDetail (dead/unused), ProductAccordions (didn't handle the
 * JSON-array case), and ProductCard (had none at all, and so never read the
 * product's real benefits). One implementation, so they can't drift.
 */
export const parseBenefitsList = (raw: unknown): string[] => {
  // Admins commonly type list markers ("- ", "• ", "* ", "✓ ") at the start of
  // each line. The UI renders its own bullet, so strip them to avoid a double
  // bullet. This behaviour came from ProductAccordions' copy of the parser and
  // is kept here so folding the copies together doesn't regress it.
  const clean = (value: unknown) =>
    String(value)
      .replace(/^[-*•✓\s]+/, "")
      .trim();

  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(clean).filter(Boolean);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(clean).filter(Boolean);
        }
      } catch {
        // Not valid JSON after all — fall through to newline splitting.
      }
    }
    return trimmed.split(/\r?\n/).map(clean).filter(Boolean);
  }
  return [];
};

export const getProductSlug = (name: string): string => {
  if (!name) return "";
  return name
    .toLowerCase()
    .trim()
    .replace(/[()'".,/#!$%^&*?;:{}=\[\]_]/g, " ") // replace punctuation and symbols with space so (Golden) becomes " Golden "
    .trim()
    .replace(/\s+/g, "-") // replace whitespace sequences with single dash
    .replace(/^-+|-+$/g, "") // trim any leading and trailing dashes
    .replace(/-+/g, "-"); // collapse multiple consecutive dashes
};

