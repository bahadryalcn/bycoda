import { expect, it } from "vitest";
import { EngineOperations } from "./engine-operations";

it("orders accepted events and settlement while an unrelated session progresses", async () => {
  const operations = new EngineOperations();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: string[] = [];
  const event = operations.enqueue("a", async () => {
    seen.push("event-start");
    await held;
    seen.push("event-committed");
  });
  const settled = operations.enqueue("a", () => {
    seen.push("settled");
  });
  await operations.run("b", () => {
    seen.push("other-session");
  });
  expect(seen).toEqual(["event-start", "other-session"]);
  release();
  await Promise.all([event, settled]);
  expect(seen).toEqual(["event-start", "other-session", "event-committed", "settled"]);
});

it("allows awaited nested operations and retires inherited owners before later callbacks", async () => {
  const operations = new EngineOperations();
  let later!: () => Promise<string>;
  await operations.run("a", async () => {
    expect(await operations.run("a", () => "nested")).toBe("nested");
    later = () => operations.run("a", () => "later");
  });
  expect(await later()).toBe("later");
  await expect(
    operations.run("a", () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  expect(await operations.run("a", () => "after failure")).toBe("after failure");
  await operations.drain();
});
