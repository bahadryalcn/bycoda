import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { hostProof, matchesHostProof } from "./host-proof";

it("matches the native HMAC-SHA256 protocol vector and rejects reflected tags", () => {
  const key = createHash("sha256").update("fixture-secret").digest("hex");
  const tag = hostProof(key, "device", "response", "0".repeat(64), "env", "https://host.test");
  expect(tag).toBe("ada6ab4aafb0487bb059cbcbbe3a23c89a948c1e70ca979ccdb84ff60d38b823");
  expect(matchesHostProof(tag, tag)).toBe(true);
  expect(
    matchesHostProof(
      tag,
      hostProof(key, "device", "request", "0".repeat(64), "env", "https://host.test"),
    ),
  ).toBe(false);
  expect(matchesHostProof(tag, "wrong")).toBe(false);
});
