/**
 * Order State Machine for Bellaura Oils Storefront & Fulfillment
 *
 * Controlled order states and transition rules:
 * Primary Flow:
 *   NEW (pending) -> CONFIRMED -> PREPARING -> SHIPPED -> DELIVERED
 *
 * Terminal / Exception States:
 *   CANCELLED (from NEW, CONFIRMED, PREPARING, SHIPPED)
 *   REFUSED (from SHIPPED)
 *   RETURNED (from SHIPPED, DELIVERED, REFUSED)
 */

export type OrderState =
  | "NEW"
  | "CONFIRMED"
  | "PREPARING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUSED"
  | "RETURNED";

export const ORDER_STATES: Record<OrderState, OrderState> = {
  NEW: "NEW",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  REFUSED: "REFUSED",
  RETURNED: "RETURNED",
};

/**
 * Valid transitions between order states
 */
export const ALLOWED_TRANSITIONS: Record<OrderState, OrderState[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "REFUSED", "RETURNED", "CANCELLED"],
  DELIVERED: ["RETURNED"],
  CANCELLED: [],
  REFUSED: ["RETURNED"],
  RETURNED: [],
};

/**
 * Normalize arbitrary legacy/display status strings to canonical OrderState
 */
export function normalizeOrderStatus(raw: string | null | undefined): OrderState {
  if (!raw) return "NEW";
  const s = String(raw).trim().toUpperCase();

  switch (s) {
    case "PENDING":
    case "NEW":
    case "EN_ATTENTE":
    case "جديد":
      return "NEW";

    case "CONFIRMED":
    case "CONFIRME":
    case "CONFIRMEE":
    case "مؤكد":
      return "CONFIRMED";

    case "PREPARING":
    case "PROCESSING":
    case "EN_PREPARATION":
    case "قيد_التحضير":
      return "PREPARING";

    case "SHIPPED":
    case "DISPATCHED":
    case "EXPEDIE":
    case "تم_الشحن":
      return "SHIPPED";

    case "DELIVERED":
    case "LIVRE":
    case "تم_التسليم":
      return "DELIVERED";

    case "CANCELLED":
    case "CANCELED":
    case "ANNULE":
    case "ملغى":
      return "CANCELLED";

    case "REFUSED":
    case "REFUSE":
    case "مرفوض":
      return "REFUSED";

    case "RETURNED":
    case "RETOURNÉ":
    case "RETOURNE":
    case "مرتجع":
      return "RETURNED";

    default:
      return "NEW";
  }
}

/**
 * Validate whether a transition from fromState to toState is permitted
 */
export function isValidOrderTransition(
  fromState: string | OrderState,
  toState: string | OrderState
): { valid: boolean; reason?: string } {
  const normalizedFrom = normalizeOrderStatus(fromState);
  const normalizedTo = normalizeOrderStatus(toState);

  // Idempotent: same state is always valid
  if (normalizedFrom === normalizedTo) {
    return { valid: true };
  }

  const allowedNext = ALLOWED_TRANSITIONS[normalizedFrom] || [];
  if (allowedNext.includes(normalizedTo)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Invalid order state transition from ${normalizedFrom} to ${normalizedTo}. Allowed transitions: ${allowedNext.join(", ") || "none (terminal state)"}`,
  };
}
