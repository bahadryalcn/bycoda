// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import {
  LOCAL_MODEL_SOURCE,
  useModelSource,
  type ModelSource,
} from "../../sessions/ui/modelSource";
import type { HostDescriptor, HostModelCatalog, RemoteMachine } from "../model/protocol";
import { HostModelSource as RawHostModelSource, hostModelSource } from "./HostModelSource";

const { request, projects } = vi.hoisted(() => ({ request: vi.fn(), projects: vi.fn() }));
vi.mock("../model/connections", () => ({ remoteRequest: request }));
vi.mock("../../automations/model/machineSnapshot", () => ({ machineProjects: projects }));
const HostModelSource = withQueryClient(RawHostModelSource);

const descriptor: HostDescriptor = {
  protocolVersion: 1,
  environmentId: "env",
  name: "Host",
  providers: ["codex"],
  capabilities: [],
};
const catalog = (name: string): HostModelCatalog => ({
  models: { codex: [{ id: `codex:${name}`, nativeId: name, harness: "codex", name }] },
  errors: {},
});
const machine = (id: string): RemoteMachine => ({
  id,
  name: id,
  endpoint: `http://${id}`,
  environmentId: id,
});
let root: Root;
let container: HTMLDivElement;
let current: ModelSource;
function Consumer() {
  current = useModelSource();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  projects.mockReset();
  projects.mockResolvedValue([{ id: "project", cwd: "/work", name: "Work" }]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("uses only the target catalog while retaining saved model IDs and setting values", () => {
  const source = hostModelSource(
    "remote:B",
    descriptor,
    catalog("Host B"),
    "codex:saved",
    { reasoningEffort: "max" },
    vi.fn(),
  );
  expect(source.modelsFor("codex").map((model) => model.name)).toEqual(["Host B"]);
  expect(source.modelsFor("claude")).toEqual([]);
  expect(source.available("codex")).toBe(true);
  expect(source.available("claude")).toBe(false);
  expect(source.find("codex:Host B")?.name).toBe("Host B");
  expect(source.find("codex:desktop-only")).toBeUndefined();
  const saved = source.resolve("codex", "codex:saved");
  expect(saved.id).toBe("codex:saved");
  expect(
    saved.settings?.find((setting) => setting.id === "reasoningEffort")?.options,
  ).toContainEqual(expect.objectContaining({ value: "max" }));
});

it("switches target catalogs without accepting a late response from the previous host", async () => {
  let finishA!: (value: HostModelCatalog) => void;
  const pendingA = new Promise<HostModelCatalog>((resolve) => {
    finishA = resolve;
  });
  request.mockImplementation(async (id: string, method: string) =>
    method === "environment.describe" ? descriptor : id === "A" ? pendingA : catalog("Host B"),
  );
  const render = (id: string) =>
    act(async () =>
      root.render(
        createElement(HostModelSource, {
          machine: machine(id),
          cwd: `remote://${id}/work`,
          model: "codex:saved",
          values: {},
          children: createElement(Consumer),
        }),
      ),
    );
  await render("A");
  expect(current.modelsFor("codex")).toEqual([]);
  await render("B");
  expect(current.modelsFor("codex")[0]?.name).toBe("Host B");
  await act(async () => finishA(catalog("Host A")));
  expect(current.modelsFor("codex")[0]?.name).toBe("Host B");
  expect(request).toHaveBeenCalledWith("B", "models.list", {
    projectId: "project",
    progressive: true,
  });
  await act(async () => current.refresh(["codex"]));
  expect(
    request.mock.calls.filter(([id, method]) => id === "B" && method === "models.list"),
  ).toHaveLength(2);
  expect(request.mock.calls.some(([, method]) => method === "projects.open")).toBe(false);
});

it("keeps desktop automations on the local source without querying a host", async () => {
  await act(async () =>
    root.render(
      createElement(HostModelSource, {
        local: true,
        machine: machine("A"),
        cwd: "/work",
        model: "saved",
        values: {},
        children: createElement(Consumer),
      }),
    ),
  );
  expect(current).toBe(LOCAL_MODEL_SOURCE);
  expect(request).not.toHaveBeenCalled();
});
