/**
 * Detects whether HTML5 canvas can encode to AVIF in the current browser environment
 */
let _supportsAvifCanvas: boolean | null = null;
export function isAvifCanvasSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (_supportsAvifCanvas !== null) return _supportsAvifCanvas;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const data = c.toDataURL("image/avif");
    _supportsAvifCanvas = typeof data === "string" && data.startsWith("data:image/avif");
  } catch {
    _supportsAvifCanvas = false;
  }
  return _supportsAvifCanvas;
}

/**
 * Detects whether HTML5 canvas can encode to WebP in the current browser environment
 */
let _supportsWebpCanvas: boolean | null = null;
export function isWebpCanvasSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (_supportsWebpCanvas !== null) return _supportsWebpCanvas;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const data = c.toDataURL("image/webp");
    _supportsWebpCanvas = typeof data === "string" && data.startsWith("data:image/webp");
  } catch {
    _supportsWebpCanvas = false;
  }
  return _supportsWebpCanvas;
}

/**
 * Reads a File directly as a base64 Data URL with zero quality loss or re-compression.
 * Use this when the user chooses to avoid compression, or when the image is already compressed.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error("FileReader failed to read file: " + (reader.error?.message || "Unknown error")));
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts format ('avif', 'webp', 'jpg', 'png', etc.) from a data URL string.
 */
export function getFormatFromDataUrl(dataUrl: string): string {
  if (!dataUrl) return "jpg";
  const match = dataUrl.match(/^data:image\/([\w\+\-]+);base64,/i);
  if (match) {
    const raw = match[1].toLowerCase();
    if (raw === "jpeg") return "jpg";
    return raw;
  }
  return "jpg";
}

/**
 * Adjusts a filename's extension to match the target image format (e.g. '.avif').
 */
export function replaceExtensionForFormat(filename: string, format: string): string {
  if (!filename) return `image.${format || "avif"}`;
  const lastDot = filename.lastIndexOf(".");
  const base = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
  const ext = format === "jpeg" ? "jpg" : (format || "avif").toLowerCase();
  return `${base}.${ext}`;
}

/**
 * Checks if a given file is already an ultra-compact next-gen image (AVIF or WebP).
 */
export function isAlreadyCompressedFormat(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type === "image/avif" ||
    name.endsWith(".avif") ||
    type === "image/webp" ||
    name.endsWith(".webp")
  );
}

/**
/**
 * Compresses an image to ultra-compact AVIF format (with WebP / JPEG fallback if browser canvas lacks AVIF encoding).
 * Maintains full backwards compatibility with signature: compressImage(file, maxWidth, maxHeight, quality).
 */
export const compressImage = (
  file: File,
  maxWidth = 1500,
  maxHeight = 1500,
  quality = 0.8
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // If the file is already an AVIF image, preserve it directly without re-compression loss
    const isAvif = file.type === "image/avif" || file.name.toLowerCase().endsWith(".avif");
    if (isAvif && file.size < 5 * 1024 * 1024) {
      readFileAsDataUrl(file).then(resolve).catch(reject);
      return;
    }

    // Skip vector SVGs and animated GIFs
    if (file.type === "image/svg+xml" || file.type === "image/gif") {
      readFileAsDataUrl(file).then(resolve).catch(reject);
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const originalDataUrl = event.target?.result as string;
      const img = new Image();
      img.src = originalDataUrl;

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          console.warn("Canvas 2D context not supported, falling back to original base64");
          resolve(originalDataUrl);
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        let compressedBase64 = "";

        // 1. Primary: Encode directly to ultra-compact next-gen AVIF
        if (isAvifCanvasSupported()) {
          try {
            const avifData = canvas.toDataURL("image/avif", quality);
            if (avifData && avifData.startsWith("data:image/avif")) {
              compressedBase64 = avifData;
            }
          } catch (e) {
            console.warn("Canvas toDataURL('image/avif') error:", e);
          }
        }

        // 2. Secondary fallback: WebP (widely supported modern format)
        if (!compressedBase64 && isWebpCanvasSupported()) {
          try {
            const webpData = canvas.toDataURL("image/webp", quality);
            if (webpData && webpData.startsWith("data:image/webp")) {
              compressedBase64 = webpData;
            }
          } catch (e) {
            console.warn("Canvas toDataURL('image/webp') error:", e);
          }
        }

        // 3. Final fallback: standard JPEG
        if (!compressedBase64) {
          try {
            compressedBase64 = canvas.toDataURL("image/jpeg", quality);
          } catch (e) {
            console.warn("Canvas toDataURL('image/jpeg') fallback error:", e);
            compressedBase64 = originalDataUrl;
          }
        }

        resolve(compressedBase64);
      };

      img.onerror = (err) => {
        console.warn("Image loading error for compression, falling back to original base64", err);
        resolve(originalDataUrl);
      };
    };

    reader.onerror = (err) => {
      console.error("FileReader error", err, reader.error);
      reject(new Error("FileReader failed to read the file: " + (reader.error?.message || "Unknown error")));
    };
  });
};

const optimizedUrlCache = new Map<string, string>();
const MAX_URL_CACHE_SIZE = 1000;

/**
 * Transforms image URLs (especially Cloudinary & Unsplash) for high-performance loading
 * - 'eco': Uses high compression (q_auto:eco,f_auto) for section previews, thumbnails, and cards
 * - 'full': Uses high quality / full resolution for zoomed lightboxes & full-screen modals
 */
export function getOptimizedImageUrl(
  url: string | undefined | null,
  mode: 'eco' | 'full' = 'eco',
  width?: number
): string | undefined {
  if (!url) return undefined;
  if (typeof url !== 'string') return url;

  // Skip base64 data URLs
  if (url.startsWith('data:')) return url;

  const cacheKey = `${mode}:${width || 0}:${url}`;
  const cached = optimizedUrlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result = url;

  // Cloudinary URL transformation
  if (url.includes('cloudinary.com') || url.includes('/upload/')) {
    const transformation = mode === 'eco'
      ? `f_auto,q_auto:eco${width ? `,w_${width}` : ''}`
      : `f_auto,q_auto:best`;

    if (url.includes('/upload/')) {
      // Check if transformation string is already present
      if (url.includes('q_auto:') || url.includes('f_auto')) {
        result = url
          .replace(/q_auto:(eco|low|good|best)/g, mode === 'eco' ? 'q_auto:eco' : 'q_auto:best')
          .replace(/f_auto/g, 'f_auto');
      } else {
        result = url.replace('/upload/', `/upload/${transformation}/`);
      }
    }
  } else if (url.includes('images.unsplash.com')) {
    // Unsplash URL transformation
    try {
      const urlObj = new URL(url);
      if (mode === 'eco') {
        urlObj.searchParams.set('q', '60');
        urlObj.searchParams.set('auto', 'format');
        if (width) urlObj.searchParams.set('w', width.toString());
      } else {
        urlObj.searchParams.set('q', '90');
        urlObj.searchParams.set('auto', 'format');
      }
      result = urlObj.toString();
    } catch {
      result = url;
    }
  } else if (url.includes('drive.google.com') || url.includes('googleusercontent.com')) {
    // Google Drive URL transformation (converts view/share links into direct image CDN URLs)
    const fileIdMatch =
      url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
      url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      result = `https://lh3.googleusercontent.com/d/${fileIdMatch[1]}`;
    }
  }

  if (optimizedUrlCache.size >= MAX_URL_CACHE_SIZE) {
    optimizedUrlCache.clear();
  }
  optimizedUrlCache.set(cacheKey, result);
  return result;
}

