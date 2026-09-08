/**
 * Meta Pixel + TikTok Pixel tracking.
 *
 * Both pixels are optional: if the corresponding VITE_*_PIXEL_ID env var is
 * empty or unset, that pixel's script is never injected and every tracking
 * call is a silent no-op. Safe to import server-side (guards on `window`).
 */

/* ------------------------------------------------------------------ */
/*  Narrow global types — avoids leaking `any` onto window             */
/* ------------------------------------------------------------------ */

type FbqMethod = "init" | "track" | "trackCustom" | "trackSingle" | "trackSingleCustom";
interface Fbq {
  (method: FbqMethod, ...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  push?: (...args: unknown[]) => void;
}

interface Ttq {
  load: (id: string) => void;
  page: () => void;
  track: (event: string, data?: Record<string, unknown>) => void;
  identify?: (data: Record<string, unknown>) => void;
  instances?: unknown[];
  _i?: Record<string, unknown>;
}

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    ttq?: Ttq;
    TiktokAnalyticsObject?: string;
  }
}

/* ------------------------------------------------------------------ */
/*  Pixel IDs — read once at module scope                              */
/* ------------------------------------------------------------------ */

const META_PIXEL_ID = (typeof import.meta !== "undefined" && import.meta.env?.VITE_META_PIXEL_ID as string) || "";
const TIKTOK_PIXEL_ID = (typeof import.meta !== "undefined" && import.meta.env?.VITE_TIKTOK_PIXEL_ID as string) || "";

/* ------------------------------------------------------------------ */
/*  Idempotent initialisation                                          */
/* ------------------------------------------------------------------ */

let initialised = false;

/** Inject and initialise whichever pixel(s) have an ID configured. */
export function initPixels(): void {
  if (typeof window === "undefined") return;
  if (initialised) return;
  initialised = true;

  /* ---------- Meta Pixel ---------- */
  if (META_PIXEL_ID) {
    /* Standard Meta base snippet, adapted to TS. */
    const n: Fbq = (window.fbq = function (...args: unknown[]) {
      if (n.callMethod) {
        n.callMethod(...args);
      } else {
        (n.queue ??= []).push(args);
      }
    } as unknown as Fbq);
    if (!window._fbq) window._fbq = n;
    n.push = n as unknown as (...a: unknown[]) => void;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];

    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);

    window.fbq!("init", META_PIXEL_ID);
  }

  /* ---------- TikTok Pixel ---------- */
  if (TIKTOK_PIXEL_ID) {
    /* Standard TikTok base snippet, adapted to TS. */
    window.TiktokAnalyticsObject = "ttq";
    const ttq: Ttq = (window.ttq = window.ttq || ({} as Ttq));
    ttq._i = ttq._i || {};
    ttq.load = ttq.load || function (id: string) {
      const s = document.createElement("script");
      s.type = "text/javascript";
      s.async = true;
      s.src = "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=" + id + "&lib=ttq";
      document.head.appendChild(s);
    };
    ttq.track = ttq.track || (() => {});
    ttq.page = ttq.page || (() => {});

    ttq.load(TIKTOK_PIXEL_ID);
  }
}

/* ------------------------------------------------------------------ */
/*  Event helpers                                                      */
/* ------------------------------------------------------------------ */

export function trackPageView(): void {
  if (typeof window === "undefined") return;
  if (META_PIXEL_ID && window.fbq) window.fbq("track", "PageView");
  if (TIKTOK_PIXEL_ID && window.ttq) window.ttq.page();
}

export function trackViewContent(data: {
  content_name: string;
  value?: number;
  currency?: string;
}): void {
  if (typeof window === "undefined") return;
  const cur = data.currency || "MAD";
  if (META_PIXEL_ID && window.fbq) {
    window.fbq("track", "ViewContent", {
      content_name: data.content_name,
      ...(data.value != null ? { value: data.value, currency: cur } : {}),
    });
  }
  if (TIKTOK_PIXEL_ID && window.ttq) {
    window.ttq.track("ViewContent", {
      content_name: data.content_name,
      ...(data.value != null ? { value: data.value, currency: cur } : {}),
    });
  }
}

export function trackAddToCart(data: {
  content_name: string;
  value?: number;
  currency?: string;
}): void {
  if (typeof window === "undefined") return;
  const cur = data.currency || "MAD";
  if (META_PIXEL_ID && window.fbq) {
    window.fbq("track", "AddToCart", {
      content_name: data.content_name,
      ...(data.value != null ? { value: data.value, currency: cur } : {}),
    });
  }
  if (TIKTOK_PIXEL_ID && window.ttq) {
    window.ttq.track("AddToCart", {
      content_name: data.content_name,
      ...(data.value != null ? { value: data.value, currency: cur } : {}),
    });
  }
}

export function trackPurchase(data: {
  value: number;
  currency: string;
  content_name?: string;
}): void {
  if (typeof window === "undefined") return;
  if (META_PIXEL_ID && window.fbq) {
    window.fbq("track", "Purchase", {
      value: data.value,
      currency: data.currency,
      ...(data.content_name ? { content_name: data.content_name } : {}),
    });
  }
  if (TIKTOK_PIXEL_ID && window.ttq) {
    window.ttq.track("CompletePayment", {
      value: data.value,
      currency: data.currency,
      ...(data.content_name ? { content_name: data.content_name } : {}),
    });
  }
}
