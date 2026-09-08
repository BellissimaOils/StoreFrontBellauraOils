// api/index.js
//
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const serverModule = require("../dist/server.cjs");

export default async function handler(req, res) {
  try {
    // Default for everything: not cacheable. Individual routes override it —
    // the pre-rendered HTML pages set a shared-cache header so a crawl doesn't
    // have to invoke this function for every URL (see server.ts), and
    // robots.txt/sitemap.xml set their own.
    //
    // Pragma and Expires used to be set here as well. They are HTTP/1.0 relics
    // that no modern CDN needs, and once a page sets a real Cache-Control they
    // actively contradict it — leaving a response that says "cache me for five
    // minutes" next to two headers saying "never cache me".
    res.setHeader("Cache-Control", "no-store");
    
    // Wait for the startServer promise to resolve and export the app
    const app = await serverModule.app;
    
    // Pass the request to the Express app
    return app(req, res);
  } catch (error) {
    console.error("Error initializing Express app on Vercel:", error);
    res.status(500).send("Internal Server Error");
  }
}

