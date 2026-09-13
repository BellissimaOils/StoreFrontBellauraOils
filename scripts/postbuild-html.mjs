import fs from "fs";
import path from "path";

/**
 * Renames dist/index.html to dist/app.html after the build.
 *
 * Why: Vercel checks the filesystem BEFORE applying `rewrites`. vercel.json
 * rewrites everything to /api/index, but a request for "/" matched the built
 * dist/index.html and was served as a plain static file — so the Express SPA
 * fallback never ran for the homepage.
 *
 * The visible symptom was the browser tab showing index.html's hardcoded
 * English <title> and then changing once React loaded. The invisible and more
 * damaging half: the homepage was served to crawlers with none of the
 * server-injected SEO — no meta description, no canonical, no Open Graph tags
 * and no JSON-LD — because all of that is added by the function.
 *
 * With no dist/index.html there is nothing for "/" to match, so the rewrite
 * applies and the function renders the homepage like every other route. The
 * server reads app.html as its shell.
 *
 * Trade-off worth knowing: the homepage no longer has a static file to fall
 * back on, so if the function fails the homepage fails with it. Every other
 * route already depended on the function, so this makes the homepage
 * consistent with the rest of the site rather than uniquely resilient.
 */

const distDir = path.join(process.cwd(), "dist");
const from = path.join(distDir, "index.html");
const to = path.join(distDir, "app.html");

if (!fs.existsSync(distDir)) {
  console.error("[postbuild] dist/ not found — did vite build run?");
  process.exit(1);
}

if (fs.existsSync(from)) {
  fs.copyFileSync(from, to);
  console.log("[postbuild] copied dist/index.html to dist/app.html");
} else if (fs.existsSync(to)) {
  fs.copyFileSync(to, from);
  console.log("[postbuild] copied dist/app.html to dist/index.html");
} else {
  console.error(
    "[postbuild] neither dist/index.html nor dist/app.html exists — the build produced no HTML shell",
  );
  process.exit(1);
}

// The server refuses to boot without a shell, so fail the build here instead of
// at runtime.
if (!fs.existsSync(to)) {
  console.error("[postbuild] rename reported success but dist/app.html is missing");
  process.exit(1);
}
