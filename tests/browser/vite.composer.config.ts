import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Bundle the actual Composer to avoid hundreds of development module requests.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-composer",
    emptyOutDir: false,
    rolldownOptions: {
      input: [
        "tests/browser/composer-extras.html",
        "tests/browser/git-generation.html",
        "tests/browser/workspace-layout.html",
        "tests/browser/crew-scene.html",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 1436, strictPort: true },
});
