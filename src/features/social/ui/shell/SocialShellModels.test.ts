// @vitest-environment happy-dom
import { act, createElement, useId, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../../tests/browser/support/queryTest";
import type {
  HostDescriptor,
  HostModelCatalog,
  RemoteMachine,
} from "../../../connections/model/protocol";
import {
  ModelSourceContext,
  useModelSource,
  type ModelSource,
} from "../../../sessions/public/modelSource";
import type { ModelPicker } from "../../../sessions/public/ModelPicker";
import type { SocialScreenProps } from "./screens";
import { AiModelSettings } from "../accounts/AiModelSettings";
import { useSocialWorkspace } from "./useSocialWorkspace";
import { SocialShell as RawSocialShell, type SocialHeaderProps } from "./SocialShell";

const { request, projects, pickers } = vi.hoisted(() => ({
  request: vi.fn(),
  projects: vi.fn(),
  pickers: {} as Record<string, { source: ModelSource; props: ComponentProps<typeof ModelPicker> }>,
}));
vi.mock("../../../connections/model/connections", () => ({ remoteRequest: request }));
vi.mock("../../../automations/model/machineSnapshot", () => ({ machineProjects: projects }));
vi.mock("./useSocialWorkspace", () => ({ useSocialWorkspace: vi.fn() }));
vi.mock("./SocialFirstRun", () => ({ SocialFirstRun: () => null }));
vi.mock("../../model/socialClient", () => ({ socialClient: vi.fn(() => ({})) }));
vi.mock("../command/CommandScreen", async () => {
  const { AiSetupCard } = await import("../command/AiSetupCard");
  return { CommandScreen: () => createElement(AiSetupCard, { busy: false, onSave: vi.fn() }) };
});
vi.mock("../accounts/AccountsScreen", async () => {
  const { AiModelSettings } = await import("../accounts/AiModelSettings");
  return {
    AccountsScreen: ({ machineId }: SocialScreenProps) =>
      createElement(AiModelSettings, {
        client: { request: vi.fn() } as unknown as SocialScreenProps["client"],
        policies: {
          global: {
            agent: {
              provider: "codex",
              model: `codex:${machineId}`,
              providerAccountId: `${machineId}-work`,
              modelSettings: { reasoningEffort: "max" },
            },
          },
          platforms: {},
        },
        onChanged: vi.fn(),
      }),
  };
});
vi.mock("../content/ContentScreen", () => ({ ContentScreen: () => null }));
vi.mock("../audience/AudienceScreen", () => ({ AudienceScreen: () => null }));
vi.mock("../inbox/InboxScreen", () => ({ InboxScreen: () => null }));
// Exercise real shell + settings composition; observe the source at the picker's public boundary.
vi.mock("../../../sessions/public/ModelPicker", () => ({
  ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
    const source = useModelSource();
    const observation = useId();
    const key =
      props.inheritChoice?.label === "Choose a model" && !props.model ? "setup" : props.model;
    pickers[key === "setup" ? observation : key] = { source, props };
    return createElement(
      "output",
      { "data-picker": key, "data-observation": observation },
      source.resolve(props.harness, props.model).name,
    );
  },
}));
vi.mock("../../../sessions/public/ModelLabel", () => ({
  ModelLabel: ({ name, model }: { name?: string; model: string }) =>
    createElement("span", { "data-inherited-model": "" }, name ?? model),
}));
// Choose a scope via the real Select contract without involving the popup implementation.
vi.mock("../../../../shared/ui/Select", () => ({
  Select: ({ onValueChange }: { onValueChange(value: string): void }) =>
    createElement("button", { onClick: () => onValueChange("x") }, "Scope X"),
}));

