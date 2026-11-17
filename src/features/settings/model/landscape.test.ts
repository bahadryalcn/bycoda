import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import source from "../data/backgrounds/mountain-lake.js?raw";

it("releases an allocated renderer when scene initialization fails", () => {
  const dispose = vi.fn(),
    forceContextLoss = vi.fn();
  const host = { dataset: {} as Record<string, string>, textContent: "", append: vi.fn() };
  const context = {
    THREE: {
      REVISION: "180",
      WebGLRenderer: class {
        setPixelRatio() {}
        dispose = dispose;
        forceContextLoss = forceContextLoss;
      },
      Scene: class {
        constructor() {
          throw new Error("GPU setup failed");
        }
      },
    },
    document: { querySelector: () => host },
    matchMedia: () => ({ matches: false }),
    devicePixelRatio: 3,
  };
  runInNewContext(source, context);
  expect(dispose).toHaveBeenCalledOnce();
  expect(forceContextLoss).toHaveBeenCalledOnce();
  expect(host.dataset.failed).toBe("true");
  expect(host.textContent).toContain("unavailable");
});
