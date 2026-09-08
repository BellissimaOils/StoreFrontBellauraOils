import fs from "fs";
import path from "path";
import type { Request, Response, NextFunction } from "express";

// Two fully self-contained static-file helpers used during server boot/
// request-serving — neither depends on any shared module-level state,
// so both were straightforward to move out of startServer()'s local
// scope with zero behavior change.

// Robust Unicode-normalization and case-insensitive static file helper to
// prevent broken images caused by NFC vs NFD normalization mismatches
// (especially with Arabic chars) or case-sensitivity.
export function serveUnicodeStatic(routePrefix: string, physicalDir: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const decodedPath = decodeURIComponent(req.path);
      if (!decodedPath || decodedPath === "/") return next();

      const segments = decodedPath.split("/").filter(Boolean);
      let solvedPath = physicalDir;

      for (const segment of segments) {
        if (!fs.existsSync(solvedPath)) {
          return next();
        }

        const items = fs.readdirSync(solvedPath);
        const matched = items.find((item) => {
          const itemNFC = item.normalize("NFC");
          const itemNFD = item.normalize("NFD");
          const segNFC = segment.normalize("NFC");
          const segNFD = segment.normalize("NFD");
          return (
            itemNFC === segNFC ||
            itemNFD === segNFD ||
            itemNFC === segNFD ||
            itemNFD === segNFC ||
            item.toLowerCase() === segment.toLowerCase()
          );
        });

        if (!matched) {
          return next();
        }
        solvedPath = path.join(solvedPath, matched);
      }

      try {
        const stats = fs.statSync(solvedPath);
        if (stats.isFile()) {
          res.setHeader("Cache-Control", "public, max-age=604800, immutable");
          return res.sendFile(solvedPath);
        }
      } catch {}
      next();
    } catch (err) {
      console.error(`Error in serveUnicodeStatic for ${routePrefix}:`, err);
      next();
    }
  };
}

// Synchronise public/Pictures to public/images recursively on startup to
// transition to the user-preferred folder structure.
export async function migratePicturesToImages() {
  const srcDir = path.join(process.cwd(), "public/Pictures");
  const destDir = path.join(process.cwd(), "public/images");

  if (!fs.existsSync(srcDir)) return;

  const copyRecursive = (src: string, dest: string) => {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const dirEntries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of dirEntries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        try {
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
          }
        } catch (e) {
          console.error(
            `Failed to copy file from ${srcPath} to ${destPath}:`,
            e,
          );
        }
      }
    }
  };

  try {
    copyRecursive(srcDir, destDir);
    console.log(
      "Successfully migrated files from public/Pictures to public/images",
    );

    // Update the Git index to let the file explorer know the images are present and tracked
    try {
      const { execSync } = await import("child_process");
      execSync("git add public/images", { stdio: "ignore" });
      console.log(
        "Successfully staged migrated public/images into Git index.",
      );
    } catch (gitErr) {
      // Silently ignore if git is not in PATH or repo is clean
    }
  } catch (err) {
    console.error("Migration error:", err);
  }
}
