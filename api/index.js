// api/index.js
// Static imports ensure Vercel Node File Trace (NFT) bundles these dependencies into the serverless function
import "express";
import "compression";
import "cors";
import "helmet";
import "express-rate-limit";
import "dotenv";
import "jsonwebtoken";
import "@aws-sdk/client-s3";
import "@google/genai";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let appPromise = null;

async function getExpressApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const candidates = [
        path.join(__dirname, "../dist/server.cjs"),
        path.join(process.cwd(), "dist/server.cjs"),
        path.join(__dirname, "dist/server.cjs"),
        path.join(process.cwd(), "server.cjs"),
      ];
      const bundlePath = candidates.find((p) => fs.existsSync(p));
      if (!bundlePath) {
        throw new Error(
          `dist/server.cjs not found.\nSearched:\n${candidates.join("\n")}\nCWD: ${process.cwd()}\n__dirname: ${__dirname}`
        );
      }
      const serverModule = require(bundlePath);
      const app = await (serverModule.app || serverModule.default || serverModule);
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const app = await getExpressApp();
    return app(req, res);
  } catch (error) {
    console.error("Vercel Serverless Function error:", error);
    res.status(500).setHeader("Content-Type", "text/plain").send(
      `Serverless Function Initialization Error:\n${error?.message || error}\n\nStack:\n${error?.stack || ""}`
    );
  }
}
