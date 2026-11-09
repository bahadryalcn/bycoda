import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_IDLE_MS,
  desktopGate,
  runDesktopLayer,
  type DesktopGateInput,
} from "./desktop-layer";
import type { BrowserSettings } from "./browser-settings";

const allowed: BrowserSettings = {
  accountId: "acc",
  visibility: "hidden",
  desktopControl: { allowed: true, computerId: "pc-1" },
};
const away = { supported: true, locked: false, idleMs: DESKTOP_IDLE_MS };
const base: DesktopGateInput = { settings: allowed, outreach: false, presence: away };

describe("desktopGate (owner decision D9)", () => {
  it("opens only when every condition holds", () => {
    expect(desktopGate(base)).toEqual({ ok: true, computerId: "pc-1" });
    expect(
      desktopGate({ ...base, presence: { supported: true, locked: false, awayStatus: true } }).ok,
    ).toBe(true);
  });

  it("refuses when desktop control is off, no computer is selected, or the task is outreach", () => {
    const off = {
      ...base,
      settings: { ...allowed, desktopControl: { allowed: false, computerId: "pc-1" } },
    };
    expect(desktopGate(off)).toEqual({ ok: false, reason: "not_allowed" });
    const none = { ...base, settings: { ...allowed, desktopControl: { allowed: true } } };
    expect(desktopGate(none)).toEqual({ ok: false, reason: "no_computer" });
    expect(desktopGate({ ...base, outreach: true })).toEqual({ ok: false, reason: "outreach" });
    expect(desktopGate({ ...base, outreach: undefined })).toEqual({
      ok: false,
      reason: "outreach",
    });
  });

  it("refuses while the owner is active, the computer is locked, presence is unknown, or the owner's screen is the target", () => {
    expect(
      desktopGate({ ...base, presence: { supported: true, locked: false, idleMs: 1000 } }),
    ).toEqual({
      ok: false,
      reason: "owner_active",
    });
    expect(
      desktopGate({
        ...base,
        presence: { supported: true, locked: true, idleMs: DESKTOP_IDLE_MS },
      }),
    ).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(desktopGate({ ...base, presence: undefined })).toEqual({
      ok: false,
      reason: "presence_unknown",
    });
    expect(desktopGate({ ...base, presence: { supported: false, locked: true } })).toEqual({
      ok: false,
      reason: "presence_unknown",
    });
    expect(desktopGate({ ...base, ownerActiveComputerId: "pc-1" })).toEqual({
      ok: false,
      reason: "owner_screen",
    });
  });
});

describe("runDesktopLayer", () => {
  const request = { accountId: "acc", platform: "x" as const, step: "send" };

  it("never calls the port when the gate is closed", async () => {
    const port = { run: vi.fn(async () => ({ done: true })) };
    const outcome = await runDesktopLayer(port, { ok: false, reason: "owner_active" }, request);
    expect(outcome).toEqual({ status: "skipped", detail: "owner_active" });
    expect(port.run).not.toHaveBeenCalled();
  });

  it("reports skipped when no adapter is wired, and failed when the port throws or is not done", async () => {
    const gate = { ok: true as const, computerId: "pc-1" };
    expect(await runDesktopLayer(undefined, gate, request)).toEqual({
      status: "skipped",
      detail: "no_adapter",
    });
    const throwing = { run: vi.fn(async () => Promise.reject(new Error("boom"))) };
    expect(await runDesktopLayer(throwing, gate, request)).toEqual({
      status: "failed",
      detail: "error",
    });
    const notDone = { run: vi.fn(async () => ({ done: false })) };
    expect(await runDesktopLayer(notDone, gate, request)).toEqual({
      status: "failed",
      detail: "not_done",
    });
  });
});
