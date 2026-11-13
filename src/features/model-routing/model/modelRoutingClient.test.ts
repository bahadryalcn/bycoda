// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { remoteRequest } from "../../connections/public/connections";
import { useModelRoutingStatus } from "./modelRoutingClient";
vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));

it("retains quota on failed refresh and retries with fresh data", async () => {
  let latest!: ReturnType<typeof useModelRoutingStatus>;
  function Probe() {
    latest = useModelRoutingStatus("host", true);
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  vi.mocked(remoteRequest).mockResolvedValueOnce({ entries: [{ entryId: "a", leftPercent: 42 }] });
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe))),
  );
  await vi.waitFor(() => expect(latest.entries[0]?.leftPercent).toBe(42));
  let reject!: (error: Error) => void;
  vi.mocked(remoteRequest).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  let pending!: ReturnType<typeof latest.refetch>;
  act(() => {
    pending = latest.refetch();
  });
  await act(async () => reject(new Error("offline")));
  await pending;
  await vi.waitFor(() => expect(latest.error).toBeTruthy());
  expect(latest.entries[0]?.leftPercent).toBe(42);
  vi.mocked(remoteRequest).mockResolvedValueOnce({ entries: [{ entryId: "a" }] });
  await act(async () => {
    await latest.refetch();
  });
  await vi.waitFor(() => expect(latest.error).toBeNull());
  expect(latest.entries).toEqual([{ entryId: "a" }]);
  await act(async () => root.unmount());
  client.clear();
  element.remove();
});
