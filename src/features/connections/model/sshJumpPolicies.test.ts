import { expect, it } from "vitest";
import {
  emptySshJumpPolicyDraft,
  sshJumpPolicyDrafts,
  sshJumpPoliciesFromDrafts,
  validSshJumpFileReference,
} from "./sshJumpPolicies";

it("roundtrips ordered per-hop credentials and trust references without trimming file names", () => {
  const policies = [
    {
      host: "first.example",
      user: "alice",
      port: 2222,
      identityFile: "C:/Keys/hop one",
      certificateFile: "C:/Keys/hop cert.pub",
      knownHostsFile: "C:/Trust/hop known hosts",
    },
    { host: "::1", user: "bob", port: 22, identityFile: "~/key" },
  ];
  const drafts = sshJumpPolicyDrafts(policies);
  expect(sshJumpPoliciesFromDrafts(drafts, "windows")).toEqual(policies);
  expect(sshJumpPoliciesFromDrafts([...drafts].reverse(), "windows")).toEqual(
    [...policies].reverse(),
  );
  drafts[0].identityFile = "C:/Keys/  literal key  ";
  expect(sshJumpPoliciesFromDrafts(drafts, "windows")?.[0].identityFile).toBe(
    "C:/Keys/  literal key  ",
  );
  expect(policies[0].identityFile).toBe("C:/Keys/hop one");
});
it("keeps partial form strings editable but rejects invalid policy submission", () => {
  const valid = { ...emptySshJumpPolicyDraft(), host: "bastion" };
  for (const patch of [
    { host: "-unsafe" },
    { host: "bad host" },
    { user: "alice@bob" },
    { port: "" },
    { port: "0" },
    { port: "65536" },
    { port: "22.5" },
    { port: "2e2" },
  ])
    expect(sshJumpPoliciesFromDrafts([{ ...valid, ...patch }])).toBeUndefined();
  expect(sshJumpPoliciesFromDrafts([])).toEqual([]);
  expect(sshJumpPoliciesFromDrafts(Array.from({ length: 8 }, () => ({ ...valid })))).toHaveLength(
    8,
  );
  expect(
    sshJumpPoliciesFromDrafts(Array.from({ length: 9 }, () => ({ ...valid }))),
  ).toBeUndefined();
});
it("rejects secret material, expansions and unsafe file references in every per-hop field", () => {
  for (const field of ["identityFile", "certificateFile", "knownHostsFile"] as const) {
    for (const value of [
      "bad\nreference",
      "bad%reference",
      "bad$reference",
      'bad"reference',
      "   ",
      "x".repeat(4097),
    ])
      expect(
        sshJumpPoliciesFromDrafts([
          { ...emptySshJumpPolicyDraft(), host: "bastion", [field]: value },
        ]),
      ).toBeUndefined();
  }
});

it("matches native absolute/home path rules across Windows and Unix without rewriting drafts", () => {
  for (const platform of ["windows", "posix"] as const) {
    for (const path of ["~/keys/key name", "~\\keys\\key", "~/", ""])
      expect(validSshJumpFileReference(path, platform)).toBe(true);
    for (const path of [
      "relative/key",
      "../key",
      "C:key",
      "~user/key",
      "~",
      "  /key",
      "~/bad$ref",
      "~/bad%ref",
      "~/bad\u0080ref",
      "~/" + "日".repeat(1400),
    ])
      expect(validSshJumpFileReference(path, platform)).toBe(false);
  }
  for (const path of [
    "C:/keys/key name",
    "D:\\keys\\key",
    "\\\\server\\share\\key",
    "//server/share/key",
  ])
    expect(validSshJumpFileReference(path, "windows")).toBe(true);
  for (const path of ["/drive-relative/key", "\\drive-relative\\key", "//server"])
    expect(validSshJumpFileReference(path, "windows")).toBe(false);
  expect(validSshJumpFileReference("/keys/key name", "posix")).toBe(true);
  expect(validSshJumpFileReference("C:/keys/key", "posix")).toBe(false);
});
