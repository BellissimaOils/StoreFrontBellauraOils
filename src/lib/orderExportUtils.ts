/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ExportOptions {
  format: "order_summary" | "itemized";
  separator: "bullet" | "newline" | "pipe";
  lang?: string;
}

/**
 * Properly escapes a string for CSV according to RFC 4180:
 * - Wraps cell in double quotes
 * - Escapes internal quotes by doubling them (" -> "")
 * - Preserves newlines, commas, and Arabic/French characters safely
 */
function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).trim();
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Translates status strings into user-friendly localized text
 */
function getStatusLabel(status: string, lang: string): string {
  const isAr = lang === "ar";
  const isFr = lang === "fr";
  const s = String(status || "").toLowerCase().trim();

  if (s === "confirmed" || s === "closed" || s === "completed") {
    return isAr ? "مؤكد (Confirmed)" : isFr ? "Confirmé" : "Confirmed";
  }
  if (s === "pending" || s === "opened") {
    return isAr ? "قيد الانتظار (Pending)" : isFr ? "En attente" : "Pending";
  }
  if (s === "cancelled") {
    return isAr ? "ملغي (Cancelled)" : isFr ? "Annulé" : "Cancelled";
  }
  if (s === "deleted by admin" || s === "deleted") {
    return isAr ? "محذوف (Deleted)" : isFr ? "Supprimé" : "Deleted";
  }
  return status || "";
}

/**
 * Translates cancellation / note codes
 */
function getCommentLabel(reason: string, lang: string): string {
  const isAr = lang === "ar";
  const isFr = lang === "fr";
  const r = String(reason || "").trim();
  if (!r) return "";

  if (r === "client_not_responding" || r.includes("not responding") || r.includes("لا يجيب")) {
    return isAr ? "الزبون لا يجيب" : isFr ? "Client ne répond pas" : "Client not responding";
  }
  if (r === "client_excused_before" || r.includes("excused before") || r.includes("قبل الشحن")) {
    return isAr ? "اعتذر الزبون قبل الشحن" : isFr ? "Client s'est excusé avant expédition" : "Client excused before shipping";
  }
  if (r === "client_excused_after" || r.includes("excused after") || r.includes("بعد الشحن")) {
    return isAr ? "اعتذر الزبون بعد الشحن" : isFr ? "Client s'est excusé après expédition" : "Client excused after shipping";
  }
  if (r === "ordered_with_error" || r.includes("with error") || r.includes("عن طريق الخطأ")) {
    return isAr ? "طلب عن طريق الخطأ" : isFr ? "Commandé par erreur" : "Ordered with error";
  }
  if (r === "pack_damaged" || r.includes("damaged") || r.includes("متضررة")) {
    return isAr ? "علبة متضررة" : isFr ? "Colis endommagé" : "Pack damaged";
  }
  return r;
}

/**
 * Converts orders array to an Excel-ready UTF-8 CSV string
 */
