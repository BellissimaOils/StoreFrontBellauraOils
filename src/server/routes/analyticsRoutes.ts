import express from "express";
import rateLimit from "express-rate-limit";
import { ensureD1AnalyticsTablesExist } from "../services/d1Client";
import { classifyUserAgent } from "../utils/botDetector";

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

export const ALLOWED_EVENT_NAMES = new Set([
  "session_start",
  "page_view",
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "cart_view",
  "checkout_start",
  "checkout_form_start",
  "checkout_submit",
  "checkout_submit_failed",
  "order_confirmed",
  "purchase_complete",
  "search",
  "scroll",
  "time_on_page",
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AnalyticsState {
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
}

export function createAnalyticsRouter(state: AnalyticsState) {
  const router = express.Router();
  let schemaReady: Promise<boolean> | null = null;

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

      if (!Array.isArray(events) || events.length === 0 || events.length > 20) {
        return res.status(400).json({ success: false, message: "Events batch must be an array of 1 to 20 events." });
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

      // 3. Bot & Traffic Classification from User-Agent (Heuristic, NO raw UA storage)
      const rawUserAgent = req.headers["user-agent"];
      const { trafficType, botName } = classifyUserAgent(
        typeof rawUserAgent === "string" ? rawUserAgent : undefined
      );

      const validVisitorId = visitorId.trim();
      const validSessionId = sessionId.trim();
      const validSource = typeof source === "string" ? source.trim().substring(0, 50) || "Direct" : "Direct";
      const validFirstTouch =
        typeof firstTouchSource === "string" ? firstTouchSource.trim().substring(0, 50) || "Direct" : "Direct";
      const validLanding = typeof landingPage === "string" && landingPage.trim().startsWith("/")
        ? landingPage.trim().replace(/[\u0000-\u001f]/g, "").substring(0, 255)
        : "/";

      const utmObj = typeof utms === "object" && utms !== null ? utms : {};
      const utmSource = typeof utmObj.utm_source === "string" ? utmObj.utm_source.trim().substring(0, 50) : null;
      const utmMedium = typeof utmObj.utm_medium === "string" ? utmObj.utm_medium.trim().substring(0, 50) : null;
      const utmCampaign = typeof utmObj.utm_campaign === "string" ? utmObj.utm_campaign.trim().substring(0, 100) : null;
      const utmContent = typeof utmObj.utm_content === "string" ? utmObj.utm_content.trim().substring(0, 100) : null;
      const utmTerm = typeof utmObj.utm_term === "string" ? utmObj.utm_term.trim().substring(0, 100) : null;

      const nowIso = new Date().toISOString();

      // Ensure D1 schema tables exist
      schemaReady ??= ensureD1AnalyticsTablesExist();
      if (!(await schemaReady)) schemaReady = null;

      // 4. Upsert visitor
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

      // 5. Upsert session with bot classification
      const sessionStart = events.find((ev: any) => ev?.eventName === "session_start");
      const sessionMetadata = sessionStart?.metadata && typeof sessionStart.metadata === "object" ? sessionStart.metadata : {};
      const sessionReferrer = typeof sessionMetadata.referrer === "string"
        ? sessionMetadata.referrer.trim().substring(0, 200)
        : null;

      const sessionSql = `INSERT INTO analytics_sessions (
        id, visitor_id, landing_page, referrer, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, city, traffic_type, bot_name, started_at, ended_at, duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = excluded.ended_at;`;
      await state.executeD1Query(sessionSql, [
        validSessionId,
        validVisitorId,
        validLanding,
        sessionReferrer,
        validSource,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        country,
        city,
        trafficType,
        botName,
        nowIso,
      ]);

      // 6. Insert events with strict normalization and safety
      let processed = 0;
      for (const ev of events) {
        if (!ev || typeof ev !== "object") continue;

        const eventName = typeof ev.eventName === "string" ? ev.eventName.trim() : "";
        if (!ALLOWED_EVENT_NAMES.has(eventName)) continue;

        const eventPath = typeof ev.path === "string" && ev.path.trim().startsWith("/")
          ? ev.path.trim().replace(/[\u0000-\u001f]/g, "").substring(0, 255)
          : null;
        const productId = typeof ev.productId === "string" || typeof ev.productId === "number" ? String(ev.productId).substring(0, 100) : null;
        const productName = typeof ev.productName === "string" ? ev.productName.trim().substring(0, 150) : null;
        const quantity = typeof ev.quantity === "number" && Number.isInteger(ev.quantity)
          ? Math.max(1, Math.min(7, ev.quantity)) // Enforce 1..7 bound
          : null;
        const unitPrice = typeof ev.unitPrice === "number" && Number.isFinite(ev.unitPrice)
          ? Math.max(0, ev.unitPrice)
          : null;
        const activeDurationMs = typeof ev.activeDurationMs === "number" && Number.isInteger(ev.activeDurationMs)
          ? Math.max(0, Math.min(1800000, ev.activeDurationMs))
          : 0;

        // Privacy filter on event metadata: NEVER allow personal info (phone, address, names, card numbers)
        let metadataStr: string | null = null;
        if (ev.metadata && typeof ev.metadata === "object") {
          try {
            const cleanMeta: Record<string, any> = {};
            const blockedKeys = new Set([
              "phone",
              "telephone",
              "address",
              "firstName",
              "lastName",
              "name",
              "email",
              "customer",
              "notes",
              "comment",
              "turnstileToken",
              "ip",
              "userAgent",
            ]);

            for (const [k, v] of Object.entries(ev.metadata)) {
              if (blockedKeys.has(k.toLowerCase())) continue;
              if (typeof v === "string") {
                cleanMeta[k] = v.substring(0, 100);
              } else if (typeof v === "number" || typeof v === "boolean") {
                cleanMeta[k] = v;
              }
            }
            const raw = JSON.stringify(cleanMeta);
            if (raw.length <= 1024) metadataStr = raw;
          } catch {}
        }

        const parsedCreatedAt = typeof ev.createdAt === "string" ? Date.parse(ev.createdAt) : NaN;
        const createdAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : nowIso;

        const insertEventSql = `INSERT INTO analytics_events (
          session_id, visitor_id, event_name, path, product_id, product_name, quantity, unit_price, active_duration_ms, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

        const inserted = await state.executeD1Query(insertEventSql, [
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
        if (inserted) processed += 1;
      }

      // Update session engagement duration safely
      await state.executeD1Query(
        `UPDATE analytics_sessions
         SET duration_seconds = CAST((
           SELECT COALESCE(SUM(active_duration_ms), 0) / 1000
           FROM analytics_events WHERE session_id = ?
         ) AS INTEGER)
         WHERE id = ?;`,
        [validSessionId, validSessionId],
      );

      return res.status(200).json({ success: true, processed });
    } catch (err) {
      console.error("[Analytics Intake Error]", err);
      // Non-blocking fail-open response
      return res.status(200).json({ success: false, error: "Internal error" });
    }
  });

  return router;
}
