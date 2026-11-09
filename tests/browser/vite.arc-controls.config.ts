import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The product stylesheet excludes tests/ from Tailwind scanning. This fixture-only build lets the
// fixture generate its own utilities; src/ is untouched.
const scanFixtures = {
  name: "scan-browser-fixtures",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.split("?")[0].replaceAll("\\", "/").endsWith("src/styles/index.css")) return null;
    return code.replace('@source not "../../tests";', "");
  },
};

export default defineConfig({
  plugins: [scanFixtures, react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/arc-controls.html"] },
  build: {
    outDir: "temp/build/browser-arc-controls",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/arc-controls.html" },
  },
  preview: { host: "127.0.0.1", port: 1442, strictPort: true },
});
