/**
 * Bot & Crawler Classifier for Bellaura Oils Storefront
 *
 * Temporarily inspects User-Agent string to classify incoming traffic into:
 *   - traffic_type: 'human' | 'bot' | 'unknown'
 *   - bot_name: string | null (e.g. 'Googlebot', 'Bingbot', 'TikTokBot', 'FacebookBot', 'Other')
 *
 * PRIVACY RULE:
 *   The raw User-Agent string is NEVER stored in database or analytics tables.
 *   Only the normalized classification (traffic_type, bot_name) is preserved.
 */

export interface BotClassification {
  trafficType: "human" | "bot" | "unknown";
  botName: string | null;
}

const KNOWN_BOT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Search engines & SEO indexers
  { name: "Googlebot", pattern: /googlebot|google-inspectiontool|adsbot-google|mediapartners-google/i },
  { name: "Bingbot", pattern: /bingbot|msnbot|bingpreview/i },
  { name: "YandexBot", pattern: /yandexbot|yandeximages/i },
  { name: "Baiduspider", pattern: /baiduspider/i },
  { name: "DuckDuckBot", pattern: /duckduckbot/i },
  { name: "Applebot", pattern: /applebot/i },
  { name: "Amazonbot", pattern: /amazonbot/i },

  // Social crawlers & link unfurlers
  { name: "TikTokBot", pattern: /bytespider|tiktokbot|tiktok/i },
  { name: "FacebookBot", pattern: /facebookexternalhit|meta-externalagent|facebot/i },
  { name: "TwitterBot", pattern: /twitterbot/i },
  { name: "LinkedInBot", pattern: /linkedinbot/i },
  { name: "WhatsApp", pattern: /whatsapp/i },
  { name: "TelegramBot", pattern: /telegrambot/i },
  { name: "PinterestBot", pattern: /pinterest/i },

  // SEO & Auditing bots
  { name: "AhrefsBot", pattern: /ahrefsbot/i },
  { name: "SemrushBot", pattern: /semrushbot/i },
  { name: "DotBot", pattern: /dotbot/i },
  { name: "MJ12bot", pattern: /mj12bot/i },

  // Automated tools, scrapers, headless browsers
  { name: "PythonRequests", pattern: /python-requests/i },
  { name: "Curl", pattern: /^curl\//i },
  {
    name: "Other",
    pattern:
      /curl|wget|go-http-client|postman|axios|httpclient|java|php|scrapy|mechanize|headlesschrome|phantomjs|puppeteer|playwright|selenium|bot|crawler|spider|slurp|archiver|scraper/i,
  },
];

export function classifyUserAgent(userAgent: string | undefined | null): BotClassification {
  if (!userAgent || typeof userAgent !== "string" || userAgent.trim().length === 0) {
    return {
      trafficType: "unknown",
      botName: null,
    };
  }

  const ua = userAgent.trim();

  // 1. Check known bots
  for (const { name, pattern } of KNOWN_BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        trafficType: "bot",
        botName: name,
      };
    }
  }

  // 2. Typical human browser patterns
  // Standard desktop and mobile browsers include Mozilla/5.0 and at least one standard browser token
  const hasMozilla = ua.includes("Mozilla/5.0");
  const hasBrowserEngine =
    ua.includes("Chrome/") ||
    ua.includes("Safari/") ||
    ua.includes("Firefox/") ||
    ua.includes("Edg/") ||
    ua.includes("OPR/") ||
    ua.includes("Mobile/") ||
    ua.includes("AppleWebKit") ||
    ua.includes("Gecko/");

  if (hasMozilla && hasBrowserEngine) {
    return {
      trafficType: "human",
      botName: null,
    };
  }

  // 3. Fallback for non-standard / obscure clients
  return {
    trafficType: "unknown",
    botName: null,
  };
}
