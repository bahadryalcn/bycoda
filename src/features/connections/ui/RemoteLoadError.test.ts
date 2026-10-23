// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RemoteLoadError } from "./RemoteLoadError";

vi.mock("../model/useRemoteConnection", () => ({
  useRemoteConnection: () => ({ status: "identity-mismatch", reconnecting: false }),
}));
vi.mock("../model/connections", () => ({
  OPEN_CONNECTIONS_EVENT: "test-open-connections",
  requestMachineEdit: vi.fn(),
}));
vi.mock("../../../shared/i18n", () => ({
  t: (value: string) => value,
  useT: () => (value: string) => value,
  useLocale: () => "en",
}));

it("offers connection settings with the refused identity's re-pair instructions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  const root = createRoot(element);
  const open = vi.fn();
  window.addEventListener("test-open-connections", open);
  const message = "Host identity changed. Add this machine again before continuing.";
  try {
    await act(async () =>
      root.render(
        createElement(RemoteLoadError, {
          cwd: "remote://env/repo",
          failure: { kind: "identity", message },
        }),
      ),
    );
    expect(element.textContent).toContain(message);
    const buttons = [...element.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Connection settings");
    await act(async () => buttons[0].click());
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener("test-open-connections", open);
    vi.unstubAllGlobals();
  }
});
