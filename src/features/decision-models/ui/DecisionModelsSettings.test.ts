// @vitest-environment happy-dom

import { act, createElement } from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionModelsClient } from "../model/decisionModelsClient";

import type { DecisionRouting, DecisionSource, DiscoveryCandidate } from "../model/decisionTypes";

import { DecisionModelsSettings } from "./DecisionModelsSettings";

import {
  bodyText,
  buttonByText,
  clickButton,
  mountDecisionUi,
  setInputValue,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";

function source(patch: Partial<DecisionSource> = {}): DecisionSource {
  return {
    id: "s1",

    name: "Local Clef",

    kind: "local",

    adapter: "systemone",

    endpoint: "http://127.0.0.1:8769/v1/systemone",

    status: "ready",

    ...patch,
  };
}

/** Mock of the typed client. Every RPC the page reads on mount has a default answer. */

function createClient(options: {
  sources?: DecisionSource[];

  sourcesError?: Error;

  found?: DiscoveryCandidate[];

  routing?: DecisionRouting;

  scan?: DecisionModelsClient["discovery"]["scan"];

  cancel?: DecisionModelsClient["discovery"]["cancel"];

  results?: DecisionModelsClient["discovery"]["results"];
}) {
  const mocks = {
    list: vi.fn(async () => {
      if (options.sourcesError) throw options.sourcesError;

      return { sources: options.sources ?? [] };
    }),

    add: vi.fn(async (params: { source: { name: string } }) =>
      source({ id: "new", name: params.source.name }),
    ),

    test: vi.fn(async () => ({ sourceId: "s1", ok: true, durationMs: 12 })),

    verify: vi.fn(async () => ({
      kind: "installation_folder" as const,

      folder: "C:\\Models",

      modelPath: "C:\\Models\\clef.gguf",

      runtimePath: "C:\\Models\\runtime\\llama-server.exe",

      verified: false,

      models: [
        {
          name: "Clef",

          modelPath: "C:\\Models\\clef.gguf",

          runtimePath: "C:\\Models\\runtime\\llama-server.exe",

          verified: false,
        },
      ],
    })),

    scan: vi.fn(options.scan ?? (async () => ({ found: [] as DiscoveryCandidate[] }))),

    cancel: vi.fn(options.cancel ?? (async () => ({ cancelled: true }))),

    results: vi.fn(options.results ?? (async () => ({ found: options.found ?? [] }))),

    routingGet: vi.fn(async () => ({
      routing: options.routing ?? {},

      localOnlyPersonalData: false,
    })),

    routingSet: vi.fn(async (params: { localOnlyPersonalData?: boolean }) => ({
      routing: {},

      localOnlyPersonalData: params.localOnlyPersonalData ?? false,
    })),

    catalog: vi.fn(async () => ({ version: 1, entries: [] })),

    hardware: vi.fn(async () => ({
      ramBytes: 16 * 1024 ** 3,

      freeRamBytes: 8 * 1024 ** 3,

      cpus: 8,

      gpus: [],

      freeDiskBytes: 100 * 1024 ** 3,
    })),

    recommend: vi.fn(async () => ({ tier: "insufficient" as const })),

    settingsGet: vi.fn(async () => ({ extraPorts: [8080], extraFolders: ["D:\\Models"] })),

    settingsSet: vi.fn(async (params: { extraPorts?: number[]; extraFolders?: string[] }) => ({
      extraPorts: params.extraPorts ?? [],

      extraFolders: params.extraFolders ?? [],
    })),

    evaluate: vi.fn(async () => ({ sourceId: "s1", accuracy: 0.91, cases: 10 })),
  };

  const client = {
    sources: {
      list: mocks.list,

      add: mocks.add,

      update: vi.fn(),

      remove: vi.fn(),

      test: mocks.test,

      evaluate: mocks.evaluate,
    },

    discovery: {
      scan: mocks.scan,

      cancel: mocks.cancel,

      results: mocks.results,

      settings: { get: mocks.settingsGet, set: mocks.settingsSet },
    },

    local: {
      hardware: mocks.hardware,

      recommend: mocks.recommend,

      install: vi.fn(),

      start: vi.fn(),

      stop: vi.fn(),

      uninstall: vi.fn(),

      status: vi.fn(),
    },

    routing: { get: mocks.routingGet, set: mocks.routingSet },

    manual: { verify: mocks.verify },

    catalog: { get: mocks.catalog },

    decide: vi.fn(),
  } as unknown as DecisionModelsClient;

  return { client, mocks };
}

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);

  mounted = null;

  vi.clearAllMocks();
});

