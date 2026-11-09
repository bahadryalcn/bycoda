import { describe, expect, it, vi } from "vitest";
import { NeedsHumanQueue } from "./needs-human";
import { memorySettings } from "./test-support";
import type { SocialPrincipal } from "../social";

const owner: SocialPrincipal = { kind: "owner", actorId: "owner" } as SocialPrincipal;
const session: SocialPrincipal = { kind: "session", actorId: "ai" } as SocialPrincipal;
const input = {
  accountId: "acc",
  kind: "captcha" as const,
  url: "https://x.example/checkpoint",
  jobId: "job-1",
};

describe("NeedsHumanQueue", () => {
  it("opens one item per account, kind and job, and notifies once", async () => {
    const onOpened = vi.fn();
    let next = 0;
    const queue = new NeedsHumanQueue(
      memorySettings(),
      () => 5,
      () => `n${++next}`,
      { onOpened },
    );
    const first = await queue.open(input);
    const again = await queue.open(input);
    expect(again.id).toBe(first.id);
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(await queue.openCount()).toBe(1);
  });

  it("keeps the screenshot identity and lists open items oldest first", async () => {
    let at = 1;
    let next = 0;
    const queue = new NeedsHumanQueue(
      memorySettings(),
      () => at,
      () => `n${++next}`,
    );
    await queue.open({ ...input, screenshotId: "shot-1" });
    at = 2;
    await queue.open({ ...input, kind: "login", jobId: "job-2" });
    const items = await queue.list();
    expect(items.map((item) => item.kind)).toEqual(["captcha", "login"]);
    expect(items[0]!.screenshotId).toBe("shot-1");
  });

  it("refuses resolution by anyone but the owner, and resumes the job once", async () => {
    const onResolved = vi.fn();
    const queue = new NeedsHumanQueue(
      memorySettings(),
      () => 1,
      () => "n1",
      { onResolved },
    );
    await queue.open(input);
    await expect(queue.resolve("n1", session)).rejects.toThrow("Only the owner");
    expect(onResolved).not.toHaveBeenCalled();
    await queue.resolve("n1", owner);
    await queue.resolve("n1", owner);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(await queue.list()).toHaveLength(0);
  });
});
