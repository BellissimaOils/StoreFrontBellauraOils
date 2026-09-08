import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithCache } from "./apiCache";

/**
 * Incremental review loading against GET /api/reviews.
 *
 * Every review surface (the reviews page, the homepage section, the reviews
 * accordion on a product page) used to `fetch('/api/reviews')` with no
 * parameters and render the entire result. That meant one response carrying
 * every review ever written — comments, admin replies and image URL lists —
 * downloaded and turned into DOM on first paint, on three separate screens,
 * growing forever. The product page was the worst of the three: it pulled the
 * whole table only to keep the handful of reviews that mentioned the product it
 * was showing.
 *
 * This asks the server for one page at a time (20 by default) and lets the
 * server do the product and rating filtering, so a product page transfers only
 * its own reviews.
 */

export const REVIEWS_PAGE_SIZE = 20;

export interface ReviewItem {
  id: string;
  name: string;
  rating: number;
  comment: string;
  date: string;
  products?: string[];
  image?: string | null;
  adminReply?: string;
  clientComment?: string;
  isHidden?: boolean;
}

export interface UsePaginatedReviewsOptions {
  /** Restrict to reviews referencing this product id. */
  productId?: string;
  /** Restrict to reviews referencing this product name. */
  productName?: string;
  /** Restrict to reviews referencing this product's English name. */
  productNameEn?: string;
  /** Restrict to a single star rating; null means "all ratings". */
  rating?: number | null;
  /** Rows per request. */
  pageSize?: number;
  /**
   * Skip fetching entirely (e.g. the product hasn't resolved yet). Stays
   * `isLoading` while disabled so callers keep showing their spinner instead of
   * flashing an "no reviews yet" empty state.
   */
  enabled?: boolean;
}

export interface UsePaginatedReviewsResult {
  reviews: ReviewItem[];
  /** Total matching the current filters, across all pages. */
  total: number;
  hasMore: boolean;
  /** First page in flight. */
  isLoading: boolean;
  /** A "load more" page in flight. */
  isLoadingMore: boolean;
  loadMore: () => void;
  /** Re-request the first page, discarding what's loaded. */
  reload: () => void;
}

export function usePaginatedReviews(
  options: UsePaginatedReviewsOptions = {},
): UsePaginatedReviewsResult {
  const {
    productId,
    productName,
    productNameEn,
    rating = null,
    pageSize = REVIEWS_PAGE_SIZE,
    enabled = true,
  } = options;

  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // How many rows the server has handed us so far. This is the offset for the
  // next page, and it is deliberately NOT reviews.length: the de-duplication
  // below can drop a row, and paging from a shortened length would re-request
  // rows we already have.
  const loadedRef = useRef(0);

  // Every request carries a ticket. A response whose ticket is stale is thrown
  // away, which is what stops a slow first page from landing after the user has
  // changed the rating filter and clobbering the newer list.
  const ticketRef = useRef(0);

  // Filters are collapsed into one primitive so the reset effect below has a
  // stable dependency instead of re-firing on every render.
  const filterKey = [
    productId ?? "",
    productName ?? "",
    productNameEn ?? "",
    rating ?? "",
    pageSize,
    enabled ? "on" : "off",
  ].join("|");

  const fetchPage = useCallback(
    async (offset: number, mode: "replace" | "append") => {
      const ticket = ++ticketRef.current;
      if (mode === "append") setIsLoadingMore(true);
      else setIsLoading(true);

      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      if (productId) params.set("productId", String(productId));
      if (productName) params.set("productName", String(productName));
      if (productNameEn) params.set("productNameEn", String(productNameEn));
      if (rating !== null && rating !== undefined) params.set("rating", String(rating));

      try {
        // fetchWithCache deduplicates in-flight requests and reuses the result
        // for 30 s (the shared DEFAULT_TTL), so rapid navigations between
        // product pages sharing a filter don't each pay a round-trip.
        const data = await fetchWithCache(`/api/reviews?${params.toString()}`, 30_000);
        if (ticket !== ticketRef.current) return;

        const page: ReviewItem[] = Array.isArray(data?.reviews) ? data.reviews : [];
        loadedRef.current = mode === "append" ? offset + page.length : page.length;

        setReviews((prev) => {
          const combined = mode === "append" ? [...prev, ...page] : page;
          // A review submitted between two page requests shifts every later row
          // by one, so page 2 can repeat the last row of page 1. React would
          // then warn about duplicate keys and the same card would render twice.
          const seen = new Set<string>();
          return combined.filter((review) => {
            const key = String(review?.id ?? "");
            if (!key) return true;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });

        const hasTotal = typeof data?.total === "number";
        const resolvedTotal = hasTotal ? data.total : loadedRef.current;
        setTotal(resolvedTotal);
        // A responder that reports neither field (an older server, or a reduced
        // mock) is judged purely on page size: a full page means there may be
        // more, a short one is the end. Comparing against the derived total
        // would be comparing a value with itself, which always says "no more".
        setHasMore(
          typeof data?.hasMore === "boolean"
            ? data.hasMore
            : hasTotal
              ? loadedRef.current < resolvedTotal
              : page.length >= pageSize,
        );
      } catch (error) {
        if (ticket !== ticketRef.current) return;
        console.error("Failed to fetch reviews", error);
        if (mode === "replace") {
          setReviews([]);
          setTotal(0);
          loadedRef.current = 0;
        }
        setHasMore(false);
      } finally {
        if (ticket === ticketRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [pageSize, productId, productName, productNameEn, rating],
  );

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    if (!enabled) {
      // Cancel anything in flight so a late response can't populate a list the
      // caller has decided not to show.
      ticketRef.current++;
      setReviews([]);
      setTotal(0);
      setHasMore(false);
      setIsLoading(true);
      loadedRef.current = 0;
      return;
    }
    loadedRef.current = 0;
    fetchPage(0, "replace");
    // fetchPage is derived from exactly the values baked into filterKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || !hasMore) return;
    fetchPage(loadedRef.current, "append");
  }, [fetchPage, hasMore, isLoading, isLoadingMore]);

  const reload = useCallback(() => {
    loadedRef.current = 0;
    fetchPage(0, "replace");
  }, [fetchPage]);

  return { reviews, total, hasMore, isLoading, isLoadingMore, loadMore, reload };
}
