import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const mock = fileURLToPath(new URL("./voice-visual-styles-mocks.ts", import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: ["localVoice", "localVoiceClient", "voiceConversation", "sessionsStore"].map((name) => ({
      find: new RegExp(`(?:.*\\/)${name}$`),
      replacement: mock,
    })),
  },
  build: {
    outDir: "temp/build/voice-visual-styles",
    emptyOutDir: false,
    rolldownOptions: { input: "tests/browser/voice-visual-styles.html" },
  },
  server: { host: "127.0.0.1", port: 1497, strictPort: true },
  preview: { host: "127.0.0.1", port: 1497, strictPort: true },
});
