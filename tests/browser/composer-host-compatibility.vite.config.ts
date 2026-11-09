import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/c1-composer-host-compatibility",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/composer-host-compatibility.html" },
  },
  preview: { host: "127.0.0.1", port: 1447, strictPort: true },
});
