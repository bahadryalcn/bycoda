import { expect, it } from "vitest";
import { ResourceDiagnostics } from "./resource-diagnostics";

it("samples only on demand, coalesces requests and bounds history in count and bytes", () => {
  let now = 10_000;
  const diagnostics = new ResourceDiagnostics(() => now);
  expect(diagnostics.read("device-a").samples).toHaveLength(1);
  expect(diagnostics.read("device-b").samples).toHaveLength(1);
  for (let index = 0; index < 120; index++) {
    now += 1_000;
    diagnostics.read("device-a");
  }
  const value = diagnostics.read("device-a");
  expect(value.samples).toHaveLength(60);
  expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(64 * 1024);
  expect(value.childProcessesIncluded).toBe(false);
  expect(JSON.stringify(value)).not.toContain("device-a");
  diagnostics.close();
  expect(diagnostics.read("device-a").samples).toHaveLength(1);
});

it("bounds reader registration and releases TTL/revoked capacity", () => {
  let now = 1_000;
  const diagnostics = new ResourceDiagnostics(() => now);
  for (let index = 0; index < 32; index++) diagnostics.read(`d-${index}`);
  expect(() => diagnostics.read("extra")).toThrow("limit");
  diagnostics.revoke("d-0");
  expect(() => diagnostics.read("extra")).not.toThrow();
  now += 61_000;
  expect(() => diagnostics.read("new")).not.toThrow();
});
