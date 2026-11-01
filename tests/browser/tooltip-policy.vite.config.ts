import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [{ name: "tooltip-fixture-utilities", enforce: "pre", transform(code, id) {
    if (!id.split("?")[0].replaceAll("\\", "/").endsWith("src/styles/index.css")) return null;
    return code.replace('@source not "../../tests";', "");
  } }, react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/tooltip-policy.html"] },
  build: { outDir: "temp/build/browser-tooltip-policy", emptyOutDir: false, rolldownOptions: { input: "tests/browser/tooltip-policy.html" } },
  server: { host: "127.0.0.1", port: 1459, strictPort: true },
  preview: { host: "127.0.0.1", port: 1459, strictPort: true },
});
