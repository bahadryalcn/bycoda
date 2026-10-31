import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { cudaTorchIndexes } from "./voice-gpu";

it("offers only CUDA wheel indexes the installed driver can run, newest first", () => {
  const index = (tag: string) => `https://download.pytorch.org/whl/${tag}`;
  expect(cudaTorchIndexes("13.0")).toEqual([index("cu130"), index("cu128"), index("cu126")]);
  expect(cudaTorchIndexes("12.8")).toEqual([index("cu128"), index("cu126")]);
  expect(cudaTorchIndexes("12.4")).toEqual([]);
  const all = [index("cu130"), index("cu128"), index("cu126")];
  expect(cudaTorchIndexes(undefined)).toEqual(all);
  expect(cudaTorchIndexes("13.0; rm")).toEqual(all);
});

it("reads the CUDA version from current and older nvidia-smi summaries", async () => {
  vi.resetModules();
  const outputs: Record<string, string> = {
    query: "NVIDIA GeForce RTX 4070\n",
    summary: "| NVIDIA-SMI 617.14   KMD Version: 617.14   CUDA UMD Version: 13.4 |",
  };
  vi.doMock("node:child_process", () => ({
    spawn: (_program: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        kill: vi.fn(),
      });
      queueMicrotask(() => {
        child.stdout.write(args.length ? outputs.query : outputs.summary);
        child.emit("close", 0);
      });
      return child;
    },
  }));
  const { detectNvidiaGpu } = await import("./voice-gpu");
  expect(await detectNvidiaGpu()).toEqual({ name: "NVIDIA GeForce RTX 4070", cuda: "13.4" });
  vi.doUnmock("node:child_process");
});
