import express from "express";
import rateLimit from "express-rate-limit";
import { ensureD1AnalyticsTablesExist } from "../services/d1Client";

/**
 * Rate limiter for POST /api/analytics/collect:
 * Allows up to 120 requests / minute per IP.
 * Accommodates active browsing sessions, multi-tabs, and shared mobile carrier CGNATs.
 */
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many tracking events. Throttled." },
});

const ALLOWED_EVENT_NAMES = new Set([
  "session_start",
  "page_view",
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "cart_view",
  "checkout_start",
  "purchase_complete",
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AnalyticsState {
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
}

export function createAnalyticsRouter(state: AnalyticsState) {
  const router = express.Router();

  router.post("/analytics/collect", analyticsLimiter, async (req, res) => {
    try {
      const { visitorId, sessionId, source, firstTouchSource, landingPage, utms, events } = req.body;

      // 1. Strict UUID & structure validation
      if (
        !visitorId ||
        typeof visitorId !== "string" ||
        !UUID_REGEX.test(visitorId.trim()) ||
        !sessionId ||
        typeof sessionId !== "string" ||
        !UUID_REGEX.test(sessionId.trim())
      ) {
        return res.status(400).json({ success: false, message: "Invalid visitor or session identifier." });
      }

      if (!Array.isArray(events) || events.length === 0 || events.length > 10) {
        return res.status(400).json({ success: false, message: "Events batch must be an array of 1 to 10 events." });
      }

      // 2. Coarse Geolocation detection from Vercel / Cloudflare headers (NO raw IP storage)
      const rawCountry = req.headers["x-vercel-ip-country"] || req.headers["cf-ipcountry"];
      const rawCity = req.headers["x-vercel-ip-city"] || req.headers["cf-ipcity"];

      const country =
        typeof rawCountry === "string" && rawCountry.trim() && rawCountry !== "XX"
          ? rawCountry.trim().toUpperCase().substring(0, 5)
          : null;

      let city: string | null = null;
      if (typeof rawCity === "string" && rawCity.trim()) {
        try {
          city = decodeURIComponent(rawCity.trim()).substring(0, 100);
        } catch {
          city = rawCity.trim().substring(0, 100);
        }
      }

      const validVisitorId = visitorId.trim();
      const validSessionId = sessionId.trim();
      const validSource = typeof source === "string" ? source.trim().substring(0, 50) || "Direct" : "Direct";
      const validFirstTouch =
        typeof firstTouchSource === "string" ? firstTouchSource.trim().substring(0, 50) || "Direct" : "Direct";
      const validLanding = typeof landingPage === "string" ? landingPage.trim().substring(0, 255) : "/";

      const utmObj = typeof utms === "object" && utms !== null ? utms : {};
      const utmSource = typeof utmObj.utm_source === "string" ? utmObj.utm_source.trim().substring(0, 50) : null;
      const utmMedium = typeof utmObj.utm_medium === "string" ? utmObj.utm_medium.trim().substring(0, 50) : null;
      const utmCampaign = typeof utmObj.utm_campaign === "string" ? utmObj.utm_campaign.trim().substring(0, 100) : null;
      const utmContent = typeof utmObj.utm_content === "string" ? utmObj.utm_content.trim().substring(0, 100) : null;
      const utmTerm = typeof utmObj.utm_term === "string" ? utmObj.utm_term.trim().substring(0, 100) : null;

      const nowIso = new Date().toISOString();

      // Ensure D1 schema tables exist
      await ensureD1AnalyticsTablesExist();

      // 3. Upsert visitor
      const visitorSql = `INSERT INTO analytics_visitors (
        id, first_touch_source, first_landing_page, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at;`;
      await state.executeD1Query(visitorSql, [
        validVisitorId,
        validFirstTouch,
        validLanding,
        nowIso,
        nowIso,
      ]);

      // 4. Upsert session
      const sessionSql = `INSERT INTO analytics_sessions (
        id, visitor_id, landing_page, referrer, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, city, started_at, ended_at, duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = excluded.ended_at;`;
      await state.executeD1Query(sessionSql, [
        validSessionId,
        validVisitorId,
        validLanding,
        null,
        validSource,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        country,
        city,
        nowIso,
        nowIso,
      ]);

      // 5. Insert events with strict item validation
      for (const ev of events) {
        if (!ev || typeof ev !== "object") continue;

        const eventName = typeof ev.eventName === "string" ? ev.eventName.trim() : "";
        if (!ALLOWED_EVENT_NAMES.has(eventName)) continue;

        const eventPath = typeof ev.path === "string" ? ev.path.trim().substring(0, 255) : null;
        const productId = typeof ev.productId === "string" || typeof ev.productId === "number" ? String(ev.productId).substring(0, 100) : null;
        const productName = typeof ev.productName === "string" ? ev.productName.trim().substring(0, 150) : null;
        const quantity = Number.isInteger(Number(ev.quantity)) ? Math.max(1, Math.min(100, Number(ev.quantity))) : null;
        const unitPrice = Number.isFinite(Number(ev.unitPrice)) ? Math.max(0, Number(ev.unitPrice)) : null;
        const activeDurationMs = Number.isInteger(Number(ev.activeDurationMs)) ? Math.max(0, Math.min(1800000, Number(ev.activeDurationMs))) : 0;
        
        let metadataStr: string | null = null;
        if (ev.metadata && typeof ev.metadata === "object") {
          try {
            const raw = JSON.stringify(ev.metadata);
            if (raw.length <= 1024) metadataStr = raw;
          } catch {}
        }

        const createdAt = typeof ev.createdAt === "string" ? ev.createdAt.substring(0, 35) : nowIso;

        const insertEventSql = `INSERT INTO analytics_events (
          session_id, visitor_id, event_name, path, product_id, product_name, quantity, unit_price, active_duration_ms, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

        await state.executeD1Query(insertEventSql, [
          validSessionId,
          validVisitorId,
          eventName,
          eventPath,
          productId,
          productName,
          quantity,
          unitPrice,
          activeDurationMs,
          metadataStr,
          createdAt,
        ]);
      }

      return res.status(200).json({ success: true, processed: events.length });
    } catch (err) {
      console.error("[Analytics Intake Error]", err);
      // Non-blocking fail-open response
      return res.status(200).json({ success: false, error: "Internal error" });
    }
  });

  return router;
}
