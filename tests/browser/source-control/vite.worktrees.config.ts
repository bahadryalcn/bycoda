import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixtureSourceScan } from "../support/fixtureSourceScan.ts";

export default defineConfig({
  plugins: [fixtureSourceScan(), react(), tailwindcss()],
  build: {
    outDir: "temp/build/browser-worktrees",
    emptyOutDir: false,
    rolldownOptions: {
      input: [
        "tests/browser/source-control/worktrees.html",
        "tests/browser/workspace/workspace-creation.html",
        "tests/browser/workspace/workspace-actions.html",
        "tests/browser/app-shell/build-identity.html",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 1497, strictPort: true },
});
