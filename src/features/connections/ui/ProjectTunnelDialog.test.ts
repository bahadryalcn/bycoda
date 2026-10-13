// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { featureHost } from "../model/hostFeatureClient";
import { remoteRequest } from "../model/connections";
import { setLanguagePreference } from "../../../shared/i18n";
import { ProjectTunnelDialog } from "./ProjectTunnelDialog";

vi.mock("../model/hostFeatureClient", () => ({ featureHost: vi.fn() }));
vi.mock("../model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
}));
const machine = {
  id: "remote",
  environmentId: "remote-env",
  name: "Home Mac",
  endpoint: "http://127.0.0.1:49000",
};
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await setLanguagePreference("en");
  vi.mocked(featureHost).mockReset();
  vi.mocked(remoteRequest).mockReset();
  vi.mocked(featureHost).mockResolvedValue({ machine, projectId: "project" });
  vi.mocked(remoteRequest).mockImplementation(async (_id, method) =>
    method === "tunnels.status"
      ? {
          environmentId: "remote-env",
          hostLocalUrl: "http://127.0.0.1:3776",
          publicReachability: "unverified",
          tunnels: [],
          providers: [
            { provider: "ngrok", installed: true, credential: "missing" },
            { provider: "cloudflare", installed: true, credential: "not-required" },
          ],
        }
      : {},
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      createElement(ProjectTunnelDialog, {
        cwd: "remote://remote-env/project",
        localUrl: "5173",
        onClose: () => {},
      }),
    ),
  );

it("shares the chosen project server on its owning remote host", async () => {
  await render();
  expect(featureHost).toHaveBeenCalledWith("remote://remote-env/project", "tunnels.manage");
  expect(container.querySelector("input")?.value).toBe("5173");
  const start = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Start tunnel",
  )!;
  await act(async () => start.click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "remote",
    "tunnels.start",
    { provider: "cloudflare", target: "dev-server", localUrl: "http://127.0.0.1:5173" },
    false,
    true,
  );
});

it("does not fall back locally when the project's machine is unavailable", async () => {
  vi.mocked(featureHost).mockRejectedValueOnce(new Error("private-diagnostic"));
  await render();
  expect(container.textContent).toContain("selected computer could not be reached");
  expect(container.textContent).not.toContain("private-diagnostic");
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("shows a host upgrade requirement instead of attempting an unsupported start", async () => {
  vi.mocked(featureHost).mockRejectedValueOnce(
    new Error("Update bycoda Host on this project's machine"),
  );
  await render();
  expect(container.textContent).toContain("Update bycoda Host on this computer");
  expect(remoteRequest).not.toHaveBeenCalled();
});
