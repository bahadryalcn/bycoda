// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  removeProviderAccount,
  saveProviderAccount,
  setDefaultProviderAccount,
} from "../../providers/model/providerAccounts";
import { hasProjectDefaults, isModelDefault, modelDefault } from "./modelDefaultMark";
import { resolveModel } from "./models";
import {
  clearProjectDefault,
  loadProjectProviderSettings,
  pinProjectDefault,
  projectDefaultAccountId,
  setProjectDefaultModel,
  setProjectDefaultProvider,
} from "./projectProviders";
import { newSession, newSessionForProject, retargetSessionToProject } from "./session";

const OPUS = resolveModel("claude", "claude:opus-5").id;

beforeEach(() => {
  localStorage.clear();
  saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
  saveProviderAccount({ id: "account-home", provider: "claude", label: "Home" });
  setDefaultProviderAccount("claude", "account-home");
});

describe("project default pin", () => {
  it("pins provider, account and model over a per-provider model", () => {
    setProjectDefaultModel("/repo/a", "claude", "claude:sonnet-4-5");
    pinProjectDefault("/repo/a", "claude", OPUS, "account-work");
    expect(modelDefault("/repo/a", false)).toEqual({
      harness: "claude",
      model: OPUS,
      accountId: "account-work",
      pinned: true,
    });
  });

  it("starts new and retargeted blank conversations on the pinned account", () => {
    pinProjectDefault("/repo/a", "claude", OPUS, "account-work");
    expect(newSession("claude", "/repo/a").providerAccountId).toBe("account-work");
    expect(newSessionForProject(undefined, "/repo/a").providerAccountId).toBe("account-work");
    const blank = newSession("claude", "/repo/b");
    expect(blank.providerAccountId).toBeUndefined();
    expect(retargetSessionToProject(blank, "/repo/a").providerAccountId).toBe("account-work");
  });

  it("falls back to the provider default account when the pinned one is removed", () => {
    pinProjectDefault("/repo/a", "claude", OPUS, "account-work");
    removeProviderAccount("claude", "account-work");
    expect(projectDefaultAccountId("/repo/a", "claude")).toBeUndefined();
    expect(modelDefault("/repo/a", false).accountId).toBe("account-home");
  });

  it("keeps the pinned account when Settings changes only the model", () => {
    pinProjectDefault("/repo/a", "claude", OPUS, "account-work");
    setProjectDefaultProvider("/repo/a", "claude", "claude:sonnet-4-5");
    expect(loadProjectProviderSettings("/repo/a").defaultAccount).toBe("account-work");
    setProjectDefaultProvider("/repo/a", "codex", "codex:gpt-5");
    expect(loadProjectProviderSettings("/repo/a").defaultAccount).toBeUndefined();
  });

  it("clears the pin so the project follows the global choice", () => {
    pinProjectDefault("/repo/a", "claude", OPUS, "account-work");
    clearProjectDefault("/repo/a");
    expect(loadProjectProviderSettings("/repo/a")).toEqual({});
    expect(modelDefault("/repo/a", false).pinned).toBe(false);
  });

  it("uses the Host default account for Host catalogs", () => {
    pinProjectDefault("/repo/a", "claude", OPUS, "account-work");
    expect(modelDefault("/repo/a", true).accountId).toBe("default");
  });
});

describe("isModelDefault", () => {
  const value = {
    harness: "claude",
    model: OPUS,
    accountId: "account-work",
    pinned: true,
  } as const;

  it("matches provider and model, and the account only when the row has one", () => {
    expect(isModelDefault(value, "claude", OPUS, "account-work")).toBe(true);
    expect(isModelDefault(value, "claude", OPUS, "account-home")).toBe(false);
    expect(isModelDefault(value, "claude", OPUS)).toBe(true);
    expect(isModelDefault(value, "codex", OPUS)).toBe(false);
  });

  it("has no project defaults for the home fallback or an empty scope", () => {
    expect(hasProjectDefaults("/repo/a")).toBe(true);
    expect(hasProjectDefaults("~")).toBe(false);
    expect(hasProjectDefaults("")).toBe(false);
    expect(hasProjectDefaults(undefined)).toBe(false);
  });
});
