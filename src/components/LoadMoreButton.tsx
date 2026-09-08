import { useLanguage } from "../context/LanguageContext";

interface LoadMoreButtonProps {
  onClick: () => void;
  /** Hides the button entirely when false. */
  hasMore: boolean;
  /** Shows the loading label and blocks repeat clicks. */
  isLoading?: boolean;
  /** How many rows are on screen — shown as "20 of 143" when total is given. */
  loaded?: number;
  total?: number;
  variant?: "default" | "subtle";
  className?: string;
}

/**
 * The "Load more" control shared by every incrementally-loaded list.
 *
 * The admin tables each had their own copy of this button with slightly
 * different labels and loading text; the product reviews accordion had a third.
 * One component means the storefront and the admin panel can't drift apart, and
 * the three translations live in one place.
 */
export default function LoadMoreButton({
  onClick,
  hasMore,
  isLoading = false,
  loaded,
  total,
  variant = "default",
  className = "",
}: LoadMoreButtonProps) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const isFr = language === "fr";

  if (!hasMore) return null;

  const label = isLoading
    ? isAr
      ? "جاري التحميل..."
      : isFr
        ? "Chargement..."
        : "Loading..."
    : isAr
      ? "عرض المزيد"
      : isFr
        ? "Afficher plus"
        : "Show More";

  const showCount = typeof loaded === "number" && typeof total === "number" && total > 0;

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={isLoading}
        aria-busy={isLoading}
        className={
          variant === "subtle"
            ? "px-6 py-2.5 text-xs font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            : "px-8 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-primary-earth bg-transparent border border-primary-earth/25 hover:border-accent-gold hover:text-accent-gold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        }
      >
        {label}
      </button>
      {showCount && (
        <span className="text-[10px] text-primary-earth/40 font-mono" dir="ltr">
          {loaded} / {total}
        </span>
      )}
    </div>
  );
}
