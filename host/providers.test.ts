import { expect, it, vi } from "vitest";
import {
  REMOTE_PROVIDERS,
  isRemoteProvider,
  requireHostDescriptor,
} from "../src/features/connections/model/protocol";
import { hostProviders, withMachineSkillPolicy, type HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import { HARNESSES } from "../src/features/sessions/model/session";

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
  const provider = withMachineSkillPolicy("codex", transport, () => policy);
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
  const prepared = provider.prepareSendPolicy!()(input);
  await provider.send(prepared);
  const sent = vi.mocked(transport.send).mock.calls[0][0];
  expect(sent).toBe(prepared);
  expect(sent.runtimeInstructions?.match(/Disabled skill names:/g)).toHaveLength(1);
  expect(sent.runtimeInstructions).toContain("Runtime tools.");
  expect(sent.skillPolicy).toEqual(policy);
  expect(() =>
    provider.send({
      ...input,
      text: "/forbidden do it",
      skillPolicy: { disabledNames: [], disabledPaths: [] },
    }),
  ).toThrow("disabled in bycoda");
  expect(transport.send).toHaveBeenCalledTimes(1);
});
