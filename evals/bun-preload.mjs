import { plugin } from "bun";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The offline evals load voice decision modules whose browser entry points
// import a Vite asset URL. Keep the AudioWorklet source out of the Node-like runtime.
plugin({
  name: "offline-eval-voice-worklet-url",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/voiceCapture\.js\?url&no-inline$/ }, ({ importer }) => {
      const path = resolve(dirname(importer), "voiceCapture.js");
      if (!existsSync(path)) throw new Error(`Voice worklet asset is missing: ${path}`);
      return { path, namespace: "offline-eval-voice-worklet-url" };
    });
    builder.onLoad({ filter: /.*/, namespace: "offline-eval-voice-worklet-url" }, ({ path }) => ({
      loader: "js",
      contents: `export default ${JSON.stringify(pathToFileURL(path).href)};`,
    }));
  },
});
