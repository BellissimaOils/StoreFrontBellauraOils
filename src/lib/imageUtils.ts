export const compressImage = (file: File, maxWidth = 1024, maxHeight = 1024, quality = 0.8): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
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
          // If canvas fails, just return the uncompressed base64
          console.warn("Canvas not supported, falling back to original");
          resolve(event.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Convert to bas64 using jpeg to guarantee compression since png isn't lossy compressed with quality param
        const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => {
        console.warn("Image loading error for compression, falling back to original base64", err);
        resolve(event.target?.result as string);
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

