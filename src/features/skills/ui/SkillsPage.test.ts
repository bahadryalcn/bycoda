// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { SkillsPage } from "./SkillsPage";
import { SettingsView } from "../../settings/ui/SettingsView";
import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import { loadDisabledSkillPaths, saveDisabledSkillPaths } from "../model/skills";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));

const skills: DiscoveredSkill[] = [
  {
    name: "Project guide",
    description: "Project instructions",
    path: "D:/repo/.agents/skills/guide/SKILL.md",
    scope: "project",
    source: "agents",
  },
  {
    name: "Personal guide",
    description: "Personal instructions",
    path: "C:/Users/test/.agents/skills/guide/SKILL.md",
    scope: "user",
    source: "agents",
  },
  {
    name: "Other guide",
    description: "Harness instructions",
    path: "C:/Users/test/.claude/skills/guide/SKILL.md",
    scope: "user",
    source: "claude",
  },
];
const markdown =
  "---\nname: guide\n---\n\n# Full instructions\n\nRead **everything**.\n\nLast paragraph.\n";
let container: HTMLDivElement;
let root: Root;

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  expect(found, `Button: ${label}`).toBeDefined();
  return found!;
}

async function click(label: string) {
  const target = button(label);
  await act(async () => {
    target.focus();
    target.click();
  });
  return target;
}

// Existing preview scenarios explicitly switch from the default editor to rendered Markdown.
async function openPreview(label: string) {
  const target = await click(label);
  const focused = document.activeElement as HTMLElement;
  await click("Preview");
  act(() => focused?.focus());
  return target;
}

async function render() {
  await act(async () => root.render(createElement(SkillsPage, { cwd: "D:/repo" })));
}

it("keeps a new skill draft while selecting an existing skill and returning to creation", async () => {
  await render();
  await click("Add skill");
  const name = container.querySelector<HTMLInputElement>('input[aria-label="Skill name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      name,
      "new-draft",
    );
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Project guide");
  const preview = container.querySelector('[aria-label="Skill preview"]');
  expect(preview).not.toBeNull();
  expect(preview?.hasAttribute("hidden")).toBe(false);
  await click("Add skill");
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Skill name"]')?.value).toBe(
    "new-draft",
  );
  await click("Cancel");
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('[aria-label="Skill preview"]')).toBe(preview);
  expect(preview?.hasAttribute("hidden")).toBe(false);
});

