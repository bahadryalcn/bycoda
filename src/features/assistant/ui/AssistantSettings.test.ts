// @vitest-environment happy-dom
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
vi.mock("../../settings/public/modelsSettingsLink", () => ({ openModelsSettings: vi.fn() }));
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantSettings } from "./AssistantSettings";
import { assistantAccessPatch } from "./settings/assistantAccess";

const mock = vi.hoisted(() => ({
  calls: [] as string[],
  failProject: false,
  full: false,
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
      createElement(
        "section",
        null,
        title ? createElement("h2", null, title) : null,
        info,
        action,
        children,
      ),
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
        : createElement("i", { "data-profile-section": section }),
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
    DesktopControlSettings: ({
      saveRef,
      accessRef,
      onDraftStateChange,
      showPermissionControls,
    }: any) => {
      const [full, setFull] = useState(mock.full);
      const [dirty, setDirty] = useState(false);
      useEffect(() => {
        onDraftStateChange?.({
          dirty,
          pending: false,
          access: {
            enabled: true,
            permissionMode: full ? "full" : "ask",
            allowPhysicalInput: true,
          },
        });
      }, [dirty, full, onDraftStateChange]);
      useEffect(() => {
        accessRef.current = (choice: string) => {
          setFull(choice === "full");
          setDirty(true);
        };
        saveRef.current = async () => {
          mock.calls.push("computer");
          setDirty(false);
        };
      });
      return createElement(
        "button",
        {
          type: "button",
          "data-individual-controls": showPermissionControls,
          onClick: () => setDirty(true),
        },
        "Change computer controls",
      );
    },
  };
});

vi.mock("./settings/folders/AssistantFoldersSettings", async () => {
  const { createElement, useEffect, useState } = await import("react");
  return {
    // Like the real section, it shows its own save error inline and rethrows it.
    AssistantFoldersSettings: ({
      saveRef,
      accessRef,
      onDraftStateChange,
      showPermissionControls,
    }: any) => {
      const [full, setFull] = useState(mock.full);
      const [dirty, setDirty] = useState(false);
      const [error, setError] = useState("");
      useEffect(() => {
        onDraftStateChange?.({
          dirty,
          pending: false,
          runWithoutAsking: full,
          allowChangesWithoutAsking: full,
        });
      }, [dirty, full, onDraftStateChange]);
      useEffect(() => {
        accessRef.current = (value: boolean) => {
          setFull(value);
          setDirty(true);
        };
        saveRef.current = async () => {
          mock.calls.push("folders");
          setError("Folder rejected");
          throw new Error("Folder rejected");
        };
      });
      return createElement(
        "div",
        { "data-individual-controls": showPermissionControls },
        createElement("button", { type: "button", onClick: () => setDirty(true) }, "Add folder"),
        error ? createElement("p", null, error) : null,
      );
    },
  };
});

let root: Root | undefined;
let container: HTMLDivElement;

