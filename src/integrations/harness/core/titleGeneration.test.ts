import type { HostRunHandle } from "./hostRun";
import { describe, expect, it, vi } from "vitest";
import { generateSessionTitle } from "./titleGeneration";

describe("ortak oturum başlığı üretimi", () => {
  it("kaynak mesajdaki iş referansını ve hesap seçimini korur", async () => {
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
  it("taşıma hatasında null döner", async () => {
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
