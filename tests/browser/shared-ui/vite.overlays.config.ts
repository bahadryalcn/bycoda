import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { overlayFixture } from "./overlay-fixtures";

const fixture = overlayFixture();
const inputs = fixture.names.map((name) => `tests/browser/overlay-${name}.html`);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: inputs },
  build: {
    outDir: `temp/build/browser-overlays-${fixture.id}`,
    emptyOutDir: true,
    rolldownOptions: { input: inputs },
  },
  preview: { host: "127.0.0.1", port: fixture.port, strictPort: true },
});
