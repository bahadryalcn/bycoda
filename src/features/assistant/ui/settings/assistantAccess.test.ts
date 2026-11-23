import { expect, it } from "vitest";
import {
  assistantAccessMode,
  assistantAccessPatch,
  DEFAULT_CRITICAL_EXCLUSIONS,
  effectiveConsent,
  nativeConsentFromGrant,
  type NativeConsent,
} from "./assistantAccess";

const execution = {
  harness: "codex",
  model: "gpt-6",
  runtimeMode: "supervised",
  modelSettings: {},
  maxRunMinutes: 60,
} as const;
const everything: NativeConsent = {
  state: "active",
  permissionLevel: "everything",
  criticalExclusions: [],
};
const full = { enabled: true, permissionMode: "full", allowPhysicalInput: true } as const;
const asking = { enabled: true, permissionMode: "ask", allowPhysicalInput: true } as const;
const consentFor = (native: NativeConsent, draft = {}, changed = false) =>
  effectiveConsent(native, draft, changed);

it("does not call mixed or unloaded grants full access", () => {
  const profile = assistantAccessPatch({ execution }, "full");
  const granted = consentFor(everything);
  expect(assistantAccessMode(profile, undefined, true, true, granted)).toBe("loading");
  expect(
    assistantAccessMode(
      profile,
      { enabled: true, permissionMode: "full", allowPhysicalInput: false },
      true,
      true,
      granted,
    ),
  ).toBe("custom");
  expect(assistantAccessMode(profile, full, false, true, granted)).toBe("custom");
  expect(assistantAccessMode(profile, full, true, false, granted)).toBe("custom");
  expect(assistantAccessMode(profile, full, true, true, granted)).toBe("full");
});

it("full access needs an active native grant of everything with no exclusions", () => {
  const profile = assistantAccessPatch({ execution }, "full");
  const label = (native: NativeConsent, draft = {}, changed = false) =>
    assistantAccessMode(profile, full, true, true, consentFor(native, draft, changed));
  // A Host mirror that says "everything" never makes the label say full.
  expect(label({ state: "missing" }, profile)).toBe("custom");
  expect(label({ state: "other-credentials", permissionLevel: "everything" }, profile)).toBe(
    "custom",
  );
  expect(label({ state: "loading" })).toBe("loading");
  expect(label({ state: "failed" })).toBe("loading");
  expect(label({ ...everything, permissionLevel: "projects" })).toBe("custom");
  expect(label({ ...everything, criticalExclusions: ["spend"] })).toBe("custom");
  expect(label(everything)).toBe("full");
  // An unsaved owner choice shows what Save will grant.
  expect(label({ state: "missing" }, profile, true)).toBe("full");
  expect(label({ state: "missing" }, { ...profile, criticalExclusions: ["spend"] }, true)).toBe(
    "custom",
  );
});

it("full access removes job confirmations without changing the model", () => {
  expect(assistantAccessPatch({ execution }, "full")).toMatchObject({
    execution: { ...execution, runtimeMode: "full-access" },
    confirmJobs: false,
    planApproval: "never",
  });
  expect(assistantAccessPatch({}, "full")).not.toHaveProperty("execution");
});

it("the full preset grants everything with no critical exclusions", () => {
  expect(assistantAccessPatch({ execution }, "full")).toMatchObject({
    permissionLevel: "everything",
    permissionProjectIds: [],
    criticalExclusions: [],
  });
});

it("supervised access restores confirmation and drops any broad grant", () => {
  const profile = assistantAccessPatch({ execution }, "ask");
  expect(profile).toMatchObject({
    confirmJobs: true,
    execution: { runtimeMode: "supervised" },
    permissionLevel: "ask",
    permissionProjectIds: [],
    criticalExclusions: DEFAULT_CRITICAL_EXCLUSIONS,
  });
  expect(assistantAccessMode(profile, asking, false, false, consentFor({ state: "missing" }))).toBe(
    "ask",
  );
  expect(
    assistantAccessMode(
      profile,
      asking,
      false,
      false,
      consentFor({ state: "other-credentials", permissionLevel: "everything" }),
    ),
  ).toBe("ask");
  // A native everything grant still in force keeps Work and ask from claiming "ask".
  expect(assistantAccessMode(profile, asking, false, false, consentFor(everything))).toBe("custom");
  expect(
    assistantAccessMode(profile, asking, false, false, consentFor(everything, profile, true)),
  ).toBe("ask");
});

it("reads the native grant, treating another credential as inactive", () => {
  expect(nativeConsentFromGrant(null)).toEqual({ state: "missing" });
  expect(
    nativeConsentFromGrant({
      revision: 2,
      active: false,
      permissionLevel: "everything",
      criticalExclusions: [],
    }),
  ).toEqual({ state: "other-credentials", permissionLevel: "everything" });
  expect(
    nativeConsentFromGrant({ revision: 3, permissionLevel: "ask", criticalExclusions: ["spend"] }),
  ).toEqual({ state: "active", permissionLevel: "ask", criticalExclusions: ["spend"] });
});
