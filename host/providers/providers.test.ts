import { expect, it, vi } from "vitest";
import {
  REMOTE_PROVIDERS,
  isRemoteProvider,
  requireHostDescriptor,
} from "../../src/features/connections/model/protocol";
import { hostProviders, withMachineSkillPolicy, type HostProvider } from "./providers";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import { HARNESSES } from "../../src/features/sessions/model/session";

it("does not offer Claude steering while its adapter only supports queued follow-ups", () => {
  expect(hostProviders.claude.steer).toBeUndefined();
});

it("rechecks machine policy after async discovery and at exact prepared dispatch", async () => {
  const transport = { send: vi.fn(async () => {}) } as unknown as HostProvider;
  let release!: () => void;
  const discovery = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disabledNames: string[] = [];
  const installed = vi.fn(async () => {
    await discovery;
    return [];
  });
  const provider = withMachineSkillPolicy(
    "codex",
    transport,
    () => ({ disabledNames, disabledPaths: [] }),
    installed,
  );
  const input: SendTurnInput = {
    sessionId: "session",
    cwd: "/isolated",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    onEvent: () => {},
    text: "/audit-example",
  };
  const pending = provider.prepareOperationPolicy!(input);
  disabledNames = ["audit-example"];
  release();
  await expect(pending).rejects.toThrow("disabled in bycoda");
  expect(transport.send).not.toHaveBeenCalled();
  disabledNames = [];
  const prepared = await provider.prepareOperationPolicy!(input);
  disabledNames = ["audit-example"];
  expect(() => provider.send(prepared)).toThrow("disabled in bycoda");
  expect(transport.send).not.toHaveBeenCalled();
});

it("dispatches exact prepared input without another await and rediscovers clones", async () => {
  const transport = { send: vi.fn(async () => {}) } as unknown as HostProvider;
  const installed = vi.fn(async () => []);
  const provider = withMachineSkillPolicy(
    "codex",
    transport,
    () => ({ disabledNames: [], disabledPaths: [] }),
    installed,
  );
  const input: SendTurnInput = {
    sessionId: "session",
    cwd: "/isolated",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    onEvent: () => {},
    text: "Continue",
  };
  const prepared = await provider.prepareOperationPolicy!(input);
  const dispatched = provider.send(prepared);
  expect(transport.send).toHaveBeenCalledWith(prepared);
  expect(vi.mocked(transport.send).mock.calls[0][0]).toBe(prepared);
  expect(installed).toHaveBeenCalledTimes(1);
  await dispatched;
  await provider.send({ ...prepared });
  expect(installed).toHaveBeenCalledTimes(2);
});

it("enforces fresh installation targets on native send, compact, rewind and follow-up", async () => {
  const transport: HostProvider = {
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    rewind: vi.fn(async () => ({ supported: false })),
    steer: vi.fn(async () => {}),
  } as unknown as HostProvider;
  const policy = { disabledNames: ["owner-disabled"], disabledPaths: [] as string[] };
  let target = "codex";
  const provider = withMachineSkillPolicy(
    "claude",
    transport,
    () => policy,
    () => [
      {
        name: "targeted",
        description: "",
        scope: "user",
        source: "agents",
        path: "/skills/targeted/SKILL.md",
        installProvider: target,
      },
    ],
  );
  const input: SendTurnInput = {
    sessionId: "session",
    cwd: "/project",
    model: "claude:test",
    runtimeMode: "supervised",
    onEvent: () => {},
    text: "Continue.",
  };
  await provider.send(input);
  expect(vi.mocked(transport.send).mock.calls[0][0].skillPolicy?.disabledNames).toEqual([
    "owner-disabled",
    "targeted",
  ]);
  await provider.compact!(input);
  expect(vi.mocked(transport.compact!).mock.calls[0][0].skillPolicy?.disabledPaths).toEqual([
    "/skills/targeted/SKILL.md",
  ]);
  await provider.rewind!({ ...input, text: undefined });
  expect(vi.mocked(transport.rewind!).mock.calls[0][0].skillPolicy?.disabledNames).toContain(
    "targeted",
  );
  await expect(provider.steer!({ ...input, text: "$targeted inspect" })).rejects.toThrow(
    "disabled in bycoda",
  );
  target = "all";
  await provider.send(input);
  expect(vi.mocked(transport.send).mock.calls[1][0].skillPolicy).toEqual(policy);
  expect(policy.disabledNames).toEqual(["owner-disabled"]);
});

it("exposes every local harness through the remote host contract", () => {
  expect(Object.keys(hostProviders).sort()).toEqual([...REMOTE_PROVIDERS].sort());
  expect([...REMOTE_PROVIDERS].sort()).toEqual([...HARNESSES].sort());
  for (const provider of REMOTE_PROVIDERS) {
    expect(isRemoteProvider(provider)).toBe(true);
    expect(hostProviders[provider].send).toBeTypeOf("function");
    expect(hostProviders[provider].cancel).toBeTypeOf("function");
    expect(hostProviders[provider].bind).toBeTypeOf("function");
    expect(hostProviders[provider].approve).toBeTypeOf("function");
  }
  expect(
    requireHostDescriptor({
      protocolVersion: 1,
      environmentId: "host",
      name: "fixture",
      providers: [...REMOTE_PROVIDERS],
      capabilities: [],
    }).providers,
  ).toHaveLength(REMOTE_PROVIDERS.length);
});

it("applies machine restrictions once to trusted preparation and rejects forged policy overrides", async () => {
  const transport: HostProvider = {
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const policy = { disabledNames: ["forbidden"], disabledPaths: ["C:/skills/forbidden/SKILL.md"] };
  const provider = withMachineSkillPolicy(
    "codex",
    transport,
    () => policy,
    () => [],
  );
  const input: SendTurnInput = {
    sessionId: "session",
    cwd: "/project",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    onEvent: () => {},
    text: "Continue.",
    runtimeInstructions: "Runtime tools.",
  };
  const prepared = await provider.prepareSendPolicy!()(input);
  await provider.send(prepared);
  const sent = vi.mocked(transport.send).mock.calls[0][0];
  expect(sent).toBe(prepared);
  expect(sent.runtimeInstructions?.match(/Disabled skill names:/g)).toHaveLength(1);
  expect(sent.runtimeInstructions).toContain("Runtime tools.");
  expect(sent.skillPolicy).toEqual(policy);
  await expect(
    provider.send({
      ...input,
      text: "/forbidden do it",
      skillPolicy: { disabledNames: [], disabledPaths: [] },
    }),
  ).rejects.toThrow("disabled in bycoda");
  expect(transport.send).toHaveBeenCalledTimes(1);
});
