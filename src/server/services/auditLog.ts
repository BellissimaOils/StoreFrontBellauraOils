import { executeRealD1QueryIfConfigured } from "./d1Client";
import { sanitizeCredentials, isMaskedValue } from "../utils/sqlUtils";

export interface AdminAuditLogEntry {
  id?: number;
  admin_email: string;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  timestamp: string;
  ip: string;
  details?: string | null;
}

const inMemoryAuditLogs: AdminAuditLogEntry[] = [];
let tableCreated = false;

/**
 * Creates the admin_audit_log table in Cloudflare D1 if not already present.
 */
export async function ensureAuditLogTableExists(): Promise<void> {
  if (tableCreated) return;
  const sql = `CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    timestamp TEXT NOT NULL,
    ip TEXT,
    details TEXT
  );`;
  try {
    const success = await executeRealD1QueryIfConfigured(sql);
    if (success) {
      tableCreated = true;
    }
  } catch (err) {
    console.error("[audit-log] Failed to initialize admin_audit_log table in D1:", err);
  }
}

/**
 * Lightweight helper to record admin write actions without storing redundant customer PII.
 * Logs to console, saves to in-memory buffer, and persists asynchronously to D1.
 */
export async function logAdminAction(
  req: any,
  action: string,
  resourceType: string,
  resourceId?: string | number | null,
  details?: string | null,
): Promise<void> {
  const adminEmail =
    req?.admin?.email ||
    req?.user?.email ||
    req?.headers?.["x-admin-email"] ||
    "admin";

  const ip =
    req?.ip ||
    (typeof req?.headers?.["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : null) ||
    req?.socket?.remoteAddress ||
    "unknown";

  const timestamp = new Date().toISOString();
  const resIdStr = resourceId !== undefined && resourceId !== null ? String(resourceId) : null;
  const detailsStr = details ? String(details).slice(0, 500) : null;

  // Structured console log for observability and log drains
  console.info(
    `[AUDIT] admin="${adminEmail}" action="${action}" resource="${resourceType}${resIdStr ? `:${resIdStr}` : ""}" ip="${ip}" time="${timestamp}"` +
      (detailsStr ? ` details="${detailsStr}"` : ""),
  );

  const entry: AdminAuditLogEntry = {
    id: inMemoryAuditLogs.length > 0 ? (inMemoryAuditLogs[0].id || 0) + 1 : 1,
    admin_email: adminEmail,
    action,
    resource_type: resourceType,
    resource_id: resIdStr,
    timestamp,
    ip,
    details: detailsStr,
  };

  inMemoryAuditLogs.unshift(entry);
  if (inMemoryAuditLogs.length > 1000) {
    inMemoryAuditLogs.pop();
  }

  // Persist to D1 (awaited to guarantee durability in serverless execution lifecycle)
  const rawAccountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
  const rawDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const rawApiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

  if (rawAccountId && rawDatabaseId && rawApiToken) {
    if (!tableCreated) {
      await ensureAuditLogTableExists();
    }
    const insertSql = `INSERT INTO admin_audit_log (admin_email, action, resource_type, resource_id, timestamp, ip, details) VALUES (?, ?, ?, ?, ?, ?, ?);`;
    try {
      await executeRealD1QueryIfConfigured(insertSql, [
        adminEmail,
        action,
        resourceType,
        resIdStr,
        timestamp,
        ip,
        detailsStr,
      ]);
    } catch (err) {
      console.warn("[audit-log] D1 audit log write failed:", err);
    }
  }
}

/**
 * Retrieves paginated audit logs from D1 or in-memory fallback.
 */
export async function getAuditLogs(options: {
  page?: number;
  limit?: number;
  resourceType?: string;
  adminEmail?: string;
}): Promise<{ logs: AdminAuditLogEntry[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
  const offset = (page - 1) * limit;

  const rawAccountId = sanitizeCredentials(process.env.CLOUDFLARE_D1_ACCOUNT_ID);
  const rawDatabaseId = sanitizeCredentials(process.env.CLOUDFLARE_D1_DATABASE_ID);
  const rawApiToken = sanitizeCredentials(process.env.CLOUDFLARE_D1_API_TOKEN);

  if (
    rawAccountId &&
    rawDatabaseId &&
    rawApiToken &&
    !isMaskedValue(rawAccountId)
  ) {
    try {
      if (!tableCreated) {
        await ensureAuditLogTableExists();
      }

      let whereClause = "";
      const params: any[] = [];
      if (options.resourceType) {
        whereClause += " WHERE resource_type = ?";
        params.push(options.resourceType);
      }
      if (options.adminEmail) {
        whereClause += whereClause ? " AND admin_email = ?" : " WHERE admin_email = ?";
        params.push(options.adminEmail);
      }

      const countSql = `SELECT COUNT(*) as total FROM admin_audit_log${whereClause};`;
      const selectSql = `SELECT id, admin_email, action, resource_type, resource_id, timestamp, ip, details FROM admin_audit_log${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?;`;

      const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${rawAccountId}/d1/database/${rawDatabaseId}/query`;
      const headers = {
        Authorization: `Bearer ${rawApiToken}`,
        "Content-Type": "application/json",
      };

      const [countResp, selectResp] = await Promise.all([
        fetch(cloudflareUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ sql: countSql, params: [...params] }),
        }),
        fetch(cloudflareUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ sql: selectSql, params: [...params, limit, offset] }),
        }),
      ]);

      if (countResp.ok && selectResp.ok) {
        const countData = await countResp.json();
        const selectData = await selectResp.json();

        const countRows = countData?.result?.[0]?.results || countData?.result?.results || [];
        const selectRows = selectData?.result?.[0]?.results || selectData?.result?.results || [];
        const total = Number(countRows[0]?.total) || 0;

        return {
          logs: selectRows,
          total,
          page,
          limit,
        };
      }
    } catch (err) {
      console.error("[audit-log] Failed to query D1 audit logs, falling back to memory:", err);
    }
  }

  // In-memory fallback
  let filtered = [...inMemoryAuditLogs];
  if (options.resourceType) {
    filtered = filtered.filter((l) => l.resource_type === options.resourceType);
  }
  if (options.adminEmail) {
    filtered = filtered.filter((l) => l.admin_email === options.adminEmail);
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    logs: paginated,
    total,
    page,
    limit,
  };
}
