/**
 * Minimal hex <-> HSV/RGB conversion used by the custom color-wheel popover
 * in ColorPicker.tsx. Kept dependency-free (no color library) since this
 * project's build environment makes new npm dependencies expensive to
 * verify — the algorithms below are the standard, textbook HSV<->RGB
 * conversions.
 */

export interface Hsv {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

export interface Rgb {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export function isValidHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

/** "#abc" -> "#aabbcc"; always lowercase. Assumes isValidHex(v) already passed. */
export function normalizeHex(v: string): string {
  const trimmed = v.trim();
  const short = trimmed.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  if (short) {
    const [, r, g, b] = short;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return trimmed.toLowerCase();
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function hexToRgb(hex: string): Rgb {
  const normalized = isValidHex(hex) ? normalizeHex(hex) : "#000000";
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s: s * 100, v: v * 100 };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;

  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hexToHsv(hex: string): Hsv {
  return rgbToHsv(hexToRgb(hex));
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}
