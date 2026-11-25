import { expect, it, vi } from "vitest";
import {
  accountChoicesSnapshot,
  accountModelChoices,
  modelAccountLabel,
  modelAccountLabelWith,
  modelChoiceBaseName,
} from "./accountModelChoices";
import { t } from "../../../shared/i18n/core";
import type { AgentModel } from "./models";
import { providerAccounts } from "../../providers/model/providerAccounts";

it("reads local accounts once per provider when expanding a model catalog", () => {
  vi.mocked(providerAccounts).mockClear();
  const choices = accountModelChoices([model, { ...model, id: "second" }], true);
  expect(choices).toHaveLength(2);
  expect(providerAccounts).toHaveBeenCalledTimes(1);
});

vi.mock("../../providers/model/providerAccounts", () => ({
  providerAccounts: vi.fn(() => [
    { id: "native-secret", label: "Native profile", provider: "codex", isDefault: true },
  ]),
  providerAccountColorValue: () => "var(--ui-text-secondary)",
  providerAccountLabel: () => "Native profile",
  defaultProviderAccountId: () => "native-secret",
  supportsProviderAccounts: (provider: string) => provider === "codex" || provider === "claude",
  PROVIDER_ACCOUNT_PROVIDERS: ["claude", "codex", "grok"],
}));
const model = { id: "codex:model", harness: "codex", name: "Model" } as AgentModel;

it("keeps local account model labels identical with explicit accounts and translator", () => {
  const accounts = providerAccounts("codex");
  for (const accountId of [undefined, "native-secret"])
    expect(modelAccountLabelWith(model, accountId, accounts, t)).toBe(
      modelAccountLabel(model, accountId),
    );
  expect(modelAccountLabelWith(model, "removed", accounts, t)).toBe("Model Removed account");
  expect(modelAccountLabelWith(model, "default", [], t)).toBe("Model Default account");
  expect(modelAccountLabelWith({ ...model, harness: "cursor" }, undefined, [], t)).toBe("Model");
});

it("uses only Host IDs and labels when an explicit Host account catalog is supplied", () => {
  vi.mocked(providerAccounts).mockClear();
  const catalog = { codex: [{ id: "host-work", label: "Build Host" }] };
  expect(accountModelChoices([model], true, catalog)).toEqual([
    { ...model, name: "Model Build Host", accountLabel: "Build Host", accountId: "host-work" },
  ]);
  expect(modelAccountLabel(model, "host-work", catalog)).toBe("Model Build Host");
  expect(modelAccountLabel(model, "native-secret", catalog)).toContain("Unavailable Host account");
  expect(providerAccounts).not.toHaveBeenCalled();
});

it("keeps a model whose Host accounts are unknown, drops one whose Host has none, and preserves Native behavior when omitted", () => {
  vi.mocked(providerAccounts).mockClear();
  expect(accountModelChoices([model], true, {})).toEqual([model]);
  expect(accountModelChoices([model], true, { codex: [] })).toEqual([]);
  expect(providerAccounts).not.toHaveBeenCalled();
  expect(accountModelChoices([model], true)[0]).toMatchObject({ accountId: "native-secret" });
});

it("keeps same-labelled accounts distinguishable without touching the stored label", () => {
  const catalog = {
    codex: [
      { id: "work-a", label: "Work" },
      { id: "work-b", label: "work" },
      { id: "personal", label: "Personal" },
    ],
  };
  const choices = accountModelChoices([model], true, catalog);
  expect(choices.map((choice) => choice.accountLabel)).toEqual([
    "Work · work-a",
    "work · work-b",
    "Personal",
  ]);
  expect(choices[0].name).toBe("Model Work · work-a");
  expect(modelChoiceBaseName(choices[0])).toBe("Model");
  expect(modelAccountLabel(model, "work-b", catalog)).toBe("Model work · work-b");
  expect(modelAccountLabel(model, "personal", catalog)).toBe("Model Personal");
});

it("keys account choices by provider so Grok never reads Codex accounts", () => {
  vi.mocked(providerAccounts).mockImplementation((provider) => [
    { id: `${provider}-1`, label: provider, provider },
  ]);
  const lists = JSON.parse(accountChoicesSnapshot());
  expect(Object.keys(lists)).toEqual(["claude", "codex", "grok"]);
  expect(lists.grok).toEqual([{ id: "grok-1", label: "grok", provider: "grok" }]);
});
