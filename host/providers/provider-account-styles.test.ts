import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HostStore } from "../store";
import {
  providerDefaultAccounts,
  parseProviderAccountStyles,
  saveProviderAccountStyles,
  readProviderAccountStyles,
  applyProviderAccountStyles,
} from "./provider-account-styles";
import { ModelsListResultSchema } from "../../src/shared/model/host-contracts/models";

it("drops invalid kinds, retaining valid names/colors and legacy records", () => {
  expect(
    parseProviderAccountStyles({
      codex: {
        a: { label: "Legacy", color: "coral" },
        b: { kind: "work" },
        c: { label: "Safe", kind: "admin" },
        d: { kind: null },
      },
    }),
  ).toEqual({
    codex: { a: { label: "Legacy", color: "coral" }, b: { kind: "work" }, c: { label: "Safe" } },
  });
});
it("persists kind across reopen, clears Automatic, and preserves other providers", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-kind-"));
  let store = new HostStore(join(root, "host.db"));
  try {
    await saveProviderAccountStyles(store, {
      codex: { a: { label: "Legacy", color: "coral" } },
      claude: { b: { kind: "work" } },
    });
    await store.close();
    store = new HostStore(join(root, "host.db"));
    expect(await readProviderAccountStyles(store)).toEqual({
      codex: { a: { label: "Legacy", color: "coral" } },
      claude: { b: { kind: "work" } },
    });
    await saveProviderAccountStyles(store, {
      claude: { b: { label: "Automatic", derivedKind: "personal" } },
    });
    const styles = await readProviderAccountStyles(store);
    expect(styles.codex?.a).toEqual({ label: "Legacy", color: "coral" });
    expect(styles.claude?.b).toEqual({ label: "Automatic", derivedKind: "personal" });
    const accounts = applyProviderAccountStyles(
      { claude: [{ id: "b", label: "Old", kind: "work" as const }] },
      styles,
    );
    expect(accounts.claude[0]?.kind).toBeUndefined();
    expect(
      ModelsListResultSchema.parse({ models: {}, errors: {}, accounts }).accounts?.claude?.[0],
    ).toMatchObject({ derivedKind: "personal" });
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("carries default account identity through safe metadata", () => {
  const styles = parseProviderAccountStyles({
    codex: { work: { isDefault: true }, old: { isDefault: false }, invalid: { isDefault: "yes" } },
  });
  expect(providerDefaultAccounts(styles)).toEqual({ claude: "default", codex: "work" });
  expect(styles.codex?.invalid).toBeUndefined();
  const catalog = applyProviderAccountStyles({ codex: [{ id: "work", label: "Work" }] }, styles);
  expect(
    ModelsListResultSchema.parse({ models: {}, errors: {}, accounts: catalog }).accounts?.codex?.[0]
      ?.isDefault,
  ).toBe(true);
});
