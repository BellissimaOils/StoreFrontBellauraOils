// Small, pure, stateless helpers used when talking to Cloudflare D1 over its
// HTTP query API. None of these depend on any shared in-memory app state
// (products/orders/storeSettings, etc.), so they're safe to import from
// anywhere without pulling in the rest of server.ts.

export function isMaskedValue(str: string | undefined): boolean {
  if (!str) return false;
  return (
    str.includes("•") ||
    str.includes("\u2022") ||
    str.includes("...") ||
    str.endsWith("...")
  );
}

export function sanitizeCredentials(str: string | undefined): string {
  if (!str) return "";
  // Strip non-ASCII characters, including the literal bullet points (•) and visual spaces
  return String(str)
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
}

/**
 * @deprecated Do not use this for new code, and do not reintroduce it at a call
 * site that was migrated away from it. Every SQL statement in this codebase now
 * passes its values through the `params` array that the D1 REST API accepts
 * (`{ sql, params }`) — see executeRealD1QueryIfConfigured. As of the SQL
 * hardening pass this function has no callers and is kept only so that any
 * out-of-tree import keeps compiling.
 *
 * Why params instead of this: escaping is only correct when the result is
 * placed inside a quoted string literal. The bug this pass fixed was a value
 * interpolated UNQUOTED (products.size_ml), where the quoting this function
 * adds would not have applied at all. A bound parameter is safe regardless of
 * position, which removes the need to reason about quoting per call site.
 *
 * NOTE: returns the unquoted SQL keyword NULL for null/undefined, not the
 * empty string "''" — those are not equivalent in SQL (one stores an actual
 * NULL, the other stores a zero-length string).
 */
export function escapeSqlString(str: string | undefined | null): string {
  if (str === null || str === undefined) return "NULL";
  return `'${String(str).replace(/'/g, "''")}'`;
}

export function logD1ExecutionDetails(sql: string, headers: any, extraMsg = "") {
  const isDebug = process.env.DEBUG_SQL === "true" || process.env.NODE_ENV === "development";
  if (!isDebug) return;

  console.log(`=== CLOUDFLARE D1 QUERY LOG ${extraMsg} ===`);
  console.log("Raw SQL Statement:", sql);

  const hasUnicode = /[^\x00-\x7F]/.test(sql);
  console.log("SQL has Unicode (>255) characters:", hasUnicode);
  if (hasUnicode) {
    const unicodeChars: string[] = [];
    for (let i = 0; i < sql.length; i++) {
      const code = sql.charCodeAt(i);
      if (code > 255) {
        unicodeChars.push(`'${sql[i]}' (index: ${i}, code: ${code})`);
      }
    }
    console.log(
      "Found Unicode characters inside SQL query body:",
      unicodeChars.slice(0, 10).join(", ") +
        (unicodeChars.length > 10
          ? `...and ${unicodeChars.length - 10} more`
          : ""),
    );
  }

  // Logs the outgoing headers with the Authorization token masked, and
  // flags (but does not block) any non-ASCII characters found in header
  // values — Cloudflare's API has previously rejected requests containing
  // literal masked bullet characters (•) copied from a dashboard UI, so
  // this makes that failure mode visible in logs instead of a bare 400.
  const safeHeaders: any = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      const hasHeaderUnicode = /[^\x00-\x7F]/.test(value);
      if (hasHeaderUnicode) {
        const unicodeHeaderChars: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const code = value.charCodeAt(i);
          if (code > 255) {
            unicodeHeaderChars.push(
              `'${value[i]}' (index: ${i}, code: ${code})`,
            );
          }
        }
        console.error(
          `HEADER SECURITY ALERT: Header '${key}' contains non-ASCII characters! characters:`,
          unicodeHeaderChars.join(", "),
        );
      }
      if (key.toLowerCase() === "authorization") {
        safeHeaders[key] = value.substring(0, 15) + "... [MASKED]";
      } else {
        safeHeaders[key] = value;
      }
    } else {
      safeHeaders[key] = value;
    }
  }

  console.log("Sanitized Headers:", JSON.stringify(safeHeaders, null, 2));
  console.log(
    "Request Body Payload Size (JSON):",
    Buffer.byteLength(JSON.stringify({ sql }), "utf-8"),
    "bytes",
  );
  console.log("===========================================");
}
