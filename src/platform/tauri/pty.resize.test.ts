import { beforeEach, expect, it, vi } from "vitest";

const pending: Array<() => void> = [];
const invoke = vi.fn(
  (_command: string, _args: unknown) => new Promise<void>((resolve) => pending.push(resolve)),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const { resizePty } = await import("./pty");

async function settleNext() {
  pending.shift()!();
  await new Promise((resolve) => setTimeout(resolve));
}

beforeEach(() => {
  invoke.mockClear();
  pending.length = 0;
});

it("runs one resize at a time per terminal and finishes on the latest size", async () => {
  const first = resizePty("a", 80, 24);
  void resizePty("a", 90, 30);
  const last = resizePty("a", 100, 40);
  expect(invoke.mock.calls.map((call) => call[1])).toEqual([{ id: "a", cols: 80, rows: 24 }]);

  await settleNext();
  expect(invoke.mock.calls.map((call) => call[1])).toEqual([
    { id: "a", cols: 80, rows: 24 },
    { id: "a", cols: 100, rows: 40 },
  ]);
  await settleNext();
  await Promise.all([first, last]);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("does not serialize different terminals behind each other", () => {
  void resizePty("b", 80, 24);
  void resizePty("c", 80, 24);
  expect(invoke).toHaveBeenCalledTimes(2);
});
