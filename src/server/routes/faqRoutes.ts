import express from "express";
import { sanitizeCredentials } from "../utils/sqlUtils";

// FAQ routes for the Public Storefront.
// Only customer-facing GET /faq is exposed.
// Admin FAQ editing belongs strictly in the Admin Dashboard.

interface FaqState {
  getStoreSettings: () => any;
}

interface FaqRow {
  id?: number;
  question_ar: string;
  answer_ar: string;
  question_en: string;
  answer_en: string;
  question_fr: string;
  answer_fr: string;
  order_index?: number;
}

function d1Credentials() {
  const accountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
  const databaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
  const apiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);
  if (!accountId || !databaseId || !apiToken) return null;
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  };
}

async function runSql(sql: string, params: any[] = []): Promise<any[]> {
  const creds = d1Credentials();
  if (!creds) throw new Error("Cloudflare D1 is not configured on this deployment");
  const resp = await fetch(creds.url, {
    method: "POST",
    headers: creds.headers,
    body: JSON.stringify({ sql, params }),
  });
  if (!resp.ok) throw new Error(`D1 returned HTTP ${resp.status}`);
  const data: any = await resp.json();
  if (data && data.success === false) {
    throw new Error(
      (data.errors || []).map((e: any) => e.message).join("; ") || "D1 rejected the query",
    );
  }
  let rows = data.result?.[0]?.results || data.result?.results || [];
  if (!Array.isArray(rows) && Array.isArray(data.result)) rows = data.result;
  return Array.isArray(rows) ? rows : [];
}

const str = (v: any): string => (v === null || v === undefined ? "" : String(v));

export function createFaqRouter(_state: FaqState) {
  const router = express.Router();
  let ready = false;

  async function ensureFaqTable(): Promise<void> {
    if (ready) return;
    await runSql(
      `CREATE TABLE IF NOT EXISTS faq (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         question_ar TEXT DEFAULT '',
         answer_ar TEXT DEFAULT '',
         question_en TEXT DEFAULT '',
         answer_en TEXT DEFAULT '',
         question_fr TEXT DEFAULT '',
         answer_fr TEXT DEFAULT '',
         order_index INTEGER DEFAULT 0
       );`,
    );
    ready = true;
  }

  async function readFaq(): Promise<FaqRow[]> {
    const rows = await runSql(
      `SELECT id, question_ar, answer_ar, question_en, answer_en, question_fr, answer_fr, order_index
         FROM faq
        ORDER BY order_index ASC, id ASC;`,
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      question_ar: str(r.question_ar),
      answer_ar: str(r.answer_ar),
      question_en: str(r.question_en),
      answer_en: str(r.answer_en),
      question_fr: str(r.question_fr),
      answer_fr: str(r.answer_fr),
      order_index: Number(r.order_index ?? 0),
    }));
  }

  // Public: the questions the FAQ page renders
  router.get("/faq", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Vary", "Accept-Encoding");
    try {
      await ensureFaqTable();
      res.json({ success: true, items: await readFaq() });
    } catch (err: any) {
      console.error("[faq] public read failed:", err?.message || err);
      res.json({ success: true, items: [] });
    }
  });

  return router;
}
