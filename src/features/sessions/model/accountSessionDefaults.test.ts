// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  providerAccounts,
  saveProviderAccount,
  setDefaultProviderAccount,
} from "../../providers/model/providerAccounts";
import { accountSessionDefaults, saveAccountSessionDefaults } from "./accountSessionDefaults";
import { withAccountDefaults } from "./accountDefaultsSwitch";
import { resetHarnessModelOverlays, saveLastModelChoice, setHarnessModels } from "./models";
import { setProjectSessionDefaults } from "./projectProviders";
import { providerSessionDefaults, saveGlobalSessionDefaults } from "./providerSessionDefaults";
import { newSession } from "./session";

const effort = {
  id: "reasoningEffort",
  label: "Effort",
  kind: "select" as const,
  value: "medium",
  options: ["low", "medium", "high"].map((value) => ({ value, label: value })),
};

beforeEach(() => {
  localStorage.clear();
  setHarnessModels("codex", [
    { id: "codex:a", harness: "codex", name: "A", settings: [effort] },
    { id: "codex:b", harness: "codex", name: "B", settings: [effort] },
  ]);
  saveLastModelChoice("codex", "codex:a");
  saveProviderAccount({ id: "account-work", provider: "codex", label: "Work" });
  saveProviderAccount({ id: "account-home", provider: "codex", label: "Home" });
  setDefaultProviderAccount("codex", "account-work");
});
afterEach(() => resetHarnessModelOverlays());

it("layers provider, then account, then project defaults", () => {
  saveGlobalSessionDefaults("codex", { effort: "low", runtimeMode: "auto" });
  saveAccountSessionDefaults("codex", "account-home", { effort: "high", model: "codex:b" });
  expect(providerSessionDefaults("codex", undefined, "account-home")).toMatchObject({
    effort: "high",
    runtimeMode: "auto",
  });
  expect(providerSessionDefaults("codex", undefined, "account-work").effort).toBe("low");
  setProjectSessionDefaults("/repo", "codex", { effort: "medium" });
  expect(providerSessionDefaults("codex", "/repo", "account-home").effort).toBe("medium");
});

it("starts a new conversation with the default account's own model and settings", () => {
  saveAccountSessionDefaults("codex", "account-work", { effort: "high", model: "codex:b" });
  const session = newSession("codex", "/repo");
  expect(session.model).toBe("codex:b");
  expect(session.modelSettings.reasoningEffort).toBe("high");
});

it("adopts an account's defaults only for a conversation with nothing sent", () => {
  saveAccountSessionDefaults("codex", "account-home", { effort: "high", model: "codex:b" });
  const blank = newSession("codex", "/repo");
  const moved = withAccountDefaults(
    { ...blank, providerAccountId: "account-home" },
    "account-home",
  );
  expect(moved.model).toBe("codex:b");
  expect(moved.modelSettings.reasoningEffort).toBe("high");
  const sent = { ...blank, blocks: [{ id: "u", role: "user" as const, text: "hi" }] };
  expect(withAccountDefaults(sent, "account-home")).toBe(sent);
  expect(withAccountDefaults(blank, "account-work")).toBe(blank);
});

it("removes an account's entry when every field follows the provider again", () => {
  saveAccountSessionDefaults("codex", "account-home", { effort: "high" });
  saveAccountSessionDefaults("codex", "account-home", {});
  expect(accountSessionDefaults("codex", "account-home")).toEqual({});
  expect(providerAccounts("codex").map((account) => account.id)).toContain("account-home");
});

it("rebinds product delegation when a blank session switches to an account without overrides", () => {
  const blank = newSession("codex", "/repo");
  expect(JSON.parse(blank.modelSettings.crossAdvisor).providerAccountId).toBe("account-work");
  const moved = withAccountDefaults(
    { ...blank, providerAccountId: "account-home" },
    "account-home",
  );
  expect(JSON.parse(moved.modelSettings.crossAdvisor).providerAccountId).toBe("account-home");
  expect(JSON.parse(moved.modelSettings.crossSubagents)[0].providerAccountId).toBe("account-home");
  expect(moved.model).toBe(blank.model);
});

it("preserves saved cross-account choices and off on account switch", () => {
  const advisor = JSON.stringify({
    harness: "codex",
    model: "codex:a",
    providerAccountId: "account-work",
  });
  saveGlobalSessionDefaults("codex", { extras: { crossAdvisor: advisor, crossSubagents: "[]" } });
  const blank = newSession("codex", "/repo");
  const moved = withAccountDefaults(
    { ...blank, providerAccountId: "account-home" },
    "account-home",
  );
  expect(moved.modelSettings.crossAdvisor).toBe(advisor);
  expect(moved.modelSettings.crossSubagents).toBe("[]");
  expect(
    withAccountDefaults({ ...blank, providerSessionId: "remote" }, "account-home").modelSettings,
  ).toEqual(blank.modelSettings);
});

it("preserves source account explicit delegation when switching to an unconfigured account", () => {
  const advisor = JSON.stringify({
    harness: "codex",
    model: "codex:a",
    providerAccountId: "account-work",
  });
  saveAccountSessionDefaults("codex", "account-work", { extras: { crossAdvisor: advisor } });
  const blank = newSession("codex", "/repo");
  const moved = withAccountDefaults(
    { ...blank, providerAccountId: "account-home" },
    "account-home",
    "account-work",
  );
  expect(moved.modelSettings.crossAdvisor).toBe(advisor);
});
