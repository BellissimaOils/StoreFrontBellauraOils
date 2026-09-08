import crypto from "crypto";

// Small, pure, stateless helpers with no dependency on any shared in-memory
// app state (products/orders/storeSettings, etc.) — safe to import anywhere.

// SSRF protection — shared by any endpoint that fetches an admin-supplied URL
// (image proxy, image-URL import, custom shipping-carrier test).
//
// The previous implementation matched a regex list against URL.hostname. Two
// concrete holes, both verified against Node's URL parser rather than assumed:
//
// 1. EVERY IPv6 private address got through. URL.hostname returns IPv6 literals
//    wrapped in brackets — "[::1]", not "::1" — so /^::1$/, /^fc00:/ and
//    /^fe80:/ could never match anything. http://[::1]/ and
//    http://[::ffff:127.0.0.1]/ (IPv4-mapped loopback) both passed.
// 2. Only the literal hostname was checked. A public hostname whose DNS record
//    points at 127.0.0.1 passed, and since fetch() follows redirects by
//    default, an allowed public URL could redirect to an internal one after the
//    check had already succeeded.
//
// Decimal/octal/hex IPv4 (2130706433, 0177.0.0.1, 0x7f000001) turned out NOT to
// be a hole: the WHATWG URL parser normalises all of them to dotted decimal
// before any check sees them.

/** Strips the brackets Node puts around IPv6 literals in URL.hostname. */
function unbracket(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Ranges that must never be reachable from a server-side fetch. */
const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8],      // "this network"
  ["10.0.0.0", 8],     // RFC1918
  ["100.64.0.0", 10],  // carrier NAT
  ["127.0.0.0", 8],    // loopback
  ["169.254.0.0", 16], // link-local, includes 169.254.169.254 cloud metadata
  ["172.16.0.0", 12],  // RFC1918
  ["192.0.0.0", 24],   // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15],  // benchmarking
  ["224.0.0.0", 4],    // multicast
  ["240.0.0.0", 4],    // reserved
];

/** Expands an IPv6 address to its 8 hextets, or null if unparseable. */
function expandIpv6(ip: string): number[] | null {
  const clean = ip.split("%")[0].toLowerCase(); // drop any zone index
  if (!/^[0-9a-f:.]+$/.test(clean) || !clean.includes(":")) return null;
  const halves = clean.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (group === "") return null;
      if (group.includes(".")) {
        const asInt = ipv4ToInt(group); // trailing dotted quad, e.g. ::ffff:127.0.0.1
        if (asInt === null) return null;
        out.push((asInt >>> 16) & 0xffff, asInt & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

/** True if this literal IP address must not be fetched. */
export function isBlockedAddress(address: string): boolean {
  const ip = unbracket(address).toLowerCase();

  const asV4 = ipv4ToInt(ip);
  if (asV4 !== null) {
    return BLOCKED_V4_CIDRS.some(([base, bits]) => {
      const baseInt = ipv4ToInt(base);
      if (baseInt === null) return false;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (asV4 & mask) === (baseInt & mask);
    });
  }

  const groups = expandIpv6(ip);
  if (groups) {
    // :: (unspecified) and ::1 (loopback)
    if (groups.slice(0, 7).every((g) => g === 0) && (groups[7] === 0 || groups[7] === 1)) {
      return true;
    }
    // ::ffff:a.b.c.d — re-check as IPv4. This is the hole that let
    // http://[::ffff:127.0.0.1]/ reach loopback.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
      return isBlockedAddress(mapped);
    }
    if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
    return false;
  }

  return false; // not an IP literal — the caller resolves DNS instead
}

const BLOCKED_HOSTNAMES = [
  /^localhost$/,
  /\.localhost$/,
  /^metadata\.google\.internal$/,
  /^metadata$/,
  /\.internal$/,
];

/**
 * Cheap synchronous check: protocol, hostname denylist, IP literals.
 *
 * Retained for fast rejection, but it CANNOT catch a hostname that resolves to
 * a private address. Anything actually being fetched should go through
 * assertPublicUrl or safeFetch.
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    const urlObj = new URL(urlString);
    if (urlObj.protocol !== "https:" && urlObj.protocol !== "http:") return false;
    const hostname = unbracket(urlObj.hostname).toLowerCase();
    if (!hostname) return false;
    if (BLOCKED_HOSTNAMES.some((p) => p.test(hostname))) return false;
    if (isBlockedAddress(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything isSafeUrl does, plus DNS resolution with every returned address
 * validated — which is what catches a public hostname pointed at a private IP.
 */
export async function assertPublicUrl(
  urlString: string,
): Promise<
  // Both members carry both keys — the unused one explicitly `undefined`.
  //
  // As a bare `{ ok: true; url: URL } | { ok: false; reason: string }`, reading
  // `verdict.reason` after an `if (!verdict.ok)` guard depends on the compiler
  // discriminating the union, and that is exactly what the CI typecheck was
  // failing on ("Property 'reason' does not exist"): this project's tsconfig
  // sets no `strict`, and without strictNullChecks the boolean discriminant
  // doesn't narrow reliably. Declaring the optional counterpart on each member
  // makes both properties readable on the un-narrowed union too, so the guard
  // is about intent rather than about satisfying the checker.
  | { ok: true; url: URL; reason?: undefined }
  | { ok: false; reason: string; url?: undefined }
> {
  if (!isSafeUrl(urlString)) {
    return { ok: false, reason: "not a fetchable public http(s) URL" };
  }
  const url = new URL(urlString);
  const hostname = unbracket(url.hostname).toLowerCase();

  // Already a literal IP that isSafeUrl cleared — nothing to resolve.
  if (ipv4ToInt(hostname) !== null || expandIpv6(hostname)) return { ok: true, url };

  try {
    const dns = await import("dns/promises");
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) return { ok: false, reason: `${hostname} did not resolve` };
    for (const record of records) {
      if (isBlockedAddress(record.address)) {
        return {
          ok: false,
          reason: `${hostname} resolves to a private address (${record.address})`,
        };
      }
    }
    return { ok: true, url };
  } catch (err: any) {
    return { ok: false, reason: `could not resolve ${hostname}: ${err?.message || "DNS error"}` };
  }
}

/**
 * fetch() for admin-supplied URLs. Redirects are followed manually so every hop
 * is re-validated; plain fetch() follows them silently, so a URL that passed
 * validation could still land on an internal address one redirect later.
 */
export async function safeFetch(
  urlString: string,
  init: RequestInit = {},
  maxRedirects = 3,
): Promise<Response> {
  let current = urlString;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const verdict = await assertPublicUrl(current);
    if (!verdict.ok) throw new Error(`Blocked URL: ${verdict.reason}`);

    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status > 399) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current).toString(); // relative redirects
  }
  throw new Error(`Blocked URL: more than ${maxRedirects} redirects`);
}

