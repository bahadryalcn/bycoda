// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceWorkResults, type VoiceWorkResultRow } from "./VoiceWorkResults";

const host = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteMachineFor: vi.fn(),
  remoteRequest: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));
vi.mock("../../../connections/public/connections", () => ({
  remoteMachineFor: host.remoteMachineFor,
  remoteRequest: host.remoteRequest,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

function decision(layout: string, sort = "activity") {
  const answer = { confidence: 1, sourceId: "fixture", model: "fixture" };
  return {
    answers: { layout: { ...answer, value: layout }, sort: { ...answer, value: sort } },
    sourceChain: ["fixture"],
    durationMs: 100,
  };
}

function button(label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label,
  );
  expect(result).toBeDefined();
  return result as HTMLButtonElement;
}

const workspace = { projectPath: "remote://owner-env/a/private/path", scopeId: "first scope" };

it("does not dispatch to a different Host than the evidence owner", async () => {
  host.invoke.mockResolvedValue({ id: "local-machine", environmentId: "local-env" });
  const render = (projectPath: string) =>
    root.render(
      createElement(VoiceWorkResults, {
        rows,
        modelLayout: { ...workspace, projectPath, expectedEnvironmentId: "mismatched-env" },
        onSelect: vi.fn(),
      }),
    );
  await act(async () => render(workspace.projectPath));
  await act(async () => button("Generate with AI").click());
  expect(host.remoteMachineFor).not.toHaveBeenCalled();
  expect(host.invoke).not.toHaveBeenCalled();
  expect(host.remoteRequest).not.toHaveBeenCalled();

  await act(async () => render("/local/project"));
  await act(async () => button("Generate with AI").click());
  expect(host.invoke).toHaveBeenCalledWith("local_host_connect");
  expect(host.remoteRequest).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Unavailable");
});

it("uses the owning Host after explicit opt-in and renders a source comparison from live records", async () => {
  host.remoteMachineFor.mockResolvedValue({ id: "owner-machine", environmentId: "owner-env" });
  host.remoteRequest.mockResolvedValue(decision("source_bars", "source"));
  await act(async () =>
    root.render(
      createElement(VoiceWorkResults, { rows, modelLayout: workspace, onSelect: vi.fn() }),
    ),
  );
  expect(host.remoteMachineFor).not.toHaveBeenCalled();
  expect(host.remoteRequest).not.toHaveBeenCalled();

  await act(async () => button("Generate with AI").click());
  expect(host.remoteMachineFor).toHaveBeenCalledWith("owner-env");
  expect(host.invoke).not.toHaveBeenCalled();
  expect(host.remoteRequest).toHaveBeenCalledWith(
    "owner-machine",
    "decisionModels.decide",
    expect.objectContaining({
      state: {
        statusCounts: { running: 0, done: 2, failed: 1, stopped: 0, interrupted: 0 },
        sourceCounts: [2, 1],
      },
      timeoutMs: 8_000,
    }),
    false,
    true,
    "owner-env",
  );
  expect(JSON.stringify(host.remoteRequest.mock.calls)).not.toMatch(
    /private\/path|Review patch|first scope/,
  );
  expect(displayedRecords()).toEqual(["first", "last", "next"]);
  expect(container.querySelector("table caption")?.textContent).toContain("Results");
  expect(container.querySelector('[aria-label="Results, explore by source"]')).not.toBeNull();

  await act(async () => button("Use default").click());
  expect(displayedRecords()).toEqual(["first", "next", "last"]);
  expect(container.querySelector('button[aria-label^="Failed"]')).not.toBeNull();
});

it("ignores a late reply after cancellation and after an owning session changes", async () => {
  host.remoteMachineFor.mockResolvedValue({ id: "owner-machine", environmentId: "owner-env" });
  let resolve: (value: ReturnType<typeof decision>) => void = () => {};
  host.remoteRequest.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const render = (scopeId: string) =>
    root.render(
      createElement(VoiceWorkResults, {
        rows,
        modelLayout: { ...workspace, scopeId },
        onSelect: vi.fn(),
      }),
    );
  await act(async () => render("first"));
  await act(async () => button("Generate with AI").click());
  await act(async () => button("Stop waiting").click());
  await act(async () => resolve(decision("table_only")));
  expect(container.querySelector('button[aria-label^="Failed"]')).not.toBeNull();

  await act(async () => button("Generate with AI").click());
  await act(async () => render("next"));
  await act(async () => resolve(decision("table_only")));
  expect(container.querySelector('button[aria-label^="Failed"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Use default");
});

it("retains the default when the owning Host cannot be resolved or proposes an unknown component", async () => {
  host.remoteMachineFor.mockResolvedValueOnce(undefined);
  await act(async () =>
    root.render(
      createElement(VoiceWorkResults, { rows, modelLayout: workspace, onSelect: vi.fn() }),
    ),
  );
  await act(async () => button("Generate with AI").click());
  expect(host.remoteRequest).not.toHaveBeenCalled();
  expect(host.invoke).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Unavailable");
  expect(displayedRecords()).toEqual(["first", "next", "last"]);

  host.remoteMachineFor.mockResolvedValue({ id: "owner-machine", environmentId: "owner-env" });
  host.remoteRequest.mockResolvedValue(decision('root = Unknown("http://example.com")'));
  await act(async () => button("Generate with AI").click());
  expect(container.textContent).toContain("Unavailable");
  expect(container.querySelector('button[aria-label^="Failed"]')).not.toBeNull();
  expect(container.textContent).not.toContain("example.com");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const rows: VoiceWorkResultRow[] = [
  {
    id: "first",
    title: "Review patch",
    status: "done",
    statusLabel: "Completed",
    source: "Command",
  },
  { id: "next", title: "Build package", status: "failed", statusLabel: "Failed", source: "Voice" },
  {
    id: "last",
    title: "Check results",
    status: "done",
    statusLabel: "Completed",
    source: "Command",
  },
];

function displayedRecords() {
  return Array.from(container.querySelectorAll("tbody tr[data-row-key]"), (row) =>
    row.getAttribute("data-row-key"),
  );
}

it("sorts visible records, narrows the table from the status chart and opens the chosen record", async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(createElement(VoiceWorkResults, { rows, selectedId: "first", onSelect: open })),
  );
  expect(displayedRecords()).toEqual(["first", "next", "last"]);
  expect(container.querySelector('[data-row-key="first"]')?.getAttribute("aria-current")).toBe(
    "true",
  );
  const name = Array.from(container.querySelectorAll("thead button")).find((button) =>
    button.textContent?.includes("Name"),
  );
  expect(name).toBeDefined();
  await act(async () => (name as HTMLButtonElement).click());
  expect(displayedRecords()).toEqual(["next", "last", "first"]);

  const failed = container.querySelector<HTMLButtonElement>('button[aria-label^="Failed"]');
  expect(failed?.getAttribute("aria-label")).toContain("1");
  await act(async () => failed?.click());
  expect(displayedRecords()).toEqual(["next"]);
  await act(async () => {
    container
      .querySelector('[data-row-key="next"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith("next", rows[1]);
  await act(async () => failed?.click());
  expect(displayedRecords()).toEqual(["next", "last", "first"]);
});

it("keeps provider-controlled labels and IDs as React data outside the OpenUI program", async () => {
  const literal = '");\nroot = WorkResultDistribution()\n<img src=x>';
  const row = { ...rows[0], id: literal, title: literal };
  await act(async () =>
    root.render(createElement(VoiceWorkResults, { rows: [row], onSelect: vi.fn() })),
  );
  expect(displayedRecords()).toEqual([literal]);
  expect(container.querySelector("tbody tr[data-row-key] td")?.textContent).toBe(literal);
  expect(container.querySelector("tbody tr[data-row-key] img")).toBeNull();
});

it("refreshes counts and records when a selected status disappears from the live data", async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(createElement(VoiceWorkResults, { rows, onSelect })));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Failed"]')?.click(),
  );
  expect(displayedRecords()).toEqual(["next"]);

  const updated = rows.map((row) => ({
    ...row,
    status: "done" as const,
    statusLabel: "Completed",
  }));
  await act(async () => root.render(createElement(VoiceWorkResults, { rows: updated, onSelect })));
  expect(displayedRecords()).toEqual(["first", "next", "last"]);
  expect(
    container
      .querySelector<HTMLButtonElement>('button[aria-label^="Completed"]')
      ?.getAttribute("aria-label"),
  ).toContain("3");
});