async function renderSettings(options: Parameters<typeof createClient>[0] = {}) {
  const { client, mocks } = createClient(options);

  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

  await settleDecisionUi();

  return { mocks };
}

function clickInList(listLabel: string, buttonText: string) {
  const list = document.querySelector(`[aria-label="${listLabel}"]`);

  const button = Array.from(list?.querySelectorAll("button") ?? []).find(
    (item) => item.textContent?.trim() === buttonText,
  );

  if (!button) throw new Error(`Button ${buttonText} not found in ${listLabel}`);

  act(() => {
    button.click();
  });
}

describe("DecisionModelsSettings sources", () => {
  it("keeps cached sources and exposes a failed refresh retry", async () => {
    const { mocks } = await renderSettings({ sources: [source()] });

    mocks.list.mockRejectedValueOnce(new Error("Source refresh unavailable"));

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    expect(bodyText()).toContain("Local Clef");

    expect(bodyText()).toContain("This did not work. Try again.");

    clickButton("Try again");

    await settleDecisionUi();

    expect(mocks.list).toHaveBeenCalledTimes(3);
  });

  it("holds routing edits until the actual Host routing snapshot arrives", async () => {
    const { client, mocks } = createClient({ sources: [source()] });

    let complete!: (value: Awaited<ReturnType<typeof client.routing.get>>) => void;

    mocks.routingGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

    await settleDecisionUi();

    expect(document.querySelector('[role="switch"]')).toBeNull();

    await vi.waitFor(async () => {
      await settleDecisionUi();

      expect(bodyText()).toContain("Loading…");
    });

    await act(async () => complete({ routing: {}, localOnlyPersonalData: false }));

    expect(document.querySelector('[role="switch"]')).not.toBeNull();

    expect(mocks.routingSet).not.toHaveBeenCalled();
  });

  it("shows the empty state when no decision model is connected", async () => {
    await renderSettings({ sources: [] });

    expect(bodyText()).toContain("No decision model is connected yet.");

    expect(bodyText()).toContain("Connect a model before customizing task routing.");

    expect(document.querySelector('[role="combobox"]')).toBeNull();

    expect(buttonByText("Add from folder")).toBeDefined();
  });

  it("lists connected sources with their status", async () => {
    await renderSettings({ sources: [source()] });

    expect(bodyText()).toContain("Local Clef");

    expect(bodyText()).toContain("Working");
  });

  it("offers a retry when the source list cannot load", async () => {
    const { mocks } = await renderSettings({ sourcesError: new Error("offline") });

    expect(bodyText()).toContain("This did not work. Try again.");

    expect(mocks.list).toHaveBeenCalledTimes(1);

    clickButton("Try again");

    await settleDecisionUi();

    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});

describe("DecisionModelsSettings found on this computer", () => {
  it("inspects a discovered model without adding it until runtime-equipped confirmation", async () => {
    const { mocks } = await renderSettings({
      found: [
        {
          id: "model:C:\\Models\\clef.gguf",

          label: "clef.gguf",

          kind: "model_file",

          detail: "C:\\Models\\clef.gguf (not verified)",
        },
      ],
    });

    clickInList("Found on this computer", "Add");

    await settleDecisionUi();

    expect(mocks.add).not.toHaveBeenCalled();

    expect(mocks.test).not.toHaveBeenCalled();

    expect(mocks.verify).toHaveBeenCalledWith({
      kind: "model_installation",

      path: "C:\\Models\\clef.gguf",
    });

    expect(bodyText()).toContain("Add from folder");

    clickButton("Add and test");

    await settleDecisionUi();

    expect(mocks.add).toHaveBeenCalledWith({
      source: {
        name: "Clef",

        kind: "local",

        adapter: "systemone",

        local: {
          modelPath: "C:\\Models\\clef.gguf",

          runtimePath: "C:\\Models\\runtime\\llama-server.exe",
        },
      },
    });

    expect(mocks.test).toHaveBeenCalledWith({ id: "new" });
  });

  it("opens a dialog instead of adding a candidate that needs a path", async () => {
    const { mocks } = await renderSettings({
      found: [
        {
          id: "c2",

          label: "llama-server",

          kind: "runtime_process",

          detail: "C:\\llama\\llama-server.exe",
        },
      ],
    });

    clickInList("Found on this computer", "Add");

    await settleDecisionUi();

    expect(bodyText()).toContain("Add from a file or address");

    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("scans once on first open when nothing is cached", async () => {
    const { mocks } = await renderSettings({ found: [] });

    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it("does not scan again when results are already cached", async () => {
    const { mocks } = await renderSettings({
      found: [
        { id: "c3", label: "Ollama", kind: "local_service", detail: "http://127.0.0.1:11434" },
      ],
    });

    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("keeps earlier results visible until cancellation settles the original scan", async () => {
    let finish!: (result: { found: DiscoveryCandidate[]; incomplete: boolean }) => void;

    const waiting = new Promise<{ found: DiscoveryCandidate[]; incomplete: boolean }>((resolve) => {
      finish = resolve;
    });

    const { mocks } = await renderSettings({
      found: [
        {
          id: "cached",

          label: "Existing model",

          kind: "model_file",

          detail: "D:\\Models\\clef.gguf",
        },
      ],

      scan: async () => waiting,
    });

    clickButton("Scan again");

    await settleDecisionUi();

    expect(bodyText()).toContain("Existing model");

    clickButton("Cancel scan");

    await settleDecisionUi();

    expect(mocks.cancel).toHaveBeenCalledTimes(1);

    expect(buttonByText("Scan again")).toBeUndefined();

    act(() => finish({ found: [], incomplete: true }));

    await settleDecisionUi();

    expect(bodyText()).toContain("Existing model");

    expect(buttonByText("Scan again")).toBeDefined();
  });

  it("shows cancellation failure while the original scan remains active", async () => {
    let finish!: (result: { found: DiscoveryCandidate[] }) => void;

    const waiting = new Promise<{ found: DiscoveryCandidate[] }>((resolve) => {
      finish = resolve;
    });

    await renderSettings({
      scan: async () => waiting,

      cancel: async () => {
        throw new Error("cancel unavailable");
      },
    });

    clickButton("Cancel scan");

    await settleDecisionUi();

    expect(bodyText()).toContain("This did not work. Try again.");

    expect(bodyText()).toContain("Scanning this computer");

    act(() => finish({ found: [] }));

    await settleDecisionUi();
  });

  it("does not replace a completed scan with a late cached result", async () => {
    let finish!: (result: { found: DiscoveryCandidate[] }) => void;

    const cached = new Promise<{ found: DiscoveryCandidate[] }>((resolve) => {
      finish = resolve;
    });

    await renderSettings({
      results: async () => cached,

      scan: async () => ({
        found: [{ id: "new", label: "Fresh model", kind: "model_file", detail: "D:\\fresh.gguf" }],
      }),
    });

    clickButton("Scan again");

    await settleDecisionUi();

    expect(bodyText()).toContain("Fresh model");

    act(() =>
      finish({
        found: [{ id: "old", label: "Stale model", kind: "model_file", detail: "D:\\old.gguf" }],
      }),
    );

    await settleDecisionUi();

    expect(bodyText()).toContain("Fresh model");

    expect(bodyText()).not.toContain("Stale model");
  });
});

describe("DecisionModelsSettings add paths", () => {
  it.each([
    ["Local file path", "Use a model file on this computer"],

    ["Local service", "Running address"],

    ["Install on this computer", "A local model runs on this computer"],

    ["API provider", "No providers are listed yet."],

    ["Custom endpoint", "Connect a service at an address you choose."],
  ])("opens the %s dialog from the Add menu", async (menuLabel, marker) => {
    await renderSettings({});

    clickButton("Add model");

    const item = Array.from(
      document.querySelectorAll<HTMLElement>("[role='menuitem'], button"),
    ).find((element) => element.textContent?.includes(menuLabel));

    if (!item) throw new Error(`Menu item not found: ${menuLabel}`);

    act(() => {
      item.click();
    });

    await settleDecisionUi();

    expect(bodyText()).toContain(marker);
  });
});

describe("DecisionModelsSettings privacy and routing", () => {
  it("saves the personal-data switch through the routing RPC", async () => {
    const { mocks } = await renderSettings({});

    const toggle = document.querySelector<HTMLButtonElement>("[role='switch']");

    if (!toggle) throw new Error("Switch not found");

    act(() => {
      toggle.click();
    });

    await settleDecisionUi();

    expect(mocks.routingSet).toHaveBeenCalledWith({ localOnlyPersonalData: true });
  });

  it("hides routing save until a route changes", async () => {
    await renderSettings({ sources: [source()] });

    expect(buttonByText("Save routing")).toBeUndefined();

    const thresholds = document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]');

    expect(thresholds.length).toBe(0);

    expect(Array.from(thresholds).every((field) => field.disabled)).toBe(true);
  });

  it("opens existing custom routes and keeps their threshold editable", async () => {
    await renderSettings({
      sources: [source()],

      routing: { screen_state: { sourceIds: ["s1"], threshold: 0.9 } },
    });

    expect(document.querySelector('input[inputmode="decimal"]')).toBeNull();

    clickButton("Customize");

    await settleDecisionUi();

    const threshold = document.querySelector<HTMLInputElement>('input[inputmode="decimal"]');

    expect(threshold?.disabled).toBe(false);

    expect(threshold?.value).toBe("0.90");
  });
});

/** Icon-only buttons have no text, so they are found by their accessible name. */

function clickIconButton(name: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  if (!button) throw new Error(`Icon button not found: ${name}`);

  act(() => {
    button.click();
  });
}

function menuItemByText(text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"]')).find(
    (item) => item.textContent?.trim() === text,
  );
}

describe("DecisionModelsSettings source row actions", () => {
  it("keeps only the connection test on the row and moves the rest into the overflow menu", async () => {
    await renderSettings({ sources: [source()] });

    expect(buttonByText("Test")).toBeDefined();

    expect(buttonByText("Measure accuracy")).toBeUndefined();

    expect(buttonByText("Stop")).toBeUndefined();

    expect(buttonByText("More")).toBeUndefined();

    clickIconButton("More actions");

    await settleDecisionUi();

    expect(menuItemByText("Measure accuracy")).toBeDefined();

    expect(menuItemByText("Stop")).toBeDefined();

    expect(menuItemByText("Edit")).toBeDefined();

    expect(menuItemByText("Uninstall local model")).toBeDefined();

    expect(menuItemByText("Remove source")).toBeDefined();
  });

  it("runs the overflow action it names through the same RPC as before", async () => {
    const { mocks } = await renderSettings({ sources: [source()] });

    clickIconButton("More actions");

    await settleDecisionUi();

    act(() => {
      menuItemByText("Measure accuracy")?.click();
    });

    await settleDecisionUi();

    expect(mocks.evaluate).toHaveBeenCalledWith({ id: "s1" });

    expect(bodyText()).toContain("on 10 test cases.");
  });
});

describe("DecisionModelsSettings scan settings", () => {
  it("rescans unchanged settings without rewriting them", async () => {
    const { mocks } = await renderSettings();

    clickButton("Scan with these settings");

    await settleDecisionUi();

    expect(mocks.settingsSet).not.toHaveBeenCalled();

    expect(mocks.scan).toHaveBeenCalledTimes(2);
  });

  it("loads the saved ports and folders and saves a valid change through the RPC", async () => {
    const { mocks } = await renderSettings();

    expect(mocks.settingsGet).toHaveBeenCalledTimes(1);

    const ports = document.querySelector<HTMLInputElement>('input[placeholder="8080, 9000"]');

    expect(ports?.value).toBe("8080");

    if (!ports) throw new Error("ports field not found");

    setInputValue(ports, "8080, 9000");

    clickButton("Save and scan");

    await settleDecisionUi();

    expect(mocks.settingsSet).toHaveBeenCalledWith({
      extraPorts: [8080, 9000],

      extraFolders: ["D:\\Models"],
    });

    expect(mocks.scan).toHaveBeenCalledTimes(2);

    expect(bodyText()).not.toContain("Changing scan settings is not available yet.");
  });

  it("refuses an invalid port before calling the Host", async () => {
    const { mocks } = await renderSettings();

    const ports = document.querySelector<HTMLInputElement>('input[placeholder="8080, 9000"]');

    if (!ports) throw new Error("ports field not found");

    setInputValue(ports, "70000");

    clickButton("Save and scan");

    await settleDecisionUi();

    expect(mocks.settingsSet).not.toHaveBeenCalled();

    expect(bodyText()).toContain("Enter ports from 1 to 65535, separated by commas.");
  });

  it("shows the folder example with single backslashes", async () => {
    await renderSettings();

    const folders = Array.from(document.querySelectorAll("textarea")).find(
      (field) => field.placeholder === "D:\\Models",
    );

    expect(folders).toBeDefined();
  });
});

it("sorts new discoveries first and offers no Add action on connected items", async () => {
  await renderSettings({
    sources: [{ ...source(), local: { modelPath: "C:/Models/connected.gguf" } }],

    found: [
      {
        id: "old",

        kind: "model_file",

        label: "Connected file",

        detail: "C:/Models/connected.gguf",
      },

      { id: "new", kind: "model_file", label: "New file", detail: "C:/Models/new.gguf" },
    ],
  });

  const list = document.querySelector('ul[aria-label="Found on this computer"]')!;

  const rows = list.querySelectorAll("li");

  expect(rows[0].textContent).toContain("New file");

  expect(rows[1].textContent).toContain("Connected");

  expect(rows[1].querySelector("button")).toBeNull();
});

it("tests all models and keeps each result visible after stale list refresh", async () => {
  const { mocks } = await renderSettings({
    sources: [
      source({ id: "s1", status: "unknown" }),

      source({ id: "s2", name: "Second", status: "unknown" }),
    ],
  });

  mocks.test.mockResolvedValueOnce({ sourceId: "s1", ok: true, durationMs: 12 });

  mocks.test.mockResolvedValueOnce({ sourceId: "s2", ok: false, durationMs: 42 });

  clickButton("Test all");

  await settleDecisionUi();

  expect(mocks.test).toHaveBeenCalledWith({ id: "s1" });

  expect(mocks.test).toHaveBeenCalledWith({ id: "s2" });

  const list = document.querySelector('[aria-label="Connected decision models"]')!;

  expect(list.textContent).toContain("Test: 12 ms");

  expect(list.textContent).toContain("Test: 42 ms");

  const rows = list.querySelectorAll("li");

  expect(rows[0].textContent).toContain("Working");

  expect(rows[1].textContent).toContain("Failed");
});

it("keeps local runtime Stop available after a failed connection test", async () => {
  const { mocks } = await renderSettings({ sources: [source()] });

  mocks.test.mockResolvedValueOnce({ sourceId: "s1", ok: false, durationMs: 42 });

  clickInList("Connected decision models", "Test");

  await settleDecisionUi();

  act(() =>
    document.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click(),
  );

  await settleDecisionUi();

  expect(bodyText()).toContain("Stop");

  expect(bodyText()).toContain("Failed");
});

it("keeps full model paths available through Details without repeating them in each row", async () => {
  const modelPath = "C:/Models/Clef/clef-model.gguf";

  await renderSettings({ sources: [source({ local: { modelPath } })] });

  const list = document.querySelector('[aria-label="Connected decision models"]')!;

  expect(list.textContent).not.toContain(modelPath);

  clickIconButton("More actions");

  await settleDecisionUi();

  act(() => menuItemByText("Details")!.click());

  await settleDecisionUi();

  expect(list.textContent).toContain(modelPath);
});

it("keeps scan settings collapsed and preserves drafts across disclosure toggles", async () => {
  await renderSettings();

  const disclosure = Array.from(document.querySelectorAll("details")).find(
    (item) => item.querySelector("summary")?.textContent === "Scan settings",
  )!;

  expect(disclosure.open).toBe(false);

  const ports = disclosure.querySelector<HTMLInputElement>('input[placeholder="8080, 9000"]')!;

  act(() => {
    disclosure.open = true;
  });

  setInputValue(ports, "9001");

  act(() => {
    disclosure.open = false;
  });

  act(() => {
    disclosure.open = true;
  });

  expect(ports.value).toBe("9001");
});

describe("decision source test freshness", () => {
  async function openEdit() {
    clickIconButton("More actions");

    await settleDecisionUi();

    act(() => menuItemByText("Edit")!.click());

    await settleDecisionUi();
  }

  it("retains a successful test on equivalent refresh and clears it after Stop", async () => {
    const current = source({ status: "ready" });

    const { client, mocks } = createClient({ sources: [current] });

    let finishStop!: () => void;

    vi.mocked(client.local.stop).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStop = () => resolve({ state: "stopped" } as never);
        }),
    );

    mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

    await settleDecisionUi();

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    expect(bodyText()).toContain("Test: 12 ms");

    mocks.list.mockRejectedValueOnce(new Error("offline"));

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    clickButton("Try again");

    await settleDecisionUi();

    expect(bodyText()).toContain("Test: 12 ms");

    clickIconButton("More actions");

    await settleDecisionUi();

    act(() => menuItemByText("Stop")!.click());

    await settleDecisionUi();

    expect(bodyText()).not.toContain("Test: 12 ms");

    mocks.list.mockResolvedValueOnce({ sources: [source({ status: "unknown" })] });

    await act(async () => finishStop());

    await settleDecisionUi();

    expect(bodyText()).not.toContain("Test: 12 ms");
  });

  it("clears prior result on endpoint edit and ignores an older pending test", async () => {
    const { client, mocks } = createClient({ sources: [source()] });

    vi.mocked(client.sources.update).mockResolvedValue(
      source({ endpoint: "http://127.0.0.1:9999" }),
    );

    mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

    await settleDecisionUi();

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    expect(bodyText()).toContain("Test: 12 ms");

    let finishTest!: (value: { sourceId: string; ok: boolean; durationMs: number }) => void;

    mocks.test.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTest = resolve;
        }),
    );

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    await openEdit();

    const address = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((input) =>
      input.value.includes("8769"),
    )!;

    setInputValue(address, "http://127.0.0.1:9999");

    mocks.list.mockResolvedValue({
      sources: [source({ endpoint: "http://127.0.0.1:9999", status: "unknown" })],
    });

    clickButton("Save");

    await settleDecisionUi();

    await act(async () => finishTest({ sourceId: "s1", ok: true, durationMs: 77 }));

    await settleDecisionUi();

    expect(bodyText()).not.toContain("Test: 77 ms");

    expect(bodyText()).not.toContain("Test: 12 ms");
  });

  it("replaces successful test feedback after a failed retest", async () => {
    const { mocks } = await renderSettings({ sources: [source()] });

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    expect(bodyText()).toContain("Test: 12 ms");

    let finish!: (value: { sourceId: string; ok: boolean; durationMs: number }) => void;

    mocks.test.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    clickInList("Connected decision models", "Test");

    await settleDecisionUi();

    expect(bodyText()).not.toContain("Test: 12 ms");

    await act(async () => finish({ sourceId: "s1", ok: false, durationMs: 42 }));

    await settleDecisionUi();

    expect(bodyText()).toContain("Failed");

    expect(bodyText()).toContain("Test: 42 ms");
  });
});

