/** @returns {import("vite").Plugin[]} */
export function workerRuntimePlugins() {
  return [
    {
      name: "bycoda-worker-runtime",
      enforce: "pre",
      async resolveId(source, importer) {
        if (source !== "decode-named-character-reference") return;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (!resolved) return;
        // This package's browser export creates a DOM element at module load.
        // Its worker/default export uses the same entity table without a document.
        return { ...resolved, id: resolved.id.replace(/index\.dom\.js$/, "index.js") };
      },
    },
  ];
}
