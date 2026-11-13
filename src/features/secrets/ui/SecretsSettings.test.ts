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
  refresh: vi.fn(),
  client: vi.fn(),
}));
vi.mock("../../connections/public/connections", () => ({
  useRemoteMachines: () => ({
    machines: mocks.machines,
    loading: mocks.loading,
    refresh: mocks.refresh,
  }),
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
  mocks.refresh.mockReset();
  mocks.client.mockReset();
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

it("never falls back to a remote machine when the local Host is missing and retries machine discovery", async () => {
  mocks.machines = [machine("remote", false)];
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
