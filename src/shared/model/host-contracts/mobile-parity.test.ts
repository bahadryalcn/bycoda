import { expect, it } from "vitest";
import { getHostRpcMethod, parseHostRpcParams, exportHostContractManifest } from "./index";

it("retains client message identity through strict wire validation and snapshot export", () => {
  const id = "8CA190F8-9E1B-477D-9565-2FB1283AC578";
  const params = {
    type: "send",
    commandId: "transport",
    sessionId: "s",
    text: "hello",
    clientMessageId: id,
  };
  expect(parseHostRpcParams("commands.dispatch", params)).toEqual(params);
  expect(() =>
    parseHostRpcParams("commands.dispatch", { ...params, clientMessageId: `${id}\n` }),
  ).toThrow();
  expect(() => parseHostRpcParams("commands.dispatch", { ...params, extra: true })).toThrow();
  expect(() => exportHostContractManifest()).not.toThrow();
});

it("never replays clone or side questions and gives both their operation deadlines", () => {
  expect(getHostRpcMethod("projects.clone")).toMatchObject({
    retry: "never",
    responseTimeoutMs: 630_000,
  });
  expect(getHostRpcMethod("projects.clone.progress")).toMatchObject({ retry: "safe-query" });
  expect(getHostRpcMethod("sessions.sideQuestion")).toMatchObject({
    retry: "never",
    responseTimeoutMs: 150_000,
  });
});
