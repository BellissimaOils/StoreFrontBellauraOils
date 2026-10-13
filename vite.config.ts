import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  envPrefix: ["VITE_", "CLOUDFLARE_"],
  define: {
    "import.meta.env.CLOUDFLARE_TURNSTILE_SITE_KEY": JSON.stringify(
      process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || ""
    ),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Split into meaningful chunks — no admin code ever lands here
        manualChunks(id) {
          if (id.includes("node_modules/react-dom")) return "react-dom";
          if (id.includes("node_modules/react-router")) return "router";
          if (id.includes("node_modules/motion")) return "motion";
          if (id.includes("node_modules/lucide")) return "icons";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
