/**
 * Business rules for order eligibility:
 * - Packs (bundles, live packs): Minimum 1 pack is allowed.
 * - Single products (oils): Minimum 3 products in total.
 * - An order is eligible if it contains at least 1 pack OR at least 3 single products.
 */

export function isPackItem(item: any): boolean {
  if (!item) return false;
  if (item.isPack === true || item.is_pack === 1 || item.is_pack === true || item.is_pack === "1") return true;
  if (item.isLivePack === true || Boolean(item.livePackId)) return true;
  const id = String(item.id || item.product_nbr || "");
  if (id.startsWith("live_pack_") || id.startsWith("pack-") || id.startsWith("pack_")) return true;
  const cat = String(item.category || "").toLowerCase();
  const name = String(item.name || item.name_en || item.name_ar || "").toLowerCase();
  if (cat.includes("pack") || cat.includes("باقة") || cat.includes("مجموعة") || cat.includes("مجموعات")) return true;
  if (name.includes("pack") || name.includes("باقة") || name.includes("مجموعة") || name.includes("مجموعات") || name.includes("طقم")) return true;
  return false;
}

export interface OrderEligibility {
  isEligible: boolean;
  hasPack: boolean;
  singleCount: number;
  totalCount: number;
  remainingCount: number;
  progressPercent: number;
  messageAr: string;
  messageFr: string;
  messageEn: string;
}

export function checkOrderEligibility(items: any[]): OrderEligibility {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      isEligible: false,
      hasPack: false,
      singleCount: 0,
      totalCount: 0,
      remainingCount: 3,
      progressPercent: 0,
      messageAr: "الحد الأدنى للطلب هو 3 منتجات فردية أو باقة واحدة (Pack).",
      messageFr: "Le minimum de commande est de 3 produits individuels ou 1 pack.",
      messageEn: "Minimum order is 3 individual products or 1 pack.",
    };
  }

  let hasPack = false;
  let singleCount = 0;
  let totalCount = 0;

  for (const item of items) {
    const qty = Math.max(1, parseInt(String(item.quantity || 1), 10) || 1);
    totalCount += qty;
    if (isPackItem(item)) {
      hasPack = true;
    } else {
      singleCount += qty;
    }
  }

  const isEligible = hasPack || singleCount >= 3;
  const remainingCount = hasPack ? 0 : Math.max(0, 3 - singleCount);
  const progressPercent = hasPack ? 100 : Math.min(100, Math.round((singleCount / 3) * 100));

  let messageAr = "";
  let messageFr = "";
  let messageEn = "";

  if (isEligible) {
    if (hasPack) {
      messageAr = "طلبك مؤهل للإرسال (يتضمن باقة) ✓";
      messageFr = "Votre commande est éligible (contient un pack) ✓";
      messageEn = "Your order is eligible (includes a pack) ✓";
    } else {
      messageAr = "طلبك مؤهل للإرسال (3 منتجات فأكثر) ✓";
      messageFr = "Votre commande est éligible (3 produits ou plus) ✓";
      messageEn = "Your order is eligible (3+ products) ✓";
    }
  } else {
    if (remainingCount === 1) {
      messageAr = "أضف منتجاً واحداً إضافياً لإتمام الطلب (الحد الأدنى 3 منتجات أو باقة واحدة)";
      messageFr = "Ajoutez 1 produit de plus pour commander (minimum 3 produits ou 1 pack)";
      messageEn = "Add 1 more product to checkout (minimum 3 products or 1 pack)";
    } else {
      messageAr = `أضف ${remainingCount} منتجات إضافية لإتمام الطلب (الحد الأدنى 3 منتجات أو باقة واحدة)`;
      messageFr = `Ajoutez ${remainingCount} produits de plus pour commander (minimum 3 produits ou 1 pack)`;
      messageEn = `Add ${remainingCount} more products to checkout (minimum 3 products or 1 pack)`;
    }
  }

  return {
    isEligible,
    hasPack,
    singleCount,
    totalCount,
    remainingCount,
    progressPercent,
    messageAr,
    messageFr,
    messageEn,
  };
}
