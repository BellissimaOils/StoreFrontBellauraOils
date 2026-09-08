/**
 * Works out exactly which products a customer should be asked to review, given
 * the raw list of things they bought (or the admin selected).
 *
 * Three rules:
 *
 *  1. A pack is a reviewable thing in its own right. Buying a pack of three
 *     oils produces four boxes: one for the pack (how it worked as a set, the
 *     value, the presentation) and one for each oil. The pack's box comes
 *     first, and its review is the only one shown on the pack's page — member
 *     reviews are not copied onto it, so a pack carries its own independent
 *     rating rather than an average of its contents.
 *
 *  2. A pack still expands into the products inside it, so each of those gets
 *     its own box and its own review on its own page.
 *
 *  3. The same product must never be asked for twice. Buying "Pack A" (which
 *     contains A, B and C) together with a separate bottle of B is completely
 *     normal: B arrives twice, once from inside the pack and once on its own,
 *     and the customer must still see exactly one box for that bottle.
 *
 * De-duplication is by product **id**, not by name. Name matching is what the
 * rest of the review pipeline does historically, and it is wrong here for a
 * reason that matters: the id is what `packProductIds` stores, so a pack's
 * member and the separately-bought line item only reliably collapse into one
 * entry when both are resolved to a catalog product and compared by id. Names
 * are kept solely as a fallback for line items that no longer resolve to
 * anything in the catalog (a deleted or renamed product on an old order), so
 * those still get a box instead of silently disappearing.
 */

/** A raw "thing that was bought/selected", as stored on tokens and orders. */
export interface ReviewTargetSource {
  id?: string | number | null;
  name?: string | null;
}

/** One product the customer will be given a review box for. */
export interface ReviewTarget {
  /**
   * Stable de-dup/React key. Prefixed by kind so a product whose id is "12"
   * can't collide with a product literally named "12".
   */
  key: string;
  /** Catalog product id, or "" when the source couldn't be resolved. */
  id: string;
  /** Display name. Always non-empty. */
  name: string;
  /**
   * True when this entry is the pack itself rather than one of the products
   * inside it. The forms use it to label the box and to keep it above the
   * members' boxes.
   */
  isPack: boolean;
}

/** The subset of the product shape this module needs. */
interface CatalogProduct {
  id?: string | number;
  name?: string;
  name_en?: string;
  isPack?: boolean;
  packProductIds?: string[];
}

const norm = (value: unknown): string => String(value ?? "").toLowerCase().trim();

const targetKey = (id: string, name: string): string =>
  id ? `id:${norm(id)}` : `name:${norm(name)}`;

/**
 * @param sources what was bought or selected, in the order it should appear
 * @param catalog the full product list, used to resolve ids/names and to look
 *                inside packs
 */
export function buildReviewTargets(
  sources: ReviewTargetSource[] | null | undefined,
  catalog: CatalogProduct[] | null | undefined,
): ReviewTarget[] {
  const byId = new Map<string, CatalogProduct>();
  const byName = new Map<string, CatalogProduct>();

  for (const product of catalog || []) {
    if (!product) continue;
    const id = norm(product.id);
    if (id && !byId.has(id)) byId.set(id, product);
    // name_en as well as name: orders and tokens store whichever label was
    // shown at the time, and the two differ on translated products.
    for (const label of [product.name, product.name_en]) {
      const key = norm(label);
      if (key && !byName.has(key)) byName.set(key, product);
    }
  }

  const resolve = (source: ReviewTargetSource): CatalogProduct | null => {
    // Id first: it survives a rename, a name doesn't.
    const viaId = byId.get(norm(source?.id));
    if (viaId) return viaId;
    return byName.get(norm(source?.name)) || null;
  };

  const targets: ReviewTarget[] = [];
  const seen = new Set<string>();

  const push = (id: string, name: string, isPack: boolean) => {
    const cleanName = String(name ?? "").trim();
    if (!cleanName) return;
    const key = targetKey(id, cleanName);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ key, id: String(id ?? ""), name: cleanName, isPack });
  };

  for (const source of sources || []) {
    const product = resolve(source);

    if (!product) {
      // Unknown to the catalog — keep it, labelled with whatever name the
      // order recorded, so the customer can still review what they bought.
      push("", String(source?.name ?? ""), false);
      continue;
    }

    const isPack = product.isPack === true;
    const packMemberIds = Array.isArray(product.packProductIds)
      ? product.packProductIds
      : [];

    // The product itself first — for a pack, that is the pack's own box, and it
    // has to come before the members' boxes.
    push(String(product.id ?? ""), String(product.name ?? ""), isPack);

    if (isPack) {
      for (const memberId of packMemberIds) {
        const member = byId.get(norm(memberId));
        // A member that no longer exists is skipped rather than guessed at.
        if (!member) continue;
        push(
          String(member.id ?? ""),
          String(member.name ?? ""),
          member.isPack === true,
        );
      }
    }
  }

  // Packs to the front, everything else in the order it was added.
  //
  // The loop above already puts a pack immediately before its own members, but
  // only relative to itself: an order listing a separate bottle before the pack
  // would put that bottle's box above the pack's. A stable partition guarantees
  // the pack review is always the first thing the customer is asked for.
  return [
    ...targets.filter((target) => target.isPack),
    ...targets.filter((target) => !target.isPack),
  ];
}

/**
 * Does an existing review row belong to this target?
 *
 * Used when a review is edited: rows store their product as a name (which is
 * what gets rendered as a tag), so match on name, and accept the id too for
 * rows written by anything that stored one.
 */
export function reviewRowMatchesTarget(
  rowProducts: unknown,
  target: ReviewTarget,
): boolean {
  if (!Array.isArray(rowProducts) || rowProducts.length === 0) return false;
  const refs = rowProducts.map(norm);
  if (target.id && refs.includes(norm(target.id))) return true;
  return refs.includes(norm(target.name));
}