it("retries a failed catalog read from the API dialog and recovers", async () => {
  const { client, mocks } = createClient({});

  mocks.catalog.mockRejectedValueOnce(new Error("offline"));

  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

  await settleDecisionUi();

  clickButton("Add model");

  const item = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']")).find(
    (node) => node.textContent?.includes("API provider"),
  )!;

  act(() => item.click());

  await settleDecisionUi();

  clickButton("Try again");

  await settleDecisionUi();

  expect(mocks.catalog).toHaveBeenCalledTimes(2);

  expect(bodyText()).toContain("No providers are listed yet.");
});

it("shows pending measurement and prevents conflicting actions until failure", async () => {
  const { client, mocks } = createClient({ sources: [source()] });

  let fail!: (error: Error) => void;

  mocks.evaluate.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );

  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

  await settleDecisionUi();

  clickIconButton("More actions");

  await settleDecisionUi();

  act(() => menuItemByText("Measure accuracy")!.click());

  await settleDecisionUi();

  expect(bodyText()).toContain("Measuring…");

  clickIconButton("More actions");

  await settleDecisionUi();

  expect((menuItemByText("Remove source") as HTMLButtonElement).disabled).toBe(true);

  expect((menuItemByText("Uninstall local model") as HTMLButtonElement).disabled).toBe(true);

  expect(mocks.evaluate).toHaveBeenCalledTimes(1);

  await act(async () => fail(new Error("offline")));

  await settleDecisionUi();

  expect(bodyText()).not.toContain("Measuring…");

  expect(bodyText()).toContain("This did not work. Try again.");
});

