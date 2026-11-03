import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const mock = fileURLToPath(new URL("./assistant-room-mocks.tsx", import.meta.url));
export default defineConfig({
  plugins: [
    react(),
    {
      name: "bounded-assistant-fixture-css",
      enforce: "pre",
      transform(code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/styles/index.css"))
          return code
            .replace(
              '@import "tailwindcss";',
              '@import "tailwindcss" source(none);\n@source "../shared/ui";\n@source "../features/assistant";\n@source "../features/sessions/ui/SessionFiltersMenu.tsx";\n@source "../features/sessions/ui/AssistantSessionControl.tsx";\n@source "../features/tasks/ui/AssistantTaskBadge.tsx";\n@source "../features/settings/ui/ShortcutSettings.tsx";',
            )
            .replaceAll(/@source "\.\.\/\.\.\/node_modules[^;]+;/g, "");
      },
    },
    tailwindcss(),
  ],
  resolve: {
    alias: [
      "hostFeatureClient",
      "ModelPicker",
      "VoiceSetupSteps",
      "assistantBriefingSpeech",
      "assistantHostRead",
      "assistantSessionDetach",
    ].map((name) => ({ find: new RegExp(`(?:.*\\/)${name}$`), replacement: mock })),
  },
  build: {
    outDir: "temp/build/assistant-room",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/assistant-room.html"] },
  },
  server: { host: "127.0.0.1", port: 15632, strictPort: true },
  preview: { host: "127.0.0.1", port: 15632, strictPort: true },
});
