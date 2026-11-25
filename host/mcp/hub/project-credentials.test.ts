import { expect, it } from "vitest";
import { ProjectMcpCredentials } from "./project-credentials";
import type { InventoryDefinition } from "./inventory";

const definition = {
  name: "service",
  source: "bycoda",
  sources: ["bycoda"],
  aliases: [],
  kind: "http",
  url: "https://one.example/mcp",
} as InventoryDefinition;

function store() {
  const secrets = new Map<string, string>();
  const credentials = new ProjectMcpCredentials({
    get: async (key) => secrets.get(key),
    set: async (key, value) => {
      secrets.set(key, value);
    },
    delete: async (key) => {
      secrets.delete(key);
    },
  });
  return { secrets, credentials };
}

it("sends a bare Authorization token as a Bearer credential", async () => {
  const { credentials } = store();
  await credentials.set(undefined, definition, { Authorization: "abc123", "X-Api-Key": "raw" });
  expect((await credentials.get(undefined, definition))?.values).toEqual({
    authorization: "Bearer abc123",
    "x-api-key": "raw",
  });
});

it("keeps an Authorization value that already names its scheme", async () => {
  const { credentials } = store();
  await credentials.set(undefined, definition, { Authorization: "Basic dXNlcjpwYXNz" });
  expect((await credentials.get(undefined, definition))?.values).toEqual({
    authorization: "Basic dXNlcjpwYXNz",
  });
});

it("repairs a bare token saved before the scheme was added", async () => {
  const { secrets, credentials } = store();
  await credentials.set(undefined, definition, { Authorization: "Bearer placeholder" });
  const [key] = secrets.keys();
  secrets.set(
    key!,
    JSON.stringify({
      revision: "00000000-0000-4000-8000-000000000000",
      values: { authorization: "abc123" },
    }),
  );
  expect((await credentials.get(undefined, definition))?.values).toEqual({
    authorization: "Bearer abc123",
  });
});
