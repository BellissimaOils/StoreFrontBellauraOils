/**
 * Utility to normalize section and navigation link URLs across the app.
 * Handles missing leading slashes, trailing slashes, and maps old or custom
 * product/category variants (e.g., 'Products/all/', 'category/all', 'products/all')
 * to clean canonical paths like '/products'.
 */
export function normalizeLinkUrl(url: string | undefined | null): string {
  if (!url) return '/';
  let trimmed = url.trim();
  if (!trimmed) return '/';

  // Absolute external URLs remain untouched
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Ensure leading slash for internal paths
  if (!trimmed.startsWith('/')) {
    trimmed = '/' + trimmed;
  }

  // Remove trailing slashes except for root '/'
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    trimmed = trimmed.replace(/\/+$/, '');
  }

  // Normalize case-insensitive paths
  const lower = trimmed.toLowerCase();

  if (
    lower === '/category' ||
    lower === '/oils' ||
    lower === '/oil'
  ) {
    return '/';
  }

  // Bare alias slugs stored on older sections. These used to 301 to the
  // canonical page, so a nav link pointing at /hair still worked. Aliases are
  // 404s now, so any link the site renders has to be rewritten to the real URL
  // here instead of relying on a redirect to rescue it.
  if (lower === '/hair' || lower === '/scalp' || lower === '/cheveux' || lower === '/hair_and_scalp') {
    return '/hair-and-scalp';
  }
  if (lower === '/peau' || lower === '/peaux') {
    return '/skin';
  }
  if (lower === '/pack' || lower === '/collections' || lower === '/bundles') {
    return '/packs';
  }
  if (lower === '/ourproducts' || lower === '/our-products' || lower === '/all') {
    return '/products';
  }

  // All variants of "Our Products" or "All Products" -> /products
  if (
    lower === '/products' ||
    lower === '/products/all' ||
    lower === '/category/all' ||
    lower === '/category/products' ||
    lower === '/products/products'
  ) {
    return '/products';
  }

  // Handle /category/... or /products/... or case variations like /Category/... /Products/...
  if (lower.startsWith('/category/')) {
    const sub = trimmed.substring(10).replace(/\/+$/, '');
    const subLower = sub.toLowerCase();
    if (subLower === 'skin' || subLower === 'peau' || subLower === 'peaux') return '/skin';
    if (subLower === 'hair' || subLower === 'hair-and-scalp' || subLower === 'cheveux' || subLower === 'scalp') return '/hair-and-scalp';
    if (subLower === 'packs' || subLower === 'pack' || subLower === 'collections' || subLower === 'bundles') return '/packs';
    if (subLower === 'all' || subLower === 'products' || subLower === 'ourproducts') return '/products';
    return '/';
  }

  // Nested /products/<category> links are flattened onto the canonical slug,
  // the same way the /category/ branch above does. This used to return
  // `/products/${sub}` unchanged, so a section saved as '/products/skin' kept
  // linking to a URL serving an identical copy of /skin.
  //
  // An unrecognised sub-segment now flattens to '/<sub>' rather than staying
  // nested: /products/<x> is no longer a URL that exists, so leaving a link
  // pointing there would send visitors to a 404. A custom section stored in
  // that shape resolves at its flat slug instead.
  if (lower.startsWith('/products/')) {
    const sub = trimmed.substring(10).replace(/\/+$/, '');
    const subLower = sub.toLowerCase();
    if (subLower === 'all' || subLower === 'products' || subLower === 'ourproducts' || subLower === 'our-products') {
      return '/products';
    }
    if (subLower === 'skin' || subLower === 'peau' || subLower === 'peaux') return '/skin';
    if (subLower === 'hair' || subLower === 'hair-and-scalp' || subLower === 'hair_and_scalp' || subLower === 'cheveux' || subLower === 'scalp') return '/hair-and-scalp';
    if (subLower === 'packs' || subLower === 'pack' || subLower === 'collections' || subLower === 'bundles') return '/packs';
    return sub ? `/${sub}` : '/products';
  }

  return trimmed;
}
