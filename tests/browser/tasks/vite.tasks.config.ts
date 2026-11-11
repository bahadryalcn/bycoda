import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "bounded-task-fixture-css",
      enforce: "pre",
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/styles/index.css"))
          return code
            .replace(
              '@import "tailwindcss" source("..");',
              '@import "tailwindcss" source(none);\n@source "../shared/ui";\n@source "../features/tasks";\n@source "../features/workspaces";\n@source "../features/sessions/ui";',
            )
            .replaceAll(/@source "\.\.\/\.\.\/node_modules[^;]+;/g, "");
      },
    },
    tailwindcss(),
  ],
  build: {
    outDir: "temp/build/browser-tasks",
    emptyOutDir: false,
    rolldownOptions: {
      input: [
        "tests/browser/tasks/tasks.html",
        "tests/browser/workspace/workspace-rewind.html",
        "tests/browser/chat/transcript.html",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 1438, strictPort: true },
});
