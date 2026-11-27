// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { saveProviderAccount } from "../../providers/model/providerAccounts";
import { loadDefaultModels, loadLastModelChoice } from "../../sessions/public/models";
import { loadProjectProviderSettings } from "../../sessions/public/projectProviders";
import {
  accountSessionDefaults,
  loadGlobalSessionDefaults,
  saveGlobalSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import {
  EMPTY_DRAFT,
  accountDraftKey,
  draftSize,
  overlaySessionDefaults,
  parseTargetValue,
  recordField,
  recordSessionDefaults,
  targetValue,
  withChange,
  type DefaultsDraft,
} from "./providerDefaultsDraft";
import { saveDefaultsDraft } from "./providerDefaultsSave";
import { providersTabForSetting } from "./providerSettingsTabs";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("records only fields that differ from the stored values", () => {
  const base = { effort: "low", extras: { fast: "on" } };
  const change = recordSessionDefaults(undefined, base, {
    effort: "high",
    runtimeMode: "full-access",
    extras: {},
  });
  expect(change).toEqual({
    effort: "high",
    runtimeMode: "full-access",
    extras: { fast: null },
  });
  expect(overlaySessionDefaults(base, change)).toEqual({
    effort: "high",
    runtimeMode: "full-access",
    extras: {},
  });
  // Choosing the stored values again leaves nothing pending.
  expect(recordSessionDefaults(change, base, base)).toBeUndefined();
  expect(recordField(undefined, "model", "opus", "opus")).toBeUndefined();
  expect(recordField({ model: "opus" }, "model", null, undefined)).toBeUndefined();
  expect(recordField(undefined, "hidden", true, false)).toEqual({ hidden: true });
});

it("counts pending changes across providers, accounts and the default provider", () => {
  let draft: DefaultsDraft = withChange(EMPTY_DRAFT, { harness: "codex" }, { effort: "high" });
  draft = withChange(draft, { harness: "claude", accountId: "work" }, { model: "sonnet" });
  draft = { ...draft, defaultProvider: "claude" };
  expect(draftSize(draft)).toBe(3);
  expect(draftSize(withChange(draft, { harness: "codex" }, undefined))).toBe(2);
});

it("round-trips targets and drops anything else to Global", () => {
  const project = { kind: "project", path: "/work/web" } as const;
  expect(parseTargetValue(targetValue(project))).toEqual(project);
  expect(parseTargetValue("group:wallet")).toEqual({ kind: "global" });
  expect(parseTargetValue("project:")).toEqual({ kind: "global" });
});

it("saves a change set to Global", () => {
  saveGlobalSessionDefaults("codex", { effort: "low" });
  const draft: DefaultsDraft = {
    defaultProvider: "codex",
    providers: { codex: { model: "gpt-x", effort: "high", runtimeMode: "full-access" } },
    accounts: {},
  };
  expect(saveDefaultsDraft(draft, { kind: "global" })).toEqual({ state: "saved" });
  expect(loadDefaultModels().codex).toBe("gpt-x");
  expect(loadGlobalSessionDefaults().codex).toEqual({
    effort: "high",
    runtimeMode: "full-access",
  });
  expect(loadLastModelChoice()).toEqual({ harness: "codex", model: "gpt-x" });
});

it("saves a change set into one project and clears a model override", () => {
  const draft: DefaultsDraft = {
    defaultProvider: "claude",
    providers: { claude: { model: "sonnet", extras: { fast: "on" }, hidden: false } },
    accounts: {},
  };
  expect(saveDefaultsDraft(draft, { kind: "project", path: "/work/web" }).state).toBe("saved");
  expect(loadProjectProviderSettings("/work/web")).toEqual({
    defaultHarness: "claude",
    defaultModel: "sonnet",
    models: { claude: "sonnet" },
    defaults: { claude: { extras: { fast: "on" } } },
  });
  expect(loadProjectProviderSettings("/work/other")).toEqual({});

  const clear: DefaultsDraft = { providers: { claude: { model: null } }, accounts: {} };
  saveDefaultsDraft(clear, { kind: "project", path: "/work/web" });
  expect(loadProjectProviderSettings("/work/web").models).toBeUndefined();
});

it("saves account overrides whatever the target and keeps their model", () => {
  saveProviderAccount({ id: "account-home", provider: "claude", label: "Home" });
  const key = accountDraftKey("claude", "account-home");
  saveDefaultsDraft(
    { providers: {}, accounts: { [key]: { model: "sonnet", effort: "high" } } },
    { kind: "global" },
  );
  expect(accountSessionDefaults("claude", "account-home")).toEqual({
    effort: "high",
    model: "sonnet",
  });
  saveDefaultsDraft(
    { providers: {}, accounts: { [key]: { model: null } } },
    { kind: "project", path: "/work/web" },
  );
  expect(accountSessionDefaults("claude", "account-home")).toEqual({
    effort: "high",
  });
});

it("keeps a project's account choice through later edits and saves it per provider", () => {
  saveProviderAccount({
    id: "account-home",
    provider: "claude",
    label: "Home",
  });
  saveProviderAccount({
    id: "account-work",
    provider: "claude",
    label: "Work",
  });
  let change = recordField(undefined, "account", "account-work", undefined);
  change = recordSessionDefaults(change, {}, { effort: "high" });
  expect(change).toEqual({ account: "account-work", effort: "high" });
  expect(draftSize({ ...EMPTY_DRAFT, providers: { claude: change } })).toBe(2);
  expect(recordField(change, "account", null, null)).toEqual({
    effort: "high",
  });

  saveDefaultsDraft(
    { ...EMPTY_DRAFT, providers: { claude: { account: "account-work" } } },
    { kind: "project", path: "/work/web" },
  );
  expect(loadProjectProviderSettings("/work/web").accounts).toEqual({
    claude: "account-work",
  });
  // Account defaults stay machine-wide; Global ignores a project's account choice.
  saveDefaultsDraft(
    { ...EMPTY_DRAFT, providers: { claude: { account: "account-home" } } },
    {
      kind: "global",
    },
  );
  expect(loadProjectProviderSettings("/work/web").accounts).toEqual({
    claude: "account-work",
  });
  saveDefaultsDraft(
    { ...EMPTY_DRAFT, providers: { claude: { account: null } } },
    { kind: "project", path: "/work/web" },
  );
  expect(loadProjectProviderSettings("/work/web").accounts).toBeUndefined();
});

it("reports unsaved when storage refuses the write", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const outcome = saveDefaultsDraft(
    { providers: { codex: { effort: "high" } }, accounts: {} },
    { kind: "global" },
  );
  expect(outcome.state).toBe("unsaved");
});

it("maps searched settings to their Providers tab", () => {
  expect(providersTabForSetting("agent-clis")).toBe("defaults");
  expect(providersTabForSetting("enabled-models")).toBe("providers");
  expect(providersTabForSetting("cli-path-codex")).toBe("providers");
  expect(providersTabForSetting("terminal-account-profiles-codex")).toBe("providers");
  expect(providersTabForSetting("acp-registry")).toBe("providers");
  expect(providersTabForSetting("models-roles")).toBe("work");
  expect(providersTabForSetting("subagents")).toBe("defaults");
  expect(providersTabForSetting("decision-models")).toBeUndefined();
  expect(providersTabForSetting("show-remaining-usage")).toBeUndefined();
  expect(providersTabForSetting(null)).toBeUndefined();
});
