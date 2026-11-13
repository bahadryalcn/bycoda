// @vitest-environment happy-dom
import { defaultNotificationSettings } from "@bycoda/account-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useNotificationSettings } from "./useAccountData";
import { ACCOUNT_CONTEXT } from "../model/testFixtures";
const mocks = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("./useAccount", () => ({
  useAccountState: () => ({ phase: "signed-in", context: ACCOUNT_CONTEXT }),
}));
vi.mock("../model/accountService", () => ({
  accountController: () => ({
    api: () => ({
      getNotificationSettings: async () => defaultNotificationSettings(),
      putNotificationSettings: mocks.put,
    }),
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("keeps saving visible through serialized optimistic changes and permits recovery", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    ["account", ACCOUNT_CONTEXT.user.id, "notifications"],
    defaultNotificationSettings(),
  );
  let hook!: ReturnType<typeof useNotificationSettings>;
  function Probe() {
    hook = useNotificationSettings();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let first!: (value: ReturnType<typeof defaultNotificationSettings>) => void;
  let second!: (error: Error) => void;
  mocks.put
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          second = reject;
        }),
    )
    .mockResolvedValue(defaultNotificationSettings());
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
  try {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
      await flush();
    });
    await act(async () => {
      hook.save.mutate((current) => ({ ...current, pushShowDetails: true }));
      hook.save.mutate((current) => ({ ...current, pushShowDetails: false }));
      await flush();
    });
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(hook.save.isPending).toBe(true);
    await act(async () => {
      first(defaultNotificationSettings());
      await flush();
    });
    expect(mocks.put).toHaveBeenCalledTimes(2);
    expect(hook.save.isPending).toBe(true);
    await act(async () => {
      second(new Error("save failed"));
      await flush();
    });
    expect(hook.save.isPending).toBe(false);
    expect(hook.save.isError).toBe(true);
    await act(async () => {
      hook.save.mutate((current) => ({ ...current, pushShowDetails: true }));
      await flush();
    });
    expect(hook.save.isError).toBe(false);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
