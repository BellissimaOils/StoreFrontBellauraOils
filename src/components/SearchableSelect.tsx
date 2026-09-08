import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

interface SearchableSelectProps {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  /** Optional label rendered for each option, e.g. a row count. */
  renderMeta?: (option: string) => string | null;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A single-select dropdown with a search box.
 *
 * A native `<select>` cannot contain a search field, and with a few dozen D1
 * tables in unpredictable order that meant hunting through the list by eye
 * every time. This keeps the same one-click behaviour and adds type-to-filter,
 * closing on outside click or Escape.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  renderMeta,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  disabled = false,
  className = "",
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  // Reset the filter each time it opens, so a previous search doesn't hide the
  // list the next time it's used.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 bg-white border border-slate-300 rounded text-xs font-mono text-primary-earth font-bold py-1.5 px-3 hover:border-accent-gold focus:outline-none focus:ring-1 focus:ring-accent-gold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 min-w-full w-max max-w-[320px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 left-2.5" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full border border-slate-200 rounded pl-8 pr-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-accent-gold"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No matches</p>
            ) : (
              filtered.map((option) => {
                const isSelected = option === value;
                const meta = renderMeta?.(option);
                return (
                  <button
                    type="button"
                    key={option}
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-mono text-left transition-colors ${
                      isSelected
                        ? "bg-accent-gold/10 text-primary-earth font-bold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="truncate">{option}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {meta && <span className="text-[10px] text-slate-400">{meta}</span>}
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </span>
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
