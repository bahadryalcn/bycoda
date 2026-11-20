import { Duplex } from "node:stream";
import { expect, it } from "vitest";
import {
  RpcResponseSchema,
  SubscriptionEventSchema,
} from "../../../src/shared/model/host-contracts";
import { rejectUpgrade, withoutPayload } from "./server-helpers";

it("rejects an upgrade whose client already dropped without crashing the Host", async () => {
  // A write to an aborted socket emitted an unhandled "error" (ECONNABORTED)
  // that took the whole Host process down.
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error("write ECONNABORTED"), { code: "ECONNABORTED" }));
    },
  });
  rejectUpgrade(socket, 401);
  await new Promise((resolve) => setImmediate(resolve));
  expect(socket.destroyed).toBe(true);
});

it("validates outgoing envelopes without walking their JSON payload", () => {
  const payload = { rows: Array.from({ length: 1_000 }, (_, index) => ({ index })) };
  const response = { jsonrpc: "2.0", id: "request", result: payload };
  const event = {
    jsonrpc: "2.0",
    method: "subscription.event",
    params: {
      subscriptionId: "subscription",
      streamId: "stream",
      cursor: { epoch: "epoch", sequence: 1 },
      kind: "snapshot",
      data: payload,
    },
  };
  expect(withoutPayload(response)).toEqual({ ...response, result: null });
  expect(withoutPayload(event)).toEqual({ ...event, params: { ...event.params, data: null } });
  expect(response.result).toBe(payload); // The sent wire itself is untouched.
  expect(event.params.data).toBe(payload);
  expect(RpcResponseSchema.safeParse(withoutPayload(response)).success).toBe(true);
  expect(SubscriptionEventSchema.safeParse(withoutPayload(event)).success).toBe(true);
  // Envelope fields are still checked.
  expect(RpcResponseSchema.safeParse(withoutPayload({ ...response, extra: true })).success).toBe(
    false,
  );
  expect(
    SubscriptionEventSchema.safeParse(
      withoutPayload({ ...event, params: { ...event.params, cursor: { epoch: "epoch" } } }),
    ).success,
  ).toBe(false);
  const error = { jsonrpc: "2.0", id: null, error: { code: -32600, message: "bad" } };
  expect(withoutPayload(error)).toBe(error);
});
