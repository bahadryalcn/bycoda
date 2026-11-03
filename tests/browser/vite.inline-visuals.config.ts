import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage, ServerResponse } from "node:http";

// Fixture-only native preview substitute. HTML stays in memory, never on disk.
function previewTransport(): Plugin {
  const snapshots = new Map<string, string>();
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!request.url?.startsWith("/__inline-preview")) return next();
    const token = request.url.split("/")[2];
    if (request.method === "POST") {
      let content = "";
      for await (const chunk of request) content += chunk;
      if (content.length > 12_000) {
        response.statusCode = 413;
        return response.end();
      }
      const id = crypto.randomUUID();
      snapshots.set(id, content);
      response.setHeader("Content-Type", "text/plain");
      return response.end(id);
    }
    if (request.method === "DELETE") {
      snapshots.delete(token);
      return response.end();
    }
    const content = snapshots.get(token);
    if (!content) {
      response.statusCode = 404;
      return response.end("Preview closed");
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'",
    );
    response.end(content);
  };
  return {
    name: "inline-visual-fixture-transport",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), previewTransport()],
  optimizeDeps: { entries: ["tests/browser/inline-visuals.html"], noDiscovery: true },
  server: { host: "127.0.0.1", port: 15487, strictPort: true },
  build: {
    minify: false,
    cssMinify: false,
    reportCompressedSize: false,
    outDir: "temp/build/browser-inline-visuals",
    emptyOutDir: false,
    rolldownOptions: { input: ["tests/browser/inline-visuals.html"] },
  },
  preview: { host: "127.0.0.1", port: 15487, strictPort: true },
});
