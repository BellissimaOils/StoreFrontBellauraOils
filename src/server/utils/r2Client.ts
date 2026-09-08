import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sanitizeCredentials, isMaskedValue } from "./sqlUtils";
import { getWritableDbPath, getWritableReviewsDbPath } from "./pathUtils";
import fs from "fs";
import path from "path";

// Cloudflare R2 credential resolution + a cached S3Client instance. This
// module owns r2_config/s3ClientInstance as private state — callers must go
// through the exported functions rather than reaching into that state
// directly, so this stays the single source of truth for R2 credentials.

// Populated only via env vars today (nothing in server.ts currently mutates
// this at runtime), but kept as a mutable object rather than reading
// process.env directly inside getR2Credentials, in case an admin-settings
// override is added later.
let r2_config: any = {
  accountId: "",
  accessKeyId: "",
  secretAccessKey: "",
  bucketName: "",
  publicUrl: "",
};

export function getR2Credentials() {
  const envAccountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const envAccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const envSecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const envBucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const envPublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  const accountId = sanitizeCredentials(r2_config.accountId || envAccountId);
  const accessKeyId = sanitizeCredentials(
    r2_config.accessKeyId || envAccessKeyId,
  );
  const secretAccessKey = sanitizeCredentials(
    r2_config.secretAccessKey || envSecretAccessKey,
  );
  const bucketName = sanitizeCredentials(r2_config.bucketName || envBucketName);
  const publicUrl = sanitizeCredentials(r2_config.publicUrl || envPublicUrl);

  const endpoint = accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : "";

  const isValid = !!(
    accountId &&
    accessKeyId &&
    secretAccessKey &&
    bucketName &&
    !isMaskedValue(accountId) &&
    !isMaskedValue(accessKeyId) &&
    !isMaskedValue(secretAccessKey) &&
    !isMaskedValue(bucketName)
  );

  return {
    valid: isValid,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
    endpoint,
  };
}

let s3ClientInstance: S3Client | null = null;
let s3ClientConfigHash = "";

export function getR2Client(): S3Client | null {
  const creds = getR2Credentials();
  if (!creds.valid) {
    s3ClientInstance = null;
    return null;
  }

  const hash = `${creds.accountId}:${creds.accessKeyId}:${creds.secretAccessKey}`;
  if (s3ClientInstance && s3ClientConfigHash === hash) {
    return s3ClientInstance;
  }

  try {
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: creds.endpoint,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    });
    s3ClientConfigHash = hash;
    return s3ClientInstance;
  } catch (err) {
    console.error("Failed to initialize S3Client for R2:", err);
    return null;
  }
}

export async function testR2ConnectionDirectly(): Promise<{
  success: boolean;
  errorName?: string;
  errorMessage?: string;
  solutions?: string[];
}> {
  const client = getR2Client();
  if (!client) {
    return {
      success: false,
      errorName: "R2_UNCONFIGURED",
      errorMessage:
        "Cloud integration is not configured. Credentials are empty or invalid.",
      solutions: [
        "Ensure CLOUDFLARE_R2_ACCOUNT_ID, ACCESS_KEY_ID, and SECRET_ACCESS_KEY are added.",
      ],
    };
  }

  const creds = getR2Credentials();
  const testKey = "r2-connection-test-file.txt";

  try {
    // 1. Test PutObject
    await client.send(
      new PutObjectCommand({
        Bucket: creds.bucketName,
        Key: testKey,
        Body: "Cloudflare R2 Connection Diagnostic Success",
        ContentType: "text/plain",
      }),
    );

    // 2. Test ListObjectsV2
    await client.send(
      new ListObjectsV2Command({
        Bucket: creds.bucketName,
        MaxKeys: 5,
      }),
    );

    // 3. Test DeleteObject
    await client.send(
      new DeleteObjectCommand({
        Bucket: creds.bucketName,
        Key: testKey,
      }),
    );

    return {
      success: true,
      solutions: [],
    };
  } catch (err: any) {
    console.error("R2 Connection Test Error Details:", err);
    let solutions = [
      "Verify your Bucket Name is exact and exists in your Cloudflare dashboard.",
      "Check that your API Token has 'Admin Read/Write' policy permissions.",
      "Check CORS settings under Bucket Settings.",
    ];
    if (
      err.name === "CredentialsProviderError" ||
      err.name === "InvalidSignatureException"
    ) {
      solutions.unshift(
        "Correct your Access Key ID and Secret Access Key credentials. They might have a visual space at the end.",
      );
    }
    return {
      success: false,
      errorName: err.name || "R2_CONNECTION_ERROR",
      errorMessage:
        err.message || "An unexpected error occurred during S3 operations.",
      solutions,
    };
  }
}

// Exposed for the /api/admin/backup endpoint, which includes this object
// verbatim in the exported backup JSON (see server.ts).
export function getR2ConfigForBackup() {
  return r2_config;
}


