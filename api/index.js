// api/index.js
//
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let serverAppPromise = null;

async function getApp() {
  if (!serverAppPromise) {
    serverAppPromise = (async () => {
      const serverModule = require("../dist/server.cjs");
      return await serverModule.app;
    })();
  }
  return serverAppPromise;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const app = await getApp();
    return app(req, res);
  } catch (error) {
    console.error("[Vercel Handler] Error initializing Express app:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error?.message || String(error),
      });
    }
  }
}

