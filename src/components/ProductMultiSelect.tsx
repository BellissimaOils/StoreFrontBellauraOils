import { useEffect, useRef, useState } from "react";
import { ChevronDown, X, Check, Search } from "lucide-react";

interface ProductMultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  isAr: boolean;
  isFr?: boolean;
  disabled?: boolean;
}

/**
 * A searchable dropdown + removable chips for picking a subset of products.
 *
 * The dropdown uses `position: fixed` with dynamically computed coordinates so
 * it is never clipped by a parent `overflow: hidden` container, and it opens
 * upward automatically when there is not enough space below the trigger.
 */
export default function ProductMultiSelect({
  options,
  selected,
  onChange,
  isAr,
  isFr = false,
  disabled = false,
}: ProductMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Fixed-position coords for the dropdown panel.
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Recompute dropdown position every time it opens.
  const openDropdown = () => {
    if (disabled) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const PANEL_HEIGHT = 310; // approx max height (search + items)
      const GAP = 6;
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;

      if (spaceBelow >= PANEL_HEIGHT || spaceBelow >= spaceAbove) {
        // Open downward
        setDropdownStyle({
          position: "fixed",
          top: rect.bottom + GAP,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
        });
      } else {
        // Not enough space below — open upward
        setDropdownStyle({
          position: "fixed",
          bottom: window.innerHeight - rect.top + GAP,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
        });
      }
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Close on scroll so the fixed panel doesn't drift away from the trigger.
    const handleScroll = () => setOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const toggle = (name: string) => {
    if (disabled) return;
    onChange(
      selected.includes(name)
        ? selected.filter((n) => n !== name)
        : [...selected, name],
    );
    // Clear the search word after picking so the full list is visible again.
    setQuery("");
  };

  const remove = (name: string) => {
    if (disabled) return;
    onChange(selected.filter((n) => n !== name));
  };

  const filteredOptions = query.trim()
    ? options.filter((o) =>
        o.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  const triggerLabel =
    selected.length === 0
      ? isAr
        ? "لم يتم اختيار أي منتج"
        : isFr
          ? "Aucun produit sélectionné"
          : "No products selected"
      : isAr
        ? `${selected.length} من ${options.length} منتجاً محدداً`
        : isFr
          ? `${selected.length} sur ${options.length} produits sélectionnés`
          : `${selected.length} of ${options.length} products selected`;

  return (
    <div className="relative" ref={containerRef}>
      {/* Selected chips — each individually removable */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 bg-[#2c5836]/10 text-[#2c5836] text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full border border-[#2c5836]/20"
            >
              {name}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(name)}
                  className="hover:bg-[#2c5836]/20 rounded-full p-0.5 transition-colors"
                  aria-label={isAr ? "إزالة" : "Remove"}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Trigger */}
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={openDropdown}
        className="w-full flex items-center justify-between gap-2 border border-primary-earth/20 rounded-lg px-3 py-2.5 bg-white text-sm text-primary-earth/80 hover:border-[#2c5836]/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className={`w-4 h-4 text-primary-earth/40 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown — fixed-position so it's never clipped by parent overflow */}
      {open && (
        <div
          style={dropdownStyle}
          className="bg-white border border-primary-earth/15 rounded-lg shadow-xl overflow-hidden"
        >
          {/* Search */}
          <div className="p-2 border-b border-primary-earth/10">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-primary-earth/30 absolute top-1/2 -translate-y-1/2 left-2.5" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  isAr
                    ? "بحث عن منتج..."
                    : isFr
                      ? "Rechercher un produit..."
                      : "Search products..."
                }
                className="w-full border border-primary-earth/15 rounded-md pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:border-[#2c5836]/50"
              />
            </div>
            <div className="flex gap-3 mt-1.5 px-0.5">
              <button
                type="button"
                onClick={() => onChange(options)}
                className="text-[11px] font-bold text-[#2c5836]/70 hover:text-[#2c5836] underline"
              >
                {isAr ? "تحديد الكل" : isFr ? "Tout sélectionner" : "Select all"}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] font-bold text-primary-earth/50 hover:text-primary-earth underline"
              >
                {isAr ? "إلغاء الكل" : isFr ? "Tout désélectionner" : "Clear all"}
              </button>
            </div>
          </div>

          {/* Items list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-primary-earth/40 text-center py-4">
                {isAr ? "لا توجد نتائج" : isFr ? "Aucun résultat" : "No matches"}
              </p>
            ) : (
              filteredOptions.map((name) => {
                const isSelected = selected.includes(name);
                return (
                  <button
                    type="button"
                    key={name}
                    onClick={() => toggle(name)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      isSelected
                        ? "bg-[#2c5836]/8 text-[#2c5836] font-medium"
                        : "text-primary-earth/80 hover:bg-primary-earth/5"
                    }`}
                  >
                    <span className="truncate">{name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
