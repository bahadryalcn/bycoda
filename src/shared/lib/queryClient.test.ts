import { expect, it, vi } from "vitest";
import { bridgeQueryEvents, createAppQueryClient } from "./queryClient";

it("maps host subscription updates and invalidations to their scoped cache and disposes", () => {
  const client = createAppQueryClient();
  const key = ["social", "host-one", "account-one"];
  const other = ["social", "host-two", "account-one"];
  client.setQueryData(key, { status: "waiting" });
  client.setQueryData(other, { status: "waiting" });
  let receive!: (event: { status?: string }) => void;
  const release = vi.fn();
  const stop = bridgeQueryEvents<{ status?: string }>(
    client,
    (listener) => {
      receive = listener;
      return release;
    },
    (event) => (event.status ? { queryKey: key, data: event } : { queryKey: key }),
  );
  receive({ status: "connected" });
  expect(client.getQueryData(key)).toEqual({ status: "connected" });
  expect(client.getQueryData(other)).toEqual({ status: "waiting" });
  receive({});
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  stop();
  expect(release).toHaveBeenCalledOnce();
  client.clear();
});
