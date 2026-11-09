import { expect, it, vi } from "vitest";
import { createMobileRuntime } from "./mobile";

function runtime(options: { address?: unknown; delegated?: boolean } = {}) {
  const externalMcp = vi.fn(async (mcpUrl?: string) =>
    mcpUrl ? { externalMcp: { servers: [{ name: "fake-a" }] } } : undefined,
  );
  const address =
    "address" in options ? options.address : { address: "127.0.0.1", family: "IPv4", port: 4321 };
  const mobile = createMobileRuntime({
    engine: {
      store: { environmentId: "env-test", ready: Promise.resolve(), db: { exec: async () => {} } },
    },
    server: { address: () => address },
    featureDirectory: "unused",
    tunnelsOverride: {},
    mcpHub: { externalMcp },
    social: { isDelegated: async () => options.delegated ?? false },
  } as never);
  return { externalMcp, describe: mobile.mcpBridgeMetadata };
}

it("publishes hub servers in the conversation describe only for the local broker url", async () => {
  const { externalMcp, describe } = runtime();
  const conversation = await describe("conversation");
  expect(conversation).toMatchObject({
    mcpUrl: "http://127.0.0.1:4321/mcp/conversation",
    externalMcp: { servers: [{ name: "fake-a" }] },
  });
  expect(externalMcp).toHaveBeenCalledWith("http://127.0.0.1:4321/mcp/conversation");
});

it("leaves runtime-logs and social describes without hub servers", async () => {
  const { externalMcp, describe } = runtime();
  expect(await describe("runtime-logs")).not.toHaveProperty("externalMcp");
  expect(await describe("social")).not.toHaveProperty("externalMcp");
  expect(externalMcp).not.toHaveBeenCalled();
});

it("omits the mcp url and hub servers when the host is not on loopback", async () => {
  const { externalMcp, describe } = runtime({
    address: { address: "192.168.1.5", family: "IPv4", port: 4321 },
  });
  const result = await describe("conversation");
  expect(result).not.toHaveProperty("mcpUrl");
  expect(result).not.toHaveProperty("externalMcp");
  expect(externalMcp).not.toHaveBeenCalled();
});