export function generateOrdersCSV(orders: any[], options: ExportOptions): string {
  const { format, separator, lang = "ar" } = options;
  const isAr = lang === "ar";

  if (format === "itemized") {
    // MODE B: One row per individual purchased item (Inventory & Packing list)
    const headers = [
      isAr ? "رقم الطلب (Order #)" : "Order Number",
      isAr ? "تاريخ الطلب (Date)" : "Order Date",
      isAr ? "وقت الطلب (Time)" : "Order Time",
      isAr ? "اسم العميل (Customer)" : "Customer Name",
      isAr ? "رقم الهاتف (Phone)" : "Phone Number",
      isAr ? "المدينة (City)" : "City",
      isAr ? "العنوان (Address)" : "Address",
      isAr ? "حالة الطلب (Order Status)" : "Order Status",
      isAr ? "حالة الشحن (Shipping Status)" : "Shipping Status",
      isAr ? "رقم الإرسالية (Dispatched #)" : "Dispatched Number",
      isAr ? "الترتيب بالطلب (Item Position)" : "Item Position",
      isAr ? "اسم المنتج (Product Name)" : "Product Name",
      isAr ? "معرف المنتج (Product ID)" : "Product ID / SKU",
      isAr ? "الكمية (Quantity)" : "Quantity",
      isAr ? "سعر الوحدة (Unit Price DH)" : "Unit Price (DH)",
      isAr ? "إجمالي البند (Item Total DH)" : "Item Total (DH)",
      isAr ? "إجمالي الطلب (Order Total DH)" : "Order Total (DH)",
      isAr ? "كود الكوبون (Coupon)" : "Coupon Code",
      isAr ? "ملاحظات الإلغاء (Notes)" : "Notes / Reason",
    ];

    const rows: string[] = [headers.map(escapeCSV).join(",")];

    orders.forEach((o) => {
      let dateStr = "";
      let timeStr = "";
      try {
        const d = new Date(o.createdAt);
        if (!isNaN(d.getTime())) {
          dateStr = d.toISOString().slice(0, 10);
          timeStr = d.toTimeString().slice(0, 8);
        }
      } catch {
        dateStr = String(o.createdAt || "");
      }

      const firstName = o.customer?.firstName || o.first_name || "";
      const lastName = o.customer?.lastName || o.last_name || "";
      const fullName = `${firstName} ${lastName}`.trim();
      const phone = o.customer?.phone || o.phone || "";
      const city = o.customer?.city || o.city || "";
      const address = o.customer?.address || o.address || "";
      const statusText = getStatusLabel(o.status, lang);
      const isShipped = !!(o.dispatchedNbr || o.shippingTracking);
      const shippingText = isShipped 
        ? (isAr ? "تم الشحن (Shipped)" : "Shipped") 
        : (isAr ? "غير مشحون (Not Shipped)" : "Not Shipped");
      const dispatchedNbr = o.dispatchedNbr || o.shippingTracking || "";
      const totalStr = String(o.cartTotal || o.total || 0).replace(/[^\d.]/g, "");
      const totalInt = Math.round(parseFloat(totalStr) || 0);
      const couponCode = o.couponApplied || o.coupon_applied || "";
      const notes = getCommentLabel(o.comment, lang);

      const items = Array.isArray(o.items) && o.items.length > 0 ? o.items : [
        { name: "Order Package", id: "-", quantity: 1, price: totalInt ? `${totalInt} DH` : "" }
      ];

      items.forEach((item: any, idx: number) => {
        const qty = Number(item.quantity) || 1;
        const priceNum = parseFloat(String(item.price || 0).replace(/[^\d.]/g, "")) || 0;
        const lineTotal = priceNum * qty;

        const row = [
          o.orderNbr || o.order_nbr || o.id,
          dateStr,
          timeStr,
          fullName,
          phone,
          city,
          address,
          statusText,
          shippingText,
          dispatchedNbr,
          `${idx + 1} of ${items.length}`,
          item.name || "Product",
          item.productNbr || item.id || "-",
          qty,
          priceNum ? `${priceNum} DH` : String(item.price || ""),
          lineTotal ? `${lineTotal} DH` : "-",
          totalInt ? `${totalInt} DH` : String(o.total || ""),
          couponCode,
          notes,
        ];
        rows.push(row.map(escapeCSV).join(","));
      });
    });

    return rows.join("\r\n");
  }

  // MODE A: One row per order (Summary with structured multi-product formatting)
  const headers = [
    isAr ? "رقم الطلب (Order #)" : "Order Number",
    isAr ? "تاريخ الطلب (Date)" : "Order Date",
    isAr ? "وقت الطلب (Time)" : "Order Time",
    isAr ? "اسم العميل (Customer)" : "Customer Name",
    isAr ? "رقم الهاتف (Phone)" : "Phone Number",
    isAr ? "المدينة (City)" : "City",
    isAr ? "العنوان (Address)" : "Address",
    isAr ? "الرمز البريدي (Postal Code)" : "Postal Code",
    isAr ? "حالة الطلب (Order Status)" : "Order Status",
    isAr ? "حالة الشحن (Shipping Status)" : "Shipping Status",
    isAr ? "رقم الإرسالية (Dispatched #)" : "Dispatched Number",
    isAr ? "رابط التتبع (Tracking Link)" : "Tracking Link",
    isAr ? "إجمالي عدد القطع (Total Items)" : "Total Items Count",
    isAr ? "عدد المنتجات المختلفة (Distinct Items)" : "Distinct Items Count",
    isAr ? "تفاصيل المنتجات (Products Summary)" : "Products Summary",
    isAr ? "قائمة المنتجات (Product Names)" : "Product Names List",
    isAr ? "قائمة الكميات (Quantities List)" : "Quantities List",
    isAr ? "قائمة الأسعار (Prices List)" : "Prices List",
    isAr ? "المجموع الفرعي (Subtotal DH)" : "Subtotal (DH)",
    isAr ? "قيمة الخصم (Discount DH)" : "Discount Amount (DH)",
    isAr ? "كود الكوبون (Coupon Code)" : "Coupon Code",
    isAr ? "المبلغ الإجمالي (Total DH)" : "Total Amount (DH)",
    isAr ? "ملاحظات الإلغاء (Notes / Reason)" : "Notes / Reason",
  ];

  const rows: string[] = [headers.map(escapeCSV).join(",")];

  orders.forEach((o) => {
    let dateStr = "";
    let timeStr = "";
    try {
      const d = new Date(o.createdAt);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().slice(0, 10);
        timeStr = d.toTimeString().slice(0, 8);
      }
    } catch {
      dateStr = String(o.createdAt || "");
    }

    const firstName = o.customer?.firstName || o.first_name || "";
    const lastName = o.customer?.lastName || o.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();
    const phone = o.customer?.phone || o.phone || "";
    const city = o.customer?.city || o.city || "";
    const address = o.customer?.address || o.address || "";
    const zip = o.customer?.zip || o.zip || "";
    const statusText = getStatusLabel(o.status, lang);
    const isShipped = !!(o.dispatchedNbr || o.shippingTracking);
    const shippingText = isShipped 
      ? (isAr ? "تم الشحن (Shipped)" : "Shipped") 
      : (isAr ? "غير مشحون (Not Shipped)" : "Not Shipped");
    const dispatchedNbr = o.dispatchedNbr || o.shippingTracking || "";
    const trackingLink = o.shippingTracking && o.shippingTracking.startsWith("http") 
      ? o.shippingTracking 
      : "";

    const totalStr = String(o.cartTotal || o.total || 0).replace(/[^\d.]/g, "");
    const totalInt = Math.round(parseFloat(totalStr) || 0);
    const subtotalStr = String(o.subtotal || o.cartTotal || o.total || 0).replace(/[^\d.]/g, "");
    const subtotalInt = Math.round(parseFloat(subtotalStr) || 0);
    const discountAmount = o.discountAmount || o.discount_amount || "";
    const couponCode = o.couponApplied || o.coupon_applied || "";
    const notes = getCommentLabel(o.comment, lang);

    const items = Array.isArray(o.items) ? o.items : [];
    const totalItemsCount = items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 1), 0);
    const distinctItemsCount = items.length;

    // Formatting multiple products cleanly based on selected separator
    let productsSummary = "";
    if (items.length === 0) {
      productsSummary = isAr ? "لا توجد تفاصيل عناصر" : "No items recorded";
    } else if (separator === "newline") {
      productsSummary = items
        .map((item: any, idx: number) => {
          const qty = item.quantity || 1;
          const price = item.price ? ` (${item.price})` : "";
          return `${idx + 1}. [x${qty}] ${item.name || "Product"}${price}`;
        })
        .join("\n");
    } else if (separator === "pipe") {
      productsSummary = items
        .map((item: any) => {
          const qty = item.quantity || 1;
          const price = item.price ? ` - ${item.price}` : "";
          return `${item.name || "Product"} (Qty: ${qty}${price})`;
        })
        .join(" | ");
    } else {
      // Default: Elegant bullet point separation
      productsSummary = items
        .map((item: any) => {
          const qty = item.quantity || 1;
          const price = item.price ? ` (${item.price})` : "";
          return `[x${qty}] ${item.name || "Product"}${price}`;
        })
        .join(" • ");
    }

    const productNamesList = items.map((i: any) => i.name || "").filter(Boolean).join("; ");
    const quantitiesList = items.map((i: any) => String(i.quantity || 1)).join("; ");
    const pricesList = items.map((i: any) => String(i.price || "")).filter(Boolean).join("; ");

    const row = [
      o.orderNbr || o.order_nbr || o.id,
      dateStr,
      timeStr,
      fullName,
      phone,
      city,
      address,
      zip,
      statusText,
      shippingText,
      dispatchedNbr,
      trackingLink,
      totalItemsCount,
      distinctItemsCount,
      productsSummary,
      productNamesList,
      quantitiesList,
      pricesList,
      subtotalInt ? `${subtotalInt} DH` : "",
      discountAmount ? `${discountAmount} DH` : "",
      couponCode,
      totalInt ? `${totalInt} DH` : String(o.total || ""),
      notes,
    ];

    rows.push(row.map(escapeCSV).join(","));
  });

  return rows.join("\r\n");
}
