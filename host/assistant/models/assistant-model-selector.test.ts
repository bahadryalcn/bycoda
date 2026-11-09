import { describe, expect, it } from "vitest";
import type { AssistantModelPoolRow } from "../../../src/shared/model/assistantModelPool";
import type { AssistantQuotaReading } from "./assistant-quota-reader";
import { selectPoolRow } from "./assistant-model-selector";

const row = (id: string, extra: Partial<AssistantModelPoolRow> = {}): AssistantModelPoolRow => ({
  id,
  harness: "codex",
  model: "m",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 60,
  roles: ["worker"],
  minRemainingPercent: 20,
  unknownLimit: "use",
  ...extra,
});
const left = (leftPercent: number, resetsAt?: number): AssistantQuotaReading => ({
  leftPercent,
  sampledAt: 1,
  ...(resetsAt === undefined ? {} : { resetsAt }),
});
const unknown: AssistantQuotaReading = { unknown: true, reason: "noSample" };
const byId = (map: Record<string, AssistantQuotaReading>) => (r: AssistantModelPoolRow) =>
  map[r.id] ?? unknown;

describe("selectPoolRow", () => {
  it("takes the first row when it has headroom", () => {
    const result = selectPoolRow(
      "worker",
      { rows: [row("a"), row("b")] },
      byId({ a: left(50), b: left(90) }),
    );
    expect(result).toMatchObject({ reason: "first", row: { id: "a" } });
  });
  it("skips a row below its threshold and names the skipped ids", () => {
    const result = selectPoolRow(
      "worker",
      { rows: [row("a"), row("b")] },
      byId({ a: left(10), b: left(90) }),
    );
    expect(result).toMatchObject({ reason: "skipped:a", row: { id: "b" } });
  });
  it("accepts a row exactly at its threshold", () => {
    expect(selectPoolRow("worker", { rows: [row("a")] }, byId({ a: left(20) })).row?.id).toBe("a");
  });
  it("honors unknownLimit use and skip", () => {
    const rows = [row("a", { unknownLimit: "skip" }), row("b", { unknownLimit: "use" })];
    expect(selectPoolRow("worker", { rows }, byId({ a: unknown, b: unknown }))).toMatchObject({
      reason: "skipped:a",
      row: { id: "b" },
    });
    expect(selectPoolRow("worker", { rows: [rows[0]] }, byId({ a: unknown }))).toEqual({
      row: null,
      reason: "allBelowThreshold",
    });
  });
  it("returns the earliest known reset when every row is limited", () => {
    const rows = [row("a"), row("b"), row("c", { unknownLimit: "skip" })];
    expect(
      selectPoolRow("worker", { rows }, byId({ a: left(1, 900), b: left(2, 500), c: unknown })),
    ).toEqual({ row: null, reason: "allBelowThreshold", nextResetAt: 500 });
  });
  it("filters by role", () => {
    const rows = [row("a", { roles: ["chief"] }), row("b", { roles: ["worker", "reply"] })];
    expect(selectPoolRow("reply", { rows }, byId({ a: left(100), b: left(100) })).row?.id).toBe(
      "b",
    );
    expect(selectPoolRow("planning", { rows }, byId({}))).toEqual({
      row: null,
      reason: "noRowForRole",
    });
  });
});