// ---------------------------------------------------------------------------
// R2 file operations (stateless — no shared in-memory app state)
// ---------------------------------------------------------------------------

export const uploadToR2 = async (
  buffer: Buffer,
  filename: string,
  contentType: string,
  subFolder?: string,
): Promise<string | null> => {
  const client = getR2Client();
  if (!client) return null;
  const creds = getR2Credentials();

  let key = filename;
  if (subFolder && subFolder !== "root" && subFolder !== "all") {
    const cleanSub = subFolder
      .replace(/[^a-zA-Z0-9\u0600-\u06FF\-_/]/g, "")
      .trim();
    if (cleanSub) {
      if (cleanSub.includes("/")) {
        key = `${cleanSub.replace(/\/$/, "")}/${filename}`;
      } else {
        key = `Images/${cleanSub}/${filename}`;
      }
    } else {
      key = `Images/${filename}`;
    }
  } else {
    key = `Images/${filename}`;
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: creds.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const basePublicUrl = creds.publicUrl
      ? creds.publicUrl.replace(/\/+$/, "")
      : `https://${creds.bucketName}.r2.cloudflarestorage.com`;

    return `${basePublicUrl}/${key}`;
  } catch (err: any) {
    console.error(
      `[R2 Upload Error] Failed to upload ${filename} to Cloudflare R2 bucket:`,
      err.message,
    );
    return null;
  }
};

export const deleteFromR2 = async (imageUrl: string): Promise<boolean> => {
  const client = getR2Client();
  if (!client) return false;
  const creds = getR2Credentials();

  try {
    let key = "";
    const credsPublicUrl = creds.publicUrl
      ? creds.publicUrl.replace(/\/+$/, "")
      : "";
    if (credsPublicUrl && imageUrl.startsWith(credsPublicUrl)) {
      key = imageUrl.substring(credsPublicUrl.length).replace(/^\/+/, "");
    } else {
      const hostMarker = `${creds.bucketName}.r2.cloudflarestorage.com`;
      const idxMarker = imageUrl.indexOf(hostMarker);
      if (idxMarker !== -1) {
        key = imageUrl
          .substring(idxMarker + hostMarker.length)
          .replace(/^\/+/, "");
      } else {
        const parts = imageUrl.split("/");
        const lowUrl = imageUrl.toLowerCase();
        const fallbackIdx = lowUrl.indexOf("/images/");
        if (fallbackIdx !== -1) {
          key = imageUrl.substring(fallbackIdx + 1);
        } else {
          key = parts[parts.length - 1];
        }
      }
    }

    if (!key) return false;

    const dirPart = path.dirname(key).replace(/\\/g, "/");
    if (dirPart && dirPart !== "." && dirPart !== "/") {
      await client
        .send(
          new PutObjectCommand({
            Bucket: creds.bucketName,
            Key: `${dirPart}/.keep`,
            Body: "",
          }),
        )
        .catch(() => {});
    }

    await client.send(
      new DeleteObjectCommand({
        Bucket: creds.bucketName,
        Key: key,
      }),
    );
    console.log(
      `[R2 Delete Success] Removed asset ${key} from Cloudflare R2 bucket.`,
    );
    return true;
  } catch (err: any) {
    console.error(
      `[R2 Delete Error] Failed to delete ${imageUrl} from Cloudflare R2 list:`,
      err.message,
    );
    return false;
  }
};

export const listFilesFromR2 = async (): Promise<string[]> => {
  const client = getR2Client();
  if (!client) return [];
  const creds = getR2Credentials();

  try {
    let isTruncated = true;
    let continuationToken: string | undefined = undefined;
    const allContents = [];

    while (isTruncated) {
      const listRes = await client.send(
        new ListObjectsV2Command({
          Bucket: creds.bucketName,
          ContinuationToken: continuationToken,
        }),
      );

      if (listRes.Contents) {
        allContents.push(...listRes.Contents);
      }
      isTruncated = listRes.IsTruncated ?? false;
      continuationToken = listRes.NextContinuationToken;
    }

    if (allContents.length === 0) {
      return [];
    }

    const basePublicUrl = creds.publicUrl
      ? creds.publicUrl.replace(/\/+$/, "")
      : `https://${creds.bucketName}.r2.cloudflarestorage.com`;

    return allContents
      .map((item) => {
        if (!item.Key) return "";
        return `${basePublicUrl}/${item.Key}`;
      })
      .filter((url) => {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();
        const lastPart = lowerUrl.split("/").pop() || "";
        if (!lastPart.includes(".")) {
          return true;
        }
        return (
          lowerUrl.endsWith(".jpg") ||
          lowerUrl.endsWith(".jpeg") ||
          lowerUrl.endsWith(".png") ||
          lowerUrl.endsWith(".webp") ||
          lowerUrl.endsWith(".gif") ||
          lowerUrl.endsWith(".svg") ||
          lowerUrl.endsWith(".bmp") ||
          lowerUrl.endsWith(".ico") ||
          lowerUrl.includes("/images/") ||
          lowerUrl.includes("/pictures/") ||
          lowerUrl.includes("images/")
        );
      });
  } catch (err: any) {
    console.error(
      "[R2 List Error] Failed to retrieve files from Cloudflare R2 container:",
      err.message,
    );
    return [];
  }
};

