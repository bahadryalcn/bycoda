import { expect, it, vi } from "vitest";
import { buildRemoteModelSource } from "./remoteModelSource";

const build = (catalog: Parameters<typeof buildRemoteModelSource>[0]["catalog"]) =>
  buildRemoteModelSource({
    catalog,
    environmentId: "env",
    hostSession: undefined,
    descriptor: undefined,
    providers: ["claude", "codex"],
    refreshCatalog: vi.fn(),
  });

it("does not invent Host accounts while the catalog or its account lists are missing", () => {
  for (const catalog of [undefined, { models: {}, errors: {} } as never]) {
    const source = build(catalog);
    expect(source.accounts).toEqual({});
    expect(source.accountsKnown?.("claude")).toBe(false);
    expect(source.accountsKnown?.("codex")).toBe(false);
  }
});

it("reports only providers the Host listed accounts for as known", () => {
  const source = build({
    models: {},
    errors: {},
    accounts: { claude: [{ id: "a", label: "A" }] },
  } as never);
  expect(source.accounts).toEqual({ claude: [{ id: "a", label: "A" }] });
  expect(source.accountsKnown?.("claude")).toBe(true);
  expect(source.accountsKnown?.("codex")).toBe(false);
});
