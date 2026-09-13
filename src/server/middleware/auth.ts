import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// dotenv.config() is safe/idempotent to call more than once. This module
// reads process.env.JWT_SECRET at import time (not inside a function body),
// and ES module imports are evaluated before the importing file's own
// top-level statements run — so server.ts's own dotenv.config() calls
// cannot be relied on to have already populated process.env by the time
// this file is first evaluated. Calling it here too guarantees a local
// .env file is loaded regardless of module evaluation order. (Not needed
// on Vercel, where env vars are injected directly rather than read from a
// .env file — this only matters for local dev.)
dotenv.config();

// Admin Auth Setup
// In the public storefront, admin routes are not exposed to the public.
// Provide a safe fallback so the serverless function does not crash on startup
// if JWT_SECRET is omitted from storefront environment variables.
export const JWT_SECRET = process.env.JWT_SECRET || "bellaura_storefront_fallback_secret_not_for_admin";

export const authenticateAdmin = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // Explicitly verify the role claim — don't trust signature alone
    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden: insufficient privileges" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};
