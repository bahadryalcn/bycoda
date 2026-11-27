// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OllamaStatus } from "../../../shared/model/host-contracts/ollama";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  remote: vi.fn(),
  catalog: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mock.remote }));
vi.mock("../../../integrations/harness/providers/opencode/opencodeCatalog", () => ({
  refreshOpenCodeCatalog: mock.catalog,
}));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mock.open }));
import { OllamaSettings } from "./OllamaSettings";
import { setLanguagePreference } from "../../../shared/i18n";

const running = (patch: Partial<OllamaStatus> = {}): OllamaStatus => ({
  port: 11434,
  portCustom: false,
  runtime: "running",
  version: "0.30.10",
  models: [
    { name: "qwen3:8b", size: 5_000_000_000, parameterSize: "8.2B", chat: true, tools: true },
    { name: "gemma:2b", size: 1_000_000_000, chat: true, tools: false },
    { name: "nomic-embed-text:latest", size: 1, chat: false, tools: false },
  ],
  pull: null,
  opencode: { config: "ready", models: ["qwen3:8b"] },
  ...patch,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  setLanguagePreference("en");
  mock.invoke.mockResolvedValue({ id: "local", name: "This computer" });
  mock.catalog.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(opencodeAvailable = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(OllamaSettings, { opencodeAvailable }),
      ),
    ),
  );
  // The status query resolves after the first render.
  await act(async () =>
    vi.waitFor(() => {
      if (
        client.isFetching() ||
        !client.getQueryState(["providers", "ollama", "status"])?.dataUpdatedAt
      )
        throw new Error("status pending");
    }),
  );
  // Commit the render the resolved query scheduled.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const button = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
const checkbox = (label: string) =>
  [...container.querySelectorAll<HTMLLabelElement>("label")]
    .find((item) => item.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>("input[type=checkbox]");

it("lists chat models, marks those without tools and saves the chosen set", async () => {
  mock.remote.mockImplementation(async (_machine: string, method: string, params: unknown) =>
    method === "ollama.opencode.save"
      ? running({ opencode: { config: "ready", models: (params as { models: string[] }).models } })
      : running(),
  );
  await render();
  expect(container.textContent).toContain("qwen3:8b");
  expect(container.textContent).not.toContain("nomic-embed-text");
  expect(container.textContent).toContain("No tool support");
  expect(checkbox("qwen3:8b")?.checked).toBe(true);
  expect(button("Save to OpenCode")).toBeUndefined();

  await act(async () => checkbox("gemma:2b")?.click());

  expect(mock.remote).toHaveBeenCalledWith("local", "ollama.opencode.save", {
    models: ["qwen3:8b", "gemma:2b"],
  });
  expect(mock.catalog).toHaveBeenCalledTimes(1);
});

it("asks the owner to install OpenCode and keeps saving off without it", async () => {
  mock.remote.mockResolvedValue(running());
  await render(false);
  expect(container.textContent).toContain("Install OpenCode above to use these models.");
  expect(checkbox("gemma:2b")?.disabled).toBe(true);
});

it("offers the download page when Ollama is missing and a start when it is stopped", async () => {
  mock.remote.mockResolvedValueOnce(running({ runtime: "missing", models: [] }));
  await render();
  expect(container.textContent).toContain("Ollama is not installed on this computer.");
  await act(async () => button("Download Ollama")?.click());
  expect(mock.open).toHaveBeenCalledWith("https://ollama.com/download");

  mock.remote.mockResolvedValueOnce(running({ runtime: "stopped", models: [] }));
  await act(async () => button("Check again")?.click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Ollama is installed but not running."),
  );
  mock.remote.mockResolvedValueOnce(running());
  await act(async () => button("Start Ollama")?.click());
  expect(mock.remote).toHaveBeenLastCalledWith("local", "ollama.start", {});
  expect(container.textContent).toContain("qwen3:8b");
});

it("refuses to rewrite a config file with comments", async () => {
  mock.remote.mockResolvedValue(running({ opencode: { config: "comments", models: [] } }));
  await render();
  expect(container.textContent).toContain("has comments");
  expect(checkbox("qwen3:8b")?.disabled).toBe(true);
});

it("starts a download and shows its progress", async () => {
  mock.remote.mockResolvedValueOnce(running());
  await render();
  const input = container.querySelector<HTMLInputElement>("input[placeholder='qwen3:8b']")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, "llama3.1:8b");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  mock.remote.mockResolvedValueOnce(
    running({ pull: { model: "llama3.1:8b", state: "running", completed: 10, total: 100 } }),
  );
  await act(async () => button("Download")?.click());
  expect(mock.remote).toHaveBeenLastCalledWith("local", "ollama.pull.start", {
    model: "llama3.1:8b",
  });
  expect(container.textContent).toContain("Downloading llama3.1:8b");
  expect(button("Cancel")).toBeDefined();
});

it("saves a custom port and returns to the default", async () => {
  mock.remote.mockImplementation(async (_machine: string, method: string, params: unknown) => {
    if (method !== "ollama.port.set") return running();
    const { port } = params as { port: number | null };
    return running({ port: port ?? 11434, portCustom: port !== null });
  });
  await render();
  const input = container.querySelector<HTMLInputElement>("input[inputmode], input[type=number]")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const type = async (value: string) =>
    act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  expect(input.value).toBe("11434");
  expect(button("Save")?.getAttribute("aria-disabled") === "true").toBe(true);
  await type("70000");
  expect(container.textContent).toContain("Enter a port from 1 to 65535.");
  expect(button("Save")?.getAttribute("aria-disabled")).toBe("true");
  await type("12000");
  await act(async () => button("Save")?.click());
  expect(mock.remote).toHaveBeenCalledWith("local", "ollama.port.set", { port: 12000 });
  await act(async () => button("Use default")?.click());
  expect(mock.remote).toHaveBeenLastCalledWith("local", "ollama.port.set", { port: null });
  expect(button("Use default")).toBeUndefined();
});
