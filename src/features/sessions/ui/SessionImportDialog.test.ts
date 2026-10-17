// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportCandidate } from "../../../platform/tauri/sessionImport";
import { SessionImportDialog } from "./SessionImportDialog";
import type { SessionImportContext } from "../import/importModel";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
}));

function candidate(overrides: Partial<ImportCandidate>): ImportCandidate {
  return {
    provider: "claude",
    path: "C:/store/a.jsonl",
    providerSessionId: "conv-a",
    cwd: "G:\\Projects\\app",
    cwdExists: true,
    resumable: true,
    firstPrompt: "Fix the login bug",
    startedAt: 1_700_000_000_000,
    lastAt: 1_700_000_100_000,
    sizeBytes: 2048,
    kind: "interactive",
    model: null,
    archived: false,
    ...overrides,
  };
}

const candidates = [
  candidate({}),
  candidate({
    provider: "codex",
    providerSessionId: "thread-b",
    cwd: "C:\\Users\\me\\old-thing",
    cwdExists: false,
    firstPrompt: "Explain the schema",
    lastAt: 1_600_000_000_000,
  }),
  candidate({
    providerSessionId: "conv-exec",
    firstPrompt: "Run the nightly job",
    kind: "exec",
  }),
];

let root: Root;
let container: HTMLDivElement;

async function render(initialContext?: SessionImportContext) {
  await act(async () => {
    root.render(
      createElement(SessionImportDialog, {
        onClose: vi.fn(),
        onImported: vi.fn(),
        initialContext,
      }),
    );
  });
  await act(async () => undefined);
}

const text = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "import_discover":
        return {
          candidates,
          filesScanned: 3,
          filesSkipped: 0,
          elapsedMs: 5,
        };
      case "session_import_keys":
        return [];
      case "import_read_claude":
        return {
          text: JSON.stringify({
            type: "user",
            message: { role: "user", content: "Fix the login bug" },
          }),
          truncated: false,
          totalRecords: 1,
          keptRecords: 1,
          oversizeSkipped: 0,
        };
      case "import_read_codex":
        return {
          entries: [{ kind: "user", at: 1, text: "Explain the schema" }],
          truncated: false,
          dropped: 0,
          oversizeSkipped: 0,
        };
      case "import_placeholder_dir":
        return "C:/app/imported-history/Missing folder - old-thing";
      case "session_import":
        return {};
      default:
        return undefined;
    }
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("SessionImportDialog", () => {
  it("opens /resume import scoped to its provider and folder", async () => {
    const scoped = candidate({
      provider: "codex",
      providerSessionId: "scoped-thread",
      cwd: "G:/Projects/app",
      firstPrompt: "Continue this project",
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === "import_discover")
        return {
          candidates: [...candidates, scoped],
          filesScanned: 4,
          filesSkipped: 0,
          elapsedMs: 5,
        };
      if (command === "session_import_keys") return [];
      return undefined;
    });
    await render({ cwd: "G:/Projects/app", provider: "codex" });
    expect(text()).toContain("Continue this project");
    expect(text()).not.toContain("Fix the login bug");
    expect(text()).not.toContain("Explain the schema");
    expect(text()).toContain("1 conversation in 1 folder will be imported");
    const provider = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Codex",
    );
    expect(provider?.getAttribute("aria-pressed")).toBe("true");
  });
  it("lists conversations by folder, hiding automation runs by default", async () => {
    await render();
    expect(text()).toContain("Fix the login bug");
    expect(text()).toContain("Explain the schema");
    expect(text()).toContain("missing folder");
    expect(text()).not.toContain("Run the nightly job");
    expect(text()).toContain("2 conversations in 2 folders");
    expect(text()).toContain("2 conversations in 2 folders will be imported");

    const toggle = [...document.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Show automation runs"))
      ?.querySelector("input") as HTMLInputElement;
    await act(async () => toggle.click());
    expect(text()).toContain("Run the nightly job");
    expect(text()).toContain("automation");
    // Automation runs are shown but not selected for import.
    expect(text()).toContain("2 conversations in 2 folders will be imported");
  });

  it("filters by provider and offers the busiest drive as a root filter", async () => {
    await render();
    const button = (label: string) =>
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(label),
      ) as HTMLButtonElement;
    await act(async () => button("Only under G:\\").click());
    expect(text()).toContain("Fix the login bug");
    expect(text()).not.toContain("Explain the schema");
    await act(async () => button("Claude Code").click());
    expect(text()).toContain("Nothing matches these filters.");
  });

  it("clears the common search field through the native event path without losing discovery candidates", async () => {
    await render();
    const field = document.querySelector<HTMLInputElement>('[aria-label="Filter conversations"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        "not-a-fixture-match",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text()).toContain("Nothing matches these filters.");
    const clear = document.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!;
    await act(async () => clear.click());
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    expect(text()).toContain("Fix the login bug");
    expect(text()).toContain("Explain the schema");
  });
  it("imports the selection and reports what happened", async () => {
    await render();
    const importButton = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Import 2"),
    ) as HTMLButtonElement;
    await act(async () => importButton.click());
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(text()).toContain("Import finished");
    });
    expect(text()).toContain("2 conversations imported");
    const imported = invoke.mock.calls
      .filter(([command]) => command === "session_import")
      .map(
        ([, args]) =>
          args.session as {
            id: string;
            cwd: string;
            providerSessionId?: string;
          },
      );
    expect(imported.map((s) => s.id).sort()).toEqual(["imp-claude-conv-a", "imp-codex-thread-b"]);
    // The conversation whose folder is gone is filed under the placeholder
    // and carries no resume binding.
    const missing = imported.find((s) => s.id === "imp-codex-thread-b");
    expect(missing?.cwd).toBe("C:/app/imported-history/Missing folder - old-thing");
    expect(missing?.providerSessionId).toBeUndefined();
    expect(imported.find((s) => s.id === "imp-claude-conv-a")?.providerSessionId).toBe("conv-a");
  });
});