it("names the selected remote Host in uninstall confirmation without uninstalling", async () => {
  const { client } = createClient({ sources: [source()] });

  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostName: "Remote A", remote: true }),
  );

  await settleDecisionUi();

  expect(bodyText()).toContain("Host: Remote A");

  clickIconButton("More actions");

  await settleDecisionUi();

  act(() => menuItemByText("Uninstall local model")!.click());

  await settleDecisionUi();

  expect(bodyText()).toContain("removed from Host Remote A");

  expect(client.local.uninstall).not.toHaveBeenCalled();
});

it.each([
  { status: "ready" as const, action: "Stop", label: "Stopping…", method: "stop" as const },
  { status: "unknown" as const, action: "Start", label: "Starting…", method: "start" as const },
])("locks only the source during $action", async ({ status, action, label, method }) => {
  const { client } = createClient({
    sources: [source({ status }), source({ id: "s2", name: "Second" })],
  });

  let settle!: (value: never) => void;

  vi.mocked(client.local[method]).mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );

  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

  await settleDecisionUi();

  clickIconButton("More actions");
  await settleDecisionUi();

  act(() => menuItemByText(action)!.click());
  await settleDecisionUi();

  expect(bodyText()).toContain(label);

  const rows = document.querySelectorAll<HTMLLIElement>(
    '[aria-label="Connected decision models"] li',
  );

  expect(
    Array.from(rows[0].querySelectorAll("button")).find((b) => b.textContent === "Test")?.disabled,
  ).toBe(true);

  expect(
    Array.from(rows[1].querySelectorAll("button")).find((b) => b.textContent === "Test")?.disabled,
  ).toBe(false);

  clickIconButton("More actions");
  await settleDecisionUi();

  expect((menuItemByText(action) as HTMLButtonElement).disabled).toBe(true);

  expect((menuItemByText("Edit") as HTMLButtonElement).disabled).toBe(true);

  expect(client.local[method]).toHaveBeenCalledTimes(1);

  await act(async () => settle({ state: "stopped" } as never));
  await settleDecisionUi();

  expect(bodyText()).not.toContain(label);
});

