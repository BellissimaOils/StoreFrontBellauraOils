import express from "express";
import { authenticateAdmin } from "../middleware/auth";
import { sanitizeCredentials } from "../utils/sqlUtils";

/**
 * The FAQ, in its own `faq` table.
 *
 * It used to live inside website_info.json_data — the single-row blob that
 * holds every site setting — as a key called `faqItems` whose value was itself
 * a JSON *string*, so the questions were double-encoded inside another JSON
 * document. That made them invisible to anyone looking for them in the database
 * (there was no faq table and no faq column to find), impossible to query, and
 * it meant every FAQ save rewrote the entire settings blob.
 *
 * This module owns the table, reads it for the public page, and writes it from
 * the admin editor. Anything still sitting in the old blob is imported once, on
 * first use, so nothing is lost in the move.
 */

interface FaqState {
  /** Only used to find rows left behind in the legacy settings blob. */
  getStoreSettings: () => any;
}

/** Shape sent to and accepted from the client. */
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

/** Cloudflare caps a single query at 100 bound parameters. */
const ID_CHUNK_SIZE = 50;

/** Guard against a runaway payload; the editor is a hand-maintained list. */
const MAX_ITEMS = 200;

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

/** Runs one statement. Returns rows, or throws with D1's own message. */
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

/**
 * Reads the questions that are still in the old settings blob.
 *
 * The legacy value was a JSON string (occasionally already an array, depending
 * on how it was written) using camelCase keys: qAr / aAr / qEn / aEn. There was
 * never a French pair.
 */
function parseLegacyFaqItems(raw: any): FaqRow[] {
  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      question_ar: str(item.qAr),
      answer_ar: str(item.aAr),
      question_en: str(item.qEn),
      answer_en: str(item.aEn),
      question_fr: "",
      answer_fr: "",
      order_index: index,
    }))
    // A blank row in the blob is noise, not content.
    .filter((row) => row.question_ar.trim() || row.question_en.trim());
}

