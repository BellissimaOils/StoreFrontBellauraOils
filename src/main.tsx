import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { prefetchAppInitialData } from "./lib/apiCache";

// Kick off instant background prefetching for home and section endpoints
prefetchAppInitialData();

// Always use the backend as the source of truth for all data.
// Clear ALL stale localStorage mock-emulator caches on startup to prevent any
// old/offline/hardcoded data from overriding real data from the backend server.
// These keys are only used as an offline fallback and persist across browser sessions.
try {
  const MOCK_CACHE_KEYS = [
    "bellaura_local_products",
    "bellaura_local_reviews",
    "bellaura_local_tokens",
    "bellaura_local_orders",
    "bellaura_local_coupons",
    "bellaura_local_images",
  ];
  MOCK_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
} catch {/* ignore if localStorage is unavailable */}


// --- PERFORMANCE LOGGING (DEV ONLY) ---
if (import.meta.env.DEV && typeof window !== "undefined") {
  try {
    // 1. Largest Contentful Paint (LCP)
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      console.log(
        `[Performance] LCP: ${lastEntry.startTime.toFixed(2)}ms`,
        lastEntry,
      );
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });

    // 2. Resource Timing (Images)
    const resourceObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      entries.forEach((entry: any) => {
        if (entry.initiatorType === "img" && entry.name.includes("r2")) {
          const ttfb = entry.responseStart - entry.requestStart;
          const downloadTime = entry.responseEnd - entry.responseStart;
          console.log(
            `[Performance] Image Load (${entry.name}): TTFB=${ttfb.toFixed(2)}ms, Download=${downloadTime.toFixed(2)}ms, Total=${entry.duration.toFixed(2)}ms`,
          );
        }
      });
    });
    resourceObserver.observe({ type: "resource", buffered: true });
  } catch (e) {
    console.warn("PerformanceObserver not supported", e);
  }
}
// ---------------------------

// Catch and suppress benign Vite WebSocket connection errors to prevent annoying visual error overlays/prompts
if (typeof window !== "undefined") {
  // Silence console methods from logging Vite HMR/WebSocket connection errors
  const isWebsocketOrViteNoise = (args: any[]) => {
    try {
      const merged = args
        .map((arg) => {
          if (typeof arg === "string") return arg;
          if (arg instanceof Error) return arg.message || String(arg);
          return String(arg);
        })
        .join(" ")
        .toLowerCase();

      return (
        merged.includes("websocket") ||
        merged.includes("[vite] connect") ||
        merged.includes("failed to connect") ||
        merged.includes("connection failed") ||
        merged.includes("hmr")
      );
    } catch {
      return false;
    }
  };

  const originalError = console.error;
  console.error = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalError.apply(console, args);
  };

  const originalWarn = console.warn;
  console.warn = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalWarn.apply(console, args);
  };

  const originalLog = console.log;
  console.log = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalLog.apply(console, args);
  };

  const originalDebug = console.debug;
  console.debug = function (...args) {
    if (isWebsocketOrViteNoise(args)) return;
    originalDebug.apply(console, args);
  };

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      const reason = String(event.reason?.message || event.reason || "");
      if (
        reason.toLowerCase().includes("websocket") ||
        reason.toLowerCase().includes("vite") ||
        reason.toLowerCase().includes("failed to connect to websocket")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  window.addEventListener(
    "error",
    (event) => {
      const msg = String(event.message || "");
      if (
        msg.toLowerCase().includes("websocket") ||
        msg.toLowerCase().includes("vite") ||
        msg.toLowerCase().includes("failed to connect to websocket")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}

// ==========================================
// BACKEND API URL REWRITER (IF CONFIGURED)
// ==========================================
const getBackendUrl = (): string => {
  try {
    const stored = localStorage.getItem("bellaura_backend_api_url");
    if (stored) return stored.trim().replace(/\/$/, "");
  } catch {}
  const viteUrl = ((import.meta as any).env?.VITE_API_URL as string) || "";
  if (viteUrl) {
    return viteUrl.trim().replace(/\/$/, "");
  }
  return "";
};

if (typeof window !== "undefined") {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const bUrl = getBackendUrl();
    let finalInput = input;
    if (
      bUrl &&
      (urlStr.startsWith("/") ||
        (urlStr.startsWith("http") &&
          new URL(urlStr).origin === window.location.origin))
    ) {
      const relativePath = urlStr.startsWith("/")
        ? urlStr
        : new URL(urlStr).pathname;
      const queryString = urlStr.includes("?")
        ? urlStr.substring(urlStr.indexOf("?"))
        : "";
      finalInput = `${bUrl}${relativePath}${queryString}`;
    }

    return originalFetch(finalInput, init);
  };
}

// ==========================================
// RENDER APPLICATION
// ==========================================
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>,
);