// ---------------------------------------------------------------------------
// DB file <-> R2 sync helpers (stateless — pass file paths explicitly,
// read shared in-memory arrays only where documented below)
// ---------------------------------------------------------------------------

// Remembers the ETag of the database.json we last pulled down, so repeat
// syncs can ask R2 "only send it if it changed". Per-process, so a cold
// instance always does one full fetch.
let lastDbEtag: string | null = null;

export const syncDbFromR2 = async () => {
  try {
    const client = getR2Client();
    const creds = getR2Credentials();
    if (!client || !creds.valid) return null;

    const writablePath = getWritableDbPath();

    // Conditional GET. loadDb() is called from the /api middleware on the
    // first request of every ~3 second window, and this function previously
    // did a full R2 download + JSON.parse of the entire database + a disk
    // write every single time — even when nothing had changed. That is a
    // network round-trip, a full parse and an fs write added to request
    // latency, plus an R2 GET (which is billed) on a continuous loop across
    // every warm instance.
    //
    // Sending If-None-Match means R2 replies 304 with no body when the file is
    // unchanged, so there is nothing to transfer, parse or write. Only skip
    // the work if we can also see the local copy is still present — otherwise
    // a 304 would leave loadDb() with no file to read.
    const canUseCachedCopy = lastDbEtag !== null && fs.existsSync(writablePath);

    const command = new GetObjectCommand({
      Bucket: creds.bucketName,
      Key: "database.json",
      ...(canUseCachedCopy ? { IfNoneMatch: lastDbEtag as string } : {}),
    });

    const response = await client.send(command);
    if (response.Body) {
      const strData = await response.Body.transformToString();
      const data = JSON.parse(strData);
      if (response.ETag) lastDbEtag = response.ETag;
      await fs.promises.writeFile(writablePath, strData, "utf-8");
      return data;
    }
  } catch (err: any) {
    // A 304 is the success case for the conditional GET above: the local copy
    // is already current, so there is deliberately nothing to do.
    const status = err?.$metadata?.httpStatusCode;
    if (status === 304 || err?.name === "NotModified") {
      return null;
    }
    // Anything else (including database.json not existing in R2 yet) is
    // ignored as before. Reset the cached ETag so the next attempt does a
    // full unconditional fetch rather than getting stuck on a stale one.
    lastDbEtag = null;
  }
  return null;
};

export const syncDbToR2 = async () => {
  try {
    const client = getR2Client();
    const creds = getR2Credentials();
    if (!client || !creds.valid) return false;
    const writablePath = getWritableDbPath();
    if (fs.existsSync(writablePath)) {
      const fileContent = await fs.promises.readFile(writablePath, "utf-8");
      const command = new PutObjectCommand({
        Bucket: creds.bucketName,
        Key: "database.json",
        Body: fileContent,
        ContentType: "application/json",
      });
      const putResult = await client.send(command);
      // Adopt the ETag of what we just uploaded. Our local file is byte-for-byte
      // this content, so the next conditional syncDbFromR2() can legitimately
      // 304 instead of re-downloading the very bytes this instance just sent.
      if (putResult?.ETag) lastDbEtag = putResult.ETag;
      return true;
    }
  } catch (err) {
    console.error("Failed to sync database to Cloudflare R2:", err);
    // Upload state is now uncertain, so drop the cached ETag and let the next
    // read do a full unconditional fetch.
    lastDbEtag = null;
  }
  return false;
};

export const syncReviewsDbFromR2 = async () => {
  try {
    const client = getR2Client();
    const creds = getR2Credentials();
    if (!client || !creds.valid) return null;
    const command = new GetObjectCommand({
      Bucket: creds.bucketName,
      Key: "reviews_table.json",
    });
    const response = await client.send(command);
    if (response.Body) {
      const strData = await response.Body.transformToString();
      const data = JSON.parse(strData);
      const writablePath = getWritableReviewsDbPath();
      await fs.promises.writeFile(writablePath, strData, "utf-8");
      return data;
    }
  } catch (err) {}
  return null;
};

export const syncReviewsDbToR2 = async () => {
  try {
    const client = getR2Client();
    const creds = getR2Credentials();
    if (!client || !creds.valid) return false;
    const writablePath = getWritableReviewsDbPath();
    if (fs.existsSync(writablePath)) {
      const fileContent = await fs.promises.readFile(writablePath, "utf-8");
      const command = new PutObjectCommand({
        Bucket: creds.bucketName,
        Key: "reviews_table.json",
        Body: fileContent,
        ContentType: "application/json",
      });
      await client.send(command);
      return true;
    }
  } catch (err) {
    console.error("Failed to sync reviews database to Cloudflare R2:", err);
  }
  return false;
};