it("keeps policy explanations collapsed without changing owner restrictions", async () => {
  saveDisabledSkillPaths([skills[0].path]);
  await render();
  const target = container.querySelector<HTMLElement>('[data-setting-id="skill-folders"]')!;
  const disclosure = target.closest("details")!;
  expect(disclosure.open).toBe(false);
  expect(
    container
      .querySelector('[role="switch"][aria-label="Enable Project guide in bycoda"]')
      ?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(container.textContent).toContain("Disabled");
  await act(async () => disclosure.querySelector("summary")!.click());
  expect(disclosure.open).toBe(true);
  expect(vi.mocked(invoke).mock.calls.some(([method]) => method === "skill_policy_set")).toBe(
    false,
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(ask).mockReset();
  vi.mocked(ask).mockResolvedValue(false);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "skill_policy_get")
      return { disabledNames: [], disabledPaths: loadDisabledSkillPaths() };
    if (command === "list_skills") return skills;
    if (command === "read_text_file") return markdown;
    throw new Error(`Unexpected command: ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Settings skill preview", () => {
  it("persists owner restrictions before updating the toggle, and keeps it off when save fails", async () => {
    const named = { ...skills[0], name: "project-guide" };
    const policy = { disabledNames: [named.name], disabledPaths: [] as string[] };
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "skill_policy_set") return policy;
      if (command === "list_skills") return [named];
      return original(command, args);
    });
    await render();
    const toggle = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Enable project-guide in bycoda"]')!;
    await act(async () => toggle().click());
    expect(invoke).toHaveBeenCalledWith("skill_policy_set", {
      cwd: "",
      name: named.name,
      enabled: false,
    });
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk unavailable"));
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("disk unavailable");
  });
  function edit(text: string) {
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }));
  }

  it("opens the editor by name and preserves drafts across selection and preview", async () => {
    await render();
    await click("Project guide");
    expect(container.querySelector('[aria-label="Skill instructions"]')).not.toBeNull();
    edit("# Draft instructions");
    await click("Other guide");
    await click("Project guide");
    expect(container.querySelector(".cm-content")?.textContent).toContain("Draft instructions");
    await click("Preview");
    expect(container.querySelector('[aria-label="Skill preview"] h1')?.textContent).toBe(
      "Draft instructions",
    );
    expect(button("Save").disabled).toBe(false);
    expect(invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
  });

  it("saves the exact document once and confirms success", async () => {
    let disk = markdown;
    const pending = deferred<void>();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_skills") return skills;
      if (command === "read_text_file") return disk;
      if (command === "write_text_file") {
        await pending.promise;
        disk = (args as { content: string }).content;
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    await render();
    await click("Project guide");
    edit("---\nname: guide\n---\n\n# Updated instructions\n");
    await click("Save");
    await click("Save");
    expect(invoke.mock.calls.filter(([command]) => command === "write_text_file")).toHaveLength(1);
    await act(async () => pending.resolve());
    expect(disk).toBe("---\nname: guide\n---\n\n# Updated instructions\n");
    expect(container.textContent).toContain("Skill saved.");
    expect(button("Save").disabled).toBe(true);
  });

  it.each(["disk changed", "write failed"])("keeps the draft when %s", async (failure) => {
    await render();
    await click("Project guide");
    edit("# Keep this draft");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "read_text_file")
        return failure === "disk changed" ? "# External change" : markdown;
      if (command === "write_text_file") throw new Error("Access denied");
      if (command === "list_skills") return skills;
      throw new Error(`Unexpected command: ${command}`);
    });
    await click("Save");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      failure === "disk changed" ? "changed on disk" : "Access denied",
    );
    expect(container.querySelector(".cm-content")?.textContent).toContain("Keep this draft");
    expect(button("Save").disabled).toBe(false);
    if (failure === "disk changed")
      expect(invoke.mock.calls.some(([command]) => command === "write_text_file")).toBe(false);
  });
  it("does not delete a skill when confirmation is cancelled", async () => {
    await render();
    await click("Actions for Project guide");
    await click("Delete Project guide");
    expect(ask).toHaveBeenCalledWith(
      expect.stringContaining("entire folder"),
      expect.objectContaining({ okLabel: "Delete" }),
    );
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "skill_delete")).toBe(
      false,
    );
    expect(button("Project guide")).toBeDefined();
  });

  it("deletes after confirmation, closes its preview, clears hidden preferences and refreshes", async () => {
    let deleted = false;
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_skills") return deleted ? skills.slice(1) : skills;
      if (command === "read_text_file") return markdown;
      if (command === "skill_delete") {
        deleted = true;
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    saveDisabledSkillPaths([skills[0].path, skills[1].path]);
    await render();
    await openPreview("Project guide");
    await click("Actions for Project guide");
    await click("Delete Project guide");
    expect(invoke).toHaveBeenCalledWith("skill_delete", {
      path: skills[0].path,
      cwd: "D:/repo",
    });
    expect(container.querySelector('[aria-label="Skill preview"]')).toBeNull();
    expect(container.querySelector('[aria-label="Delete Project guide"]')).toBeNull();
    expect(loadDisabledSkillPaths()).toEqual([skills[1].path]);
  });

  it("retains a skill and reports deletion failure, preventing duplicate requests while busy", async () => {
    const pending = deferred<void>();
    vi.mocked(ask).mockResolvedValue(true);
    await render();
    vi.mocked(invoke).mockImplementationOnce(() => pending.promise);
    await click("Actions for Project guide");
    await click("Delete Project guide");
    await click("Actions for Project guide");
    expect(button("Delete Project guide").disabled).toBe(true);
    await click("Actions for Personal guide");
    await click("Delete Personal guide");
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "skill_delete"),
    ).toHaveLength(1);
    await act(async () => pending.reject(new Error("Access denied")));
    expect(container.textContent).toContain("Could not delete Project guide. Access denied");
    expect(button("Project guide")).toBeDefined();
    await click("Actions for Project guide");
    expect(button("Delete Project guide").disabled).toBe(false);
  });
  it.each(["document", "error"])(
    "never shows the previous %s under a newly selected skill while its read is pending",
    async (previousState) => {
      const pending = deferred<string>();
      const frames: string[] = [];
      await act(async () =>
        root.render(
          createElement(
            Profiler,
            {
              id: "skill-preview",
              // Observe committed DOM before passive effects clear stale state.
              onRender: () => {
                const panel = container.querySelector('[aria-label="Skill preview"]');
                if (panel?.querySelector("h2")?.textContent === "Other guide") {
                  frames.push(panel.textContent ?? "");
                }
              },
            },
            createElement(SkillsPage, { cwd: "D:/repo" }),
          ),
        ),
      );
      if (previousState === "document") {
        vi.mocked(invoke).mockResolvedValueOnce("# Previous document");
      } else {
        vi.mocked(invoke).mockRejectedValueOnce(new Error("Previous read failed"));
      }
      await openPreview("Project guide");
      const previousText =
        previousState === "document" ? "Previous document" : "Previous read failed";
      expect(container.querySelector('[aria-label="Skill preview"]')?.textContent).toContain(
        previousText,
      );
      vi.mocked(invoke).mockImplementationOnce(() => pending.promise);
      await openPreview("Other guide");
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame).not.toContain(previousText);
        expect(frame).toContain("Loading skill");
      }
      await act(async () => pending.resolve("# Selected document"));
      expect(container.querySelector('[aria-label="Skill preview"] h1')?.textContent).toBe(
        "Selected document",
      );
    },
  );

  it.each(["Project guide", "Preview skill Project guide"])(
    "restores focus to %s after refreshing the list",
    async (label) => {
      await render();
      const opener = await click(label);
      const reload = deferred<DiscoveredSkill[]>();
      vi.mocked(invoke).mockImplementationOnce(() => reload.promise);
      await click("Refresh skills");
      expect(opener.isConnected).toBe(false);
      await act(async () => reload.resolve(skills));
      const replacement = button(label);
      await click("Close skill preview");
      expect(document.activeElement === replacement).toBe(true);
    },
  );

  it("returns focus to the filter if the preview opener disappears after refresh", async () => {
    await render();
    await openPreview("Project guide");
    vi.mocked(invoke).mockResolvedValueOnce([skills[2]]);
    await click("Refresh skills");
    await click("Close skill preview");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Filter skills");
  });

  it.each([
    { control: "Skill name", preview: true },
    ...["Project", "Personal", "Cancel", "Create"].flatMap((control) =>
      [true, false].map((preview) => ({ control, preview })),
    ),
  ])(
    "lets Escape cancel Add skill from $control before closing Settings (preview: $preview)",
    async ({ control, preview }) => {
      const closeSettings = vi.fn();
      await act(async () =>
        root.render(
          createElement(SettingsView, {
            section: "skills",
            cwd: "D:/repo",
            sessions: [],
            onClose: closeSettings,
            onOpenSession: vi.fn(),
            onArchiveSession: vi.fn(),
            onDeleteSession: vi.fn(),
            onOpenWhatsNew: vi.fn(),
          }),
        ),
      );
      if (preview) await openPreview("Project guide");
      const previewPanel = container.querySelector('[aria-label="Skill preview"]');
      await click("Add skill");
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Skill name");
      if (control !== "Skill name") {
        const input = container.querySelector<HTMLInputElement>('[aria-label="Skill name"]')!;
        act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            input,
            "escape-test",
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const target = Array.from(
          container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
            "form button, form input[type=radio]",
          ),
        ).find(
          (item) =>
            item.textContent?.startsWith(control) ||
            item.closest("label")?.textContent?.startsWith(control),
        );
        expect(target, `Form control: ${control}`).toBeDefined();
        expect(target!.disabled).toBe(false);
        act(() => target!.focus());
        expect(document.activeElement).toBe(target);
      }
      const escape = () =>
        act(() =>
          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      escape();
      expect(container.querySelector("form")).toBeNull();
      expect(container.querySelector('[aria-label="Skill preview"]')).toBe(previewPanel);
      expect(document.activeElement === button("Add skill")).toBe(true);
      expect(closeSettings).not.toHaveBeenCalled();
      if (preview) {
        escape();
        expect(container.querySelector('[aria-label="Skill preview"]')).toBeNull();
        expect(document.activeElement === button("Project guide")).toBe(true);
        expect(closeSettings).not.toHaveBeenCalled();
      }
      escape();
      expect(closeSettings).toHaveBeenCalledOnce();
    },
  );

  it("separates YAML metadata from Markdown headings, renders tables, and preserves the original source", async () => {
    const source =
      "---\nname: guide\ndescription: |\n  Review the change.\n  Keep all metadata.\nallowed-tools:\n  - Read\n---\n\n# Instructions\n\n| Check | Result |\n| --- | --- |\n| Tests | Passed |\n";
    await render();
    vi.mocked(invoke).mockResolvedValueOnce(source);
    await openPreview("Project guide");
    const panel = container.querySelector('[aria-label="Skill preview"]')!;
    const metadata = panel.querySelector("details");
    expect(metadata).not.toBeNull();
    expect(metadata?.querySelector("summary")?.textContent).toBe("Skill metadata");
    expect(metadata?.textContent).toContain("allowed-tools:\n  - Read");
    expect(
      Array.from(panel.querySelectorAll("h1, h2, h3"), (heading) => heading.textContent),
    ).toEqual(["Project guide", "Instructions"]);
    expect(Array.from(panel.querySelectorAll("th"), (cell) => cell.textContent)).toEqual([
      "Check",
      "Result",
    ]);
    expect(Array.from(panel.querySelectorAll("td"), (cell) => cell.textContent)).toEqual([
      "Tests",
      "Passed",
    ]);
    await click("Source");
    expect(panel.querySelector("pre")?.textContent).toBe(source);
    await click("Preview");
  });

  it("opens an inline panel from an eye icon and switches skills without closing it", async () => {
    await render();
    const opener = button("Preview skill Project guide");
    expect(opener.textContent).toBe("");
    expect(opener.querySelector("svg")).not.toBeNull();
    await click("Preview skill Project guide");
    const panel = container.querySelector('[aria-label="Skill preview"]');
    expect(panel).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    await openPreview("Other guide");
    expect(container.querySelector('[aria-label="Skill preview"]')).toBe(panel);
    expect(panel?.textContent).toContain(skills[2].path);
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button("Other guide"));
  });

  it.each(["preview", "page background"])(
    "Escape closes the preview before Settings from %s",
    async (focus) => {
      const closeSettings = vi.fn();
      await act(async () =>
        root.render(
          createElement(SettingsView, {
            section: "skills",
            cwd: "D:/repo",
            sessions: [],
            onClose: closeSettings,
            onOpenSession: vi.fn(),
            onArchiveSession: vi.fn(),
            onDeleteSession: vi.fn(),
            onOpenWhatsNew: vi.fn(),
          }),
        ),
      );
      await openPreview("Project guide");
      if (focus === "page background") {
        act(() => (document.activeElement as HTMLElement).blur());
        expect(document.activeElement).toBe(document.body);
      }
      act(() =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(document.querySelector('[aria-label="Skill preview"]')).toBeNull();
      expect(closeSettings).not.toHaveBeenCalled();
      expect(container.querySelector('[aria-label="Settings"]')).not.toBeNull();
      act(() =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(closeSettings).toHaveBeenCalledOnce();
    },
  );

  it("allows Tab to leave the preview and keeps the document keyboard-scrollable", async () => {
    await render();
    await openPreview("Project guide");
    const close = button("Close skill preview");
    const preview = document.querySelector<HTMLElement>('[aria-label="Markdown preview"]');
    expect(preview?.tabIndex).toBe(0);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => close.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(false);
    await openPreview("Other guide");
    expect(document.activeElement).toBe(button("Other guide"));
    await click("Source");
    expect(document.querySelector<HTMLElement>('[aria-label="Markdown source"]')?.tabIndex).toBe(0);
    await click("Preview");
  });

  it.each(["Close skill preview", "Escape"])(
    "closes with %s, restores opener focus and preserves the filter",
    async (action) => {
      await render();
      const filter = container.querySelector<HTMLInputElement>('[aria-label="Filter skills"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          filter,
          "project",
        );
        filter.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const opener = await openPreview("Project guide");
      expect(document.activeElement).toBe(button("Close skill preview"));
      if (action === "Close skill preview") await click("Close skill preview");
      else
        act(() =>
          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      expect(document.querySelector('[aria-label="Skill preview"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(filter.value).toBe("project");
      expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
    },
  );

  it.each([new Error("File not found"), "Permission denied"])(
    "shows a readable error and can open another skill after %s",
    async (error) => {
      await render();
      vi.mocked(invoke).mockRejectedValueOnce(error);
      await openPreview("Project guide");
      const alert = document.querySelector('[aria-label="Skill preview"] [role="alert"]');
      expect(alert?.textContent).toContain("Could not read SKILL.md");
      expect(alert?.textContent).toContain(error instanceof Error ? error.message : error);
      expect(document.querySelector('[role="status"]')).toBeNull();
      await click("Close skill preview");
      await openPreview("Other guide");
      expect(document.querySelector('[aria-label="Skill preview"] [role="alert"]')).toBeNull();
      expect(document.querySelector('[aria-label="Skill preview"] h1')?.textContent).toBe(
        "Full instructions",
      );
    },
  );

  it.each(["resolves", "rejects"])(
    "keeps the current skill when a previous read %s after switching",
    async (outcome) => {
      const previous = deferred<string>();
      const current = deferred<string>();
      await render();
      vi.mocked(invoke).mockImplementationOnce(() => previous.promise);
      await openPreview("Project guide");
      expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading skill");
      vi.mocked(invoke).mockImplementationOnce(() => current.promise);
      await openPreview("Other guide");
      await act(async () => current.resolve("# Current instructions"));
      expect(document.querySelector('[aria-label="Skill preview"] h1')?.textContent).toBe(
        "Current instructions",
      );
      await act(async () => {
        if (outcome === "resolves") previous.resolve("# Old instructions");
        else previous.reject(new Error("Old read failed"));
      });
      expect(document.querySelector('[aria-label="Skill preview"] h1')?.textContent).toBe(
        "Current instructions",
      );
      expect(document.querySelector('[aria-label="Skill preview"]')?.textContent).not.toContain(
        "Old instructions",
      );
      expect(document.querySelector('[aria-label="Skill preview"] [role="alert"]')).toBeNull();
    },
  );

  it("opens project and harness skills using Preview skill", async () => {
    await render();
    for (const skill of [skills[0], skills[2]]) {
      await click(`Preview skill ${skill.name}`);
      expect(document.querySelector('[aria-label="Skill preview"]')?.textContent).toContain(
        skill.path,
      );
      expect(invoke).toHaveBeenCalledWith("read_text_file", {
        path: skill.path,
      });
      await click("Close skill preview");
    }
  });

  it("opens a disabled personal skill by name and shows the full Markdown and source without changing its preference", async () => {
    saveDisabledSkillPaths([skills[1].path]);
    await render();
    await openPreview("Personal guide");

    const dialog = document.querySelector('[aria-label="Skill preview"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(skills[1].path);
    expect(dialog.querySelector("h1")?.textContent).toBe("Full instructions");
    expect(dialog.textContent).toContain("Read everything.");
    expect(dialog.textContent).toContain("Last paragraph.");
    expect(invoke).toHaveBeenCalledWith("read_text_file", {
      path: skills[1].path,
    });
    await click("Source");
    expect(dialog.querySelector("pre")?.textContent).toBe(markdown);
    expect(button("Source").getAttribute("aria-checked")).toBe("true");
    expect(loadDisabledSkillPaths()).toEqual([skills[1].path]);
    expect(
      container
        .querySelector('[aria-label="Enable Personal guide in bycoda"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    await click("Actions for Personal guide");
    expect(button("Copy path of Personal guide")).toBeDefined();
    expect(button("Reveal Personal guide in file explorer")).toBeDefined();
  });
});

describe("Skills on connected machines", () => {
  const macSkills: DiscoveredSkill[] = [
    {
      name: "mac-notes",
      description: "Notes from the Mac",
      path: "/Users/me/.agents/skills/notes/SKILL.md",
      scope: "user",
      source: "agents",
    },
    {
      name: "kit:plan",
      description: "A plugin skill",
      path: "/Users/me/.claude/plugins/kit/skills/plan/SKILL.md",
      scope: "user",
      source: "claude",
    },
  ];
  const machine = (id: string, name: string) => ({
    id: `machine-${id}`,
    name,
    endpoint: `http://${id}.example`,
    environmentId: `env-${id}`,
  });
  const b64 = (text: string) => btoa(text);
  let hostCalls: { machineId: string; command: string; args: Record<string, unknown> }[];

  /** The desktop's own commands plus a `workspace.run` per machine. */
  function connect(
    machines: ReturnType<typeof machine>[],
    host: (
      environmentId: string,
      command: string,
      args: Record<string, unknown>,
    ) => unknown | Promise<unknown>,
  ) {
    hostCalls = [];
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "skill_policy_get")
        return { disabledNames: [], disabledPaths: loadDisabledSkillPaths() };
      const input = (args ?? {}) as Record<string, unknown>;
      if (command === "remote_machines") return machines;
      if (command === "list_skills") return [skills[1]];
      if (command === "skill_import") return "C:/Users/test/.agents/skills/mac-notes/SKILL.md";
      if (command === "remote_request") {
        const found = machines.find((entry) => entry.id === input.machineId)!;
        const params = input.params as { command: string; args: Record<string, unknown> };
        hostCalls.push({ machineId: found.id, command: params.command, args: params.args });
        return host(found.environmentId, params.command, params.args);
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  }

  async function renderLocalProject() {
    await act(async () => root.render(createElement(SkillsPage, { cwd: "D:/repo" })));
    await act(async () => {});
    await act(async () => {});
  }

  it("deletes a personal remote skill on its machine and protects plugin rows", async () => {
    let deleted = false;
    connect([machine("mac", "Mac mini")], (_environment, command) => {
      if (command === "list_skills") return deleted ? macSkills.slice(1) : macSkills;
      if (command === "skill_delete") {
        deleted = true;
        return;
      }
      throw new Error(`Unexpected host command: ${command}`);
    });
    vi.mocked(ask).mockResolvedValue(true);
    await renderLocalProject();
    await click("Actions for kit:plan");
    expect(document.querySelector('[aria-label="Delete kit:plan"]')).toBeNull();
    await click("Actions for mac-notes");
    await click("Delete mac-notes");
    expect(hostCalls).toContainEqual({
      machineId: "machine-mac",
      command: "skill_delete",
      args: { path: macSkills[0].path, cwd: "" },
    });
    expect(container.querySelector('[aria-label="Delete mac-notes"]')).toBeNull();
    expect(container.textContent).toContain("kit:plan");
  });

  it("lists a machine's skill names with a Transfer button while the open project is local", async () => {
    connect([machine("mac", "Mac mini")], () => macSkills);
    await renderLocalProject();

    expect(hostCalls).toContainEqual(
      expect.objectContaining({ command: "list_skills", args: { cwd: "" } }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("This computer");
    expect(text).toContain("Mac mini");
    expect(text).toContain("mac-notes");
    expect(text).toContain("kit:plan");
    expect(text).toContain("Personal guide");
    // 1 on this computer + 2 on the Mac.
    expect(text).toContain("3 skills");
    // Names only: no description line, no catalog switch on the other machine's rows.
    expect(text).not.toContain("Notes from the Mac");
    expect(
      container.querySelector('[aria-label="Include mac-notes in bycoda catalog"]'),
    ).toBeNull();
    expect(button("Copy mac-notes to this computer").querySelector("svg")).not.toBeNull();
    // A plugin skill belongs to its plugin: nothing to transfer.
    expect(container.querySelector('[aria-label="Copy kit:plan to this computer"]')).toBeNull();
    // Rows on this computer can be copied to the single connected machine.
    expect(button("Copy Personal guide to Mac mini")).toBeDefined();
  });

  it("lists the open remote project's skills in its machine's section", async () => {
    const { rememberRemoteProject } = await import("../../connections/model/remoteProjects");
    const project = rememberRemoteProject("env-mac", {
      id: "p1",
      cwd: "/Users/me/shop",
      name: "shop",
    });
    connect([machine("mac", "Mac mini"), machine("pc", "Office PC")], (env, _command, args) =>
      env === "env-mac"
        ? [
            ...macSkills,
            {
              name: "shop-deploy",
              description: "Deploys the shop",
              path: "/Users/me/shop/.agents/skills/deploy/SKILL.md",
              scope: "project",
              source: "agents",
            },
          ]
        : (expect(args.cwd).toBe(""), []),
    );
    await act(async () => root.render(createElement(SkillsPage, { cwd: project.key })));
    await act(async () => {});
    await act(async () => {});

    expect(hostCalls.find((call) => call.machineId === "machine-mac")?.args).toEqual({
      cwd: "/Users/me/shop",
    });
    const text = container.textContent ?? "";
    expect(text).toContain("shop-deploy");
    expect(text).toContain("Office PC");
    expect(text).toContain("No skills on this machine.");
    // Several machines: the local rows offer a choice instead of one target.
    expect(button("Copy Personal guide to another machine")).toBeDefined();
  });

  it("opens a machine's skill by asking that machine for its SKILL.md", async () => {
    connect([machine("mac", "Mac mini")], (_env, command) =>
      command === "list_skills"
        ? macSkills
        : {
            name: "notes",
            files: [{ path: "SKILL.md", data: b64("# Mac notes\n\nRemote body.") }],
          },
    );
    await renderLocalProject();
    await click("mac-notes");
    await act(async () => {});

    expect(hostCalls.at(-1)).toMatchObject({
      command: "skill_export",
      args: { path: "/Users/me/.agents/skills/notes/SKILL.md", cwd: "" },
    });
    const panel = container.querySelector('[aria-label="Skill preview"]')!;
    expect(panel.textContent).toContain("Mac mini");
    expect(panel.textContent).toContain("Remote body.");
    expect(button("Copy mac-notes to this computer")).toBeDefined();
  });

  it("transfers a machine's skill to this computer", async () => {
    connect([machine("mac", "Mac mini")], (_env, command) =>
      command === "list_skills"
        ? macSkills
        : { name: "notes", files: [{ path: "SKILL.md", data: b64("# Mac notes") }] },
    );
    await renderLocalProject();
    await click("Copy mac-notes to this computer");
    await act(async () => {});

    expect(hostCalls.some((call) => call.command === "skill_export")).toBe(true);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("skill_import", {
      cwd: "",
      name: "notes",
      files: [{ path: "SKILL.md", data: b64("# Mac notes") }],
      overwrite: false,
    });
  });

  it("explains an outdated host in its own section only", async () => {
    connect([machine("mac", "Mac mini"), machine("old", "Old box")], (env, command) => {
      if (env === "env-old") throw "Host rejected request: Invalid workspace path";
      return command === "list_skills" ? macSkills : [];
    });
    await renderLocalProject();

    const old = container.querySelector('[aria-label="Skills on Old box"]')!;
    expect(old.textContent).toContain("needs updating");
    expect(old.querySelector('[role="alert"]')).not.toBeNull();
    const mac = container.querySelector('[aria-label="Skills on Mac mini"]')!;
    expect(mac.textContent).toContain("mac-notes");
    expect(mac.querySelector('[role="alert"]')).toBeNull();
  });

  it("says when a machine cannot be reached", async () => {
    connect([machine("mac", "Mac mini")], () => {
      throw "Machine is unreachable";
    });
    await renderLocalProject();
    expect(container.textContent).toContain("Couldn't reach Mac mini.");
    expect(container.textContent).toContain("Personal guide");
  });
});
