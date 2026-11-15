// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { announceRemoteRecovery } from "./remoteHealth";
import { useReloadOnReconnect } from "./useReloadOnReconnect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(cwd: string | undefined, active: boolean, reload: () => void) {
  function Probe() {
    useReloadOnReconnect(cwd, reload, { active });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return root;
}

it("reloads once when its machine recovers while a load is failed", () => {
  const reload = vi.fn();
  const root = mount("remote://env-1/home", true, reload);
  act(() => announceRemoteRecovery("env-2"));
  expect(reload).not.toHaveBeenCalled();
  act(() => announceRemoteRecovery("env-1"));
  expect(reload).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it("stays quiet for healthy screens and local paths", () => {
  const reload = vi.fn();
  const healthy = mount("remote://env-1/home", false, reload);
  const local = mount("/home/me", true, reload);
  act(() => announceRemoteRecovery("env-1"));
  expect(reload).not.toHaveBeenCalled();
  act(() => {
    healthy.unmount();
    local.unmount();
  });
});
