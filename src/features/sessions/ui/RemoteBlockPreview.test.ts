// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";

it("loads a preview only on explicit request and removes its control after expansion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const load = vi.fn();
  const preview = {
    id: "large",
    role: "assistant" as const,
    text: "Output preview",
    remoteContent: { revision: 9, bytes: 180000 },
  };
  try {
    await act(async () =>
      root.render(
        createElement(AgentTranscript, {
          blocks: [preview],
          busy: false,
          onLoadRemoteBlock: load,
        }),
      ),
    );
    expect(load).not.toHaveBeenCalled();
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Load full output"),
    );
    expect(button?.type).toBe("button");
    await act(async () => button!.click());
    expect(load).toHaveBeenCalledExactlyOnceWith("large", 9);
    await act(async () =>
      root.render(
        createElement(AgentTranscript, {
          blocks: [{ id: "large", role: "assistant", text: "Full output" }],
          busy: false,
          onLoadRemoteBlock: load,
        }),
      ),
    );
    expect(container.textContent).toContain("Full output");
    expect(container.textContent).not.toContain("Load full output");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
