import { Star } from "lucide-react";

interface StarRatingProps {
  /** Average rating. Accepts the string the summary endpoint returns ("4.7"). */
  value?: number | string | null;
  /** Number of reviews. When 0, all five stars render empty. */
  count?: number | null;
  size?: "xs" | "sm" | "md";
  /** Show the numeric average next to the stars. */
  showValue?: boolean;
  /** Show "(12)" after the stars. */
  showCount?: boolean;
  className?: string;
}

const SIZES = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
} as const;

const TEXT_SIZES = {
  xs: "text-[10px]",
  sm: "text-[11px]",
  md: "text-xs",
} as const;

/**
 * Five stars, filled to the nearest half.
 *
 * The product cards used to print a single "★" glyph next to a number, and only
 * when a rating existed — so a product with no reviews showed nothing at all,
 * and a product with reviews showed one star regardless of whether it averaged
 * 2.0 or 5.0. This renders the actual score: full stars, one half star where the
 * average lands mid-way, and empty stars for the rest.
 *
 * A product with no reviews renders five empty stars rather than nothing, so a
 * grid of cards lines up and "not rated yet" is visible instead of ambiguous.
 *
 * The half star is drawn by overlaying a clipped filled star on an empty one —
 * `overflow-hidden` on a half-width wrapper — because lucide has no half-fill.
 */
export default function StarRating({
  value,
  count = null,
  size = "sm",
  showValue = false,
  showCount = false,
  className = "",
}: StarRatingProps) {
  const numeric = Number(value);
  const reviewCount = Number(count) || 0;
  // No reviews means no score, whatever `value` happens to hold: some rows
  // carry a stale default of 5 from before ratings were computed server-side.
  const average = reviewCount > 0 && Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  // Nearest half: 4.2 -> 4, 4.3 -> 4.5, 4.8 -> 5.
  const rounded = Math.round(average * 2) / 2;
  const starClass = SIZES[size];
  const textClass = TEXT_SIZES[size];

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {/* dir=ltr so the stars read left-to-right in Arabic as well; a rating
          scale is not a sentence and flipping it reverses its meaning. */}
      <span className="inline-flex items-center gap-px" dir="ltr" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((position) => {
          const filled = rounded >= position;
          const half = !filled && rounded >= position - 0.5;
          if (half) {
            return (
              <span key={position} className="relative inline-block">
                <Star className={`${starClass} fill-transparent text-current opacity-30`} />
                {/* Explicit left/top rather than inset-0: `inset-0` also sets
                    `right: 0`, which fights the 50% width, and under dir=rtl the
                    resolved side is not obvious. This always clips the left
                    half. */}
                <span
                  className="absolute overflow-hidden"
                  style={{ left: 0, top: 0, bottom: 0, width: "50%" }}
                >
                  <Star className={`${starClass} fill-current text-current`} />
                </span>
              </span>
            );
          }
          return (
            <Star
              key={position}
              className={`${starClass} ${
                filled ? "fill-current text-current" : "fill-transparent text-current opacity-30"
              }`}
            />
          );
        })}
      </span>
      {showValue && average > 0 && (
        <span className={`${textClass} font-bold`} dir="ltr">
          {average.toFixed(1)}
        </span>
      )}
      {showCount && (
        <span className={`${textClass} opacity-60`} dir="ltr">
          ({reviewCount})
        </span>
      )}
    </span>
  );
}
