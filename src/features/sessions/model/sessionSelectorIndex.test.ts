import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import { selectSessionById } from "./sessionsStore";
describe("indexed session selector", () => {
  it("isolates immutable updates and preserves first duplicate semantics", () => {
    const a = newSession("cursor", "/a");
    a.id = "a";
    const b = newSession("cursor", "/b");
    b.id = "b";
    const initial = [a, b];
    expect(selectSessionById(initial, "b")).toBe(b);
    const changed = {
      ...a,
      blocks: [...a.blocks, { id: "text", role: "assistant" as const, text: "token" }],
    };
    const next = [changed, b];
    expect(selectSessionById(next, "a")).toBe(changed);
    expect(selectSessionById(next, "b")).toBe(b);
    expect(selectSessionById([a, { ...a }], "a")).toBe(a);
    expect(selectSessionById(next, undefined)).toBeUndefined();
  });
});
