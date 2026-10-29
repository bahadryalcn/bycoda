import { expect, it, vi } from "vitest";
import { accountModelChoices, modelAccountLabel } from "./accountModelChoices";
import type { AgentModel } from "./models";
import { providerAccounts } from "../../providers/model/providerAccounts";

vi.mock("../../providers/model/providerAccounts", () => ({
  providerAccounts: vi.fn(() => [
    { id: "native-secret", label: "Native profile", provider: "codex" },
  ]),
  providerAccountColorValue: () => "var(--ui-text-secondary)",
  providerAccountLabel: () => "Native profile",
  defaultProviderAccountId: () => "native-secret",
  supportsProviderAccounts: (provider: string) => provider === "codex" || provider === "claude",
}));
const model = { id: "codex:model", harness: "codex", name: "Model" } as AgentModel;

it("uses only Host IDs and labels when an explicit Host account catalog is supplied", () => {
  vi.mocked(providerAccounts).mockClear();
  const catalog = { codex: [{ id: "host-work", label: "Build Host" }] };
  expect(accountModelChoices([model], true, catalog)).toEqual([
    { ...model, name: "Model Build Host", accountId: "host-work" },
  ]);
  expect(modelAccountLabel(model, "host-work", catalog)).toBe("Model Build Host");
  expect(modelAccountLabel(model, "native-secret", catalog)).toContain("Unavailable Host account");
  expect(providerAccounts).not.toHaveBeenCalled();
});

it("treats an explicitly empty Host catalog as empty and preserves Native account behavior when omitted", () => {
  vi.mocked(providerAccounts).mockClear();
  expect(accountModelChoices([model], true, {})).toEqual([]);
  expect(providerAccounts).not.toHaveBeenCalled();
  expect(accountModelChoices([model], true)[0]).toMatchObject({ accountId: "native-secret" });
});
