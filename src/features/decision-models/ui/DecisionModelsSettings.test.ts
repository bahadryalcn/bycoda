// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type { DecisionSource, DiscoveryCandidate } from "../model/decisionTypes";
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
    scan: vi.fn(async () => ({ found: [] as DiscoveryCandidate[] })),
    results: vi.fn(async () => ({ found: options.found ?? [] })),
    routingGet: vi.fn(async () => ({ routing: {}, localOnlyPersonalData: false })),
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
  it("shows the empty state when no decision model is connected", async () => {
    await renderSettings({ sources: [] });
    expect(bodyText()).toContain("No decision model is connected yet.");
  });

  it("lists connected sources with their status", async () => {
    await renderSettings({ sources: [source()] });
    expect(bodyText()).toContain("Local Clef");
    expect(bodyText()).toContain("Ready");
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
  it("adds a model file from the found list with one click", async () => {
    const { mocks } = await renderSettings({
      found: [
        {
          id: "c1",
          label: "clef.gguf",
          kind: "model_file",
          detail: "C:\\Models\\clef.gguf",
        },
      ],
    });
    clickInList("Found on this computer", "Add");
    await settleDecisionUi();
    expect(mocks.add).toHaveBeenCalledWith({
      source: {
        name: "clef.gguf",
        kind: "local",
        adapter: "systemone",
        local: { modelPath: "C:\\Models\\clef.gguf" },
      },
    });
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
});

describe("DecisionModelsSettings add paths", () => {
  it.each([
    ["From a file or address", "Use a model file on this computer"],
    ["Install on this computer", "A local model runs on this computer"],
    ["API provider", "No providers are listed yet."],
    ["Custom endpoint", "Connect a service at an address you choose."],
  ])("opens the %s dialog from the Add menu", async (menuLabel, marker) => {
    await renderSettings({});
    clickButton("Add");
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

  it("keeps routing save disabled until a route changes", async () => {
    await renderSettings({ sources: [source()] });
    expect(buttonByText("Save routing")?.disabled).toBe(true);
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
    expect(buttonByText("Test connection")).toBeDefined();
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
  it("loads the saved ports and folders and saves a valid change through the RPC", async () => {
    const { mocks } = await renderSettings();
    expect(mocks.settingsGet).toHaveBeenCalledTimes(1);
    const ports = document.querySelector<HTMLInputElement>('input[placeholder="8080, 9000"]');
    expect(ports?.value).toBe("8080");
    if (!ports) throw new Error("ports field not found");
    setInputValue(ports, "8080, 9000");
    clickButton("Save");
    await settleDecisionUi();
    expect(mocks.settingsSet).toHaveBeenCalledWith({
      extraPorts: [8080, 9000],
      extraFolders: ["D:\\Models"],
    });
    expect(bodyText()).not.toContain("Changing scan settings is not available yet.");
  });

  it("refuses an invalid port before calling the Host", async () => {
    const { mocks } = await renderSettings();
    const ports = document.querySelector<HTMLInputElement>('input[placeholder="8080, 9000"]');
    if (!ports) throw new Error("ports field not found");
    setInputValue(ports, "70000");
    clickButton("Save");
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
