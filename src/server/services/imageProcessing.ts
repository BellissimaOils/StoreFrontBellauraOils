import { uploadToR2 } from "../utils/r2Client";

/**
 * Allowed MIME image types for customer reviews.
 * Executable, SVG, HTML, or unknown types are strictly forbidden.
 */
const ALLOWED_IMAGE_TYPES = ["jpeg", "jpg", "png", "webp", "gif", "avif"];

/**
 * Maximum allowed decoded image buffer size (5MB per image).
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function createImageProcessingService() {
  /**
   * Securely validates and uploads a base64 customer review image to Cloudflare R2.
   *
   * Security constraints:
   * 1. Subfolder is hardcoded/restricted to "Reviews" (yielding R2 key: Images/Reviews/...).
   * 2. Validates base64 data-URL structure and rejects non-image formats.
   * 3. Enforces a 5MB decoded buffer size ceiling per image.
   * 4. Sanitizes and generates the final object filename server-side.
   * 5. Prevents any path traversal or arbitrary directory writing.
   */
  const processBase64Image = async (
    imageStr?: string,
    explicitlyPassedFilename?: string,
    _subFolder?: string, // Ignored: Storefront strictly forces "Reviews"
  ): Promise<string | null> => {
    if (!imageStr || typeof imageStr !== "string" || !imageStr.startsWith("data:image/")) {
      return null;
    }

    try {
      const match = imageStr.match(/^data:image\/([\w\+\-]+);base64,(.+)$/);
      if (!match) {
        console.warn("[Review Image Rejected] Malformed base64 image data URL");
        return null;
      }

      const rawExt = match[1].toLowerCase();
      const ext = rawExt === "jpg" ? "jpeg" : rawExt;

      if (!ALLOWED_IMAGE_TYPES.includes(ext)) {
        console.warn(`[Review Image Rejected] Disallowed image type: ${ext}`);
        return null;
      }

      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, "base64");

      if (buffer.length > MAX_IMAGE_BYTES) {
        console.warn(
          `[Review Image Rejected] Decoded image exceeds size limit (${buffer.length} bytes > ${MAX_IMAGE_BYTES} bytes)`,
        );
        return null;
      }

      // Generate sanitized server-side filename
      let baseName = `review_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      if (explicitlyPassedFilename) {
        // Strip any directory traversal characters and keep only alphanumeric/safe symbols
        baseName = explicitlyPassedFilename
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9_\-]/g, "_")
          .substring(0, 100);
      }
      const filename = `${baseName}.${ext}`;

      // Upload strictly to "Reviews" subfolder (path becomes: Images/Reviews/${filename})
      const r2Url = await uploadToR2(
        buffer,
        filename,
        `image/${ext}`,
        "Reviews",
      );

      if (r2Url) {
        console.log(`[Review Image Upload] Successfully stored review picture in R2: ${r2Url}`);
        return r2Url;
      } else {
        console.warn(
          `[Review Image Upload] uploadToR2 returned null for ${filename} (R2 credentials may not be configured in environment)`,
        );
        return null;
      }
    } catch (err: any) {
      console.error("[Review Image Upload Error] Failed to process review image:", err?.message || err);
      return null;
    }
  };

  return { processBase64Image };
}
