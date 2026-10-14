import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  harnessSupportsAttachments,
  setHarnessAttachmentsSupported,
} from "../../../../features/sessions/model/session";
import type { SendTurnInput } from "../../core/types";

const mock = vi.hoisted(() => ({
  transport: undefined as "acp" | "stream-json" | undefined,
  acp: vi.fn(async () => undefined),
  stream: vi.fn(async () => undefined),
}));

vi.mock("../../core/child", () => ({
  resolveAntigravityBinary: async () => ({
    path: "/bin/agy",
    args: [],
    transport: mock.transport,
  }),
}));
vi.mock("./antigravity", () => ({
  sendAntigravityTurn: mock.acp,
  steerAntigravityTurn: vi.fn(),
  cancelAntigravityTurn: vi.fn(async () => undefined),
  respondAntigravityApproval: vi.fn(),
  stopAntigravitySession: vi.fn(async () => undefined),
  forgetAntigravitySession: vi.fn(async () => undefined),
  bindAntigravitySession: vi.fn(),
}));
vi.mock("./antigravityStream", () => ({
  sendAntigravityStreamTurn: mock.stream,
  cancelAntigravityStreamTurn: vi.fn(async () => undefined),
  stopAntigravityStreamSession: vi.fn(async () => undefined),
  forgetAntigravityStreamSession: vi.fn(async () => undefined),
  bindAntigravityStreamSession: vi.fn(),
}));
vi.mock("./antigravityCatalog", () => ({ refreshAntigravityCatalog: vi.fn() }));

const { antigravityAdapter } = await import("./antigravityAdapter");

const input = { sessionId: "s" } as SendTurnInput;

describe("antigravity adapter transport choice", () => {
  beforeEach(() => {
    mock.acp.mockClear();
    mock.stream.mockClear();
  });

  it("uses ACP when the host reports it, or says nothing", async () => {
    for (const transport of ["acp", undefined] as const) {
      mock.transport = transport;
      await antigravityAdapter.sendTurn(input);
    }
    expect(mock.acp).toHaveBeenCalledTimes(2);
    expect(mock.stream).not.toHaveBeenCalled();
  });

  it("uses stream-json when only the agy CLI was found", async () => {
    mock.transport = "stream-json";
    await antigravityAdapter.sendTurn(input);
    expect(mock.stream).toHaveBeenCalledWith(input, {
      path: "/bin/agy",
      args: [],
      transport: "stream-json",
    });
    expect(mock.acp).not.toHaveBeenCalled();
  });

  it("cannot steer a running turn", () => {
    expect(antigravityAdapter.canSteer).toBe(false);
  });
});

describe("antigravity attachment support", () => {
  it("is on until the stream-json transport turns it off", () => {
    expect(harnessSupportsAttachments("antigravity")).toBe(true);
    setHarnessAttachmentsSupported("antigravity", false);
    expect(harnessSupportsAttachments("antigravity")).toBe(false);
    expect(harnessSupportsAttachments("claude")).toBe(true);
    setHarnessAttachmentsSupported("antigravity", true);
    expect(harnessSupportsAttachments("antigravity")).toBe(true);
    // fx never accepts them, whatever is toggled for other harnesses.
    expect(harnessSupportsAttachments("fx")).toBe(false);
  });
});