it.each([
  { action: "Remove source", confirm: "Remove", label: "Removing…", method: "remove" as const },
  {
    action: "Uninstall local model",
    confirm: "Uninstall",
    label: "Uninstalling…",
    method: "uninstall" as const,
  },
])(
  "locks pending $action and restores after rejection",
  async ({ action, confirm, label, method }) => {
    const { client } = createClient({ sources: [source(), source({ id: "s2", name: "Second" })] });

    const operation = method === "remove" ? client.sources.remove : client.local.uninstall;

    let fail!: (error: Error) => void;

    const rejectedOperation = () =>
      new Promise<never>((_, reject) => {
        fail = reject;
      });
    if (method === "remove") vi.mocked(client.sources.remove).mockImplementation(rejectedOperation);
    else vi.mocked(client.local.uninstall).mockImplementation(rejectedOperation);

    mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client }));

    await settleDecisionUi();

    clickIconButton("More actions");
    await settleDecisionUi();

    act(() => menuItemByText(action)!.click());
    await settleDecisionUi();

    clickButton(confirm);
    await settleDecisionUi();

    expect(bodyText()).toContain(label);

    const rows = document.querySelectorAll<HTMLLIElement>(
      '[aria-label="Connected decision models"] li',
    );

    expect(
      Array.from(rows[0].querySelectorAll("button")).find((b) => b.textContent === "Test")
        ?.disabled,
    ).toBe(true);

    expect(
      Array.from(rows[1].querySelectorAll("button")).find((b) => b.textContent === "Test")
        ?.disabled,
    ).toBe(false);

    clickIconButton("More actions");
    await settleDecisionUi();

    expect((menuItemByText(action) as HTMLButtonElement).disabled).toBe(true);

    expect((menuItemByText("Edit") as HTMLButtonElement).disabled).toBe(true);

    act(() => menuItemByText(action)!.click());

    expect(operation).toHaveBeenCalledTimes(1);

    await act(async () => fail(new Error("offline")));
    await settleDecisionUi();

    expect(bodyText()).not.toContain(label);

    expect(bodyText()).toContain("This did not work. Try again.");
  },
);

