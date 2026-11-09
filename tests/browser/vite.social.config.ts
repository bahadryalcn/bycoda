import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    {
      // Scan only the sources this fixture renders; a whole-repository scan stalls the local build.
      name: "bounded-social-fixture-css",
      enforce: "pre",
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/styles/index.css"))
          return code
            .replace(
              '@import "tailwindcss";',
              '@import "tailwindcss" source(none);\n@source "../shared";\n@source "../app/shell";\n@source "../app/workspace/surfaces";\n@source "../features/social";\n@source "../features/sessions/ui";\n@source "../integrations/social";',
            )
            .replaceAll(/@source "\.\.\/\.\.\/node_modules[^;]+;/g, "");
      },
    },
    tailwindcss(),
  ],
  build: {
    outDir: "temp/build/browser-social",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/social.html" },
  },
  preview: { host: "127.0.0.1", port: 1437, strictPort: true },
});
