// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
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
  groupProjectKeys,
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

const groups = [
  { id: "team", name: "Team", collapsed: false },
  {
    id: "wallet",
    name: "Wallet",
    collapsed: false,
    workspaceFile: "/work/wallet/wallet.code-workspace",
    workspaceFolders: ["/work/wallet/api"],
  },
];
const assignments = {
  [pathKey("/work/web")]: "team",
  [pathKey("/work/wallet")]: "team",
  [pathKey("/work/wallet/api")]: "wallet",
  [pathKey("/work/other")]: "elsewhere",
};

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

it("round-trips targets and drops unknown groups to Global", () => {
  const project = { kind: "project", path: "/work/web" } as const;
  expect(parseTargetValue(targetValue(project), groups)).toEqual(project);
  expect(parseTargetValue("group:wallet", groups)).toEqual({
    kind: "group",
    id: "wallet",
    workspace: true,
  });
  expect(parseTargetValue("group:gone", groups)).toEqual({ kind: "global" });
});

it("expands a group to its projects and the projects of nested workspaces", () => {
  expect(groupProjectKeys("team", groups, assignments).sort()).toEqual(
    [pathKey("/work/web"), pathKey("/work/wallet"), pathKey("/work/wallet/api")].sort(),
  );
  expect(groupProjectKeys("wallet", groups, assignments)).toEqual([pathKey("/work/wallet/api")]);
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

it("saves the same change set into every project of a group and clears a model override", () => {
  localStorage.setItem("bycoda.projectGroups", JSON.stringify(groups));
  localStorage.setItem("bycoda.projectGroupAssignments", JSON.stringify(assignments));
  const draft: DefaultsDraft = {
    defaultProvider: "claude",
    providers: { claude: { model: "sonnet", extras: { fast: "on" }, hidden: false } },
    accounts: {},
  };
  expect(saveDefaultsDraft(draft, { kind: "group", id: "team", workspace: false }).state).toBe(
    "saved",
  );
  for (const path of ["/work/web", "/work/wallet", "/work/wallet/api"]) {
    expect(loadProjectProviderSettings(path)).toEqual({
      defaultHarness: "claude",
      defaultModel: "sonnet",
      models: { claude: "sonnet" },
      defaults: { claude: { extras: { fast: "on" } } },
    });
  }
  expect(loadProjectProviderSettings("/work/other")).toEqual({});

  const clear: DefaultsDraft = { providers: { claude: { model: null } }, accounts: {} };
  saveDefaultsDraft(clear, { kind: "project", path: "/work/web" });
  expect(loadProjectProviderSettings("/work/web").models).toBeUndefined();
});

it("refuses an empty group instead of reporting a save", () => {
  localStorage.setItem("bycoda.projectGroups", JSON.stringify(groups));
  const outcome = saveDefaultsDraft(
    { providers: { claude: { effort: "high" } }, accounts: {} },
    { kind: "group", id: "team", workspace: false },
  );
  expect(outcome.state).toBe("unsaved");
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
  expect(accountSessionDefaults("claude", "account-home")).toEqual({ effort: "high" });
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
  expect(providersTabForSetting("enabled-models")).toBe("models");
  expect(providersTabForSetting("cli-path-codex")).toBe("cli");
  expect(providersTabForSetting("terminal-account-profiles-codex")).toBe("providers");
  expect(providersTabForSetting("acp-registry")).toBe("providers");
  expect(providersTabForSetting("decision-models")).toBe("decision");
  expect(providersTabForSetting("show-remaining-usage")).toBeUndefined();
  expect(providersTabForSetting(null)).toBeUndefined();
});
