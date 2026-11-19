// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SecretsSettings } from "./SecretsSettings";
import type { SecretsClient } from "../model/secretsClient";
import { LOADING_DELAY_MS } from "../../../shared/hooks/useDelayedVisible";

const mocks = vi.hoisted(() => ({
  machines: [] as Record<string, unknown>[],
  loading: false,
  error: undefined as string | undefined,
  /** The chosen machine when it is not connected; then nothing is selected. */
  entry: undefined as Record<string, unknown> | undefined,
  missing: false,
  select: vi.fn(),
  refresh: vi.fn(),
  client: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/settingsHosts", async (importActual) => ({
  ...(await importActual<typeof import("../../connections/public/settingsHosts")>()),
  useSettingsHostScope: () => ({
    loading: mocks.loading,
    checking: false,
    local: mocks.machines.find((entry) => entry.localHost),
    entries: [],
    entry: mocks.entry,
    missing: mocks.missing,
    selected: mocks.entry || mocks.missing ? undefined : mocks.machines[0],
    error: mocks.error,
    options: [],
    value: "",
    select: mocks.select,
    retry: mocks.refresh,
  }),
  SettingsHostPicker: () => null,
}));
vi.mock("../model/secretsClient", () => ({ secretsClient: mocks.client }));

const machine = (id: string, localHost = true) => ({
  id,
  localHost,
  name: id,
  endpoint: localHost ? "http://127.0.0.1:47321" : "https://remote.invalid",
  environmentId: id,
});
const metadata = {
  secretRef: "synthetic-ref",
  name: "FIXTURE_TOKEN",
  projectId: "p",
  purpose: "Synthetic purpose",
  createdAt: 1,
  expiresAt: null,
  materialized: false,
};
const client = (): SecretsClient => ({
  list: vi.fn(async () => ({ secrets: [metadata] })),
  projects: vi.fn(async () => []),
  revoke: vi.fn(async () => ({ revoked: true as const })),
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.machines = [machine("local")];
  mocks.loading = false;
  mocks.error = undefined;
  mocks.entry = undefined;
  mocks.missing = false;
  mocks.select.mockReset();
  mocks.refresh.mockReset();
  mocks.client.mockReset();
  mocks.invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () => root.render(createElement(SecretsSettings)));
};
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text,
  )!;