export function createFaqRouter(state: FaqState) {
  const router = express.Router();

  // Per-instance latch. The schema check and the legacy import only need to
  // happen once per cold start, not on every request.
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

    // Carry across anything still in the old blob, once. Only when the table is
    // empty, so this cannot overwrite questions that have since been edited.
    const countRows = await runSql(`SELECT COUNT(*) AS n FROM faq;`);
    const existing = Number(countRows?.[0]?.n ?? 0);
    if (existing === 0) {
      const legacy = parseLegacyFaqItems(state.getStoreSettings()?.faqItems);
      if (legacy.length > 0) {
        for (const [index, row] of legacy.entries()) {
          // Explicit id + INSERT OR IGNORE: if two cold instances happen to run
          // this import at the same moment, the second one collides on the
          // primary key and is ignored rather than duplicating every question.
          await runSql(
            `INSERT OR IGNORE INTO faq
               (id, question_ar, answer_ar, question_en, answer_en, question_fr, answer_fr, order_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              index + 1,
              row.question_ar,
              row.answer_ar,
              row.question_en,
              row.answer_en,
              row.question_fr,
              row.answer_fr,
              index,
            ],
          );
        }
        console.log(
          `[faq] Imported ${legacy.length} question(s) from the legacy website_info settings blob into the faq table.`,
        );
      }
    }

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

  // Public: the questions the FAQ page renders.
  router.get("/faq", async (_req, res) => {
    // Short shared cache, matching /api/products, so an edit shows up quickly
    // without every visitor hitting D1.
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    try {
      await ensureFaqTable();
      res.json({ success: true, items: await readFaq() });
    } catch (err: any) {
      // A storefront page must not break because the FAQ could not be read.
      // An empty list renders the page's "no questions yet" state.
      console.error("[faq] public read failed:", err?.message || err);
      res.json({ success: true, items: [] });
    }
  });

  // Admin: the editor's copy. Never cached — the admin must see what is stored.
  router.get("/admin/faq", authenticateAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await ensureFaqTable();
      res.json({ success: true, items: await readFaq() });
    } catch (err: any) {
      console.error("[faq] admin read failed:", err?.message || err);
      res.status(500).json({
        success: false,
        message: `Could not read the FAQ: ${err?.message || "unknown error"}`,
      });
    }
  });

  // Admin: replace the list.
  //
  // Rows are matched by id and updated in place, new rows are inserted, and
  // only ids the editor no longer holds are deleted. Deliberately not
  // "DELETE everything then re-INSERT": that leaves the table empty if the
  // inserts fail halfway, which would destroy the FAQ on a transient error.
  router.put("/admin/faq", authenticateAdmin, async (req, res) => {
    try {
      const incoming = req.body?.items;
      if (!Array.isArray(incoming)) {
        return res.status(400).json({ success: false, message: "items must be an array" });
      }
      if (incoming.length > MAX_ITEMS) {
        return res.status(400).json({
          success: false,
          message: `Too many questions in one save (${incoming.length}); the limit is ${MAX_ITEMS}.`,
        });
      }

      await ensureFaqTable();

      // Drop rows with no question in either language: they are half-finished
      // editor rows, and storing them would make the public page skip them
      // anyway.
      const items: FaqRow[] = incoming
        .filter((item: any) => item && typeof item === "object")
        .map((item: any) => ({
          id: Number.isInteger(Number(item.id)) && Number(item.id) > 0 ? Number(item.id) : undefined,
          question_ar: str(item.question_ar),
          answer_ar: str(item.answer_ar),
          question_en: str(item.question_en),
          answer_en: str(item.answer_en),
          question_fr: str(item.question_fr),
          answer_fr: str(item.answer_fr),
        }))
        .filter(
          (row) =>
            row.question_ar.trim() ||
            row.question_en.trim() ||
            row.question_fr.trim(),
        );

      const existingRows = await runSql(`SELECT id FROM faq;`);
      const existingIds = new Set(existingRows.map((r: any) => Number(r.id)));

      const keptIds = new Set<number>();
      let updated = 0;
      let inserted = 0;

      // order_index is the position in the array the editor sent, so the
      // editor's up/down arrows are what defines the order on the page.
      for (const [index, row] of items.entries()) {
        if (row.id !== undefined && existingIds.has(row.id)) {
          await runSql(
            `UPDATE faq
                SET question_ar = ?, answer_ar = ?,
                    question_en = ?, answer_en = ?,
                    question_fr = ?, answer_fr = ?,
                    order_index = ?
              WHERE id = ?;`,
            [
              row.question_ar,
              row.answer_ar,
              row.question_en,
              row.answer_en,
              row.question_fr,
              row.answer_fr,
              index,
              row.id,
            ],
          );
          keptIds.add(row.id);
          updated++;
        } else {
          await runSql(
            `INSERT INTO faq
               (question_ar, answer_ar, question_en, answer_en, question_fr, answer_fr, order_index)
             VALUES (?, ?, ?, ?, ?, ?, ?);`,
            [
              row.question_ar,
              row.answer_ar,
              row.question_en,
              row.answer_en,
              row.question_fr,
              row.answer_fr,
              index,
            ],
          );
          inserted++;
        }
      }

      // Anything that was in the table but is not in this payload was removed
      // in the editor.
      const removedIds = [...existingIds].filter((id) => !keptIds.has(id));
      for (let i = 0; i < removedIds.length; i += ID_CHUNK_SIZE) {
        const group = removedIds.slice(i, i + ID_CHUNK_SIZE);
        const placeholders = group.map(() => "?").join(", ");
        await runSql(`DELETE FROM faq WHERE id IN (${placeholders});`, group);
      }

      // Return the stored rows so the editor picks up the ids of anything it
      // just created; without this a second save would insert duplicates
      // instead of updating what it had added.
      const stored = await readFaq();
      res.json({
        success: true,
        items: stored,
        updated,
        inserted,
        deleted: removedIds.length,
      });
    } catch (err: any) {
      console.error("[faq] save failed:", err?.message || err);
      res.status(500).json({
        success: false,
        message: `Failed to save the FAQ: ${err?.message || "unknown error"}`,
      });
    }
  });

  return router;
}
