import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Droplets, Trash2 } from "lucide-react";
import { ColorPreset } from "../lib/colorPresets";
import { Hsv, hexToHsv, hsvToHex, isValidHex, normalizeHex } from "../lib/colorUtils";

/**
 * Shared color-picking control used everywhere an admin picks a hex color
 * (Quote/Section colors, Hero Studio text/button colors, etc.).
 *
 * Clicking the swatch opens a self-contained popover with a full
 * saturation/value gradient square + hue strip — the same interaction
 * pattern as the OS-native / Shopify-style color pickers — instead of
 * relying on the browser's native <input type="color"> dialog, whose look
 * varies wildly between browsers and OSes and can't be styled at all.
 *
 * The popover also carries the hex input, the eyedropper, and the
 * preset/recent swatch rows, so everything for choosing a color lives in one
 * place once it's open.
 */

interface ColorPickerProps {
  /** Current value. May be empty/invalid while the admin is mid-typing. */
  value: string;
  /** Used as the initial color and the hex placeholder when value is empty/invalid. */
  fallback: string;
  onChange: (hex: string) => void;
  presets: ColorPreset[];
  presetsLabel: string;
  recentLabel: string;
  clearRecentLabel: string;
  eyedropperLabel: string;
}

const RECENT_KEY = "bo_admin_recent_colors";
const MAX_RECENT = 12;
const POPOVER_WIDTH = 272;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string" && isValidHex(c)) : [];
  } catch {
    // Private-mode storage, quota errors, or corrupted JSON — no recents, not fatal.
    return [];
  }
}

function pushRecent(hex: string, current: string[]): string[] {
  const normalized = normalizeHex(hex);
  const next = [normalized, ...current.filter((c) => c !== normalized)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the picker still works, it just won't remember.
  }
  return next;
}

interface SwatchProps {
  hex: string;
  title: string;
  onClick: () => void;
  /**
   * Declared purely to satisfy the type checker.
   *
   * `key` is a React-reserved prop that React strips before props reach a
   * component, so it is never read here. It has to be declared because this
   * project has no `@types/react` — nothing provides a React JSX namespace, so
   * there is no `IntrinsicAttributes` contributing `key`, and TypeScript treats
   * `<Swatch key={...} />` as passing an excess property. Those were the two
   * TS2322 errors failing the CI typecheck job.
   *
   * The real fix is `npm i -D @types/react @types/react-dom`, which needs the
   * lockfile regenerating; this keeps the build honest until then.
   */
  key?: string;
}

function Swatch({ hex, title, onClick }: SwatchProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-6 h-6 rounded-full border border-black/20 shadow-sm transition-transform hover:scale-110 focus:outline-none cursor-pointer shrink-0"
      style={{ backgroundColor: hex }}
      title={title}
    />
  );
}

/** Draggable saturation/value square, tinted by the current hue. */
function SvSquare({ hsv, onChange }: { hsv: Hsv; onChange: (s: number, v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const update = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const s = ((clientX - rect.left) / rect.width) * 100;
    const v = 100 - ((clientY - rect.top) / rect.height) * 100;
    onChange(Math.min(100, Math.max(0, s)), Math.min(100, Math.max(0, v)));
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) update(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      className="relative w-full h-40 rounded-md cursor-crosshair select-none touch-none overflow-hidden"
      style={{
        backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
        backgroundImage:
          "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))",
      }}
    >
      <div
        className="absolute w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
        style={{
          left: `${hsv.s}%`,
          top: `${100 - hsv.v}%`,
          transform: "translate(-50%, -50%)",
          backgroundColor: hsvToHex(hsv),
        }}
      />
    </div>
  );
}

/** Draggable hue strip, the full 0-360 spectrum. */
function HueSlider({ hue, onChange }: { hue: number; onChange: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const update = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const h = ((clientX - rect.left) / rect.width) * 360;
    onChange(Math.min(360, Math.max(0, h)));
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e.clientX);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) update(e.clientX);
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      className="relative w-full h-4 rounded-full cursor-pointer select-none touch-none"
      style={{
        background:
          "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
      }}
    >
      <div
        className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
        style={{
          left: `${(hue / 360) * 100}%`,
          transform: "translate(-50%, -50%)",
          backgroundColor: `hsl(${hue}, 100%, 50%)`,
        }}
      />
    </div>
  );
}