export function formatNotificationTemplate(template: string, data: any): string {
  if (!template) return "";

  const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();

  return template
    .replace(/{ORDER_ID}/g, data.orderId || "")
    .replace(/{CUSTOMER_FULL_NAME}/g, fullName || "")
    .replace(/{CUSTOMER_PHONE}/g, data.phone || "")
    .replace(/{CUSTOMER_CITY}/g, data.city || "")
    .replace(/{CUSTOMER_ADDRESS}/g, data.address || "")
    .replace(/{ITEMS_LIST}/g, data.itemsList || "")
    .replace(/{TRACKING_NUMBER}/g, data.trackingNumber || "")
    .replace(/{TOTAL_PRICE}/g, data.totalPrice || "")
    .replace(/{REVIEW_LINK}/g, data.reviewLink || "");
}

// Finds the smallest positive integer not already used as a product_nbr in
// the given list. Takes the list as a parameter (rather than reading shared
// state directly) so it stays pure/stateless and easy to test in isolation.
export function getNextAvailableProductId(productsList: any[]): number {
  const existingIds = new Set(
    productsList.map((p) => Number(p.product_nbr)).filter((n) => !isNaN(n)),
  );
  let nextId = 1;
  while (existingIds.has(nextId)) {
    nextId++;
  }
  return nextId;
}

export const generateUUID = () => {
  // crypto.randomUUID() — cryptographically strong and RFC4122-compliant,
  // replacing the previous Math.random()-based generator which was both
  // guessable and prone to collisions.
  return crypto.randomUUID();
};

export const generateOrderNbr = () => {
  // This value doubles as the review-submission token (see createToken()) and
  // is checked via GET /api/reviews/check-token/:token, so it acts as a bearer
  // credential, not just a display number. The previous version used
  // Math.random() over a 900,000-value range, which is both non-cryptographic
  // and small enough to brute-force. crypto.randomInt over a 9-digit range
  // keeps the same "ORD-XXXXXXX" shape (still a TEXT column, still starts
  // with "ORD-") while making guessing/enumeration impractical.
  return "ORD-" + crypto.randomInt(100000000, 999999999);
};
