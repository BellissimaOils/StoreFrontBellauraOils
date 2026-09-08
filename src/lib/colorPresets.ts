/**
 * Curated color presets for the admin color pickers (Quote/Section colors,
 * Hero Studio overlay text/button colors). Split by purpose because a
 * background needs pale/neutral options while a button or text color needs
 * strong, legible ones — merging them into one list made the old 5-8 dot
 * preset rows far less useful than they could be.
 */
export interface ColorPreset {
  name: string;
  hex: string;
}

export const SECTION_BG_PRESETS: ColorPreset[] = [
  { name: "Lavender", hex: "#f3e8ff" },
  { name: "Soft Cream", hex: "#f7f4ef" },
  { name: "Pure White", hex: "#ffffff" },
  { name: "Soft Gold", hex: "#fdf8eb" },
  { name: "Rose Blush", hex: "#fbeef1" },
  { name: "Sage Green", hex: "#e8f0ec" },
  { name: "Sky Mist", hex: "#e8f1f7" },
  { name: "Peach Cream", hex: "#fdece0" },
  { name: "Warm Sand", hex: "#f0e6d8" },
  { name: "Pale Lilac", hex: "#e3ceff" },
  { name: "Dark Luxury", hex: "#2c2520" },
  { name: "Midnight Olive", hex: "#1f241d" },
  { name: "Deep Plum", hex: "#3c2946" },
  { name: "Espresso", hex: "#3b2a20" },
  { name: "Charcoal", hex: "#242424" },
];

export const SECTION_TEXT_PRESETS: ColorPreset[] = [
  { name: "Earth Dark", hex: "#2c2520" },
  { name: "Accent Gold", hex: "#c5a059" },
  { name: "Pure White", hex: "#ffffff" },
  { name: "Muted Earth", hex: "#5c4a3d" },
  { name: "Charcoal", hex: "#333333" },
  { name: "Deep Plum", hex: "#3c2946" },
  { name: "Soft Lavender", hex: "#d6b3fc" },
  { name: "Rose", hex: "#c76b7a" },
  { name: "Forest", hex: "#3f5b45" },
  { name: "Slate Blue", hex: "#4a5a72" },
];

export const OVERLAY_TEXT_PRESETS: ColorPreset[] = [
  { name: "Pure White", hex: "#ffffff" },
  { name: "Ivory", hex: "#faf6ef" },
  { name: "Soft Gold", hex: "#e9d3a3" },
  { name: "Pale Lilac", hex: "#e3ceff" },
  { name: "Earth Dark", hex: "#2c2520" },
  { name: "Deep Plum", hex: "#3c2946" },
  { name: "Charcoal", hex: "#1a1a1a" },
];

export const OVERLAY_BUTTON_BG_PRESETS: ColorPreset[] = [
  { name: "Earth Dark", hex: "#2c2520" },
  { name: "Deep Plum", hex: "#3c2946" },
  { name: "Accent Gold", hex: "#c5a059" },
  { name: "Pure White", hex: "#ffffff" },
  { name: "Soft Lavender", hex: "#d6b3fc" },
  { name: "Charcoal", hex: "#1a1a1a" },
  { name: "Rose", hex: "#a85361" },
];

export const OVERLAY_BUTTON_TEXT_PRESETS: ColorPreset[] = [
  { name: "Pure White", hex: "#ffffff" },
  { name: "Earth Dark", hex: "#2c2520" },
  { name: "Ivory", hex: "#faf6ef" },
  { name: "Charcoal", hex: "#1a1a1a" },
];
