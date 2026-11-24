import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { build } from "vite";

test(
  "production Markdown worker parses MiB documents without DOM globals",
  { timeout: 30000 },
  async () => {
    const entry = "\0markdown-worker-regression";
    const factory = resolve("src/features/sessions/ui/markdownWorker.ts").replaceAll("\\", "/");
    const bundle = await build({
      configFile: resolve("vite.config.ts"),
      logLevel: "silent",
      plugins: [
        {
          name: "markdown-worker-regression",
          resolveId: (id) => (id === entry ? entry : undefined),
          load: (id) =>
            id === entry
              ? `import { createMarkdownWorker } from ${JSON.stringify(factory)}; globalThis.worker = createMarkdownWorker();`
              : undefined,
        },
      ],
      build: { write: false, rolldownOptions: { input: entry } },
    });
    assert.ok(!Array.isArray(bundle) && "output" in bundle);
    const artifact = bundle.output.find((item) =>
      /streamingMarkdown\.worker-.*\.js$/.test(item.fileName),
    );
    assert.ok(
      artifact && artifact.type === "asset",
      "Worker must be emitted by the production config",
    );
    // Execute the emitted ES module inside a worker realm with no DOM.
    const moduleUrl = (source) =>
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    const worker = new Worker(
      new URL(
        moduleUrl(`
      import { parentPort } from "node:worker_threads";
      globalThis.self = { postMessage: message => parentPort.postMessage(message) };
      await import(${JSON.stringify(moduleUrl(artifact.source))});
      parentPort.on("message", data => self.onmessage({ data }));
    `),
      ),
    );
    try {
      for (const [index, line] of [
        "Paragraph with **bold** and &amp; entities.\n\n",
        "Türkçe içerik ve 漢字.\n\n",
      ].entries()) {
        const text = line.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(line)));
        assert.ok(Buffer.byteLength(text) >= 1024 * 1024);
        const response = once(worker, "message");
        worker.postMessage({ stream: "large-file", sequence: index + 1, text });
        const [result] = await response;
        assert.equal(result.failed, undefined);
        assert.ok(result.blocks.length > 1);
        assert.equal(result.blocks.join(""), text);
      }
    } finally {
      await worker.terminate();
    }
  },
);
