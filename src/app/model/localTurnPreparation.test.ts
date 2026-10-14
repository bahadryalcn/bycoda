import { describe, expect, it, vi } from "vitest";
import { prepareLocalTurn } from "./localTurnPreparation";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
describe("local preparation ownership", () => {
  it("overlaps independent reads but waits for the checkpoint before ready", async () => {
    const checkpoint = deferred<void>();
    const attachments = vi.fn().mockResolvedValue(["file"]);
    const prompt = vi.fn().mockResolvedValue("prompt");
    let ready = false;
    const result = prepareLocalTurn({
      checkpoint: () => checkpoint.promise,
      attachments,
      prompt,
      isCurrent: () => true,
    }).then((value) => {
      ready = true;
      return value;
    });
    await Promise.resolve();
    expect(attachments).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledOnce();
    expect(ready).toBe(false);
    checkpoint.resolve();
    expect(await result).toEqual({ attachments: ["file"], prompt: "prompt" });
  });
  it("rejects stale ownership after an in-flight preparation", async () => {
    const checkpoint = deferred<void>();
    let current = true;
    const result = prepareLocalTurn({
      checkpoint: () => checkpoint.promise,
      attachments: async () => [],
      prompt: async () => "prompt",
      isCurrent: () => current,
    });
    current = false;
    checkpoint.resolve();
    expect(await result).toBeNull();
  });
  it("never reports ready after a required checkpoint failure", async () => {
    await expect(
      prepareLocalTurn({
        checkpoint: async () => {
          throw new Error("disk failed");
        },
        attachments: async () => [],
        prompt: async () => "prompt",
        isCurrent: () => true,
      }),
    ).rejects.toThrow("disk failed");
  });
});
