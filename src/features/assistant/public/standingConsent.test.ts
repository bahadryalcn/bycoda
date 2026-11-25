import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const { readStandingConsent } = await import("./standingConsent");

beforeEach(() => invoke.mockReset());
const grant = (extra: object) => invoke.mockResolvedValueOnce({ revision: 1, ...extra });

it("is full access only for level everything with no exclusions on the active credential", async () => {
  grant({ permissionLevel: "everything", criticalExclusions: [] });
  const full = await readStandingConsent("env");
  expect(full.fullAccess).toBe(true);
  expect(full.excludes("deleteSession")).toBe(false);
});
it.each([
  [{ permissionLevel: "ask", criticalExclusions: [] }],
  [{ permissionLevel: "everything", criticalExclusions: ["deleteSession"] }],
  [{ permissionLevel: "everything", criticalExclusions: [], active: false }],
])("is not full access for %j", async (extra) => {
  grant(extra);
  expect((await readStandingConsent("env")).fullAccess).toBe(false);
});
it("fails closed on a missing grant or a failed read", async () => {
  invoke.mockResolvedValueOnce(null);
  expect((await readStandingConsent("env")).fullAccess).toBe(false);
  invoke.mockRejectedValueOnce(new Error("native failure"));
  const closed = await readStandingConsent("env");
  expect(closed.fullAccess).toBe(false);
  expect(closed.excludes("deleteSession")).toBe(true);
});
