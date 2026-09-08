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
// Only JWT_SECRET is required now — admin access is Clerk-only
// (see /api/admin/clerk-login). The username/password path and its
// ADMIN_PASSWORD_HASH have been removed.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[SECURITY] JWT_SECRET must be set as an environment variable in production. " +
      "Set it in Vercel → Project → Settings → Environment Variables."
    );
  } else {
    throw new Error(
      "[SECURITY] JWT_SECRET is not set. " +
      "Add it to your .env file before starting the server."
    );
  }
}

// Exported so any route that issues an admin JWT (e.g. the Clerk-login
// token exchange) signs with the exact same secret this middleware
// verifies against.
export const JWT_SECRET = process.env.JWT_SECRET!;

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