it("retains Host routing and scan drafts after a section remount", async () => {
  const { client } = createClient({
    sources: [source()],
    routing: { screen_state: { sourceIds: ["s1"], threshold: 0.9 } },
  });
  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostId: "draft-host" }),
  );
  await settleDecisionUi();
  clickButton("Customize");
  await settleDecisionUi();
  setInputValue(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, "0.74");
  const folders = document.querySelector<HTMLTextAreaElement>("textarea")!;
  setInputValue(folders, "D:\\NewModels");
  unmountDecisionUi(mounted);
  mounted = null;
  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostId: "draft-host" }),
  );
  await settleDecisionUi();
  clickButton("Customize");
  await settleDecisionUi();
  expect(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(
    "0.74",
  );
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("D:\\NewModels");
});

it("retains pending scan save and failure across Host remount and isolates another Host", async () => {
  const { client, mocks } = createClient({});
  let fail!: (error: Error) => void;
  mocks.settingsSet.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client, hostId: "scan-a" }));
  await settleDecisionUi();
  setInputValue(document.querySelector<HTMLTextAreaElement>("textarea")!, "D:\\Pending");
  clickButton("Save and scan");
  await settleDecisionUi();
  unmountDecisionUi(mounted);
  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client, hostId: "scan-b" }));
  await settleDecisionUi();
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("D:\\Models");
  unmountDecisionUi(mounted);
  mounted = mountDecisionUi(createElement(DecisionModelsSettings, { client, hostId: "scan-a" }));
  await settleDecisionUi();
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("D:\\Pending");
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  expect(mocks.settingsSet).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("offline")));
  await settleDecisionUi();
  expect(bodyText()).toContain("This did not work. Try again.");
  expect(buttonByText("Save and scan")?.disabled).toBe(false);
});

