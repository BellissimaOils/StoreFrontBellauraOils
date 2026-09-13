import React, { useEffect, useState } from "react";
import { useProducts } from "../context/ProductContext";

interface DiagnosticsData {
  success?: boolean;
  serverTime?: string;
  env?: Record<string, any>;
  d1LiveTest?: any;
  error?: any;
  counts?: Record<string, any>;
}

export default function DebugBanner() {
  const { products, loading: productsLoading } = useProducts();
  const [diag, setDiag] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      const data = await res.json();
      setDiag(data);
    } catch (err: any) {
      setDiag({
        success: false,
        error: `Could not reach /api/diagnostics: ${err.message || err}`,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const handleCopy = () => {
    if (!diag) return;
    navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const hasError = !diag?.success || !!diag?.error || (products.length === 0 && !productsLoading);

  return (
    <aside
      aria-label="Diagnostic Debug Panel"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[480px] z-50 shadow-2xl rounded-xl border border-amber-500/40 bg-zinc-950/95 text-zinc-100 backdrop-blur-md font-sans text-xs overflow-hidden transition-all duration-300"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-900/90 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${hasError ? "bg-red-500 animate-ping" : "bg-emerald-500"}`} />
          <span className="font-semibold tracking-wide text-[11px] uppercase text-zinc-200">
            Storefront DB &amp; API Debugger
          </span>
          <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-mono">
            LIVE
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchDiagnostics}
            disabled={loading}
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 rounded text-[10px] transition"
            title="Refresh diagnostics"
          >
            {loading ? "..." : "🔄 Refresh"}
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 rounded text-[10px] transition"
          >
            {isExpanded ? "Minimize" : "Expand"}
          </button>
        </div>
      </div>

      {/* Body content */}
      {isExpanded && (
        <div className="p-3.5 space-y-3 max-h-[75vh] overflow-y-auto">
          {/* Main Status Callout */}
          {hasError ? (
            <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800 text-red-200">
              <div className="font-bold flex items-center gap-1.5 mb-1 text-red-300 text-[12px]">
                <span>⚠️ Database / Data Loading Issue Detected</span>
              </div>
              <div className="text-[11px] font-mono bg-black/50 p-2 rounded border border-red-900/50 break-words whitespace-pre-wrap">
                {typeof diag?.error === "object"
                  ? JSON.stringify(diag.error, null, 2)
                  : diag?.error || (products.length === 0 ? "Products returned: 0. Database query returned no rows or failed." : "Unknown error")}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 flex items-center gap-2">
              <span>✅</span>
              <span>All D1 &amp; R2 connections are responding properly!</span>
            </div>
          )}

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-zinc-900/80 p-2 rounded border border-zinc-800">
              <div className="text-zinc-400">Products in App:</div>
              <div className="font-mono text-sm font-bold text-zinc-100">
                {productsLoading ? "Loading..." : products.length}
              </div>
            </div>
            <div className="bg-zinc-900/80 p-2 rounded border border-zinc-800">
              <div className="text-zinc-400">Cloudflare D1 Query:</div>
              <div className={`font-mono text-sm font-bold ${diag?.d1LiveTest?.success ? "text-emerald-400" : "text-red-400"}`}>
                {diag?.d1LiveTest?.httpStatus ? `HTTP ${diag.d1LiveTest.httpStatus}` : (loading ? "Checking..." : "Failed")}
              </div>
            </div>
          </div>

          {/* Environment Variables Verification */}
          <div>
            <div className="text-zinc-400 font-medium mb-1 text-[11px]">Cloudflare Variables Check:</div>
            <div className="space-y-1 font-mono text-[10px] bg-zinc-900/90 p-2 rounded border border-zinc-800">
              {diag?.env ? (
                Object.entries(diag.env).map(([k, v]: [string, any]) => (
                  <div key={k} className="flex items-center justify-between border-b border-zinc-800/50 pb-0.5 last:border-0">
                    <span className="text-zinc-300">{k}</span>
                    <span className={v?.set ? (v?.masked ? "text-amber-400" : "text-emerald-400") : "text-red-400"}>
                      {v?.set ? (v?.masked ? "⚠️ MASKED" : "✓ OK") : "✗ MISSING"}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-zinc-500">Checking environment variables...</span>
              )}
            </div>
          </div>

          {/* Detailed D1 Test Info */}
          {diag?.d1LiveTest && (
            <div>
              <div className="text-zinc-400 font-medium mb-1 text-[11px]">D1 Query Result:</div>
              <pre className="bg-zinc-900/90 p-2 rounded border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-32">
                {JSON.stringify(diag.d1LiveTest, null, 2)}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
            <button
              onClick={handleCopy}
              className="px-2.5 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-amber-200 rounded font-medium text-[10px] transition"
            >
              {copied ? "✓ Copied to Clipboard!" : "📋 Copy Full Diagnostic JSON"}
            </button>
            <a
              href="/api/diagnostics"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-zinc-200 underline text-[10px]"
            >
              Open /api/diagnostics ↗
            </a>
          </div>
        </div>
      )}
    </aside>
  );
}
