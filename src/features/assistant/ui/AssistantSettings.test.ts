// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantSettings } from "./AssistantSettings";

const mock = vi.hoisted(() => ({
  calls: [] as string[],
  failProject: false,
  request: vi.fn(),
}));

vi.mock("../../settings/public/settingsControls", async () => {
  const { createElement } = await import("react");
  return {
    Row: ({ label, description, info, children }: any) =>
      createElement(
        "div",
        { role: "group", "aria-label": label },
        createElement("span", null, label),
        description ? createElement("p", null, description) : null,
        info,
        children,
      ),
    Group: ({ title, info, action, children }: any) =>
      createElement("section", null, createElement("h2", null, title), info, action, children),
    AdvancedSettings: ({ title, children }: any) =>
      createElement("div", null, createElement("button", { type: "button" }, title), children),
  };
});
vi.mock("../../../shared/i18n", () => ({
  formatNumber: (value: number) => value.toLocaleString(),
  formatDate: (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", options).format(value),
  t: (key: string, params?: Record<string, unknown>) =>
    key.replace(/\{(p\d+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`)),
  useT: () => (key: string) => key,
  useLocale: () => "en",
  translateAt: (_locale: string, key: string) => key,
}));
vi.mock("./AssistantProfileFields", async () => {
  const { createElement } = await import("react");
  return {
    AssistantProfileFields: ({ section, onChange }: any) =>
      section === "identity"
        ? createElement(
            "button",
            { type: "button", onClick: () => onChange({ name: "Ada" }) },
            "Rename assistant",
          )
        : null,
  };
});
vi.mock("./AssistantPresenceStatus", () => ({ AssistantPresenceStatus: () => null }));
vi.mock("./AssistantKeepAwakeStatus", () => ({ AssistantKeepAwakeStatus: () => null }));
vi.mock("./settings/AssistantUsageSettings", () => ({
  AssistantRetentionField: () => null,
}));
vi.mock("./ManualSessionSupervision", async () => {
  const { createElement, useEffect, useState } = await import("react");
  return {
    ManualSessionSupervision: ({ saveRef, onDraftStateChange }: any) => {
      const [dirty, setDirty] = useState(false);
      useEffect(() => {
        onDraftStateChange?.({ dirty, pending: false });
      }, [dirty, onDraftStateChange]);
      useEffect(() => {
        saveRef.current = async () => {
          mock.calls.push("project");
          if (mock.failProject) throw new Error("Project scope save failed");
          setDirty(false);
        };
      });
      return createElement(
        "button",
        { type: "button", onClick: () => setDirty(true) },
        "Change project scope",
      );
    },
  };
});
vi.mock("../../host-tools/DesktopControlSettings", async () => {
  const { createElement, useEffect, useState } = await import("react");
  return {
    DesktopControlSettings: ({ saveRef, onDraftStateChange }: any) => {
      const [dirty, setDirty] = useState(false);
      useEffect(() => {
        onDraftStateChange?.({ dirty, pending: false });
      }, [dirty, onDraftStateChange]);
      useEffect(() => {
        saveRef.current = async () => {
          mock.calls.push("computer");
          setDirty(false);
        };
      });
      return createElement(
        "button",
        { type: "button", onClick: () => setDirty(true) },
        "Change computer controls",
      );
    },
  };
});

let root: Root | undefined;
let container: HTMLDivElement;

function snapshot() {
  return {
    profile: { version: 3, name: "Arif", setupComplete: true },
    capabilities: {},
    conversationRetentionDays: 0,
    usage: {},
    keepAwake: {},
  } as any;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.calls = [];
  mock.failProject = false;
  mock.request = vi.fn(async (input: any) => {
    if (input.op === "profile.update") {
      mock.calls.push("profile");
      return {
        profile: { ...snapshot().profile, ...input.patch, version: input.expectedVersion + 1 },
      };
    }
    return { ok: true };
  });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  const onClose = vi.fn();
  const onSetup = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(AssistantSettings, {
        request: mock.request as any,
        snapshot: snapshot(),
        manual: {} as any,
        projects: [],
        onClose,
        onSetup,
      }),
    ),
  );
  return { onClose, onSetup };
}

function control(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
}

async function press(label: string) {
  const button = control(label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

function footerText() {
  return document.querySelector("footer")?.textContent ?? "";
}

it("keeps one footer row with a disabled Save until any section is dirty", async () => {
  await render();
  const save = control("Save profile settings")!;
  expect(save.disabled).toBe(true);
  expect(save.textContent).toBe("Save");
  expect(footerText()).toContain("Run setup again");
  expect(footerText()).not.toContain("Saved");
  await press("Change project scope");
  expect(control("Save profile settings")!.disabled).toBe(false);
  await press("Change computer controls");
  expect(control("Save profile settings")!.disabled).toBe(false);
});

it("saves profile, then project scope, then computer use, and shows Saved only after all succeed", async () => {
  await render();
  await press("Rename assistant");
  await press("Change project scope");
  await press("Change computer controls");
  await press("Save profile settings");
  expect(mock.calls).toEqual(["profile", "project", "computer"]);
  expect(footerText()).toContain("Saved");
  expect(footerText()).not.toContain("Discard unsaved changes?");
  expect(control("Save profile settings")!.disabled).toBe(true);
});

it("stops at the first failing section, shows its error and leaves the later sections unsaved", async () => {
  mock.failProject = true;
  await render();
  await press("Rename assistant");
  await press("Change project scope");
  await press("Change computer controls");
  await press("Save profile settings");
  expect(mock.calls).toEqual(["profile", "project"]);
  expect(document.querySelector("footer")!.textContent).toContain("Project scope save failed");
  expect(footerText()).not.toContain("Saved");
  expect(control("Save profile settings")!.disabled).toBe(false);
});

it("replaces the footer row with the discard confirmation and never shows Save or Saved beside it", async () => {
  const { onSetup } = await render();
  await press("Change project scope");
  await press("Run setup again");
  expect(footerText()).toContain("Discard unsaved changes?");
  expect(control("Save profile settings")).toBeUndefined();
  expect(footerText()).not.toContain("Saved");
  expect(footerText()).not.toContain("Run setup again");
  await press("Keep editing");
  expect(footerText()).toContain("Run setup again");
  expect(control("Save profile settings")).toBeDefined();
  expect(onSetup).not.toHaveBeenCalled();
  await press("Run setup again");
  await press("Discard");
  expect(onSetup).toHaveBeenCalledTimes(1);
});

it("clears the saved notice as soon as another section becomes dirty", async () => {
  await render();
  await press("Rename assistant");
  await press("Save profile settings");
  expect(footerText()).toContain("Saved");
  await press("Change computer controls");
  expect(footerText()).not.toContain("Saved");
  expect(control("Save profile settings")!.disabled).toBe(false);
});