it("shows the Host failure reason once and retries host discovery when no Host is selected", async () => {
  mocks.machines = [];
  mocks.error = "Host rejected request [RPC_AUTHORIZATION]";
  mocks.client.mockReturnValue(client());
  await render();
  expect(mocks.client).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Could not load saved secrets.");
  await act(async () => button("Retry").click());
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("shows loading while the first local Host inventory is being discovered", async () => {
  vi.useFakeTimers();
  mocks.machines = [];
  mocks.loading = true;
  await render();
  await act(async () => {
    vi.advanceTimersByTime(LOADING_DELAY_MS);
  });
  expect(container.textContent).toContain("Loading…");
  expect(container.textContent).not.toContain("Could not load");
});

it("shows read errors instead of empty inventory and retries the same local Host", async () => {
  const api = client();
  vi.mocked(api.list).mockRejectedValueOnce(new Error("synthetic-private-read-error"));
  mocks.client.mockReturnValue(api);
  await render();
  expect(container.textContent).toContain("Could not load saved secrets.");
  expect(container.textContent).not.toContain("No saved secrets");
  expect(container.textContent).not.toContain("synthetic-private-read-error");
  await act(async () => button("Retry").click());
  expect(container.textContent).toContain("FIXTURE_TOKEN");
  expect(api.list).toHaveBeenCalledTimes(2);
});

it("preserves metadata on cancellation and reloads only after confirmed successful removal", async () => {
  const api = client();
  mocks.client.mockReturnValue(api);
  await render();
  await act(async () => button("Remove").click());
  await act(async () => button("Cancel").click());
  expect(api.revoke).not.toHaveBeenCalled();
  expect(container.textContent).toContain("FIXTURE_TOKEN");
  vi.mocked(api.list).mockResolvedValueOnce({ secrets: [] });
  await act(async () => button("Remove").click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((node) => node.textContent === "Remove")!
      .click(),
  );
  expect(api.revoke).toHaveBeenCalledOnce();
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("No saved secrets");
});

it("clears the previous Host inventory and pending confirmation before another Host loads", async () => {
  const first = client();
  const next = client();
  vi.mocked(next.list).mockImplementation(() => new Promise(() => {}));
  mocks.client.mockImplementation((id: string) => (id === "first" ? first : next));
  mocks.machines = [machine("first")];
  await render();
  await act(async () => button("Remove").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  mocks.machines = [machine("next")];
  await render();
  expect(container.textContent).not.toContain("FIXTURE_TOKEN");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(first.revoke).not.toHaveBeenCalled();
  expect(next.revoke).not.toHaveBeenCalled();
});

it("keeps failed revocations retryable without displaying sensitive RPC payloads", async () => {
  const api = client();
  vi.mocked(api.revoke).mockRejectedValueOnce(new Error("synthetic-private-error-payload"));
  mocks.client.mockReturnValue(api);
  await render();
  await act(async () => button("Remove").click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((node) => node.textContent === "Remove")!
      .click(),
  );
  expect(document.body.textContent).not.toContain("synthetic-private-error-payload");
  expect(document.body.textContent).toContain("Could not remove the secret.");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.textContent).toContain("FIXTURE_TOKEN");
  expect(api.revoke).toHaveBeenCalledWith("synthetic-ref");
});

it("clears the removal failure banner once the confirmation is cancelled", async () => {
  const api = client();
  vi.mocked(api.revoke).mockRejectedValueOnce(new Error("synthetic-private-error-payload"));
  mocks.client.mockReturnValue(api);
  await render();
  await act(async () => button("Remove").click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((node) => node.textContent === "Remove")!
      .click(),
  );
  expect(container.textContent).toContain("Could not remove the secret.");
  await act(async () => button("Cancel").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Could not remove the secret.");
  expect(container.textContent).toContain("FIXTURE_TOKEN");
});

const refusal = () =>
  new Error(
    "Host rejected request [RPC_AUTHORIZATION] (secrets.owner.list) synthetic-private-read-error",
  );

it("shows a safe access reason for another machine's failed read, never the payload", async () => {
  const api = client();
  vi.mocked(api.list).mockRejectedValueOnce(refusal());
  mocks.client.mockReturnValue(api);
  mocks.machines = [machine("remote", false)];
  await render();
  expect(container.textContent).toContain("Could not load saved secrets.");
  expect(container.textContent).toContain("Host rejected request [RPC_AUTHORIZATION]");
  expect(container.textContent).not.toContain("synthetic-private-read-error");
  expect(container.textContent).not.toContain("Reconnect");
  expect(button("Retry")).toBeDefined();
});

it("offers Reconnect when this computer's Host revoked its link, and pairs only when asked", async () => {
  const api = client();
  vi.mocked(api.list).mockRejectedValueOnce(refusal());
  mocks.client.mockReturnValue(api);
  mocks.invoke.mockResolvedValue({ ...machine("local"), environmentId: "local" });
  await render();
  expect(container.textContent).toContain("This computer's connection to its Host was revoked.");
  expect(container.textContent).not.toContain("synthetic-private-read-error");
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => button("Reconnect").click());
  expect(mocks.invoke).toHaveBeenCalledWith("local_host_reconnect", { machineId: "local" });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("FIXTURE_TOKEN");
});

it("keeps the revoked notice and shows the reason when Reconnect fails", async () => {
  const api = client();
  vi.mocked(api.list).mockRejectedValue(refusal());
  mocks.client.mockReturnValue(api);
  mocks.invoke.mockRejectedValue(new Error("The local Host is not installed on this computer"));
  await render();
  await act(async () => button("Reconnect").click());
  expect(container.textContent).toContain("This computer's connection to its Host was revoked.");
  expect(container.textContent).toContain("The local Host is not installed on this computer");
  expect(api.list).toHaveBeenCalledOnce();
});

const unavailable = (status: string, isLocal = false) => ({
  id: "office",
  machine: machine("office", false),
  isLocal,
  name: "Office",
  status,
});

it("never reads secrets from a machine that is not connected", async () => {
  mocks.client.mockReturnValue(client());
  mocks.entry = unavailable("offline");
  await render();
  expect(mocks.client).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Could not load saved secrets. Office is offline.");
  expect(container.textContent).not.toContain("FIXTURE_TOKEN");
  await act(async () => button("Retry").click());
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("tells the owner to pair a remote machine again from Connections, with no Reconnect", async () => {
  mocks.client.mockReturnValue(client());
  mocks.entry = unavailable("pair-again");
  await render();
  expect(mocks.client).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Pair it again from Settings → Connections");
  expect(container.textContent).not.toContain("Reconnect");
});

it("reports a removed machine and goes back to this computer only on request", async () => {
  mocks.client.mockReturnValue(client());
  mocks.missing = true;
  await render();
  expect(mocks.client).not.toHaveBeenCalled();
  expect(container.textContent).toContain("This machine is no longer available.");
  expect(mocks.select).not.toHaveBeenCalled();
  await act(async () => button("Use this computer").click());
  expect(mocks.select).toHaveBeenCalledWith(undefined);
});
