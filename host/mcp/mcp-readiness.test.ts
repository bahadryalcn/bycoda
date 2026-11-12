import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { mcpReady } from "./mcp-readiness";

it("initializes a scoped endpoint and rejects expired credentials, malformed replies and closed ports", async () => {
  let malformed = false;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.headers.authorization !== "Bearer scoped") response.writeHead(401).end();
      else
        response.end(
          JSON.stringify(
            malformed
              ? { result: {} }
              : { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25" } },
          ),
        );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/conversation`;
  try {
    expect(await mcpReady(url, "scoped")).toBe(true);
    expect(await mcpReady(url, "expired")).toBe(false);
    malformed = true;
    expect(await mcpReady(url, "scoped")).toBe(false);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  expect(await mcpReady(url, "scoped")).toBe(false);
});

it("bounds a Host that accepts the connection but never answers initialize", async () => {
  const server = createServer((request) => request.resume());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(
      await mcpReady(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/conversation`,
        "scoped",
      ),
    ).toBe(false);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});