function snapshot() {
  return {
    profile: {
      version: 3,
      name: "Arif",
      setupComplete: true,
      ...(mock.full
        ? assistantAccessPatch(
            {
              execution: {
                harness: "codex",
                model: "gpt-6",
                runtimeMode: "supervised",
                modelSettings: {},
                maxRunMinutes: 60,
              },
            },
            "full",
          )
        : {}),
    },
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
  mock.full = false;
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
  expect(footerText()).toContain("Quick setup");
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
  expect(control("Saved")!.textContent).toBe("Saved");
  expect(document.querySelector("footer")!.querySelectorAll("button")).toHaveLength(2);
  expect(
    document.querySelector("footer")!.querySelectorAll("[role=status]:not(.sr-only)"),
  ).toHaveLength(0);
  expect(footerText()).not.toContain("Discard unsaved changes?");
  expect(control("Saved")!.disabled).toBe(true);
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

it("shows a folder save error once, in its section, not again in the footer", async () => {
  await render();
  await press("Add folder");
  await press("Save profile settings");
  expect(mock.calls).toEqual(["folders"]);
  expect(document.body.textContent!.split("Folder rejected")).toHaveLength(2);
  expect(footerText()).not.toContain("Folder rejected");
  expect(footerText()).not.toContain("Saved");
});

it("keeps the save action busy until the Host confirms and never reports an unconfirmed save", async () => {
  let finish!: (value: unknown) => void;
  mock.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await press("Rename assistant");
  await press("Save profile settings");
  expect(control("Saving…")!.getAttribute("aria-busy")).toBe("true");
  expect(footerText()).not.toContain("Saved");
  await act(async () => finish({}));
  expect(footerText()).toContain("The settings save was not confirmed.");
  expect(footerText()).not.toContain("Saved");
  expect(control("Save profile settings")!.disabled).toBe(false);
});

it("replaces the footer row with the discard confirmation and never shows Save or Saved beside it", async () => {
  const { onSetup } = await render();
  await press("Change project scope");
  await press("Quick setup");
  expect(footerText()).toContain("Discard unsaved changes?");
  expect(control("Save profile settings")).toBeUndefined();
  expect(footerText()).not.toContain("Saved");
  expect(footerText()).not.toContain("Quick setup");
  await press("Keep editing");
  expect(footerText()).toContain("Quick setup");
  expect(control("Save profile settings")).toBeDefined();
  expect(onSetup).not.toHaveBeenCalled();
  await press("Quick setup");
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

function page(id: string) {
  return document.querySelector<HTMLElement>(`[data-settings-page="${id}"]`)!;
}
function sections(id: string) {
  return [...page(id).querySelectorAll("[data-profile-section]")].map((node) =>
    node.getAttribute("data-profile-section"),
  );
}
function titles(id: string) {
  return [...page(id).querySelectorAll("h2")].map((node) => node.textContent);
}

it("offers four tabs: Personal, Work, Access and Advanced", async () => {
  await render();
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((node) => node.textContent);
  expect(tabs).toEqual(["Personal", "Work", "Access", "Advanced"]);
  expect(document.querySelectorAll("[data-settings-page]")).toHaveLength(4);
});

it("groups every setting under the tab that answers its question", async () => {
  await render();
  expect(titles("personal")).toEqual(["Identity", "Conversation"]);
  expect(sections("personal")).toEqual(["language", "personality", "behavior"]);
  expect(titles("work")).toEqual(["Models", "Presence and hours"]);
  expect(sections("work")).toEqual(["budget", "presence", "notifications"]);
  expect(titles("access")).toEqual([
    "Access",
    "Customize access",
    "Job permissions",
    "Folders and commands",
    "Computer use",
    "Manual session supervision",
    "Ready for 24/7",
  ]);
  expect(titles("advanced")).toEqual(["Cost and context", "Retention and usage"]);
  // Collapsed disclosures keep their sections mounted, so drafts survive.
  expect(page("access").textContent).toContain("Customize access");
  expect(page("access").textContent).toContain("Ready for 24/7");
  expect(page("personal").textContent).toContain("Personality and conversation");
});

it("shows the permission picker only once a worker execution exists", async () => {
  await render();
  expect(sections("access")).toEqual(["jobs"]);
  expect(page("access").textContent).toContain(
    "Choose a worker model before enabling job execution.",
  );
});

it("links to Models roles without a pool editor or writable pool request", async () => {
  await render();
  await press("Manage models");
  expect(openModelsSettings).toHaveBeenCalledWith("roles");
  expect(mock.request.mock.calls.some(([input]) => input.op === "models.pool.set")).toBe(false);
  expect(control("Add model")).toBeUndefined();
});

it("keeps preset grants selected while customizing and preserves the mounted owners", async () => {
  mock.full = true;
  await render();
  await press("Access");
  const full = control("Full access")!;
  expect(full.getAttribute("aria-checked")).toBe("true");
  expect(sections("access")).toEqual([]);
  expect(page("access").querySelectorAll('[data-individual-controls="false"]')).toHaveLength(2);
  await press("Custom");
  expect(full.getAttribute("aria-checked")).toBe("true");
  expect(sections("access")).toEqual(["jobs", "permissions"]);
  expect(control("Save profile settings")!.disabled).toBe(true);
  await press("Done");
  expect(sections("access")).toEqual([]);
  await press("Add folder");
  await press("Save profile settings");
  expect(page("access").textContent).toContain("Folder rejected");
  expect(sections("access")).toEqual(["jobs", "permissions"]);
  expect(mock.calls).toEqual(["folders"]);
});

it("reveals the hidden tab and nested settings disclosures before focusing an invalid field", async () => {
  await render();
  const advanced = document.createElement("section");
  advanced.dataset.settingsPart = "advanced";
  advanced.innerHTML =
    '<h3><button type="button" aria-expanded="false">Technical limits</button></h3><div hidden><details><summary>Additional limits</summary><input type="number" min="1" value="0" required></details></div>';
  page("advanced").append(advanced);
  const toggle = advanced.querySelector("button")!;
  toggle.addEventListener("click", () => {
    advanced.dataset.open = "true";
    toggle.setAttribute("aria-expanded", "true");
    advanced.querySelector("div")!.hidden = false;
  });
  const details = advanced.querySelector("details")!;
  const input = advanced.querySelector("input")!;
  const focus = vi.spyOn(input, "focus");
  const report = vi.spyOn(input, "reportValidity").mockReturnValue(false);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const invalid = new Event("invalid", { cancelable: true });
  await act(async () => {
    input.dispatchEvent(invalid);
  });
  expect(invalid.defaultPrevented).toBe(true);
  expect(page("advanced").hidden).toBe(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(details.open).toBe(true);
  expect(frames).toHaveLength(1);
  await act(async () => {
    frames[0](0);
  });
  expect(focus).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledOnce();
});
