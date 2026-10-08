import dotenv from "dotenv";
dotenv.config();

function cleanEnv(val: string | undefined): string {
  if (!val) return "";
  let s = String(val).trim();
  // Remove surrounding single or double quotes if present
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Normalizes environment variables for the Public Storefront.
 * Strips whitespace, surrounding quotes, and supports standard aliases.
 */
export function normalizeEnv() {
  // 1. Cloudflare D1 Database
  process.env.CLOUDFLARE_D1_API_TOKEN = cleanEnv(
    process.env.CLOUDFLARE_D1_API_TOKEN ||
    process.env.CLOUDFLARE_D1_TOKEN ||
    process.env.D1_API_TOKEN ||
    process.env.D1_TOKEN ||
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CLOUDFLARE_TOKEN
  );

  process.env.CLOUDFLARE_D1_ACCOUNT_ID = cleanEnv(
    process.env.CLOUDFLARE_D1_ACCOUNT_ID ||
    process.env.D1_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.ACCOUNT_ID
  );

  process.env.CLOUDFLARE_D1_DATABASE_ID = cleanEnv(
    process.env.CLOUDFLARE_D1_DATABASE_ID ||
    process.env.D1_DATABASE_ID ||
    process.env.DATABASE_ID
  );

  // 2. Telegram Order Alerts (Server-side only)
  process.env.TELEGRAM_BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
  process.env.TELEGRAM_CHAT_ID = cleanEnv(process.env.TELEGRAM_CHAT_ID);

  // 3. Cloudflare R2 Storage (Customer Review Images)
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = cleanEnv(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID
  );
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = cleanEnv(
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID
  );
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = cleanEnv(
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY
  );
  process.env.CLOUDFLARE_R2_BUCKET_NAME = cleanEnv(
    process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME
  );
  process.env.CLOUDFLARE_R2_PUBLIC_URL = cleanEnv(
    process.env.CLOUDFLARE_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL
  );

  // 4. Store URL & Server configuration
  let rawStoreUrl = cleanEnv(process.env.STORE_URL || process.env.VITE_STORE_URL);
  if (rawStoreUrl) {
    rawStoreUrl = rawStoreUrl.replace(/\/+$/, "");
    if (!rawStoreUrl.startsWith("http://") && !rawStoreUrl.startsWith("https://")) {
      rawStoreUrl = `https://${rawStoreUrl}`;
    }
  }
  process.env.STORE_URL = rawStoreUrl || "https://www.bellauraoils.com";

  if (process.env.PORT) {
    process.env.PORT = cleanEnv(process.env.PORT);
  }
}

// Execute immediately when imported
normalizeEnv();
