import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { OwnerRpcRequest } from "./owner-rpc-context";

const generate = vi.hoisted(() => vi.fn());
vi.mock("../appearance/background-image", () => ({ generateAppearanceBackgroundImage: generate }));
vi.mock("../appearance/background-suggestions", () => ({ generateBackgroundSuggestion: vi.fn() }));
vi.mock("../appearance/theme-suggestions", () => ({ generateThemeSuggestions: generate }));

const { handleAppearanceRpc } = await import("./rpc-appearance");

function request(method: string, tokenHash: string, params: Record<string, unknown>) {
  return { input: { method }, tokenHash, params, domainContext: {} } as unknown as OwnerRpcRequest;
}

it("scopes cancellation to one active generation and its initiating credential", async () => {
  generate.mockImplementation(
    (_params: unknown, _adapter: unknown, signal: AbortSignal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  );
  const first = randomUUID();
  const second = randomUUID();
  const firstImage = handleAppearanceRpc(
    null,
    request("appearance.backgroundImage", "owner", {
      generationId: first,
      prompt: "Forest",
      provider: "codex",
    }),
  );
  const secondImage = handleAppearanceRpc(
    null,
    request("appearance.themeSuggestions", "owner", {
      generationId: second,
      prompt: "Ocean",
      harness: "codex",
      model: "auto",
    }),
  );
  const firstStopped = expect(firstImage).rejects.toMatchObject({ name: "AbortError" });
  const secondStopped = expect(secondImage).rejects.toMatchObject({ name: "AbortError" });
  const cancel = async (generationId: string, tokenHash = "owner") => {
    const rpc = request("appearance.cancelGeneration", tokenHash, { generationId });
    await handleAppearanceRpc(null, rpc);
    return rpc.result;
  };
  await expect(cancel(first, "other")).resolves.toEqual({ cancelled: false });
  expect(generate.mock.calls[0][2].aborted).toBe(false);
  await expect(cancel(first)).resolves.toEqual({ cancelled: true });
  await firstStopped;
  expect(generate.mock.calls[1][2].aborted).toBe(false);
  await expect(cancel(first)).resolves.toEqual({ cancelled: false });
  await expect(cancel(second)).resolves.toEqual({ cancelled: true });
  await secondStopped;
});
