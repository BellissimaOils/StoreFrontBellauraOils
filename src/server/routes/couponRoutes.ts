import express from "express";
import { authenticateAdmin } from "../middleware/auth";
import { logAdminAction } from "../services/auditLog";
import { generateUUID } from "../utils/idUtils";

// Coupon routes. Shared state: `coupons` array + saveDb + fetchRealD1CouponsIfConfigured.
// All three are passed in so this module stays decoupled from server.ts globals.

interface CouponsState {
  getCoupons: () => any[];
  setCoupons: (v: any[]) => void;
  fetchCouponsFromD1: () => Promise<any[] | null>;
  saveDb: () => Promise<void>;
  executeD1Query: (sql: string, params?: any[]) => Promise<boolean>;
  getLastD1WriteError?: () => string | null;
}

export function createCouponRouter(state: CouponsState) {
  const router = express.Router();

  router.get("/admin/coupons", authenticateAdmin, async (req, res) => {
    const d1Coupons = await state.fetchCouponsFromD1();
    if (d1Coupons !== null) state.setCoupons(d1Coupons);
    res.json({ success: true, coupons: state.getCoupons() });
  });

  router.post("/admin/coupons", authenticateAdmin, async (req, res) => {
    const { code, discountType, discountValue, isActive, expiresAt, minCartAmount, applicableProducts } = req.body;
    if (!code || !discountType || discountValue === undefined) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const d1Coupons = await state.fetchCouponsFromD1();
    if (d1Coupons !== null) state.setCoupons(d1Coupons);

    const coupons = state.getCoupons();
    const exists = coupons.some((c) => c.code.trim().toUpperCase() === code.trim().toUpperCase());
    if (exists) {
      return res.status(400).json({ success: false, message: "A coupon with this code already exists" });
    }

    const newCoupon = {
      id: generateUUID(),
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: Number(discountValue),
      isActive: isActive !== undefined ? isActive : true,
      expiresAt: expiresAt || null,
      minCartAmount: minCartAmount !== undefined && minCartAmount !== null ? Number(minCartAmount) : null,
      applicableProducts: Array.isArray(applicableProducts) ? applicableProducts : null,
    };

    coupons.push(newCoupon);
    await state.saveDb();

    const applicableStr = Array.isArray(newCoupon.applicableProducts)
      ? JSON.stringify(newCoupon.applicableProducts) : null;
    const insertCouponSql = `INSERT INTO coupons (
      id, code, discountType, discountValue, isActive, expiresAt, minCartAmount, applicableProducts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;
    // Column order above = params order below.
    //
    // minCartAmount uses ?? rather than the old `!== null ? x : "NULL"`: that
    // test passed for `undefined`, which interpolated the literal text
    // "undefined" into the SQL. ?? maps both null and undefined to a real NULL.
    const insertCouponParams = [
      newCoupon.id,
      newCoupon.code,
      newCoupon.discountType,
      newCoupon.discountValue,
      newCoupon.isActive ? 1 : 0,
      newCoupon.expiresAt,
      newCoupon.minCartAmount ?? null,
      applicableStr,
    ];
    // D1 is the source of truth for coupons: every read path here starts
    // with fetchCouponsFromD1(). So if this write fails but we still report
    // success, the coupon lives only in memory and silently disappears the
    // next time the page loads and refetches — which is exactly the
    // "I saved it and it didn't stick" symptom. Roll the local push back out
    // and surface the real error instead.
    const inserted = await state.executeD1Query(insertCouponSql, insertCouponParams);
    if (!inserted) {
      const idx = coupons.findIndex((c) => c.id === newCoupon.id);
      if (idx !== -1) coupons.splice(idx, 1);
      await state.saveDb();
      return res.status(500).json({
        success: false,
        message: `Failed to save the coupon to the database: ${state.getLastD1WriteError?.() || "unknown error"}. It was not created.`,
      });
    }

    await logAdminAction(req, "CREATE", "coupon", newCoupon.code, `Created coupon ${newCoupon.code} (${newCoupon.discountType}: ${newCoupon.discountValue})`);
    res.json({ success: true, coupon: newCoupon });
  });

  router.put("/admin/coupons/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { code, discountType, discountValue, isActive, expiresAt, minCartAmount, applicableProducts } = req.body;

    const d1Coupons = await state.fetchCouponsFromD1();
    if (d1Coupons !== null) state.setCoupons(d1Coupons);

    const coupons = state.getCoupons();
    const index = coupons.findIndex((c: any) => c.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    if (code) {
      const isTaken = coupons.some(
        (c: any) => c.id !== id && c.code.trim().toUpperCase() === code.trim().toUpperCase(),
      );
      if (isTaken) {
        return res.status(400).json({ success: false, message: "Another coupon is already using this code" });
      }
      coupons[index].code = code.trim().toUpperCase();
    }

    if (discountType) coupons[index].discountType = discountType;
    if (discountValue !== undefined) coupons[index].discountValue = Number(discountValue);
    if (isActive !== undefined) coupons[index].isActive = !!isActive;
    if (expiresAt !== undefined) coupons[index].expiresAt = expiresAt;
    if (minCartAmount !== undefined)
      coupons[index].minCartAmount = minCartAmount !== null ? Number(minCartAmount) : null;
    if (applicableProducts !== undefined)
      coupons[index].applicableProducts = Array.isArray(applicableProducts) ? applicableProducts : null;

    await state.saveDb();

    const updatedCoupon = coupons[index];
    const applicableStr = Array.isArray(updatedCoupon.applicableProducts)
      ? JSON.stringify(updatedCoupon.applicableProducts) : null;
    const updateCouponSql = `UPDATE coupons SET
      code = ?,
      discountType = ?,
      discountValue = ?,
      isActive = ?,
      expiresAt = ?,
      minCartAmount = ?,
      applicableProducts = ?
      WHERE id = ?;`;
    const updated = await state.executeD1Query(updateCouponSql, [
      updatedCoupon.code,
      updatedCoupon.discountType,
      updatedCoupon.discountValue,
      updatedCoupon.isActive ? 1 : 0,
      updatedCoupon.expiresAt,
      // See the note on the insert above re: ?? vs the old NULL test.
      updatedCoupon.minCartAmount ?? null,
      applicableStr,
      id,
    ]);
    if (!updated) {
      return res.status(500).json({
        success: false,
        message: `Failed to save the coupon changes to the database: ${state.getLastD1WriteError?.() || "unknown error"}. Your edit was not saved.`,
      });
    }

    await logAdminAction(req, "UPDATE", "coupon", id, `Updated coupon ${updatedCoupon.code}`);
    res.json({ success: true, coupon: coupons[index] });
  });

  router.delete("/admin/coupons/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    const d1Coupons = await state.fetchCouponsFromD1();
    if (d1Coupons !== null) state.setCoupons(d1Coupons);

    const coupons = state.getCoupons();
    const index = coupons.findIndex((c: any) => c.id === id);
    if (index !== -1) {
      const removed = coupons[index];
      coupons.splice(index, 1);
      await state.saveDb();
      const deleted = await state.executeD1Query(`DELETE FROM coupons WHERE id = ?;`, [id]);
      if (!deleted) {
        // Put it back — otherwise it looks deleted until the next refetch
        // resurrects it from D1, which is confusing.
        coupons.splice(index, 0, removed);
        await state.saveDb();
        return res.status(500).json({
          success: false,
          message: `Failed to delete the coupon from the database: ${state.getLastD1WriteError?.() || "unknown error"}.`,
        });
      }
      await logAdminAction(req, "DELETE", "coupon", id, `Deleted coupon #${id}`);
      res.json({ success: true, message: "Coupon deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Coupon not found" });
    }
  });

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
