import React from "react";

/**
 * Recovers from a failed lazy-page load.
 *
 * Every page in this app is `lazy(() => import(...))`, so the browser fetches a
 * hashed chunk file at navigation time. Those filenames change with every
 * deployment, and a tab that was opened before a deploy asks for the old name —
 * which no longer exists. Worse, vercel.json rewrites `/(.*)` to the serverless
 * function, so the miss is answered with the HTML shell at status 200 rather
 * than a 404: the browser then fails the module load on a MIME/parse error, the
 * lazy component throws, and with nothing catching it the page renders blank.
 *
 * That is the "sometimes I have to refresh to load correctly" report — and
 * refreshing works precisely because it fetches fresh HTML naming the chunks
 * that do exist. This boundary does that refresh automatically, once.
 *
 * Only chunk-loading errors are auto-reloaded. A genuine render bug would
 * survive the reload and reloading on it would be an infinite loop, so anything
 * else falls through to the message below, as does a second chunk failure
 * within the cooldown.
 */

const RELOAD_MARK_KEY = "bo_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 30 * 1000;

function isChunkLoadError(error: unknown): boolean {
  const err = error as { name?: string; message?: string } | null;
  const name = String(err?.name || "");
  const message = String(err?.message || error || "");
  return (
    name === "ChunkLoadError" ||
    /loading chunk \d+ failed/i.test(message) ||
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    // Chrome/Safari wording when HTML comes back where JS was expected, which
    // is exactly what the catch-all rewrite produces for a missing chunk.
    /expected a javascript.*module/i.test(message) ||
    /mime type/i.test(message)
  );
}

/** Reads the language the way LanguageContext persists it, without the context. */
function currentLang(): "ar" | "fr" | "en" {
  try {
    const stored = localStorage.getItem("bellaura_lang");
    if (stored === "fr" || stored === "en" || stored === "ar") return stored;
  } catch {
    /* private mode */
  }
  return "ar";
}

export interface ChunkErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Shown instead of the full-page panel. Used when the boundary guards one
   * section rather than a whole route, so a secondary part of the page failing
   * doesn't look like the page failing.
   */
  fallback?: React.ReactNode;
  /**
   * Whether a chunk failure should reload the page. True for a whole route,
   * where a reload is the only way to pick up current filenames; false for a
   * section, where reloading the page over a sidebar or an accordion is a
   * bigger interruption than the failure itself.
   */
  autoReload?: boolean;
}

interface State {
  failed: boolean;
  /** Whether the failure was a chunk that wouldn't load, vs any other error. */
  wasChunkError: boolean;
}

export default class ChunkErrorBoundary extends React.Component<
  ChunkErrorBoundaryProps,
  State
> {
  // Same shape as ClerkErrorBoundary: the repo's tsconfig doesn't give class
  // components typed `props`/`state` off React.Component, so both are declared.
  declare props: ChunkErrorBoundaryProps;
  state: State = { failed: false, wasChunkError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, wasChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: unknown) {
    if (this.props.autoReload === false) {
      console.error("[ChunkErrorBoundary] section failed to load", error);
      return;
    }
    if (!isChunkLoadError(error)) {
      // Not a loading problem — a reload would just hit it again. Log it so it
      // is diagnosable rather than silently swallowed behind a friendly panel.
      console.error("[ChunkErrorBoundary] render error", error);
      return;
    }

    // One automatic reload per cooldown. A timestamp rather than a boolean
    // because the flag has to survive the reload it triggers — clearing it on
    // mount would let a permanently missing chunk reload forever.
    let lastReloadAt = 0;
    try {
      lastReloadAt = Number(sessionStorage.getItem(RELOAD_MARK_KEY) || 0);
    } catch {
      /* private mode: fall through to the manual message */
    }
    if (Date.now() - lastReloadAt < RELOAD_COOLDOWN_MS) return;

    try {
      sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    window.location.reload();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    const lang = currentLang();
    const title =
      lang === "ar"
        ? "تعذر تحميل هذه الصفحة"
        : lang === "fr"
          ? "Impossible de charger cette page"
          : "This page could not load";
    // Two different causes, two different explanations. Claiming "the site was
    // updated" for an unrelated crash sends the customer in circles.
    const body = this.state.wasChunkError
      ? lang === "ar"
        ? "يبدو أن الاتصال انقطع أثناء التحميل. أعد التحميل للمتابعة."
        : lang === "fr"
          ? "La connexion semble avoir été interrompue pendant le chargement. Rechargez pour continuer."
          : "The connection seems to have dropped while loading. Reload to continue."
      : lang === "ar"
        ? "حدث خطأ غير متوقع. أعد التحميل للمتابعة."
        : lang === "fr"
          ? "Une erreur inattendue est survenue. Rechargez pour continuer."
          : "Something went wrong. Reload to continue.";
    const action =
      lang === "ar" ? "إعادة التحميل" : lang === "fr" ? "Recharger" : "Reload";

    return (
      <div
        dir={lang === "ar" ? "rtl" : "ltr"}
        className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <h1 className="text-xl font-light text-primary-earth">{title}</h1>
        <p className="text-sm text-primary-earth/60 font-light max-w-md">{body}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary-earth text-white px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-accent-gold transition-colors"
        >
          {action}
        </button>
      </div>
    );
  }
}
