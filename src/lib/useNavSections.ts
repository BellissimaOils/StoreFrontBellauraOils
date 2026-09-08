import { useEffect, useState } from "react";
import { fetchWithCache, getCachedSync } from "./apiCache";

/**
 * The nav/SEO section rows from /api/sections.
 *
 * Pages need these to honour Admin > SEO > Sections. AboutPage and FaqPage
 * previously didn't load them at all, so their titles were hardcoded and no
 * admin setting could ever reach those pages.
 *
 * fetchWithCache deduplicates, so several components calling this on the same
 * page share one request.
 */
export function useNavSections(): { sections: any[]; loaded: boolean } {
  const cached = getCachedSync<any>("/api/sections");
  const [sections, setSections] = useState<any[]>(
    cached?.success ? cached.sections : [],
  );
  // Starts true when the cache already holds the answer, so a client-side
  // navigation doesn't have to wait.
  const [loaded, setLoaded] = useState<boolean>(Boolean(cached?.success));

  useEffect(() => {
    fetchWithCache("/api/sections")
      .then((data) => {
        if (data && data.success && data.sections) setSections(data.sections);
      })
      .catch(() => {})
      // Loaded even on failure: the generated default is then the final
      // answer, and staying false forever would stall anything gated on this.
      .finally(() => setLoaded(true));
  }, []);

  return { sections, loaded };
}
