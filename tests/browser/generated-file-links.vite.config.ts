import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    {
      name: "generated-file-links-fixture-styles",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/styles/index.css")) return;
        return code.replace(
          '@import "tailwindcss";',
          '@import "tailwindcss" source(none);\n@source "../../src";\n@source "../../tests/browser/generated-file-links.tsx";',
        );
      },
    },
    tailwindcss(),
  ],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "temp/build/generated-file-links",
    rolldownOptions: { input: "tests/browser/generated-file-links.html" },
  },
  preview: { host: "127.0.0.1", port: 14783, strictPort: true },
});
