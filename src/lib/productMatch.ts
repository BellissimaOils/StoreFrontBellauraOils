import { getProductSlug } from '../types';

/** Use the same identifier matching in the API and the product view. */
export function matchesProduct(product: any, id: string): boolean {
  const key = String(id).trim().toLowerCase();
  if (!product || !key) return false;
  return [product.id, product.slug, ...[product.name, product.name_en, product.name_ar]
    .filter(Boolean).map(getProductSlug)]
    .some(value => value != null && String(value).trim().toLowerCase() === key);
}
