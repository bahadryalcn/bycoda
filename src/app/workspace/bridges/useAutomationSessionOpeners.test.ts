// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ reserve: vi.fn(), adopt: vi.fn(), route: vi.fn() }));
vi.mock("../../model/sessionWindowOwnership", () => ({ reserveSessionWindow: api.reserve }));
vi.mock("../../model/windowNavigation", () => ({ routeWindowDestination: api.route }));
vi.mock("../../../features/connections/model/openLocalHostSession", () => ({
  openLocalHostSession: api.adopt,
}));
import {
  useAutomationSessionOpeners,
  type AutomationSessionOpenersDeps,
} from "./useAutomationSessionOpeners";

it("does not adopt a local Host session when another window owns it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.route.mockResolvedValue(false);
  api.reserve.mockResolvedValue(null);
  const root = createRoot(document.createElement("div"));
  let actions!: ReturnType<typeof useAutomationSessionOpeners>;
  const deps = { toolWindow: null } as unknown as AutomationSessionOpenersDeps;
  function Fixture() {
    actions = useAutomationSessionOpeners(deps);
    return null;
  }
  await act(async () => root.render(createElement(Fixture)));
  await act(async () =>
    actions.onOpenBackgroundSession({
      machineId: "local",
      cwd: "/repo",
      projectId: "p",
      sessionId: "s",
    }),
  );
  expect(api.reserve).toHaveBeenCalledWith(["s"]);
  expect(api.adopt).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
