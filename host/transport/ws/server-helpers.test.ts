import { Duplex } from "node:stream";
import { expect, it } from "vitest";
import { rejectUpgrade } from "./server-helpers";

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