it("keeps Host routing draft through a failed initial read and retry", async () => {
  const initial = { screen_state: { sourceIds: ["s1"], threshold: 0.9 } };
  const { client, mocks } = createClient({ sources: [source()], routing: initial });
  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostId: "routing-read-retry" }),
  );
  await settleDecisionUi();
  clickButton("Customize");
  await settleDecisionUi();
  setInputValue(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, "0.74");
  unmountDecisionUi(mounted);
  mounted = null;
  mocks.routingGet.mockRejectedValueOnce(new Error("offline"));
  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostId: "routing-read-retry" }),
  );
  await settleDecisionUi();
  expect(bodyText()).toContain("This did not work. Try again.");
  expect(document.querySelector('input[inputmode="decimal"]')).toBeNull();
  clickButton("Try again");
  await settleDecisionUi();
  clickButton("Customize");
  await settleDecisionUi();
  expect(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(
    "0.74",
  );
  expect(mocks.routingGet).toHaveBeenCalledTimes(3);
});

it("acknowledges delayed scan settings saved while the page is unmounted", async () => {
  const { client, mocks } = createClient({});
  let finish!: (value: { extraPorts: number[]; extraFolders: string[] }) => void;
  mocks.settingsSet.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostId: "scan-success" }),
  );
  await settleDecisionUi();
  setInputValue(document.querySelector<HTMLTextAreaElement>("textarea")!, "D:\\Saved");
  clickButton("Save and scan");
  await settleDecisionUi();
  unmountDecisionUi(mounted);
  mounted = null;
  mocks.settingsGet.mockResolvedValue({ extraPorts: [8080], extraFolders: ["D:\\Saved"] });
  await act(async () => finish({ extraPorts: [8080], extraFolders: ["D:\\Saved"] }));
  mounted = mountDecisionUi(
    createElement(DecisionModelsSettings, { client, hostId: "scan-success" }),
  );
  await settleDecisionUi();
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("D:\\Saved");
  expect(buttonByText("Scan with these settings")).toBeDefined();
  expect(mocks.settingsSet).toHaveBeenCalledTimes(1);
});
