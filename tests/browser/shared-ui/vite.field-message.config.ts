import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The product stylesheet scans only src/ and the root documents. This fixture-only build adds the
// fixture folder so the fixture generates its own utilities; src/ is untouched.
const scanFixtures = {
  name: "scan-browser-fixtures",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.split("?")[0].replaceAll("\\", "/").endsWith("src/styles/index.css")) return null;
    return code.replace(
      '@source "../../*.html";',
      '@source "../../*.html";\n@source "../../tests/browser";',
    );
  },
};

export default defineConfig({
  plugins: [scanFixtures, react(), tailwindcss()],
  optimizeDeps: { entries: ["tests/browser/shared-ui/field-message.html"] },
  build: {
    outDir: "temp/build/browser-field-message",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/shared-ui/field-message.html" },
  },
  preview: { host: "127.0.0.1", port: 1459, strictPort: true },
});
