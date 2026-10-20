import { expect, it } from "vitest";
import { termiusDuplicate, termiusNeedsReview, type TermiusHost } from "./termiusImport";
import type { ServerRecord } from "./serverInventory";

const host: TermiusHost = {
  sourceId: "source",
  name: "Production",
  endpoint: { host: "prod.test", user: "admin", port: 2222 },
  group: "ops",
  tags: [],
  hasKey: true,
  needsPassword: false,
  requiresReview: false,
  warnings: [],
};
it("compares the effective endpoint and preserves different users and ports", () => {
  const server: ServerRecord = {
    id: "existing",
    kind: "ssh",
    name: "Keep name",
    sshEndpoint: { host: "other.test", port: 22 },
    effectiveSshEndpoint: { host: "PROD.test", user: "admin", port: 2222 },
    metadata: { tags: [], favorite: true },
  };
  expect(termiusDuplicate(host, [server])).toBe(true);
  expect(
    termiusDuplicate({ ...host, endpoint: { ...host.endpoint, user: "other" } }, [server]),
  ).toBe(false);
  expect(termiusDuplicate({ ...host, endpoint: { ...host.endpoint, port: 22 } }, [server])).toBe(
    false,
  );
});
it("requires review for unsupported routing while allowing interactive password entry", () => {
  expect(
    termiusNeedsReview({
      ...host,
      requiresReview: true,
      warnings: ["Proxy settings require review"],
    }),
  ).toBe(true);
  expect(
    termiusNeedsReview({ ...host, requiresReview: true, warnings: ["Host chain requires review"] }),
  ).toBe(true);
  expect(
    termiusNeedsReview({ ...host, warnings: ["Enter the server password when connecting"] }),
  ).toBe(false);
});
