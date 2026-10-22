import { beforeEach, expect, it, vi } from "vitest";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  register: vi.fn(),
  run: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir }));
vi.mock("../src/integrations/harness/core/register", () => ({
  registerBuiltinHarnesses: mocks.register,
}));
vi.mock("../src/integrations/harness/core/registry", () => ({
  runHarnessTextPrompt: mocks.run,
}));
import { socialAgentGenerator } from "./social-agent";
beforeEach(() => {
  mocks.mkdir.mockReset().mockResolvedValue(undefined);
  mocks.register.mockReset();
  mocks.run.mockReset();
});
it("uses the saved provider/model in the common text runner and an empty host workspace", async () => {
  mocks.run.mockResolvedValue('{"text":"Public fact"}');
  const signal = new AbortController().signal;
  const generate = socialAgentGenerator("host-social");
  expect(
    await generate(
      { provider: "antigravity", model: "antigravity:chosen-model" },
      "Trusted public prompt",
      signal,
    ),
  ).toBe('{"text":"Public fact"}');
  expect(mocks.mkdir).toHaveBeenCalledWith(join("host-social", "text-workspace"), {
    recursive: true,
    mode: 0o700,
  });
  expect(mocks.register).toHaveBeenCalledOnce();
  expect(mocks.run).toHaveBeenCalledWith({
    harness: "antigravity",
    model: "chosen-model",
    cwd: join("host-social", "text-workspace"),
    prompt: "Trusted public prompt",
    intent: "plan",
    ephemeral: true,
    timeoutMs: 90_000,
    signal,
  });
});
it("an unsupported or unauthenticated saved runner fails without selecting another provider", async () => {
  mocks.run.mockRejectedValue(new Error("Runner unavailable"));
  await expect(
    socialAgentGenerator("host-social")(
      { provider: "antigravity" },
      "Trusted fact",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Runner unavailable");
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0][0].harness).toBe("antigravity");
});