const SocialShell = withQueryClient(RawSocialShell);
const machines: RemoteMachine[] = ["A", "B"].map((id) => ({
  id,
  name: id,
  endpoint: `http://${id}`,
  environmentId: `env-${id}`,
}));
const descriptor: HostDescriptor = {
  protocolVersion: 1,
  environmentId: "env",
  name: "Host",
  providers: ["codex"],
  capabilities: [],
};
const catalog = (id: string): HostModelCatalog => ({
  models: { codex: [{ id: `codex:${id}`, nativeId: id, harness: "codex", name: `Host ${id}` }] },
  accounts: { codex: [{ id: `${id}-work`, label: `${id} work` }] },
  errors: {},
});
const desktopSource: ModelSource = {
  id: "desktop",
  accounts: { codex: [{ id: "desktop-work", label: "Desktop work" }] },
  modelsFor: () => [
    { id: "codex:desktop", nativeId: "desktop", harness: "codex", name: "Desktop model" },
  ],
  resolve: () => ({
    id: "codex:desktop",
    nativeId: "desktop",
    harness: "codex",
    name: "Desktop model",
  }),
  available: () => true,
  probed: () => true,
  find: () => undefined,
  refresh: vi.fn(),
};
let root: Root, element: HTMLDivElement;
const shell = { hostOnline: true, unreachable: false, aiStopped: false };
function render(id: string) {
  vi.mocked(useSocialWorkspace).mockReturnValue({
    machines,
    machineId: id,
    projects: [{ id: `${id}-project`, name: id, cwd: `/work/${id}` }],
    projectId: `${id}-project`,
    client: {} as SocialScreenProps["client"],
    shell,
    loaded: true,
    error: "",
    selectWorkspace: vi.fn(),
    setAiStopped: vi.fn(),
    retry: vi.fn(),
    shellFor: () => shell,
    projectFor: () => `${id}-project`,
  });
  return act(async () =>
    root.render(
      createElement(
        ModelSourceContext.Provider,
        { value: desktopSource },
        createElement(SocialShell, {
          cwd: "/desktop/project",
          onClose: vi.fn(),
          header: ({ children }: SocialHeaderProps) => createElement("header", null, children),
        }),
      ),
    ),
  );
}
async function accounts() {
  await act(async () => {
    [...element.querySelectorAll<HTMLButtonElement>(".social-shell-nav button")]
      .find((button) => button.textContent === "Accounts & Settings")!
      .click();
  });
}
function setup() {
  const visible = [...element.querySelectorAll<HTMLOutputElement>('[data-picker="setup"]')].find(
    (node) => !node.closest<HTMLElement>(".social-shell-host")?.hidden,
  )!;
  return pickers[visible.dataset.observation!]!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset();
  projects.mockReset();
  for (const key of Object.keys(pickers)) delete pickers[key];
  projects.mockImplementation(async (machine: RemoteMachine) => [
    { id: `${machine.id}-project`, name: machine.id, cwd: `/work/${machine.id}` },
  ]);
  request.mockImplementation(async (id: string, method: string) =>
    method === "environment.describe" ? descriptor : catalog(id),
  );
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it("uses the selected Social Host for setup, then isolates catalogs and accounts across Host switches", async () => {
  await render("A");
  expect(setup().source.modelsFor("codex")[0]?.name).toBe("Host A");
  expect(setup().source.accounts).toEqual(catalog("A").accounts);
  await accounts();
  expect(pickers["codex:A"]!.source.modelsFor("codex")[0]?.name).toBe("Host A");
  expect(pickers["codex:A"]!.props.accountId).toBe("A-work");
  await render("B");
  expect(setup().source.modelsFor("codex")[0]?.name).toBe("Host B");
  await accounts();
  expect(pickers["codex:B"]!.source.accounts).toEqual(catalog("B").accounts);
  expect(pickers["codex:B"]!.props.accountId).toBe("B-work");
  expect(pickers["codex:B"]!.source.find("codex:desktop")).toBeUndefined();
  expect(request).toHaveBeenCalledWith("B", "models.list", {
    projectId: "B-project",
    progressive: true,
  });
});

it("does not accept a late catalog or desktop identity while the selected Host loads", async () => {
  let finishA!: (value: HostModelCatalog) => void;
  let finishB!: (value: HostModelCatalog) => void;
  const pendingA = new Promise<HostModelCatalog>((resolve) => {
    finishA = resolve;
  });
  const pendingB = new Promise<HostModelCatalog>((resolve) => {
    finishB = resolve;
  });
  request.mockImplementation(async (id: string, method: string) =>
    method === "environment.describe" ? descriptor : id === "A" ? pendingA : pendingB,
  );
  await render("A");
  await render("B");
  expect(setup().source.modelsFor("codex")).toEqual([]);
  expect(setup().source.accounts).toEqual({});
  await act(async () => finishA(catalog("A")));
  expect(setup().source.modelsFor("codex")).toEqual([]);
  await act(async () => finishB(catalog("B")));
  expect(setup().source.modelsFor("codex")[0]?.name).toBe("Host B");
  expect(setup().source.accounts).toEqual(catalog("B").accounts);
});

it("keeps a missing explicit Host empty rather than falling back to desktop credentials", async () => {
  await render("missing");
  expect(setup().source.modelsFor("codex")).toEqual([]);
  expect(setup().source.accounts).toEqual({});
  expect(request).not.toHaveBeenCalled();
});

it("preserves an intentional standalone fixture source outside the Social Host boundary", async () => {
  await act(async () =>
    root.render(
      createElement(
        ModelSourceContext.Provider,
        { value: desktopSource },
        createElement(AiModelSettings, {
          client: {} as SocialScreenProps["client"],
          policies: {
            global: { agent: { provider: "codex", model: "codex:saved" } },
            platforms: {},
          },
          onChanged: vi.fn(),
        }),
      ),
    ),
  );
  expect(pickers["codex:saved"]!.source).toBe(desktopSource);
  expect(request).not.toHaveBeenCalled();
});

it("shows the effective inherited model and saved effort absent from the Host's current catalog", async () => {
  await render("B");
  await accounts();
  await act(async () =>
    [...element.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Scope X")!
      .click(),
  );
  const { source, props } = pickers["codex:B"]!;
  expect(props.inheritChoice).toMatchObject({
    selected: true,
    label: "Use the all-accounts model",
  });
  expect(props.model).toBe("codex:B");
  expect(props.values).toEqual({ reasoningEffort: "max" });
  expect(source.resolve(props.harness, props.model).name).toBe("Host B");
  expect(element.querySelector("[data-inherited-model]")?.textContent).toBe("Host B");
  expect(
    source
      .resolve(props.harness, props.model)
      .settings?.find((setting) => setting.id === "reasoningEffort")?.options,
  ).toContainEqual(expect.objectContaining({ value: "max" }));
});
