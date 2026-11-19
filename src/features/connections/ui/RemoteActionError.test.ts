// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { describeRemoteError } from "../model/remoteFailure";
import { RemoteActionError } from "./RemoteActionError";

async function render(error: Parameters<typeof RemoteActionError>[0]["error"]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(RemoteActionError, { error })));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("shows the presented sentence and keeps the raw transport text behind Details", async () => {
  const { container, cleanup } = await render(
    describeRemoteError(new Error("The host request did not complete [RPC_TIMEOUT]")),
  );
  try {
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("This computer is busy right now");
    expect(alert.textContent).not.toContain("RPC_TIMEOUT");
    expect(alert.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull();
  } finally {
    cleanup();
  }
});

it("offers no Details when the raw text is the message itself", async () => {
  const { container, cleanup } = await render(describeRemoteError(new Error("Access denied")));
  try {
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Access denied");
    expect(container.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
  } finally {
    cleanup();
  }
});
