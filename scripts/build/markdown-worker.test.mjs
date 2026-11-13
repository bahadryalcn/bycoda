import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
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
    const output = [];
    const self = { postMessage: (message) => output.push(message) };
    const context = { self, setTimeout, clearTimeout, console };
    // Real worker bundle, deliberately no window/document/navigator or DOM shims.
    runInNewContext(String(artifact.source), context, { timeout: 15000 });

    for (const line of [
      "Paragraph with **bold** and &amp; entities.\n\n",
      "Türkçe içerik ve 漢字.\n\n",
    ]) {
      const text = line.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength(line)));
      assert.ok(Buffer.byteLength(text) >= 1024 * 1024);
      self.onmessage({ data: { stream: "large-file", sequence: output.length + 1, text } });
      const result = output.at(-1);
      assert.equal(result.failed, undefined);
      assert.ok(result.blocks.length > 1);
      assert.equal(result.blocks.join(""), text);
    }
  },
);
