import type { HighlightOptions, HighlightResult } from "@streamdown/code";

let worker: Worker | undefined;
let nextId = 0;
const requests = new Map<
  number,
  {
    resolve: (result: HighlightResult) => void;
    reject: (reason: unknown) => void;
  }
>();

function workerForHighlighting() {
  if (worker) return worker;
  const created = new Worker(new URL("./codeHighlight.worker.ts", import.meta.url), {
    type: "module",
    name: "code-highlighter",
  });
  created.onmessage = ({ data }: MessageEvent<{ id: number; result: HighlightResult }>) => {
    requests.get(data.id)?.resolve(data.result);
    requests.delete(data.id);
  };
  const failed = () => {
    if (worker !== created) return;
    created.terminate();
    worker = undefined;
    for (const request of requests.values())
      request.reject(new Error("Code highlight worker failed"));
    requests.clear();
  };
  created.onerror = failed;
  created.onmessageerror = failed;
  return (worker = created);
}

/** Share grammars across settled fences, including simultaneous replies and both theme variants. */
export function highlightInWorker(args: HighlightOptions) {
  return new Promise<HighlightResult>((resolve, reject) => {
    const target = workerForHighlighting();
    const id = ++nextId;
    requests.set(id, { resolve, reject });
    try {
      target.postMessage({ id, args });
    } catch (cause) {
      requests.delete(id);
      reject(cause);
    }
  });
}
