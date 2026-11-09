import type { HostRunHandle } from "./hostRun";
import { describe, expect, it, vi } from "vitest";
import { generateSessionTitle } from "./titleGeneration";
import {
  setHarnessModels,
  resetHarnessModelOverlays,
} from "../../../features/sessions/model/models";

describe("shared session title generation", () => {
  it("resolves the selected catalog key to its exact provider-native model", async () => {
    setHarnessModels("codex", [
      {
        id: "codex:cheap-terra",
        harness: "codex",
        name: "Terra",
        nativeId: "provider-terra-model",
      },
    ]);
    try {
      const run = vi.fn().mockResolvedValue('{"title":"Fix links"}');
      await generateSessionTitle(
        { sessionId: "s", cwd: "/p", message: "Fix links", model: "codex:cheap-terra" },
        run,
      );
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ model: "provider-terra-model" }));
    } finally {
      resetHarnessModelOverlays();
    }
  });
  it("forwards the selected title model and settings without substituting conversation defaults", async () => {
    const run = vi.fn().mockResolvedValue('{"title":"Fix links"}');
    await generateSessionTitle(
      {
        sessionId: "s",
        cwd: "/p",
        message: "Fix links",
        model: "selected-terra",
        modelSettings: { effort: "low" },
      },
      run,
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "selected-terra", modelSettings: { effort: "low" } }),
    );
  });
  it("preserves the work reference and account selection from the source message", async () => {
    const run = vi
      .fn()
      .mockResolvedValue('{"title":"Fix links","workItem":{"kind":"pr","number":42}}');
    expect(
      await generateSessionTitle(
        { sessionId: "s", cwd: "/p", message: "Fix PR #42", providerAccountId: "account" },
        run,
      ),
    ).toEqual({ title: "Fix links", workItem: { kind: "pr", number: 42 } });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/p", timeoutMs: 45000, providerAccountId: "account" }),
    );
  });
  it("returns null on a transport error", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    expect(
      await generateSessionTitle({ sessionId: "s", cwd: "/p", message: "Fix links" }, async () => {
        throw new Error("transport");
      }),
    ).toBeNull();
    vi.restoreAllMocks();
  });
});

it("forwards its original background operation and Host source to the text adapter", async () => {
  const source = Object.freeze({}) as HostRunHandle;
  const operation = {};
  const control = Object.freeze({}) as HostRunHandle;
  const context = { operation, hostRun: source, hostControlRun: control };
  let release!: (value: string) => void;
  const run = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const work = generateSessionTitle(
    { sessionId: "parent", cwd: "/p", message: "Fix links", operationContext: context },
    run,
  );
  context.hostRun = Object.freeze({}) as HostRunHandle;
  context.hostControlRun = Object.freeze({}) as HostRunHandle;
  const forwarded = run.mock.calls[0] as unknown as [
    {
      operationContext: {
        operation: object;
        hostRun: HostRunHandle;
        hostControlRun: HostRunHandle;
      };
    },
  ];
  expect(forwarded[0].operationContext.operation).toBe(operation);
  expect(forwarded[0].operationContext.hostRun).toBe(source);
  expect(forwarded[0].operationContext.hostControlRun).toBe(control);
  expect(Object.isFrozen(forwarded[0].operationContext)).toBe(true);
  release('{"title":"Fix links"}');
  await expect(work).resolves.toEqual({ title: "Fix links", workItem: null });
});
