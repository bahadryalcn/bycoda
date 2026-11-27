import { afterEach, expect, it, vi } from "vitest";
import type { HighlightOptions, HighlightResult } from "@streamdown/code";
import { createBoundedCodePlugin } from "./codeHighlightPlugin";

class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage?: (event: { data: { id: number; result: HighlightResult } }) => void;
  onerror?: () => void;
  sent: { id: number; args: HighlightOptions }[] = [];
  terminate = vi.fn();
  constructor() {
    WorkerStub.instances.push(this);
  }
  postMessage(request: { id: number; args: HighlightOptions }) {
    this.sent.push(request);
  }
}

afterEach(() => {
  WorkerStub.instances.at(-1)?.onerror?.();
  WorkerStub.instances.length = 0;
  vi.unstubAllGlobals();
});

it("routes settled fences through one worker, matches concurrent replies and recovers on failure", async () => {
  vi.stubGlobal("Worker", WorkerStub);
  const plugin = createBoundedCodePlugin();
  const args = (code: string): HighlightOptions => ({
    code,
    language: "typescript",
    themes: plugin.getThemes(),
    isIncomplete: false,
  });
  const get = (code: string) =>
    new Promise<HighlightResult>((resolve) => {
      const cached = plugin.highlight(args(code), resolve);
      if (cached) resolve(cached);
    });
  const a = get("const a=1;"),
    b = get("const b=2;"),
    same = get("const a=1;");
  await vi.waitFor(() => expect(WorkerStub.instances[0]?.sent).toHaveLength(2));
  const worker = WorkerStub.instances[0];
  for (const {
    id,
    args: { code },
  } of [...worker.sent].reverse()) {
    worker.onmessage?.({
      data: { id, result: { tokens: [[{ content: code, offset: 0 }]], themeName: "github" } },
    });
  }
  expect((await a).tokens[0][0].content).toBe("const a=1;");
  expect(await same).toBe(await a);
  expect((await b).tokens[0][0].content).toBe("const b=2;");
  expect(plugin.highlight(args("const b=2;"))).toBe(await b);
  const retry = get("const c=3;");
  await vi.waitFor(() => expect(worker.sent).toHaveLength(3));
  worker.onerror?.();
  expect(worker.terminate).toHaveBeenCalledOnce();
  const local = await retry;
  expect(local.tokens[0].map((t) => t.content).join("")).toBe("const c=3;");
  expect(local.tokens[0].length).toBeGreaterThan(1);
});