export default function ColorPicker({
  value,
  fallback,
  onChange,
  presets,
  presetsLabel,
  recentLabel,
  clearRecentLabel,
  eyedropperLabel,
}: ColorPickerProps) {
  const [text, setText] = useState(value || "");
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const eyedropperSupported = typeof window !== "undefined" && "EyeDropper" in window;

  const currentHex = isValidHex(value) ? normalizeHex(value) : fallback;
  const hsv = hexToHsv(currentHex);

  useEffect(() => {
    setText(value || "");
  }, [value]);

  // Position the popover under the swatch, clamped so it never runs off the
  // right edge of the viewport — the admin's editor panel is a fixed-width
  // modal, so a naive left-anchored popover would frequently overflow it.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = swatchRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12);
      setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, left) });
    };
    place();

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || swatchRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // capture: true so this fires even for scroll events on the modal's own
    // internal overflow-y-auto container, which don't bubble to window.
    window.addEventListener("scroll", () => setOpen(false), true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("scroll", () => setOpen(false), true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const commit = (hex: string, remember: boolean) => {
    const normalized = normalizeHex(hex);
    onChange(normalized);
    setText(normalized);
    if (remember) setRecent((prev) => pushRecent(normalized, prev));
  };

  const handleEyedropper = async () => {
    try {
      // EyeDropper isn't in the standard TS DOM lib yet; feature-detected above.
      const dropper = new (window as any).EyeDropper();
      const result = await dropper.open();
      if (result?.sRGBHex) commit(result.sRGBHex, true);
    } catch {
      // User pressed Escape, or the browser blocked it — nothing to report.
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          ref={swatchRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-10 h-10 rounded border border-primary-earth/20 cursor-pointer shrink-0 shadow-sm"
          style={{ backgroundColor: currentHex }}
          title={currentHex}
        />
        <input
          type="text"
          placeholder={fallback}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (isValidHex(e.target.value)) onChange(normalizeHex(e.target.value));
          }}
          onBlur={() => {
            if (isValidHex(text)) commit(text, true);
            else setText(value || "");
          }}
          className="flex-1 p-2 border border-primary-earth/20 text-sm font-mono uppercase"
        />
        {eyedropperSupported && (
          <button
            type="button"
            title={eyedropperLabel}
            onClick={handleEyedropper}
            className="p-2.5 border border-primary-earth/20 rounded text-primary-earth hover:bg-primary-earth/5 cursor-pointer shrink-0"
          >
            <Droplets className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[10050] bg-white rounded-lg border border-primary-earth/15 shadow-2xl p-4 space-y-3"
          style={{ top: popoverPos.top, left: popoverPos.left, width: POPOVER_WIDTH }}
        >
          <SvSquare
            hsv={hsv}
            onChange={(s, v) => commit(hsvToHex({ h: hsv.h, s, v }), false)}
          />
          <HueSlider hue={hsv.h} onChange={(h) => commit(hsvToHex({ h, s: hsv.s, v: hsv.v }), false)} />

          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded border border-primary-earth/20 shrink-0"
              style={{ backgroundColor: currentHex }}
            />
            <input
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (isValidHex(e.target.value)) onChange(normalizeHex(e.target.value));
              }}
              onBlur={() => {
                if (isValidHex(text)) commit(text, true);
                else setText(value || "");
              }}
              className="flex-1 p-2 border border-primary-earth/20 text-sm font-mono uppercase"
            />
            {eyedropperSupported && (
              <button
                type="button"
                title={eyedropperLabel}
                onClick={handleEyedropper}
                className="p-2 border border-primary-earth/20 rounded text-primary-earth hover:bg-primary-earth/5 cursor-pointer shrink-0"
              >
                <Droplets className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 items-center pt-1 border-t border-primary-earth/10">
            <span className="text-[9px] font-bold text-primary-earth/50 uppercase tracking-wider mr-1">
              {presetsLabel}
            </span>
            {presets.map((preset) => (
              <Swatch
                key={preset.hex}
                hex={preset.hex}
                title={`${preset.name} (${preset.hex})`}
                onClick={() => commit(preset.hex, true)}
              />
            ))}
          </div>

          {recent.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[9px] font-bold text-primary-earth/50 uppercase tracking-wider mr-1">
                {recentLabel}
              </span>
              {recent.map((hex) => (
                <Swatch key={hex} hex={hex} title={hex} onClick={() => commit(hex, false)} />
              ))}
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(RECENT_KEY);
                  } catch {
                    // Ignore — nothing to clean up if storage was never written.
                  }
                  setRecent([]);
                }}
                className="p-1 text-primary-earth/40 hover:text-red-500 cursor-pointer shrink-0"
                title={clearRecentLabel}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
