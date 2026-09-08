import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Reveals a long array one page at a time behind a "Load more" button.
 *
 * Why the product grids window client-side instead of paging the API the way
 * reviews do: `/api/products` is fetched once by ProductContext and shared by
 * every screen, and the category pages derive their contents by filtering that
 * full array in the browser (CategoryPage) — as does the product picker in the
 * review-invite generator. If that endpoint returned pages, a category page
 * would only ever show the products that happened to be on the pages already
 * loaded, so "Skin" could look empty while its products sat on page 3.
 *
 * Windowing here still fixes the part that actually hurts: instead of mounting
 * every ProductCard at once — each with its own image request, animation and
 * hover state — the grid mounts 20 and grows on demand.
 */

export const PRODUCTS_PAGE_SIZE = 20;

export interface UseIncrementalListOptions {
  pageSize?: number;
  /**
   * Change this to collapse back to the first page. Pass whatever identifies
   * the current list (category id, active filters) so switching category
   * doesn't inherit the previous page's scroll depth.
   */
  resetKey?: string | number;
}

export function useIncrementalList<T>(
  items: T[],
  options: UseIncrementalListOptions = {},
) {
  const { pageSize = PRODUCTS_PAGE_SIZE, resetKey = "" } = options;
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [resetKey, pageSize]);

  const total = items.length;
  const visible = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = total > visibleCount;

  const showMore = useCallback(() => {
    setVisibleCount((current) => current + pageSize);
  }, [pageSize]);

  return { visible, hasMore, showMore, total, visibleCount: visible.length };
}
