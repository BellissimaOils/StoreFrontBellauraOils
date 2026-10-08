import express from "express";

// Coupon routes for the Public Storefront.
// Only customer-facing POST /coupons/validate is exposed (pre-flight check at checkout).
// Admin coupon management belongs strictly in the Admin Dashboard.

interface CouponsState {
  getCoupons: () => any[];
  setCoupons: (v: any[]) => void;
  fetchCouponsFromD1: () => Promise<any[] | null>;
}

export function createCouponRouter(state: CouponsState) {
  const router = express.Router();

  // Public: validate a coupon code at checkout
  router.post("/coupons/validate", async (req, res) => {
    const { code, cartPrice, cartItems } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: "Coupon code is required" });
    }

    const d1Coupons = await state.fetchCouponsFromD1();
    if (d1Coupons !== null) state.setCoupons(d1Coupons);

    const coupons = state.getCoupons();
    const coupon = coupons.find(
      (c: any) => c.code.trim().toUpperCase() === code.trim().toUpperCase(),
    );
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Discount code is invalid." });
    }
    if (!coupon.isActive) {
      return res.status(400).json({ success: false, message: "This code is currently inactive" });
    }
    if (coupon.expiresAt) {
      const now = new Date();
      const expiry = new Date(coupon.expiresAt);
      if (now > expiry) {
        return res.status(400).json({ success: false, message: "This coupon code has expired" });
      }
    }
    if (coupon.minCartAmount && cartPrice !== undefined && Number(cartPrice) < coupon.minCartAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum spend of ${coupon.minCartAmount} DH is required for this code.`,
      });
    }
    if (coupon.applicableProducts && coupon.applicableProducts.length > 0 && Array.isArray(cartItems)) {
      const matchingItems = cartItems.filter((item: any) =>
        coupon.applicableProducts.includes(item.id),
      );
      if (matchingItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "This code is only applicable to specific products that are not currently in your cart.",
        });
      }
    }

    res.json({
      success: true,
      coupon: {
        id: coupon.id,
        code: coupon.code.toUpperCase(),
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        expiresAt: coupon.expiresAt || null,
        minCartAmount: coupon.minCartAmount || null,
        applicableProducts: coupon.applicableProducts || null,
      },
    });
  });

  return router;
}
