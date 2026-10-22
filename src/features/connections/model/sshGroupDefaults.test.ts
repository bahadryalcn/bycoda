// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined), refresh: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("./serverInventory", () => ({ refreshServerInventory: bridge.refresh }));
import {
  sshGroupDraft,
  sshGroupProfileFromDraft,
  saveSshGroupDefaults,
  removeSshGroupDefaults,
  previewSshConfiguration,
  setSshInheritance,
  validSshRuntimeConfiguration,
  type SshGroupDefaults,
} from "./sshGroupDefaults";
afterEach(() => vi.clearAllMocks());
const group: SshGroupDefaults = {
  id: "group-1",
  revision: 3,
  name: "Team machines",
  defaults: {
    user: "remote-user",
    port: 2222,
    identityFile: "~/key",
    certificateFile: "~/cert.pub",
  },
  environment: [{ name: "APP_STAGE", value: "literal '$()' ; 日本語" }],
  shellKind: "powershell",
};
it("keeps canonical profile identity/revision, public references and literal values without sharing draft arrays", () => {
  const draft = sshGroupDraft(group);
  expect(sshGroupProfileFromDraft(draft)).toEqual(group);
  draft.environment[0].value = "changed";
  expect(group.environment[0].value).toContain("日本語");
  expect(sshGroupProfileFromDraft(draft)?.environment[0].value).toBe("changed");
  const fresh = sshGroupDraft();
  expect(fresh.id).not.toBe(group.id);
  expect(fresh.revision).toBe(0);
});
it("rejects secret/bootstrap environment names, case-insensitive duplicates and private material", () => {
  for (const name of [
    "API_KEY",
    "password",
    "AWS_ACCESS_KEY_ID",
    "BASH_ENV",
    "Path",
    "LD_PRELOAD",
    "SSH_AUTH_SOCK",
    "BYCODA_X",
    "NODE_OPTIONS",
    "bad-name",
  ]) {
    const draft = sshGroupDraft(group);
    draft.environment = [{ name, value: "not-allowed" }];
    expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
  }
  for (const value of [
    "bad\nvalue",
    "bad\u2028value",
    "https://user:pass@host.invalid",
    "-----BEGIN PRIVATE KEY-----",
    "日".repeat(1400),
  ]) {
    const draft = sshGroupDraft(group);
    draft.environment = [{ name: "APP_STAGE", value }];
    expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
  }
  const draft = sshGroupDraft(group);
  draft.environment = [
    { name: "APP_STAGE", value: "first" },
    { name: "app_stage", value: "second" },
  ];
  expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
});
it("rejects partial ports/default references and bounds environment count/total while leaving the draft intact", () => {
  const draft = sshGroupDraft(group);
  for (const port of ["0", "65536", "1e3", "x"]) {
    draft.port = port;
    expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
    expect(draft.port).toBe(port);
  }
  draft.port = "";
  draft.identityFile = "-----BEGIN PRIVATE KEY-----";
  expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
  draft.identityFile = "~/key";
  draft.environment = Array.from({ length: 33 }, (_, i) => ({ name: `APP_${i}`, value: "x" }));
  expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
  draft.environment = Array.from({ length: 5 }, (_, i) => ({
    name: `APP_${i}`,
    value: "x".repeat(4096),
  }));
  expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
});
it("sends exact revision/binding/digest CAS inputs and refreshes only after successful writes", async () => {
  await saveSshGroupDefaults(group, 3);
  expect(bridge.invoke).toHaveBeenCalledWith("ssh_group_defaults_save", {
    profile: group,
    expectedRevision: 3,
  });
  expect(bridge.refresh).toHaveBeenCalledTimes(1);
  const binding = { groupId: group.id, fields: ["user" as const], environment: false };
  await previewSshConfiguration("server-id", binding, false);
  expect(bridge.refresh).toHaveBeenCalledTimes(1);
  await setSshInheritance("server-id", binding, null, "reviewed-digest");
  expect(bridge.invoke).toHaveBeenCalledWith("server_ssh_inheritance_set", {
    connectionId: "server-id",
    inheritance: binding,
    expectedInheritance: null,
    expectedConfigurationDigest: "reviewed-digest",
  });
  bridge.invoke.mockRejectedValueOnce(new Error("group in use"));
  await expect(removeSshGroupDefaults(group.id, 3)).rejects.toThrow("group in use");
  expect(bridge.refresh).toHaveBeenCalledTimes(2);
});

it("uses shell-specific environment name uniqueness and native absolute/home key-reference rules", () => {
  const draft = sshGroupDraft(group);
  draft.shellKind = "posix";
  draft.environment = [
    { name: "APP_STAGE", value: "one" },
    { name: "app_stage", value: "two" },
  ];
  expect(sshGroupProfileFromDraft(draft)).toBeDefined();
  draft.shellKind = "powershell";
  expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
  draft.environment = [];
  for (const value of ["relative-key", "../key"]) {
    draft.identityFile = value;
    expect(sshGroupProfileFromDraft(draft)).toBeUndefined();
  }
  draft.identityFile = "~/key name";
  expect(sshGroupProfileFromDraft(draft)?.defaults.identityFile).toBe("~/key name");
});

it("validates nullable native shell metadata and rejects forged unsafe environment/provenance previews", () => {
  const configuration = {
    digest: "a".repeat(64),
    environment: [],
    shellKind: null,
    provenance: { user: { source: "connection" } },
  };
  expect(validSshRuntimeConfiguration(configuration)).toBe(true);
  expect(
    validSshRuntimeConfiguration({
      ...configuration,
      environment: [{ name: "APP_STAGE", value: "x" }],
    }),
  ).toBe(false);
  expect(validSshRuntimeConfiguration({ ...configuration, digest: "short" })).toBe(false);
  expect(
    validSshRuntimeConfiguration({
      ...configuration,
      provenance: { user: { source: "group", groupId: "id" } },
    }),
  ).toBe(false);
  expect(
    validSshRuntimeConfiguration({
      ...configuration,
      shellKind: "posix",
      environment: [{ name: "PASSWORD", value: "sensitive" }],
    }),
  ).toBe(false);
});
